// MuPDF in a worker: the paper opened once, the display lists of the pages drawn lately kept, and
// each request drawn into a pixmap of exactly the device pixels asked for, returned as an
// ImageBitmap. Several of these run side by side (mupdf.js), each with its own copy of the paper.

import * as mupdf from '/vendor/mupdf/mupdf.js';

const KEPT_LISTS = 16;
let doc = null;
// Page index → its display list, the most recently used last.
const lists = new Map();

function displayList(index) {
  let list = lists.get(index);
  if (list) {
    lists.delete(index);
  } else {
    const page = doc.loadPage(index);
    list = page.toDisplayList(true);
    page.destroy();
  }
  lists.set(index, list);
  while (lists.size > KEPT_LISTS) {
    const [oldest, gone] = lists.entries().next().value;
    lists.delete(oldest);
    gone.destroy();
  }
  return list;
}

// One band of a page: rows y0..y1 of the page drawn at `scale` device pixels a point.
async function draw({ index, scale, y0, y1 }) {
  const started = performance.now();
  const list = displayList(index);
  const [x0p, y0p, x1p] = list.getBounds();
  const width = Math.round((x1p - x0p) * scale);
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, y0, width, y1], true);
  pixmap.clear(255);
  const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
  // The page's own origin need not be 0, 0 (a crop box): moved there, then scaled.
  list.run(device, mupdf.Matrix.concat(mupdf.Matrix.translate(-x0p, -y0p), mupdf.Matrix.scale(scale, scale)));
  device.close();
  device.destroy();
  const pixels = new Uint8ClampedArray(pixmap.getPixels());
  const image = new ImageData(pixels, width, y1 - y0);
  pixmap.destroy();
  const bitmap = await createImageBitmap(image);
  return { bitmap, ms: performance.now() - started };
}

onmessage = async ({ data }) => {
  try {
    if (data.open) {
      doc = mupdf.Document.openDocument(data.open, 'application/pdf');
      const sizes = [];
      for (let i = 0; i < doc.countPages(); i += 1) {
        const page = doc.loadPage(i);
        const [x0, y0, x1, y1] = page.getBounds();
        sizes.push([x1 - x0, y1 - y0]);
        page.destroy();
      }
      postMessage({ opened: sizes });
    } else if (data.draw) {
      const { bitmap, ms } = await draw(data.draw);
      postMessage({ drawn: data.draw, bitmap, ms }, [bitmap]);
    }
  } catch (error) {
    postMessage({ error: String(error?.stack ?? error), job: data.draw ?? null });
  }
};
// A module worker that awaits its imports misses what was sent before they loaded: the page waits
// for this before it sends anything.
postMessage({ ready: true });
