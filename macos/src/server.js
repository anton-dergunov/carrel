// Finds the carrel serving this Mac, or starts one.
//
// A carrel already answering on the port (the login agent's, or one started in a terminal) is only
// shown, and never stopped. With none, the app runs `carrel serve` itself, holding the server's
// stdin: carrel stops when it closes, so a server the app started goes with it, even when the app
// is killed.

import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AGENT_LABEL,
  canStart,
  findOnPath,
  originOf,
  parseAgent,
  parseEnvironment,
  parsePing,
  resolveSetup,
  serveArguments,
  serverEnvironment,
  shellArguments,
} from './setup.js';

export const LOG = join(homedir(), 'Library/Logs/carrel-app.log');

// How long a starting carrel has to answer its ping, and a stopping one to close its chats.
const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;
// How long the login shell has to print its environment: startup files that wait for input must
// not hold the app up.
const SHELL_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The server and what the app knows of it. `state` is one of: probing (looking on the port),
 * attached (someone else's, shown and never stopped), starting, running (the app's own), stopped
 * (the app's own, stopped from the menu), needsSetup (none answering, and not enough known to start
 * one), failed (with `reason`). It emits 'change' with each.
 */
export class Server extends EventEmitter {
  constructor(settings) {
    super();
    this.settings = settings;
    this.state = 'probing';
    this.ping = null;
    this.reason = '';
    this.shell = null;
    this.child = null;
    this.stopping = false;
    this.setup = resolveSetup({ settings, agent: readAgent() });
  }

  /** Whether the server showing is the app's own, so quitting stops it. */
  get owns() {
    return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null);
  }

  /** Where carrel's page is, once a carrel answers. */
  get pageURL() {
    return this.ping ? `${originOf(this.setup)}/` : null;
  }

  set(state, { ping = null, reason = '' } = {}) {
    this.state = state;
    this.ping = ping;
    this.reason = reason;
    this.emit('change', state);
  }

  /** Looks for a carrel, and starts one when none answers and the setup allows it. */
  async connect() {
    if (this.owns) return;
    this.set('probing');
    await this.resolve();
    const ping = await pingAt(originOf(this.setup));
    if (ping) this.set('attached', { ping });
    else if (canStart(this.setup)) await this.start();
    else this.set('needsSetup');
  }

  /** The settings changed: the app's own server is started again with them; someone else's is
   * left alone unless the port moved. */
  async reconnect(settings) {
    this.settings = settings;
    if (this.owns) await this.stop();
    await this.connect();
  }

  async resolve() {
    this.shell ??= await readShell();
    this.setup = resolveSetup({
      settings: this.settings,
      agent: readAgent(),
      shell: this.shell,
      carrelOnPath: findOnPath('carrel', this.shell.PATH),
    });
  }

  async start() {
    if (this.owns) return;
    const { setup } = this;
    if (!canStart(setup)) return this.set('needsSetup');
    this.set('starting');
    const args = serveArguments(setup);
    const log = openLog(`\n--- ${new Date().toString()} ${setup.command} ${args.join(' ')}\n`);
    let child;
    try {
      // stdin a pipe the app holds open: `--exit-with-stdin` stops carrel when it closes.
      child = spawn(setup.command, args, {
        cwd: setup.library,
        env: serverEnvironment(process.env, this.shell ?? {}),
        stdio: ['pipe', log, log],
      });
    } catch (error) {
      return this.set('failed', { reason: `Carrel could not run ${setup.command}: ${error.message}` });
    } finally {
      closeSync(log);
    }
    child.on('error', (error) => {
      if (this.child === child) this.set('failed', { reason: `Carrel could not run ${setup.command}: ${error.message}` });
    });
    child.on('exit', (code) => this.ended(child, code));
    this.child = child;
    this.stopping = false;

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline && this.child === child) {
      const ping = await pingAt(originOf(setup));
      // A carrel that found another one answering steps aside and exits 0: show that one.
      if (ping) return this.set(this.owns ? 'running' : 'attached', { ping });
      await sleep(300);
    }
    if (this.child === child && this.owns) {
      await this.stop();
      this.set('failed', { reason: `Carrel did not answer within ${START_TIMEOUT_MS / 1000} seconds.` });
    }
  }

  /** Stops the app's own server: SIGTERM, which closes its chats, and SIGKILL if it lingers. */
  async stop() {
    const { child } = this;
    if (!child || !this.owns) return;
    this.stopping = true;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
    await gone;
    clearTimeout(timer);
    this.set('stopped');
  }

  ended(child, code) {
    if (child !== this.child) return;
    this.child = null;
    if (this.stopping) {
      this.stopping = false;
      return;
    }
    if (this.state === 'starting' && code === 0) return; // stepped aside: the start loop finds the other
    if (this.state === 'starting' || this.state === 'running') {
      this.set('failed', { reason: `carrel serve stopped (exit code ${code ?? 'none'}).` });
    }
  }
}

/** What answers `/api/ping` on the origin, if it is a carrel. */
export async function pingAt(origin) {
  try {
    const response = await fetch(`${origin}/api/ping`, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    return response.ok ? parsePing(await response.text()) : null;
  } catch {
    return null;
  }
}

/** The login agent's configuration, from its plist, or null. */
function readAgent() {
  try {
    const path = join(homedir(), 'Library/LaunchAgents', `${AGENT_LABEL}.plist`);
    const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    return parseAgent(plist.ProgramArguments);
  } catch {
    return null;
  }
}

/** The variables an interactive login shell sets, read once, or {} when it takes too long. */
function readShell() {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const chunks = [];
    let child;
    try {
      child = spawn(shell, shellArguments(), { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve({});
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({});
    }, SHELL_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', () => resolve({}));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseEnvironment(Buffer.concat(chunks)));
    });
  });
}

function openLog(header) {
  mkdirSync(dirname(LOG), { recursive: true });
  const fd = openSync(LOG, 'a');
  writeSync(fd, header);
  return fd;
}

/** The last lines the latest start wrote to the log, for a failure's page. */
export function logTail(lines = 20) {
  try {
    const text = readFileSync(LOG, 'utf8');
    const run = text.split('\n--- ').at(-1);
    return run.split('\n').slice(1).filter(Boolean).slice(-lines).join('\n');
  } catch {
    return '';
  }
}
