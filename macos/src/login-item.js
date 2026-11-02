// Opening at login, as a LaunchAgent of the reader's that opens the app with `--at-login`, so the
// app can tell that launch from one by hand and stay in the menu bar. Electron's own login item
// (SMAppService) cannot say which launch was the login's on macOS 13 and later. It is read from
// the file each time, so an agent removed by hand does not still show as on; it is never turned on
// by itself.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

export const AT_LOGIN = '--at-login';
const LABEL = 'com.anton.carrel.app';

const plist = () => join(app.getPath('home'), 'Library/LaunchAgents', `${LABEL}.plist`);

/** The app bundle this process runs from (…/Carrel.app), or null when run from the checkout. */
function bundle() {
  const at = process.execPath.indexOf('.app/Contents/MacOS/');
  return at < 0 || !app.isPackaged ? null : process.execPath.slice(0, at + 4);
}

export const isEnabled = () => existsSync(plist());

/** Turns opening at login on or off; false when it cannot (run from the checkout). */
export function setEnabled(enabled) {
  if (!enabled) {
    rmSync(plist(), { force: true });
    return true;
  }
  const path = bundle();
  if (!path) return false;
  const args = ['/usr/bin/open', '-g', '-a', path, '--args', AT_LOGIN].map((arg) => `    <string>${escape(arg)}</string>`);
  mkdirSync(dirname(plist()), { recursive: true });
  writeFileSync(
    plist(),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`,
  );
  return true;
}

/** The Swift app's login item (SMAppService, under the same bundle id) taken over: it would open
 * this app at login with no way to tell, so it is unregistered and the agent written instead. */
export function takeOverSwiftLoginItem() {
  if (!app.isPackaged) return;
  if (app.getLoginItemSettings({ type: 'mainAppService' }).status !== 'enabled') return;
  app.setLoginItemSettings({ openAtLogin: false, type: 'mainAppService' });
  setEnabled(true);
}

/** Whether this launch was the login's. */
export const launchedAtLogin = () => process.argv.includes(AT_LOGIN);

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
