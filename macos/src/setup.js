// What the app finds out before it shows carrel, as plain functions: which carrel to look for and
// how to start one, what answers the port, the login shell's environment, and where a navigation
// goes. Nothing here touches Electron, so the tests load it alone (tests/mac-setup.test.mjs).

import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 8517;
export const AGENT_LABEL = 'com.anton.carrel';

/** Where a setting's value came from, said beside it in Settings. */
export const SOURCES = { settings: 'set here', agent: 'from the login agent', shell: 'from your shell', standard: 'the default' };

/**
 * What the login agent runs, from its plist's ProgramArguments: `carrel serve` and its options, or
 * null when it is not `carrel serve`. `extra` holds the options passed on as they are (`--login`,
 * `--add-dir`).
 */
export function parseAgent(args) {
  if (!Array.isArray(args) || args.length < 2 || args[1] !== 'serve') return null;
  const agent = { command: args[0], library: null, engine: null, port: null, extra: [] };
  for (let i = 2; i + 1 < args.length; i += 2) {
    const [option, value] = [args[i], args[i + 1]];
    if (option === '--library') agent.library = value;
    else if (option === '--engine') agent.engine = value;
    else if (option === '--port') agent.port = Number.parseInt(value, 10) || null;
    else agent.extra.push(option, value);
  }
  return agent;
}

export const expandTilde = (path) => (path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

/**
 * The server the app looks for, and the command that starts one: the first of what Settings says,
 * what the login agent runs, and what the login shell has. `settings` holds strings (empty: find
 * it) and a port (0: find it).
 */
export function resolveSetup({ settings = {}, agent = null, shell = {}, carrelOnPath = null }) {
  const sources = {};
  const pick = (key, choices) => {
    for (const [value, source] of choices) {
      if (value) {
        sources[key] = source;
        return expandTilde(value.trim());
      }
    }
    return null;
  };
  const command = pick('command', [[settings.command, 'settings'], [agent?.command, 'agent'], [carrelOnPath, 'shell']]);
  const library = pick('library', [[settings.library, 'settings'], [agent?.library, 'agent'], [shell.PAPER_LIBRARY, 'shell']]);
  const engine = pick('engine', [[settings.engine, 'settings'], [agent?.engine, 'agent'], [shell.CARREL_ENGINE, 'shell']]);
  let port = DEFAULT_PORT;
  sources.port = 'standard';
  if (settings.port > 0) [port, sources.port] = [settings.port, 'settings'];
  else if (agent?.port > 0) [port, sources.port] = [agent.port, 'agent'];
  // The agent's other options belong to the library it serves.
  const extra = sources.library === 'agent' ? (agent?.extra ?? []) : [];
  return { command, library, engine, port, extra, sources };
}

export const originOf = (setup) => `http://127.0.0.1:${setup.port}`;

/** Enough to start a carrel: a command and a library. */
export const canStart = (setup) => Boolean(setup.command && setup.library);

/** `carrel serve`'s arguments, tied to the app's stdin so the server never outlives it. */
export function serveArguments(setup) {
  const args = ['serve', '--library', setup.library ?? ''];
  if (setup.engine) args.push('--engine', setup.engine);
  return [...args, '--port', String(setup.port), ...setup.extra, '--exit-with-stdin'];
}

/** What a carrel says about itself at `/api/ping`, or null for anything else on the port. */
export function parsePing(data) {
  const ping = typeof data === 'string' ? safeJSON(data) : data;
  if (!ping || ping.app !== 'carrel' || typeof ping.library !== 'string') return null;
  return { app: ping.app, version: String(ping.version ?? ''), library: ping.library, tablet: ping.tablet ?? null };
}

function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The login shell's environment. An app opened from the Finder gets launchd's, whose PATH lacks
// Homebrew's `rg`, `uv` (which runs `paperlib`) and `tailscale`: the same gap the login agent fills
// by carrying the installing shell's PATH.

/** What carrel needs from it: the agent's carried names, and where the library and engine are. */
export const CARRIED = ['PATH', 'XDG_STATE_HOME', 'PAPER_LIBRARY', 'CARREL_ENGINE'];
export const MARKER = '__CARREL_ENVIRONMENT__';
export const FALLBACK_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/** The arguments that make the login shell print its environment after `MARKER`. */
export const shellArguments = () => ['-l', '-i', '-c', `printf '%s' ${MARKER}; env -0`];

/** `env -0`'s output after the marker, as an object; what the startup files printed before it is
 * skipped. */
export function parseEnvironment(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  const at = text.indexOf(MARKER);
  if (at < 0) return {};
  const environment = {};
  for (const entry of text.slice(at + MARKER.length).split('\0')) {
    const equals = entry.indexOf('=');
    if (equals > 0) environment[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return environment;
}

/** The environment carrel runs with: the app's own, with the shell's carried names over it. */
export function serverEnvironment(app, shell) {
  const environment = { ...app };
  for (const name of CARRIED) if (shell[name]) environment[name] = shell[name];
  if (!shell.PATH) environment.PATH = FALLBACK_PATH;
  return environment;
}

/** The first executable `name` along `path`. */
export function findOnPath(name, path) {
  for (const folder of (path || FALLBACK_PATH).split(':')) {
    if (!folder) continue;
    const candidate = join(folder, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

/**
 * Where a navigation in the window goes: 'allow' (carrel's own page, the app's status page),
 * 'browser' (elsewhere on the web), {action} (a button on the status page, `carrel-app://<action>`),
 * or 'cancel'. A paper link (`http://pdf.invalid/…`) is the page's to handle, so it never navigates.
 */
export function route(address, origin) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return 'cancel';
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme === 'about' || scheme === 'data' || scheme === 'devtools') return 'allow';
  if (scheme === 'carrel-app') return { action: url.hostname };
  if (scheme === 'http' || scheme === 'https') {
    if (url.origin === new URL(origin).origin) return 'allow';
    return url.hostname.toLowerCase() === 'pdf.invalid' ? 'cancel' : 'browser';
  }
  return scheme === 'mailto' ? 'browser' : 'cancel';
}

/** Text made safe for the status page's HTML. */
export const escapeHTML = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
