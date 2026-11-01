import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// boot.js is a classic script, run before the page paints; without a page it only defines its
// functions on the global object.
const context = {};
vm.runInNewContext(readFileSync(new URL('../src/carrel/static/boot.js', import.meta.url), 'utf8'), context);
const { readPrefs, themeOf, deviceDefaults, scaleOf, pageFilters, DEFAULTS, EINK_PAGES } = context.carrelLook;

test('saved prefs are checked: what is missing or does not fit is the default', () => {
  assert.deepEqual({ ...readPrefs(null) }, { ...DEFAULTS });
  const prefs = readPrefs({ family: 'solarized', mode: 'dark', ink: 'colour', darkPages: 'yes', ui: 40, library: 15.6, chat: 'big' });
  assert.equal(prefs.family, 'carrel');
  assert.equal(prefs.mode, 'dark');
  assert.equal(prefs.ink, 'colour');
  assert.equal(prefs.darkPages, false);
  assert.equal(prefs.ui, 22);
  assert.equal(prefs.library, 16);
  assert.equal(prefs.chat, 15);
});

test('the library starts at 17 px, the chat and the rest at 15', () => {
  assert.deepEqual([DEFAULTS.library, DEFAULTS.chat, DEFAULTS.ui], [17, 15, 15]);
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

const BOOX = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const PAGE_KEYS = ['pages', 'outlines', 'embolden', 'tone', 'sharpen', 'contrast', 'scans'];
const pagesOf = (prefs) => Object.fromEntries(PAGE_KEYS.map((key) => [key, prefs[key]]));

test('e-ink starts with its pages; every other screen with the pages as they are', () => {
  assert.deepEqual(pagesOf(deviceDefaults('Mozilla/5.0 (Linux; Android 12; BOOX Tab Ultra)', false)), { ...EINK_PAGES });
  const asTheyAre = { pages: false, outlines: false, embolden: 0, tone: 1, sharpen: 0, contrast: 1, scans: false };
  assert.deepEqual(pagesOf(deviceDefaults('Mozilla/5.0 (iPad; CPU OS 26_6 like Mac OS X)', false)), asTheyAre);
  assert.deepEqual(pagesOf(deviceDefaults('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)', false)), asTheyAre);
  assert.deepEqual(pagesOf(DEFAULTS), asTheyAre);
});

test('e-ink chosen on a screen that did not say so starts with e-ink pages, until pages are chosen', () => {
  // The Boox's Chrome says only "Android", until the reader chose E-ink.
  const boox = deviceDefaults(BOOX, false);
  assert.equal(boox.family, 'carrel');
  assert.deepEqual(pagesOf(readPrefs({ family: 'eink' }, boox)), { ...EINK_PAGES });
  assert.equal(readPrefs({ family: 'eink', pages: false }, boox).pages, false);
  assert.equal(readPrefs({ family: 'eink', pages: true, outlines: false }, boox).outlines, false);
});

test('page strengths outside the choices are the default', () => {
  const prefs = readPrefs({ pages: true, tone: 2.7, contrast: '1.3', outlines: 1, scans: true, embolden: 0.25, sharpen: 3 });
  assert.equal(prefs.embolden, 0);
  assert.equal(prefs.sharpen, 0);
  assert.equal(prefs.tone, 1);
  assert.equal(prefs.contrast, 1);
  assert.equal(prefs.outlines, false);
  assert.equal(prefs.scans, true);
  assert.equal(readPrefs({ tone: 1.5, contrast: 1.15 }).tone, 1.5);
});

test('the filters: none when off, the tone and contrast on a page, black and white first on a scan', () => {
  assert.deepEqual({ ...pageFilters(readPrefs({ pages: false, tone: 1.5, scans: true })) }, { page: 'none', scan: 'none' });
  assert.deepEqual({ ...pageFilters(readPrefs({ pages: true })) }, { page: 'none', scan: 'none' });
  assert.deepEqual({ ...pageFilters(readPrefs({ pages: true, tone: 1.25, contrast: 1.3, scans: true })) }, {
    page: 'url(#page-tone-125) contrast(1.3)',
    scan: 'url(#page-scan) url(#page-tone-125) contrast(1.3)',
  });
  assert.deepEqual({ ...pageFilters(readPrefs({ pages: true, scans: true })) }, { page: 'none', scan: 'url(#page-scan)' });
  // Emboldening and sharpening are drawn on the canvas (page-adjust.js), not filters.
  assert.equal(pageFilters(readPrefs({ pages: true, sharpen: 0.7, tone: 1.5 })).page, 'url(#page-tone-150)');
  assert.equal(pageFilters(readPrefs({ pages: true, embolden: 0.1 })).page, 'none');
});

test('every tone the settings offer has its filter in the page', () => {
  const page = readFileSync(new URL('../src/carrel/pages/app.html', import.meta.url), 'utf8');
  for (const tone of context.carrelLook.TONES.filter((t) => t !== 1)) assert.match(page, new RegExp(`id="page-tone-${Math.round(tone * 100)}"`));
  assert.match(page, /id="page-scan"/);
});
