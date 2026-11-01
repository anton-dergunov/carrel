import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// boot.js is a classic script, run before the page paints; without a page it only defines its
// functions on the global object.
const context = {};
vm.runInNewContext(readFileSync(new URL('../src/carrel/static/boot.js', import.meta.url), 'utf8'), context);
const { readPrefs, themeOf, deviceDefaults, scaleOf, DEFAULTS } = context.carrelLook;

test('saved prefs are checked: what is missing or does not fit is the default', () => {
  assert.deepEqual({ ...readPrefs(null) }, { ...DEFAULTS });
  const prefs = readPrefs({ family: 'solarized', mode: 'dark', ink: 'colour', darkPages: 'yes', ui: 40, library: 15.6, chat: 'big' });
  assert.equal(prefs.family, 'carrel');
  assert.equal(prefs.mode, 'dark');
  assert.equal(prefs.ink, 'colour');
  assert.equal(prefs.darkPages, false);
  assert.equal(prefs.ui, 22);
  assert.equal(prefs.library, 16);
  assert.equal(prefs.chat, 17);
});

test('the theme is the family in its mode, and e-ink by its ink', () => {
  assert.equal(themeOf(readPrefs({ mode: 'system' }), true), 'carrel-dark');
  assert.equal(themeOf(readPrefs({ mode: 'system' }), false), 'carrel-light');
  assert.equal(themeOf(readPrefs({ family: 'plain', mode: 'dark' }), false), 'plain-dark');
  assert.equal(themeOf(readPrefs({ family: 'eink', mode: 'dark' }), true), 'eink');
  assert.equal(themeOf(readPrefs({ family: 'eink', ink: 'colour' }), true), 'eink-colour');
});

test('an e-ink reader starts in e-ink', () => {
  assert.equal(deviceDefaults('Mozilla/5.0 (Linux; Android 12; BOOX Tab Ultra)', false).family, 'eink');
  assert.equal(deviceDefaults('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', true).family, 'eink');
  assert.equal(deviceDefaults('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', false).family, 'carrel');
});

test('a text size is a scale of 17 px', () => {
  assert.equal(scaleOf(17), 1);
  assert.equal(scaleOf(20), 1.176);
});
