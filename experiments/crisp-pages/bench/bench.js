// The bench: the same crop of a paper drawn several ways, side by side at the size this device
// reads it in carrel, and the reader's pick of them sent to the laptop.
//
// Every variant is a recipe (RECIPE below, changed by one knob), drawn into a canvas at the
// device's own pixels: by PDF.js here, as carrel draws, or by MuPDF on the laptop. The tones
// and thresholds are filters on that canvas (CSS and SVG, as carrel would apply them); the
// sharpening and Sauvola's threshold work on its pixels in a worker.

import '/static/polyfill.js'; // before PDF.js, as in carrel
import * as pdfjsLib from '/static/vendor/pdfjs/pdf.min.mjs';

globalThis.pdfjsLib = pdfjsLib;
const { EventBus, PDFLinkService, PDFViewer } = await import('/static/vendor/pdfjs/pdf_viewer.mjs');

const ASSETS = '/static/vendor/pdfjs/';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;
// read.js's own parameters.
const DOCUMENT = {
  cMapUrl: `${ASSETS}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ASSETS}standard_fonts/`,
  wasmUrl: `${ASSETS}wasm/`,
  iccUrl: `${ASSETS}iccs/`,
  enableHWA: true,
};
const ROUND = 1;
const SCANS = new Set(['scanned', 'scanned-figure']);
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const still = params.get('still') === '1'; // stills.py: no shuffling, labels shown, a ready mark

// ---- The device ----

const ua = navigator.userAgent;
const isAndroid = /Android/.test(ua);
const isIOS = /\b(?:iPad|iPhone|iPod)(?=;)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// PDF.js's own cap on a canvas, as its viewer sets it on this platform (pdf_viewer.mjs).
const MAX_CANVAS = Number(params.get('cap')) || (isAndroid || isIOS ? 5242880 : 2 ** 25); // stills.py passes a tablet's
const dpr = window.devicePixelRatio || 1;

function facts() {
  return {
    userAgent: ua,
    devicePixelRatio: dpr,
    screen: `${screen.width}×${screen.height}`,
    available: `${screen.availWidth}×${screen.availHeight}`,
    window: `${innerWidth}×${innerHeight}`,
    monochrome: matchMedia('(monochrome)').matches,
    maxCanvasPixels: MAX_CANVAS,
  };
}

const TABLET_KEY = 'crisp-bench-tablet';
function tablet() {
  try {
    return JSON.parse(localStorage.getItem(TABLET_KEY)) || {};
  } catch {
    return {};
  }
}
function saveTablet() {
  const values = Object.fromEntries(new FormData($('tablet')));
  try {
    localStorage.setItem(TABLET_KEY, JSON.stringify(values));
  } catch {}
}
function paperWidth() {
  return Number(params.get('width')) || Number(tablet().width) || innerWidth;
}

/** How PDF.js draws a page this wide here: its base canvas, before the detail canvas. */
function baseCanvas(pageWidthPt, pageHeightPt) {
  const cssW = paperWidth();
  const cssH = (cssW * pageHeightPt) / pageWidthPt;
  const limit = Math.min(MAX_CANVAS, Math.ceil(screen.availWidth * screen.availHeight * dpr ** 2 * 3));
  let scale = Math.min(dpr, Math.sqrt(limit / (cssW * cssH)));
  const restricted = scale < dpr;
  if (restricted) scale /= 2; // the detail canvas draws the part in view at full size
  return { restricted, fraction: scale / dpr, devicePixels: Math.round(cssW * dpr * cssH * dpr) };
}

function showFacts() {
  const rows = Object.entries(facts());
  const letter = baseCanvas(612, 792);
  rows.push(['Paper width', `${paperWidth()} CSS px (${Math.round(paperWidth() * dpr)} device px)`]);
  rows.push([
    'A letter page there',
    `${(letter.devicePixels / 1e6).toFixed(1)} MP at full size; ` +
      (letter.restricted
        ? `over the cap, so PDF.js draws it at ${Math.round(letter.fraction * 100)}% and then the part in view again at full size (the detail canvas)`
        : 'under the cap: drawn at full size at once'),
  ]);
  $('facts').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = String(v);
      return [dt, dd];
    }),
  );
}

// ---- The recipes and the knobs ----

const RECIPE = { res: 1, fonts: 'face', embolden: 0, contrast: 1, tone: 1, sharpen: 0, threshold: 0, sauvola: 0, laptop: null };
const textOnly = (crop) => !SCANS.has(crop.kind);
const scansOnly = (crop) => SCANS.has(crop.kind);

const KNOBS = {
  res: {
    name: 'Resolution',
    levels: ['base', 1.25, 1.5, 2],
    set: (r, v) => ({ ...r, res: v }),
    show: (v) => (v === 'base' ? 'before the detail canvas' : `${v}× the pixels`),
  },
  tone: { name: 'Tone curve', levels: [1.25, 1.5, 1.8, 2.2, 2.7, 3.3], set: (r, v) => ({ ...r, tone: v }), show: (v) => `gamma ${v}` },
  embolden: {
    name: 'Embolden',
    levels: [0.1, 0.18, 0.25, 0.35, 0.5, 0.7],
    set: (r, v) => ({ ...r, embolden: v }),
    show: (v) => `stroke ${v} pt`,
    applies: textOnly,
  },
  glyphs: {
    name: 'Glyphs as paths',
    levels: ['paths'],
    set: (r) => ({ ...r, fonts: 'paths' }),
    show: () => 'glyphs drawn as paths',
    applies: textOnly,
  },
  laptop: {
    name: 'Drawn on the laptop',
    levels: [{ aa: 8 }, { aa: 4 }, { aa: 2 }, { aa: 0 }, { aa: 8, gamma: 1.6 }, { aa: 8, gamma: 2.2 }],
    set: (r, v) => ({ ...r, laptop: v }),
    show: (v) => `MuPDF, anti-aliasing ${v.aa}${v.gamma ? `, gamma ${v.gamma}` : ''}`,
  },
  sharpen: { name: 'Sharpen', levels: [0.4, 0.7, 1, 1.5, 2, 3], set: (r, v) => ({ ...r, sharpen: v }), show: (v) => `unsharp ${v}` },
  contrast: { name: 'Contrast', levels: [1.15, 1.3, 1.5, 1.75, 2, 2.5], set: (r, v) => ({ ...r, contrast: v }), show: (v) => `contrast ${v}` },
  threshold: {
    name: 'Threshold (one cut)',
    levels: [0.45, 0.55, 0.65, 0.75, 0.85],
    set: (r, v) => ({ ...r, threshold: v }),
    show: (v) => `ink below ${Math.round(v * 100)}% grey`,
    applies: scansOnly,
  },
  sauvola: {
    name: 'Threshold (Sauvola)',
    levels: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5],
    set: (r, v) => ({ ...r, sauvola: v }),
    show: (v) => `Sauvola k ${v}`,
    applies: scansOnly,
  },
};
const BASES = { full: RECIPE, laptop: { ...RECIPE, laptop: { aa: 8 } } };

function describe(recipe) {
  const parts = [];
  for (const [name, knob] of Object.entries(KNOBS)) {
    const value = name === 'glyphs' ? (recipe.fonts === 'paths' ? 'paths' : null) : recipe[name];
    if (value !== null && value !== RECIPE[name] && !(name === 'res' && value === 1)) parts.push(knob.show(value));
  }
  return parts.join(', ') || 'as carrel draws it';
}

// ---- Drawing a variant ----

const documents = new Map();
function documentFor(id, embolden, paths) {
  const key = `${id}|${embolden}|${paths}`;
  if (!documents.has(key)) {
    const url = `/pdf/${encodeURIComponent(id)}${embolden ? `?embolden=${embolden}` : ''}`;
    const task = pdfjsLib.getDocument({ ...DOCUMENT, url, disableFontFace: paths });
    documents.set(key, task.promise);
  }
  return documents.get(key);
}

const filters = $('filters').querySelector('defs');
const SVG = 'http://www.w3.org/2000/svg';
function svgFilter(id, build) {
  if (!document.getElementById(id)) {
    const filter = document.createElementNS(SVG, 'filter');
    filter.id = id;
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    build(filter);
    filters.append(filter);
  }
  return `url(#${id})`;
}
function transfer(filter, attributes) {
  const node = document.createElementNS(SVG, 'feComponentTransfer');
  for (const channel of ['R', 'G', 'B']) {
    const fn = document.createElementNS(SVG, `feFunc${channel}`);
    for (const [k, v] of Object.entries(attributes)) fn.setAttribute(k, v);
    node.append(fn);
  }
  filter.append(node);
}
function cssFilter(recipe) {
  const parts = [];
  if (recipe.contrast !== 1) parts.push(`contrast(${recipe.contrast})`);
  if (recipe.tone !== 1) {
    // Exponent above 1: the greys of a glyph's edges darker, white and black as they were.
    parts.push(svgFilter(`tone-${recipe.tone}`, (f) => transfer(f, { type: 'gamma', amplitude: 1, exponent: recipe.tone, offset: 0 })));
  }
  if (recipe.threshold) {
    parts.push(
      svgFilter(`cut-${recipe.threshold}`, (f) => {
        const grey = document.createElementNS(SVG, 'feColorMatrix');
        grey.setAttribute('type', 'saturate');
        grey.setAttribute('values', '0');
        f.append(grey);
        const steps = Array.from({ length: 100 }, (_, i) => (i / 100 < recipe.threshold ? 0 : 1));
        transfer(f, { type: 'discrete', tableValues: steps.join(' ') });
      }),
    );
  }
  return parts.join(' ');
}

let worker = null;
let jobs = 0;
const waiting = new Map();
function onPixels(canvas, message) {
  worker ??= new Worker('/bench/worker.js');
  worker.onmessage = ({ data }) => {
    const done = waiting.get(data.id);
    waiting.delete(data.id);
    done?.(data.buffer);
  };
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const id = ++jobs;
  return new Promise((resolve) => {
    waiting.set(id, (buffer) => {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer), canvas.width, canvas.height), 0, 0);
      resolve();
    });
    worker.postMessage({ id, width: canvas.width, height: canvas.height, buffer: image.data.buffer, ...message }, [image.data.buffer]);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** The crop's size here: at page width, in CSS and device pixels, and device pixels a point. */
function geometry(crop) {
  const [x0, y0, x1, y1] = crop.rect;
  const cssPerPt = paperWidth() / crop.size[0];
  const deviceW = Math.round((x1 - x0) * cssPerPt * dpr);
  const deviceH = Math.round((y1 - y0) * cssPerPt * dpr);
  return { cssW: deviceW / dpr, cssH: deviceH / dpr, zoom: deviceW / (x1 - x0) };
}

async function draw(crop, recipe) {
  const started = performance.now();
  const { cssW, cssH, zoom } = geometry(crop);
  const [x0, y0, x1, y1] = crop.rect;
  const factor = recipe.res === 'base' ? baseCanvas(...crop.size).fraction : recipe.res;
  const scale = zoom * factor;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((x1 - x0) * scale);
  canvas.height = Math.round((y1 - y0) * scale);
  const ctx = canvas.getContext('2d');
  if (recipe.laptop) {
    const query = new URLSearchParams({ zoom: scale, aa: recipe.laptop.aa, gamma: recipe.laptop.gamma ?? 1 });
    if (recipe.embolden) query.set('embolden', recipe.embolden);
    const img = await loadImage(`/render/${encodeURIComponent(crop.id)}?${query}`);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } else {
    const pdf = await documentFor(crop.id, recipe.embolden, recipe.fonts === 'paths');
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale] }).promise;
  }
  if (recipe.sharpen) await onPixels(canvas, { op: 'sharpen', amount: recipe.sharpen });
  if (recipe.sauvola) await onPixels(canvas, { op: 'sauvola', k: recipe.sauvola, window: Math.max(15, Math.round(scale * 12)) | 1 });
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.filter = cssFilter(recipe);
  return { canvas, ms: Math.round(performance.now() - started) };
}

// ---- Compare ----

let crops = [];
const compare = { crop: null, knob: 'res', base: 'full', offset: 0, cells: [], picked: false };

function cropsFor(knob) {
  const applies = KNOBS[knob].applies ?? (() => true);
  return crops.filter(applies);
}

function fillCropList() {
  const list = cropsFor(compare.knob);
  if (!list.some((c) => c.id === compare.crop?.id)) compare.crop = list[0];
  $('crop').replaceChildren(
    ...list.map((c) => {
      const option = new Option(`${c.kind}: ${c.title.slice(0, 48)} (p. ${c.page})`, c.id);
      option.selected = c.id === compare.crop.id;
      return option;
    }),
  );
}

function shuffle(items) {
  if (still) return items;
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

let showing = 0;
async function showGrid() {
  const ticket = ++showing;
  const knob = KNOBS[compare.knob];
  const count = Number($('count').value);
  const levels = knob.levels.slice(compare.offset, compare.offset + count - 1);
  const base = BASES[compare.base];
  const recipes = [{ recipe: base, baseline: true }, ...levels.map((v) => ({ recipe: knob.set(base, v), level: v }))];
  const order = shuffle(recipes.map((r, i) => ({ ...r, index: i })));
  compare.picked = false;
  compare.cells = order.map((entry, i) => ({ ...entry, label: 'ABCD'[i], what: describe(entry.recipe) }));
  $('grid').dataset.ready = '';
  $('grid').replaceChildren(...compare.cells.map(cellElement));
  $('note').value = '';
  status(`${knob.name}: ${levels.length} level${levels.length === 1 ? '' : 's'} over ${compare.base === 'full' ? 'full resolution' : 'the laptop'}`);
  const drawn = await Promise.allSettled(compare.cells.map((cell) => draw(compare.crop, cell.recipe)));
  if (ticket !== showing) return;
  drawn.forEach((result, i) => {
    const cell = compare.cells[i];
    const view = cell.element.querySelector('.view');
    if (result.status === 'fulfilled') {
      view.replaceChildren(result.value.canvas);
      cell.ms = result.value.ms;
    } else {
      view.textContent = String(result.reason);
    }
  });
  $('grid').dataset.ready = '1';
  reveal(!$('blind').checked);
}

function cellElement(cell) {
  const { cssW, cssH } = geometry(compare.crop);
  const element = document.createElement('div');
  element.className = 'cell';
  const header = document.createElement('header');
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = cell.label;
  const what = document.createElement('span');
  what.className = 'what';
  what.textContent = '';
  const button = document.createElement('button');
  button.textContent = 'This one';
  button.addEventListener('click', () => pick(cell.label));
  header.append(label, what, button);
  const view = document.createElement('div');
  view.className = 'view';
  view.style.width = `${cssW}px`;
  view.style.height = `${cssH}px`;
  element.append(header, view);
  cell.element = element;
  return element;
}

function reveal(on) {
  for (const cell of compare.cells) {
    cell.element.querySelector('.what').textContent = on ? (cell.baseline ? `baseline: ${cell.what}` : cell.what) : '';
  }
}

async function pick(choice) {
  if (compare.picked) return;
  compare.picked = true;
  for (const cell of compare.cells) cell.element.classList.toggle('picked', cell.label === choice);
  reveal(true);
  const record = {
    kind: 'pick',
    round: ROUND,
    crop: compare.crop.id,
    cropKind: compare.crop.kind,
    knob: compare.knob,
    base: compare.base,
    blind: $('blind').checked,
    cells: compare.cells.map(({ label, recipe, what, baseline, ms }) => ({ label, what, baseline: !!baseline, recipe, ms })),
    pick: choice,
    pickedBaseline: compare.cells.find((c) => c.label === choice)?.baseline ?? false,
    note: $('note').value.trim(),
    paperWidth: paperWidth(),
    device: facts(),
    tablet: tablet(),
  };
  const response = await fetch('/api/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }).catch(
    (error) => ({ ok: false, statusText: String(error) }),
  );
  status(response.ok ? `Saved: ${choice === 'same' ? 'no difference' : choice}. Next crop, or move the strengths.` : `Not saved: ${response.statusText}`);
}

function nextCrop() {
  const list = cropsFor(compare.knob);
  const at = list.findIndex((c) => c.id === compare.crop.id);
  compare.crop = list[(at + 1) % list.length];
  fillCropList();
  void showGrid();
}

function status(text) {
  $('status').textContent = text;
}

// ---- Measure ----

let measuring = false;
async function measure() {
  if (measuring) return;
  measuring = true;
  const crop = crops.find((c) => c.id === $('measure-paper').value);
  const capped = $('measure-cap').value === 'carrel';
  const log = $('measure-log');
  log.textContent = 'Opening…\n';
  const box = $('measure-viewer');
  box.classList.add('running');
  const container = $('viewerContainer');
  // The paper fills the window, as carrel's does with the chat over it.
  Object.assign(box.style, { position: 'fixed', inset: '0', height: 'auto', zIndex: 10, background: '#fff' });
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({
    container,
    viewer: $('viewer'),
    eventBus,
    linkService,
    removePageBorders: true,
    // The cap PDF.js's viewer takes on this platform anyway (stills.py's ?cap= stands in for it).
    maxCanvasPixels: capped ? MAX_CANVAS : 2 ** 28,
  });
  linkService.setViewer(viewer);
  const events = [];
  let since = performance.now();
  let last = performance.now();
  const starts = new Map();
  eventBus.on('pagerender', ({ pageNumber }) => starts.set(pageNumber, performance.now()));
  eventBus.on('pagerendered', ({ source, pageNumber, isDetailView, error }) => {
    last = performance.now();
    const canvas = source.canvas;
    const rect = canvas?.getBoundingClientRect();
    events.push({
      page: pageNumber,
      detail: !!isDetailView,
      afterTurnMs: Math.round(last - since),
      drawMs: starts.has(pageNumber) ? Math.round(last - starts.get(pageNumber)) : null,
      canvas: canvas ? [canvas.width, canvas.height] : null,
      css: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
      ofDevice: canvas && rect?.width ? +(canvas.width / (rect.width * dpr)).toFixed(3) : null,
      error: error ? String(error) : undefined,
    });
  });
  const task = pdfjsLib.getDocument({ ...DOCUMENT, url: `/pdf/${encodeURIComponent(crop.id)}?whole=1` });
  const pdf = await task.promise;
  const ready = new Promise((resolve) => eventBus.on('pagesinit', resolve, { once: true }));
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  await ready;
  viewer.currentScaleValue = 'page-width';
  const settle = async () => {
    do await new Promise((r) => setTimeout(r, 400));
    while (performance.now() - last < 1500);
  };
  since = performance.now();
  await settle();
  for (let turn = 1; turn <= 5; turn++) {
    since = performance.now();
    container.scrollTop += container.clientHeight;
    await settle();
  }
  Object.assign(box.style, { position: '', inset: '', height: '', zIndex: '', background: '' });
  box.classList.remove('running');
  const lines = events.map(
    (e) =>
      `p${e.page} ${e.detail ? 'detail' : 'page  '} ${e.canvas?.join('×')} for ${e.css?.join('×')} css: ${Math.round((e.ofDevice ?? 0) * 100)}% of device px, ` +
      `drawn ${e.drawMs} ms, ${e.afterTurnMs} ms after the turn${e.error ? ` ERROR ${e.error}` : ''}`,
  );
  log.textContent = `${crop.title}, cap ${capped ? 'PDF.js' : 'none'}, scale ${viewer.currentScale.toFixed(3)}\n${lines.join('\n')}\n`;
  const record = { kind: 'measure', round: ROUND, crop: crop.id, cap: capped ? 'pdfjs' : 'none', scale: viewer.currentScale, paperWidth: container.clientWidth, events, device: facts(), tablet: tablet() };
  const response = await fetch('/api/measure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }).catch(() => ({ ok: false }));
  log.textContent += response.ok ? 'Saved.\n' : 'Not saved.\n';
  viewer.setDocument(null);
  linkService.setDocument(null);
  void task.destroy();
  measuring = false;
}

// ---- Modes and controls ----

function setMode(mode) {
  for (const button of document.querySelectorAll('#bar [data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  for (const section of document.querySelectorAll('.mode')) section.hidden = section.id !== mode;
  if (mode === 'device') showFacts();
  if (mode === 'compare') void showGrid();
  try {
    localStorage.setItem('crisp-bench-mode', mode);
  } catch {}
}

async function start() {
  crops = await (await fetch('/api/crops')).json();
  const saved = tablet();
  for (const [name, value] of Object.entries(saved)) {
    const input = $('tablet').elements.namedItem(name);
    if (input) input.value = value;
  }
  $('tablet').addEventListener('input', () => {
    saveTablet();
    showFacts();
  });
  $('knob').replaceChildren(...Object.entries(KNOBS).map(([id, k]) => new Option(k.name, id)));
  $('measure-paper').replaceChildren(...crops.map((c) => new Option(`${c.title.slice(0, 60)} (${c.kind})`, c.id)));
  for (const button of document.querySelectorAll('#bar [data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
  $('knob').addEventListener('change', () => {
    compare.knob = $('knob').value;
    compare.offset = 0;
    fillCropList();
    void showGrid();
  });
  $('crop').addEventListener('change', () => {
    compare.crop = crops.find((c) => c.id === $('crop').value);
    void showGrid();
  });
  $('base').addEventListener('change', () => {
    compare.base = $('base').value;
    void showGrid();
  });
  $('count').addEventListener('change', () => void showGrid());
  $('gentler').addEventListener('click', () => {
    compare.offset = Math.max(0, compare.offset - 2);
    void showGrid();
  });
  $('stronger').addEventListener('click', () => {
    const count = Number($('count').value) - 1;
    compare.offset = Math.max(0, Math.min(KNOBS[compare.knob].levels.length - count, compare.offset + 2));
    void showGrid();
  });
  $('blind').addEventListener('change', () => reveal(!$('blind').checked || compare.picked));
  $('same').addEventListener('click', () => pick('same'));
  $('next').addEventListener('click', nextCrop);
  $('measure-run').addEventListener('click', () => void measure().catch((e) => (($('measure-log').textContent += `${e}\n`), (measuring = false))));

  // stills.py: ?still=1&crop=ID&knob=K&offset=N&count=4&base=full&width=W
  if (still) {
    // What stills.py needs to know to walk every knob over every crop.
    window.benchKnobs = Object.fromEntries(
      Object.entries(KNOBS).map(([id, k]) => [id, { levels: k.levels.length, crops: cropsFor(id).map((c) => c.id) }]),
    );
    compare.knob = params.get('knob') ?? 'res';
    compare.offset = Number(params.get('offset') ?? 0);
    compare.base = params.get('base') ?? 'full';
    $('count').value = params.get('count') ?? '4';
    $('blind').checked = false;
    $('knob').value = compare.knob;
    compare.crop = crops.find((c) => c.id === params.get('crop'));
    fillCropList();
    setMode('compare');
    return;
  }
  compare.knob = $('knob').value;
  fillCropList();
  let mode = 'device';
  try {
    mode = localStorage.getItem('crisp-bench-mode') || mode;
  } catch {}
  setMode(mode);
  showFacts();
}

void start();
