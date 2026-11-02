// Carrel in a window of its own, on Chromium: carrel's page, the server found or started behind it,
// and the menu bar item when Settings turns it on. The page is the same one the tablet loads; the
// app adds no way in, and its menus only run the page's commands.

import { BrowserWindow, Menu, app, clipboard, ipcMain, nativeTheme, screen, session, shell, dialog } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEnabled as loginItemEnabled, launchedAtLogin, setEnabled as setLoginItem, takeOverSwiftLoginItem } from './login-item.js';
import { mainMenu } from './menus.js';
import { LOG, Server, logTail } from './server.js';
import { loadSettings, saveSettings } from './settings.js';
import { SOURCES, originOf, route } from './setup.js';
import { statusPage } from './status.js';
import { createTray } from './tray.js';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

app.setName('Carrel');
app.setAboutPanelOptions({ applicationName: 'Carrel', applicationVersion: app.getVersion(), copyright: 'MIT licence' });
if (!app.requestSingleInstanceLock()) app.exit(0);

let settings;
let server;
let window = null;
let settingsWindow = null;
let tray = null;
let menu = null;
let showingStatus = false;
let quitting = false;
/** Settings opens by itself once, when nothing is known to start a carrel with. */
let askedForSetup = false;

app.whenReady().then(() => {
  settings = loadSettings();
  takeOverSwiftLoginItem();
  server = new Server(settings);
  menu = mainMenu({ pageCommand, closeTab, zoom, reload, settings: showSettings, showLog });
  Menu.setApplicationMenu(menu);
  // The page may write to the clipboard (a code block's Copy) and go full screen; nothing else.
  session.defaultSession.setPermissionRequestHandler((_, permission, done) =>
    done(['clipboard-sanitized-write', 'fullscreen'].includes(permission)),
  );
  ipcSettings();

  makeWindow();
  server.on('change', show);
  setMenuBarItem(settings.showInMenuBar);
  // Opened at login with the menu bar item, Carrel waits there; opened by hand, it shows itself.
  if (settings.showInMenuBar && launchedAtLogin()) app.setActivationPolicy('accessory');
  else openWindow();
  void server.connect();
});

app.on('second-instance', () => openWindow());
app.on('activate', () => openWindow());
app.on('window-all-closed', () => {});

/** A server the app started is stopped first, so its chats close before it goes. */
app.on('before-quit', (event) => {
  quitting = true;
  if (!server?.owns) return;
  event.preventDefault();
  server.stop().then(() => app.quit());
});

// The window.

function makeWindow() {
  const bounds = savedBounds();
  window = new BrowserWindow({
    ...bounds,
    minWidth: 700,
    minHeight: 500,
    title: 'Carrel',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1d' : '#fdf6e3',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  if (!bounds.x && !bounds.y) window.center();
  const contents = window.webContents;
  contents.setUserAgent(`${contents.getUserAgent()} CarrelMac/${app.getVersion()}`);
  // Ctrl and the wheel, or a pinch, zoom the paper or the map (pinch.js), never the whole page.
  contents.setVisualZoomLevelLimits(1, 1);
  contents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    window.setTitle(showingStatus || !title ? 'Carrel' : title);
  });
  // Carrel's own addresses stay in the window; the rest of the web opens in the browser.
  const navigate = (event, url) => {
    const where = route(url, origin());
    if (where === 'allow') return;
    event.preventDefault();
    if (where === 'browser') void shell.openExternal(url);
    else if (where.action && showingStatus) statusAction(where.action);
  };
  contents.on('will-navigate', navigate);
  contents.on('will-redirect', navigate);
  contents.setWindowOpenHandler(({ url }) => {
    if (route(url, origin()) === 'browser') void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('did-fail-load', (_, code, description, url, mainFrame) => {
    // -3 is a navigation the app cancelled, or one replaced by the next.
    if (!mainFrame || code === -3 || showingStatus) return;
    showStatus('Carrel is not answering', `${description} (${url})`, { buttons: [['Try Again', 'retry']] });
  });
  // The page's process went away (memory, a crash): load it again rather than show a blank.
  contents.on('render-process-gone', () => {
    if (!showingStatus) contents.reload();
  });
  // Closing the window hides it, so the page and its chats are there when it comes back.
  window.on('close', (event) => {
    saveBounds();
    if (quitting) return;
    event.preventDefault();
    window.hide();
    if (settings.showInMenuBar) returnToMenuBarIfAlone();
    else app.quit();
  });
  window.on('resized', saveBounds);
  window.on('moved', saveBounds);
}

const origin = () => originOf(server.setup);

/** Shows carrel's page, unless it is already showing. */
function load(url) {
  const current = window.webContents.getURL();
  if (!showingStatus && current && route(current, url) === 'allow' && current.startsWith('http')) return;
  showingStatus = false;
  void window.loadURL(url);
}

function showStatus(heading, text, options) {
  showingStatus = true;
  window.setTitle('Carrel');
  void window.loadURL(statusPage(heading, text, options));
}

function show(state) {
  const { setup } = server;
  if (state === 'probing') showStatus('Looking for carrel…', `On port ${setup.port}.`);
  else if (state === 'starting') {
    showStatus('Starting carrel…', `Serving ${setup.library ?? 'the library'} on port ${setup.port}.`, { buttons: [['Show Log', 'log']] });
  } else if (state === 'attached' || state === 'running') load(server.pageURL);
  else if (state === 'stopped') showStatus('Carrel is stopped', 'The server this app started has stopped.', { buttons: [['Start', 'start']] });
  else if (state === 'needsSetup') {
    showStatus(
      'Carrel is not running',
      `Nothing answers on port ${setup.port}, and Carrel does not know which library to serve or where the carrel command is. Name them in Settings, or start carrel yourself (carrel serve, or carrel agent install) and try again.`,
      { buttons: [['Settings', 'settings'], ['Try Again', 'retry']] },
    );
    if (!askedForSetup && window.isVisible()) {
      askedForSetup = true;
      showSettings();
    }
  } else if (state === 'failed') {
    showStatus('Carrel could not start', server.reason, {
      detail: logTail(),
      buttons: [['Try Again', 'retry'], ['Settings', 'settings'], ['Show Log', 'log']],
    });
  }
  sendSettings();
}

function statusAction(action) {
  if (action === 'retry') void server.connect();
  else if (action === 'start') void server.start();
  else if (action === 'settings') showSettings();
  else if (action === 'log') showLog();
}

function savedBounds() {
  try {
    const bounds = JSON.parse(readFileSync(boundsFile(), 'utf8'));
    const area = screen.getDisplayMatching(bounds).workArea;
    const inside = bounds.x >= area.x - 50 && bounds.y >= area.y - 50 && bounds.x < area.x + area.width - 100;
    if (inside && bounds.width >= 700 && bounds.height >= 500) return bounds;
  } catch {
    // none saved yet
  }
  return { width: 1280, height: 820 };
}

function saveBounds() {
  if (!window || window.isFullScreen() || window.isMinimized()) return;
  writeFileSync(boundsFile(), JSON.stringify(window.getNormalBounds()));
}

const boundsFile = () => join(app.getPath('userData'), 'window.json');

// Coming forward from the menu bar, and going back to it. With the menu bar item on, Carrel with no
// window open is an accessory: no Dock icon and no menu bar of its own.

function bringForward(target) {
  app.setActivationPolicy('regular');
  app.focus({ steal: true });
  target.show();
  target.focus();
  // The menu bar follows activation rather than the policy, so one set while another application
  // owns the bar can leave that application's showing; set again once active (Acervo's finding).
  setImmediate(() => {
    app.focus({ steal: true });
    Menu.setApplicationMenu(menu);
    target.show();
  });
}

function openWindow() {
  if (window) bringForward(window);
}

function toggleWindow() {
  if (window.isVisible() && window.isFocused()) {
    window.hide();
    returnToMenuBarIfAlone();
  } else openWindow();
}

/** Back to the menu bar once no window is on screen. */
function returnToMenuBarIfAlone() {
  if (!settings.showInMenuBar) return;
  setImmediate(() => {
    if (!BrowserWindow.getAllWindows().some((each) => each.isVisible())) app.setActivationPolicy('accessory');
  });
}

function setMenuBarItem(on) {
  if (on && !tray) {
    tray = createTray({
      get server() {
        return server;
      },
      toggleWindow,
      openWindow,
      statusLine,
      copyTabletAddress: () => server.ping?.tablet && clipboard.writeText(server.ping.tablet),
      startServer: () => void server.connect(),
      stopServer: () => void server.stop(),
      settings: showSettings,
      quit: () => app.quit(),
    });
  }
  if (!on && tray) {
    tray.destroy();
    tray = null;
  }
}

function statusLine() {
  const short = (path) => path.replace(app.getPath('home'), '~');
  return {
    probing: 'Looking for carrel…',
    attached: `Serving ${short(server.ping?.library ?? '')}`,
    starting: 'Starting…',
    running: `Serving ${short(server.ping?.library ?? '')}, started by Carrel`,
    stopped: 'Stopped',
    needsSetup: 'Not running',
    failed: 'Could not start',
  }[server.state];
}

// Menu actions.

/** Runs one of the page's commands (`commands.js`): whether it did anything. */
async function command(name) {
  if (showingStatus) return false;
  try {
    return Boolean(await window.webContents.executeJavaScript(`window.carrel ? window.carrel.command(${JSON.stringify(name)}) : false`, true));
  } catch {
    return false;
  }
}

function pageCommand(name) {
  openWindow();
  void command(name);
}

/** ⌘W closes the tab showing; on the library, which has no tab to close, the window. */
async function closeTab() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused !== window) return focused.close();
  if (!(await command('close-tab'))) window.close();
}

/** Zoom is the paper's or the meaning map's, as the page decides; with neither showing, the whole
 * page's. */
async function zoom(name) {
  if (await command(name)) return;
  const contents = window.webContents;
  const factor = contents.getZoomFactor();
  if (name === 'zoom-reset') contents.setZoomFactor(1);
  else if (name === 'zoom-in') contents.setZoomFactor(Math.min(factor * 1.1, 3));
  else contents.setZoomFactor(Math.max(factor / 1.1, 0.5));
}

function reload() {
  if (!server.pageURL) void server.connect();
  else if (showingStatus) load(server.pageURL);
  else window.webContents.reload();
}

/** The log of the server this app starts; the login agent's is ~/Library/Logs/carrel.log. */
function showLog() {
  if (!existsSync(LOG)) writeFileSync(LOG, '');
  void shell.openPath(LOG);
}

// Settings: a window of the app's own (settings.html), which reaches the app only through
// settings-preload.cjs.

function showSettings() {
  if (!settingsWindow) {
    settingsWindow = new BrowserWindow({
      width: 600,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Carrel Settings',
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ececec',
      webPreferences: { preload: here('./settings-preload.cjs'), contextIsolation: true, sandbox: true },
    });
    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    settingsWindow.on('closed', () => {
      settingsWindow = null;
      returnToMenuBarIfAlone();
    });
    void settingsWindow.loadFile(here('./settings.html'));
    settingsWindow.once('ready-to-show', () => bringForward(settingsWindow));
  } else bringForward(settingsWindow);
}

function settingsState() {
  const { setup } = server;
  const versions = { attached: 'Showing carrel {v}, not started here', running: 'Running carrel {v}, started here' };
  const status = versions[server.state]?.replace('{v}', server.ping?.version ?? '') ??
    {
      probing: 'Looking for carrel…',
      starting: 'Starting…',
      stopped: 'Stopped',
      needsSetup: 'Not running: name a command and a library',
      failed: 'Failed: see the log',
    }[server.state];
  const found = (key) => ({ value: setup[key] ?? null, source: SOURCES[setup.sources[key]] ?? null });
  return {
    settings,
    found: { command: found('command'), library: found('library'), engine: found('engine'), port: found('port') },
    status,
    openAtLogin: loginItemEnabled(),
    canOpenAtLogin: app.isPackaged,
    home: app.getPath('home'),
  };
}

function sendSettings() {
  settingsWindow?.webContents.send('settings:changed', settingsState());
}

function ipcSettings() {
  ipcMain.handle('settings:get', () => settingsState());
  ipcMain.handle('settings:set', (_, changes) => {
    const was = settings.showInMenuBar;
    settings = saveSettings({ ...settings, ...changes });
    if (settings.showInMenuBar !== was) setMenuBarItem(settings.showInMenuBar);
    return settingsState();
  });
  ipcMain.handle('settings:login', (_, on) => {
    setLoginItem(on);
    return settingsState();
  });
  ipcMain.handle('settings:choose', async (_, folders) => {
    const chosen = await dialog.showOpenDialog(settingsWindow, {
      properties: folders ? ['openDirectory'] : ['openFile', 'showHiddenFiles'],
    });
    return chosen.canceled ? null : chosen.filePaths[0];
  });
  ipcMain.handle('settings:apply', async () => {
    await server.reconnect(settings);
    return settingsState();
  });
  ipcMain.handle('settings:log', () => showLog());
}
