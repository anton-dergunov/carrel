// What the page can be asked to do from outside it: the Mac app's menus call
// `window.carrel.command(name)`, and get back whether it did anything (Close Tab on the library
// closes the window instead). The actions themselves are the page's own; this only names them.
//
// The page takes a few keys for itself, in a browser too: ⌘F (Ctrl+F elsewhere), since find in the
// paper finds on pages PDF.js has not drawn, which the browser's own find cannot; and ⌘= ⌘− ⌘0, and
// + − 0 alone, which zoom the paper or the meaning map rather than the page. Where there is nothing
// of the page's to zoom, ⌘= and the rest are left to the browser (or to the app's menu).

/** Runs the command `name` from `commands`: true when it did something. */
export function runCommand(commands, name) {
  const run = Object.hasOwn(commands, name) ? commands[name] : null;
  return typeof run === 'function' ? run() !== false : false;
}

/** Whether a keydown is the find key: ⌘F on a Mac, Ctrl+F elsewhere, with nothing else held. */
export function isFindKey(event, mac) {
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
}

const ZOOMS = { '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', _: 'zoom-out', 0: 'zoom-reset' };

/** The zoom command a keydown asks for: ⌘= ⌘− ⌘0 on a Mac (Ctrl elsewhere), or with `plain`, the
 * keys alone. Null for anything else. */
export function zoomKey(event, mac, plain = false) {
  if (event.altKey) return null;
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const none = !event.metaKey && !event.ctrlKey;
  if (!(primary || (plain && none))) return null;
  return ZOOMS[event.key] ?? null;
}

/** The key of the tab `step` away from `active` among `keys`, wrapping round. */
export function stepTab(keys, active, step) {
  if (!keys.length) return active;
  const at = Math.max(0, keys.indexOf(active));
  return keys[(at + step + keys.length) % keys.length];
}

/** `plainZoom()`: whether + − 0 alone should zoom now. */
export function startCommands(commands, { plainZoom = () => false } = {}) {
  const command = (name) => runCommand(commands, String(name));
  window.carrel = Object.freeze({ command });
  const mac = /Mac/.test(navigator.platform);
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const typing = event.target?.closest?.('input, textarea, select, [contenteditable]');
    const name = isFindKey(event, mac) ? 'find' : zoomKey(event, mac, !typing && plainZoom());
    if (name && command(name)) event.preventDefault();
  });
}
