// This Mac's preferences for the app, in a JSON file in the app's own folder. What the page
// remembers (tabs, layout, the model) stays in the page's own storage, as on any other device.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

const DEFAULTS = { command: '', library: '', engine: '', port: 0, showInMenuBar: false };

const file = () => join(app.getPath('userData'), 'settings.json');

/** The settings, imported once from the Swift app's preferences when there are none yet. */
export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) };
  } catch {
    const imported = { ...DEFAULTS, ...fromSwiftApp() };
    saveSettings(imported);
    return imported;
  }
}

export function saveSettings(settings) {
  const clean = {
    command: String(settings.command ?? '').trim(),
    library: String(settings.library ?? '').trim(),
    engine: String(settings.engine ?? '').trim(),
    port: Math.max(0, Number.parseInt(settings.port, 10) || 0),
    showInMenuBar: Boolean(settings.showInMenuBar),
  };
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}

/** The Swift app's preferences (UserDefaults, under the same bundle id), if it left any. */
function fromSwiftApp() {
  if (!existsSync(join(app.getPath('home'), 'Library/Preferences/com.anton.carrel.app.plist'))) return {};
  try {
    const plist = execFileSync('defaults', ['export', 'com.anton.carrel.app', '-']);
    const old = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist }).toString());
    return {
      command: old.CarrelCommand ?? '',
      library: old.CarrelLibrary ?? '',
      engine: old.CarrelEngine ?? '',
      port: old.CarrelPort ?? 0,
      showInMenuBar: old.CarrelShowInMenuBar ?? false,
    };
  } catch {
    return {};
  }
}
