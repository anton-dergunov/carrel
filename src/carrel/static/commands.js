// What the page can be asked to do from outside it: the Mac app's menus call
// `window.carrel.command(name)`, and get back whether it did anything (Close Tab on the library
// closes the window instead). The actions themselves are the page's own; this only names them.
//
// In a browser the page takes one key for itself, ⌘F (Ctrl+F elsewhere): find in the paper finds
// on pages PDF.js has not drawn, which the browser's own find cannot. The browser keeps the rest.

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

/** The key of the tab `step` away from `active` among `keys`, wrapping round. */
export function stepTab(keys, active, step) {
  if (!keys.length) return active;
  const at = Math.max(0, keys.indexOf(active));
  return keys[(at + step + keys.length) % keys.length];
}

export function startCommands(commands) {
  const command = (name) => runCommand(commands, String(name));
  window.carrel = Object.freeze({ command });
  const mac = /Mac/.test(navigator.platform);
  document.addEventListener('keydown', (event) => {
    if (!event.defaultPrevented && isFindKey(event, mac) && command('find')) event.preventDefault();
  });
}
