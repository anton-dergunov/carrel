import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { test } from 'node:test';
import {
  FALLBACK_PATH,
  MARKER,
  canStart,
  escapeHTML,
  originOf,
  parseAgent,
  parseEnvironment,
  parsePing,
  resolveSetup,
  route,
  serveArguments,
  serverEnvironment,
} from '../macos/src/setup.js';

const agentArguments = [
  '/repo/.venv/bin/carrel', 'serve', '--library', '/Users/someone/papers',
  '--engine', '/Users/someone/engine', '--port', '8600', '--add-dir', '/Users/someone/notes',
];

test("the agent's plist gives its command and options", () => {
  const agent = parseAgent(agentArguments);
  assert.equal(agent.command, '/repo/.venv/bin/carrel');
  assert.equal(agent.library, '/Users/someone/papers');
  assert.equal(agent.engine, '/Users/someone/engine');
  assert.equal(agent.port, 8600);
  assert.deepEqual(agent.extra, ['--add-dir', '/Users/someone/notes']);
  assert.equal(parseAgent(['/bin/carrel', 'tools']), null);
});

test('with the agent installed nothing needs setting', () => {
  const setup = resolveSetup({
    agent: parseAgent(agentArguments),
    shell: { PAPER_LIBRARY: '/elsewhere' },
    carrelOnPath: '/usr/local/bin/carrel',
  });
  assert.equal(setup.command, '/repo/.venv/bin/carrel');
  assert.equal(setup.library, '/Users/someone/papers');
  assert.equal(setup.port, 8600);
  assert.equal(setup.sources.library, 'agent');
  assert.deepEqual(serveArguments(setup), [
    'serve', '--library', '/Users/someone/papers', '--engine', '/Users/someone/engine',
    '--port', '8600', '--add-dir', '/Users/someone/notes', '--exit-with-stdin',
  ]);
});

test('settings come first and the shell last', () => {
  const setup = resolveSetup({ settings: { library: '~/mine' }, agent: parseAgent(agentArguments) });
  assert.equal(setup.library, `${homedir()}/mine`);
  assert.equal(setup.sources.library, 'settings');
  // The agent's other options belong to its library, not to this one.
  assert.ok(!serveArguments(setup).includes('--add-dir'));

  const shellOnly = resolveSetup({
    shell: { PAPER_LIBRARY: '/papers', CARREL_ENGINE: '/engine' },
    carrelOnPath: '/bin/carrel',
  });
  assert.equal(shellOnly.command, '/bin/carrel');
  assert.equal(shellOnly.library, '/papers');
  assert.equal(shellOnly.engine, '/engine');
  assert.equal(shellOnly.port, 8517);
  assert.equal(shellOnly.sources.command, 'shell');
  assert.ok(canStart(shellOnly));
});

test('with nothing found there is nothing to start', () => {
  const setup = resolveSetup({});
  assert.ok(!canStart(setup));
  assert.equal(originOf(setup), 'http://127.0.0.1:8517');
});

test("only a carrel's ping counts", () => {
  const ping = parsePing('{"app":"carrel","version":"0.1.0","library":"/p","tablet":"https://m.ts.net:8443/"}');
  assert.equal(ping.tablet, 'https://m.ts.net:8443/');
  // An older carrel says nothing of the tablet.
  assert.ok(parsePing('{"app":"carrel","version":"0.1.0","library":"/p"}'));
  assert.equal(parsePing('{"app":"lectern","version":"1","library":"/p"}'), null);
  assert.equal(parsePing('<html>'), null);
});

test('the environment is read after the marker', () => {
  const output = Buffer.from(`Welcome! fortune of the day\n${MARKER}PATH=/opt/homebrew/bin:/usr/bin\0NOTE=a=b\nc\0EMPTY=\0`);
  const parsed = parseEnvironment(output);
  assert.equal(parsed.PATH, '/opt/homebrew/bin:/usr/bin');
  assert.equal(parsed.NOTE, 'a=b\nc');
  assert.equal(parsed.EMPTY, '');
  assert.deepEqual(parseEnvironment('no marker'), {});
});

test("the server gets the shell's carried names only", () => {
  const environment = serverEnvironment(
    { PATH: '/usr/bin:/bin', HOME: '/Users/someone' },
    { PATH: '/opt/homebrew/bin:/usr/bin', PAPER_LIBRARY: '/papers', SECRET: 'x' },
  );
  assert.equal(environment.PATH, '/opt/homebrew/bin:/usr/bin');
  assert.equal(environment.PAPER_LIBRARY, '/papers');
  assert.equal(environment.HOME, '/Users/someone');
  assert.equal(environment.SECRET, undefined);
  // A shell that could not be read still finds Homebrew's commands.
  assert.equal(serverEnvironment({ PATH: '/usr/bin' }, {}).PATH, FALLBACK_PATH);
});

const origin = 'http://127.0.0.1:8517/';

test("carrel's own pages stay in the window", () => {
  assert.equal(route('http://127.0.0.1:8517/read/a.pdf', origin), 'allow');
  assert.equal(route('about:blank', origin), 'allow');
});

test('the rest of the web opens in the browser', () => {
  assert.equal(route('https://arxiv.org/abs/1606.07792', origin), 'browser');
  // Another port on this Mac is another app.
  assert.equal(route('http://127.0.0.1:9000/', origin), 'browser');
  assert.equal(route('mailto:a@example.com', origin), 'browser');
});

test('paper links and other schemes go nowhere', () => {
  assert.equal(route('http://pdf.invalid/a.pdf?page=2', origin), 'cancel');
  assert.equal(route('file:///etc/passwd', origin), 'cancel');
  assert.equal(route('javascript:alert(1)', origin), 'cancel');
});

test("the status page's buttons are actions, and its text is escaped", () => {
  assert.deepEqual(route('carrel-app://retry', origin), { action: 'retry' });
  assert.equal(escapeHTML('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});
