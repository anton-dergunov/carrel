// What goes wrong in the page, sent to the server's log, since the iPad's console can't be
// seen from the laptop: errors, rejected promises, and what the libraries say through
// `console.error` and `console.warn` (PDF.js reports a page whose text it could not read
// that way, and goes on).

const PER_MINUTE = 20;
const LONGEST = 2000;

let sent = [];

function report(level, message, stack = '') {
  const now = Date.now();
  sent = sent.filter((time) => now - time < 60_000);
  if (sent.length >= PER_MINUTE) return;
  sent.push(now);
  const entry = { level, message: clip(message), where: clip(location.pathname), stack: clip(stack) };
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    keepalive: true,
  }).catch(() => {});
}

function clip(text) {
  return text.length > LONGEST ? `${text.slice(0, LONGEST)}…` : text;
}

function describe(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

window.addEventListener('error', (event) => {
  const where = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : '';
  report('error', `${describe(event.error ?? event.message)}${where}`, event.error?.stack ?? '');
});
window.addEventListener('unhandledrejection', (event) => {
  report('unhandled', describe(event.reason), event.reason?.stack ?? '');
});
for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    report(level, args.map(describe).join(' '), args.find((arg) => arg instanceof Error)?.stack ?? '');
  };
}
