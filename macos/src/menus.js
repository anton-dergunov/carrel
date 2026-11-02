// The app's menu bar. Each item that acts on the library runs one of the page's own commands
// (`commands.js`): a menu, not a second implementation.

import { Menu } from 'electron';

/** `actions` holds the app's side: pageCommand(name), closeTab(), zoom(command), reload(),
 * settings(), showLog(). */
export function mainMenu(actions) {
  const page = (label, command, accelerator) => ({ label, accelerator, click: () => actions.pageCommand(command) });
  return Menu.buildFromTemplate([
    {
      label: 'Carrel',
      submenu: [
        { role: 'about', label: 'About Carrel' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: actions.settings },
        { label: 'Show Server Log', click: actions.showLog },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Carrel' },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Carrel' },
      ],
    },
    {
      label: 'File',
      submenu: [
        page('Add Paper…', 'add', 'Cmd+N'),
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'Cmd+W', click: actions.closeTab },
        { role: 'close', label: 'Close Window', accelerator: 'Shift+Cmd+W' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        page('Find…', 'find', 'Cmd+F'),
      ],
    },
    {
      label: 'View',
      submenu: [
        page('Library', 'library', 'Cmd+1'),
        page('Next Tab', 'next-tab', 'Shift+Cmd+]'),
        page('Previous Tab', 'previous-tab', 'Shift+Cmd+['),
        { type: 'separator' },
        page('Ask', 'ask', 'Cmd+L'),
        page('Show or Hide Chat', 'toggle-chat', 'Shift+Cmd+L'),
        { type: 'separator' },
        // The page's own settings (colours, text sizes, the chat's); ⌘, is the app's.
        page('Page Settings…', 'settings', 'Alt+Cmd+,'),
        { type: 'separator' },
        // The paper's or the meaning map's zoom, as the page decides; the whole page's otherwise.
        { label: 'Actual Size', accelerator: 'Cmd+0', click: () => actions.zoom('zoom-reset') },
        { label: 'Zoom In', accelerator: 'Cmd+=', click: () => actions.zoom('zoom-in') },
        { label: 'Zoom Out', accelerator: 'Cmd+-', click: () => actions.zoom('zoom-out') },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'Cmd+R', click: actions.reload },
        { role: 'toggleDevTools', label: 'Developer Tools', accelerator: 'Alt+Cmd+I' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'windowMenu',
    },
  ]);
}
