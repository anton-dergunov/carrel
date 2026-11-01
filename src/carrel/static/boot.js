// The page's look, applied before the first paint so a saved theme or text size never flashes in
// after it: a classic script in <head>, as Lectern's boot.js is. Kept per device in localStorage,
// since the iPad, the e-ink tablet and the Mac want different ones. Everything else reads it
// through `window.carrelLook` and hears of a change by the `carrel:look` event on `document`.
(() => {
  const KEY = 'carrel.look';
  // The text sizes are the px of each part's body text; its other sizes scale with it, and the CSS
  // is written for BASE.
  const BASE = 17;
  const DEFAULTS = {
    family: 'carrel',
    mode: 'system',
    // The two below apply only in their own themes: e-ink's colour, the dark ones' pages.
    ink: 'mono',
    darkPages: false,
    // What the reader settled on for the Mac, the iPad, the phone and the e-ink tablet alike.
    ui: 15,
    library: 17,
    chat: 15,
    // The pages (experiments/crisp-pages): adjustments to how a paper's pages are drawn, under one
    // switch that keeps them when off. Off, and each adjustment off, except on e-ink (EINK_PAGES).
    pages: false,
    outlines: false, // PDF.js draws each letter's outline itself, instead of the browser's font
    embolden: 0, // pt: each page drawn again over itself, this far to the side (read.js)
    tone: 1, // a gamma on the page's greys: above 1, the grey edges of letters darker
    sharpen: 0, // an unsharp mask's amount, about one device pixel wide (page-adjust.js)
    contrast: 1,
    scans: false, // the pages that are scans, in black and white
    // Pages drawn at the monitor's own pixels where the Mac app says it has fewer than the screen
    // (a HiDPI screen scaled down onto it, as Crisp makes): see drawRatioOf.
    monitor: true,
  };
  // A page is drawn this much finer than the monitor's pixels, so that the two resamplings on its
  // way there (up to the screen's 2×, down to the monitor) leave it as sharp.
  const MONITOR_MARGIN = 1.2;
  const EMBOLDENS = [0, 0.05, 0.1, 0.18];
  const TONES = [1, 1.25, 1.5, 1.8];
  const SHARPENS = [0, 0.4, 0.7, 1];
  const CONTRASTS = [1, 1.15, 1.3, 1.5];
  const PAGE_PREFS = ['pages', 'outlines', 'embolden', 'tone', 'sharpen', 'contrast', 'scans'];
  // What e-ink starts with: crisp-pages' winners there, the letters' own outlines, a light
  // embolden and black-and-white scans. The reader saw a page made far crisper by them on the
  // Boox, and too crisp, read whole, on the iPad, which judging small crops had favoured: so every
  // other screen starts with the pages as they are.
  const EINK_PAGES = { pages: true, outlines: true, embolden: 0.05, tone: 1, sharpen: 0, contrast: 1, scans: true };
  const SIZES = { ui: [14, 22], library: [14, 24], chat: [14, 26] };
  const FAMILIES = ['carrel', 'plain', 'eink'];
  const MODES = ['light', 'dark', 'system'];
  const INKS = ['mono', 'colour'];
  // The page's background in each theme, for the browser's bar and the status bar around it.
  const BAR_COLORS = {
    'carrel-light': '#fffdf6',
    'carrel-dark': '#24282a',
    'plain-light': '#ffffff',
    'plain-dark': '#000000',
    eink: '#ffffff',
    'eink-colour': '#ffffff',
  };
  // Reading devices whose browsers say what they are; the rest are caught by the media query.
  const EINK_DEVICE = /\b(BOOX|Onyx|Kindle|Kobo|PocketBook|reMarkable|Bigme|Meebook|Likebook|Boyue)\b/i;

  /** What a device starts with before anything is chosen on it: e-ink, with its pages, on an e-ink screen. */
  function deviceDefaults(userAgent, monochrome) {
    const defaults = { ...DEFAULTS };
    if (EINK_DEVICE.test(userAgent) || monochrome) Object.assign(defaults, { family: 'eink' }, EINK_PAGES);
    return defaults;
  }

  /** The saved prefs, checked: whatever is missing or does not fit is the device's default. */
  function readPrefs(saved, defaults = DEFAULTS) {
    if (!saved || typeof saved !== 'object') saved = {};
    const prefs = {};
    for (const name of Object.keys(DEFAULTS)) {
      prefs[name] = typeof saved[name] === typeof DEFAULTS[name] ? saved[name] : defaults[name];
    }
    if (!FAMILIES.includes(prefs.family)) prefs.family = defaults.family;
    if (!MODES.includes(prefs.mode)) prefs.mode = defaults.mode;
    if (!INKS.includes(prefs.ink)) prefs.ink = defaults.ink;
    // E-ink chosen by hand on a screen that did not say it is one (the Boox's Chrome says only
    // "Android"), with no pages chosen yet: e-ink's pages.
    if (prefs.family === 'eink' && typeof saved.pages !== 'boolean') Object.assign(prefs, EINK_PAGES);
    if (!EMBOLDENS.includes(prefs.embolden)) prefs.embolden = defaults.embolden;
    if (!TONES.includes(prefs.tone)) prefs.tone = defaults.tone;
    if (!SHARPENS.includes(prefs.sharpen)) prefs.sharpen = defaults.sharpen;
    if (!CONTRASTS.includes(prefs.contrast)) prefs.contrast = defaults.contrast;
    for (const [name, [min, max]] of Object.entries(SIZES)) {
      const size = Number.isFinite(prefs[name]) ? Math.round(prefs[name]) : defaults[name];
      prefs[name] = Math.min(max, Math.max(min, size));
    }
    return prefs;
  }

  /**
   * How many pixels a page's canvas has per CSS pixel: the screen's (`ratio`, devicePixelRatio),
   * or, with `prefs.monitor` and a monitor of `density` real pixels per CSS pixel below it, that
   * density and a margin. On a 5120-pixel monitor shown as a 4096-point screen at 2×, 1.5 rather
   * than 2: 56% of the pixels to draw, keep and move while scrolling, none of them seen.
   */
  function drawRatioOf(prefs, ratio, density) {
    if (!prefs.monitor || !(density > 0)) return ratio;
    return Math.min(ratio, Math.max(1, Math.round(density * MONITOR_MARGIN * 100) / 100));
  }

  /** The theme the page is drawn in: e-ink is always dark on light, with or without colour. */
  function themeOf(prefs, systemDark) {
    if (prefs.family === 'eink') return prefs.ink === 'colour' ? 'eink-colour' : 'eink';
    const mode = prefs.mode === 'system' ? (systemDark ? 'dark' : 'light') : prefs.mode;
    return `${prefs.family}-${mode}`;
  }

  const scaleOf = (size) => Math.round((size / BASE) * 1000) / 1000;

  /**
   * The filters on a page's canvases (app.html's SVG filters by id), for a page and for a page
   * that is a scan: 'none' when the pages are left as they are.
   */
  function pageFilters(prefs) {
    if (!prefs.pages) return { page: 'none', scan: 'none' };
    const parts = [];
    if (prefs.tone !== 1) parts.push(`url(#page-tone-${Math.round(prefs.tone * 100)})`);
    if (prefs.contrast !== 1) parts.push(`contrast(${prefs.contrast})`);
    const page = parts.join(' ') || 'none';
    // Black and white first: the tone and contrast after it change nothing more, but keep the
    // filter one chain.
    const scan = prefs.scans ? ['url(#page-scan)', ...parts].join(' ') : page;
    return { page, scan };
  }

  // The page, when there is one; a test runs the functions above without it.
  if (typeof document === 'undefined' || typeof localStorage === 'undefined') {
    globalThis.carrelLook = { readPrefs, themeOf, deviceDefaults, scaleOf, pageFilters, drawRatioOf, DEFAULTS, SIZES, EMBOLDENS, TONES, SHARPENS, CONTRASTS, EINK_PAGES };
    return;
  }

  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
  } catch {
    // Private browsing, or nothing kept yet: the device's defaults.
  }
  const prefs = readPrefs(saved, deviceDefaults(navigator.userAgent, matchMedia('(monochrome)').matches));

  function apply() {
    const theme = themeOf(prefs, dark.matches);
    root.dataset.theme = theme;
    root.toggleAttribute('data-dark-pages', prefs.darkPages && theme.endsWith('-dark'));
    root.style.setProperty('--ui-scale', String(scaleOf(prefs.ui)));
    root.style.setProperty('--library-scale', String(scaleOf(prefs.library)));
    root.style.setProperty('--chat-scale', String(scaleOf(prefs.chat)));
    const filters = pageFilters(prefs);
    root.style.setProperty('--page-filter', filters.page);
    root.style.setProperty('--page-filter-scan', filters.scan);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = BAR_COLORS[theme];
  }

  function changed() {
    apply();
    document.dispatchEvent(new CustomEvent('carrel:look', { detail: { ...prefs } }));
  }

  apply();
  // The bar's colour meta comes after this script in <head>.
  document.addEventListener('DOMContentLoaded', apply, { once: true });
  dark.addEventListener('change', changed);
  // The Mac app's word on the monitor the window is on (`window.carrelScreen`), when it changes.
  document.addEventListener('carrel:screen', changed);
  const density = () => globalThis.carrelScreen?.density;

  globalThis.carrelLook = Object.freeze({
    prefs,
    sizes: SIZES,
    base: BASE,
    emboldens: EMBOLDENS,
    tones: TONES,
    sharpens: SHARPENS,
    contrasts: CONTRASTS,
    pagePrefs: PAGE_PREFS,
    set(name, value) {
      prefs[name] = value;
      Object.assign(prefs, readPrefs(prefs));
      try {
        localStorage.setItem(KEY, JSON.stringify(prefs));
      } catch {
        // Private browsing: the choice lasts as long as the page.
      }
      changed();
    },
    theme: () => root.dataset.theme,
    eink: () => root.dataset.theme.startsWith('eink'),
    dark: () => root.dataset.theme.endsWith('-dark'),
    /** Whether the page may move: not on e-ink, where every frame is a repaint, nor with reduced motion. */
    motion: () => !reduced.matches && !root.dataset.theme.startsWith('eink'),
    /** Whether PDF.js draws the letters' outlines itself (read.js loads the paper so). */
    outlines: () => prefs.pages && prefs.outlines,
    /** How far, in pt, read.js draws each page again over itself to embolden it: 0 for not. */
    embolden: () => (prefs.pages ? prefs.embolden : 0),
    /** How much read.js sharpens each page once drawn: 0 for not. */
    sharpen: () => (prefs.pages ? prefs.sharpen : 0),
    /** How many pixels a page's canvas has per CSS pixel (drawRatioOf). */
    drawRatio: () => drawRatioOf(prefs, globalThis.devicePixelRatio || 1, density()),
    /** Whether the monitor has fewer pixels than the screen, so that `monitor` means something. */
    monitorBelowScreen: () => drawRatioOf({ monitor: true }, globalThis.devicePixelRatio || 1, density()) < (globalThis.devicePixelRatio || 1),
    /** A part's text scale: 'ui', 'library' or 'chat'. */
    scale: (part) => scaleOf(prefs[part]),
  });
})();
