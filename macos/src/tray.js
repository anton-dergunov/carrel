// Carrel in the menu bar, when Settings turns it on: a click shows or hides the window, and a right
// click (or a Control-click) opens its menu.

import { Menu, Tray, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';

// Lucide's `library` (ISC), drawn by scripts/icons.py as a template image: macOS colours it.
const ICON = fileURLToPath(new URL('../resources/trayTemplate.png', import.meta.url));

/** `app` holds: toggleWindow(), openWindow(), statusLine(), server, copyTabletAddress(),
 * startServer(), stopServer(), settings(), quit(). */
export function createTray(app) {
  const image = nativeImage.createFromPath(ICON);
  image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip('Carrel');
  tray.on('click', (event) => (event.ctrlKey ? tray.popUpContextMenu(menu(app)) : app.toggleWindow()));
  tray.on('right-click', () => tray.popUpContextMenu(menu(app)));
  return tray;
}

function menu(app) {
  const { server } = app;
  const tablet = server.ping?.tablet;
  const items = [
    { label: app.statusLine(), enabled: false },
    { type: 'separator' },
    { label: 'Open Carrel', click: app.openWindow },
    { label: 'Copy Tablet Address', enabled: Boolean(tablet), toolTip: tablet ?? 'Not published on the tailnet', click: app.copyTabletAddress },
  ];
  if (['running', 'starting'].includes(server.state)) items.push({ label: 'Stop Server', click: app.stopServer });
  else if (['stopped', 'failed', 'needsSetup'].includes(server.state)) items.push({ label: 'Start Server', click: app.startServer });
  items.push({ type: 'separator' }, { label: 'Settings…', click: app.settings }, { label: 'Quit Carrel', click: app.quit });
  return Menu.buildFromTemplate(items);
}
