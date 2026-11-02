// The app's own page, for when there is no carrel to show: a heading, some text, the log's last
// lines, and buttons, which are `carrel-app://<action>` links the window catches (main.js).

import { escapeHTML } from './setup.js';

export function statusPage(heading, text, { detail = '', buttons = [] } = {}) {
  const links = buttons.map(([label, action]) => `<a class=button href="carrel-app://${escapeHTML(action)}">${escapeHTML(label)}</a>`).join('');
  const pre = detail ? `<pre>${escapeHTML(detail)}</pre>` : '';
  const html = `<!doctype html><meta charset=utf-8><meta name=color-scheme content="light dark">
<title>Carrel</title>
<style>
:root { --text: #2b2b28; --muted: #6b675d; --bg: #fdf6e3; --box: #efe7d1; --accent: #2a6f97; }
@media (prefers-color-scheme: dark) {
  :root { --text: #e8e4d8; --muted: #a8a294; --bg: #1f1f1d; --box: #2c2b28; --accent: #6fb0d6; }
}
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, sans-serif; }
main { max-width: 620px; margin: 12vh auto; padding: 0 32px; }
h1 { font-weight: 600; font-size: 24px; margin: 0 0 8px; }
p { color: var(--muted); white-space: pre-wrap; }
pre { background: var(--box); padding: 12px 14px; border-radius: 8px; font: 12px/1.45 ui-monospace, monospace;
      white-space: pre-wrap; max-height: 40vh; overflow: auto; }
.button { display: inline-block; margin: 8px 8px 0 0; padding: 6px 14px; border-radius: 7px;
          background: var(--accent); color: white; text-decoration: none; }
.button + .button { background: var(--box); color: var(--text); }
</style>
<main><h1>${escapeHTML(heading)}</h1><p>${escapeHTML(text)}</p>${pre}<div>${links}</div></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
