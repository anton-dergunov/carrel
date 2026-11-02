// A minimal viewer over MuPDF.js, to see what drawing off the main thread in tiles gives in WebKit:
// each page is first drawn whole at a quarter of the screen's resolution, then, once the paper
// moves slowly enough to read, as bands of full resolution over the part in view, the way
// PDFKit and Chrome's PDFium draw. Workers draw (mupdf-worker.js); this page only places their
// bitmaps, in `bitmaprenderer` canvases, which take a bitmap without copying it.
//
// What is drawn next is chosen when a worker is free, from where the paper is then: the pages in
// view whole, then their bands in view, then the pages either side whole. A page left far behind
// loses its bands, then its whole drawing.

import { asked, createFrames, failed, paperInfo } from './frames.js';

const WORKERS = Math.min(2, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
const GAP = 8;
const LOW = 0.25; // the whole page's resolution, a share of the screen's
const BAND = 512; // device px
const FAST = 2; // screens a second: above it no bands are drawn, as carrel's scroll-gate.js
const AROUND = 3; // pages either side drawn whole ahead
const KEEP_BANDS = 2; // pages either side of the view that keep their bands
const KEEP_LOW = 40; // pages either side that keep their whole drawing

try {
  const { paper: id, page: start } = asked();
  const paper = await paperInfo(id);
  const frames = createFrames('mupdf', id);
  const pane = document.getElementById('pane');
  const data = await (await fetch(`/pdf/${id}`)).arrayBuffer();

  const workers = await Promise.all(
    Array.from({ length: WORKERS }, () => {
      const worker = new Worker('/viewers/mupdf-worker.js', { type: 'module' });
      return new Promise((resolve, reject) => {
        worker.onerror = (event) => reject(new Error(`The worker failed: ${event.message}`));
        worker.onmessage = ({ data: reply }) => {
          if (reply.ready) worker.postMessage({ open: data.slice(0) });
          else if (reply.opened) resolve({ worker, sizes: reply.opened, busy: null });
          else reject(new Error(reply.error));
        };
      });
    }),
  );
  const sizes = workers[0].sizes;

  // The pages laid out: a div each, as wide as the pane.
  const column = document.createElement('div');
  pane.append(column);
  const dpr = devicePixelRatio;
  const width = pane.clientWidth;
  const pages = sizes.map(([w, h], index) => {
    const div = document.createElement('div');
    const height = Math.round((width * h) / w);
    div.style.cssText = `position: relative; width: ${width}px; height: ${height}px; margin: 0 auto ${GAP}px; background: #fff; overflow: hidden;`;
    div.dataset.page = index + 1;
    column.append(div);
    const scale = (width * dpr) / w; // device px a point
    return { index, div, height, scale, top: 0, low: null, bands: new Map(), pending: new Set(), rows: Math.round(h * scale) };
  });
  let top = 0;
  for (const page of pages) {
    page.top = top;
    top += page.height + GAP;
  }
  pane.scrollTop = pages[(start ?? paper.page) - 1].top;

  // How fast the paper moves, in screens a second, from the last 100 ms of scrolling.
  const moves = [];
  pane.addEventListener('scroll', () => {
    moves.push([performance.now(), pane.scrollTop]);
    pump();
  }, { passive: true });
  function speed() {
    const now = performance.now();
    while (moves.length && now - moves[0][0] > 100) moves.shift();
    if (moves.length < 2) return 0;
    const [t0, y0] = moves[0];
    const [t1, y1] = moves[moves.length - 1];
    if (now - t1 > 100) return 0;
    return Math.abs(y1 - y0) / Math.max(t1 - t0, 16) * 1000 / pane.clientHeight;
  }
  // When the paper stops, the bands are asked for.
  let settle = null;
  pane.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(pump, 120);
  }, { passive: true });

  function inView() {
    const y0 = pane.scrollTop;
    const y1 = y0 + pane.clientHeight;
    return pages.filter((page) => page.top < y1 && page.top + page.height > y0).map((page) => ({
      page,
      // The rows in view, in the page's device px.
      from: Math.max(0, ((y0 - page.top) / page.height) * page.rows),
      to: Math.min(page.rows, ((y1 - page.top) / page.height) * page.rows),
    }));
  }

  function next() {
    const visible = inView();
    for (const { page } of visible) if (!page.low && !page.pending.has('low')) return { page, kind: 'low' };
    if (speed() <= FAST) {
      for (const { page, from, to } of visible) {
        for (let band = Math.floor(from / BAND); band * BAND < to; band += 1) {
          if (!page.bands.has(band) && !page.pending.has(band)) return { page, kind: band };
        }
      }
    }
    const first = visible[0]?.page.index ?? 0;
    const last = visible[visible.length - 1]?.page.index ?? 0;
    for (let d = 1; d <= AROUND; d += 1) {
      for (const index of [last + d, first - d]) {
        const page = pages[index];
        if (page && !page.low && !page.pending.has('low')) return { page, kind: 'low' };
      }
    }
    return null;
  }

  function pump() {
    for (const worker of workers) {
      if (worker.busy) continue;
      const job = next();
      if (!job) break;
      const { page, kind } = job;
      page.pending.add(kind);
      const draw = kind === 'low'
        ? { index: page.index, scale: page.scale * LOW, y0: 0, y1: Math.round(page.rows * LOW), kind }
        : { index: page.index, scale: page.scale, y0: kind * BAND, y1: Math.min(page.rows, (kind + 1) * BAND), kind };
      worker.busy = draw;
      worker.worker.onmessage = ({ data: reply }) => {
        worker.busy = null;
        page.pending.delete(kind);
        if (reply.error) console.error(reply.error);
        else place(page, reply.drawn, reply.bitmap);
        evict();
        pump();
      };
      worker.worker.postMessage({ draw });
    }
    markSharp();
  }

  function canvasFor(bitmap) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
    return canvas;
  }

  function place(page, { kind, y0, y1 }, bitmap) {
    const canvas = canvasFor(bitmap);
    if (kind === 'low') {
      canvas.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%;';
      page.low = canvas;
      page.div.prepend(canvas);
      if (isVisible(page)) frames.first(page.index + 1);
    } else {
      const css = page.height / page.rows;
      canvas.style.cssText = `position: absolute; left: 0; width: 100%; top: ${y0 * css}px; height: ${(y1 - y0) * css}px;`;
      page.bands.set(kind, canvas);
      page.div.append(canvas);
    }
  }

  function isVisible(page) {
    return page.top < pane.scrollTop + pane.clientHeight && page.top + page.height > pane.scrollTop;
  }

  function markSharp() {
    for (const { page, from, to } of inView()) {
      let all = true;
      for (let band = Math.floor(from / BAND); band * BAND < to; band += 1) all &&= page.bands.has(band);
      if (all) frames.sharp(page.index + 1);
    }
  }

  function evict() {
    const visible = inView();
    if (!visible.length) return;
    const first = visible[0].page.index;
    const last = visible[visible.length - 1].page.index;
    for (const page of pages) {
      const away = page.index < first ? first - page.index : page.index - last;
      if (away > KEEP_BANDS && page.bands.size) {
        for (const canvas of page.bands.values()) canvas.remove();
        page.bands.clear();
      }
      if (away > KEEP_LOW && page.low) {
        page.low.remove();
        page.low = null;
      }
    }
  }

  // Each page's visits, for the instrument.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const page = Number(entry.target.dataset.page);
      if (entry.isIntersecting) {
        frames.seen(page);
        if (pages[page - 1].low) frames.first(page);
      } else frames.gone(page);
    }
  }, { root: pane });
  for (const page of pages) observer.observe(page.div);
  pump();
} catch (error) {
  failed(error);
}
