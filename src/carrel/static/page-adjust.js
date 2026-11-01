// What Settings → Pages draws on a page's canvases once PDF.js has drawn them (read.js calls it
// at each `pagerendered`): bolder letters and sharper edges. Both were judged by the reader in
// crisp-pages; the darker greys, the contrast and the scans' black and white are CSS filters on
// the canvases instead (boot.js's pageFilters), which cost nothing to keep.

/**
 * Emboldens: draws the canvas again over itself, `by` device pixels to the right, keeping the
 * darker of the two. It thickens each letter's stems as stroking its outline would (round 2 found
 * the two alike), without changing the PDF, which keeps the reader's highlights.
 */
export function strike(canvas, by) {
  const context = canvas.getContext('2d');
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'darken';
  context.drawImage(canvas, by, 0);
  context.restore();
}

let worker = null;
let jobs = 0;
const waiting = new Map(); // job id -> resolve
const latest = new WeakMap(); // canvas -> its latest job id, so an older result is dropped

/**
 * Sharpens the canvas's pixels in a worker (sharpen-worker.js), and puts them back unless the
 * canvas was drawn again meanwhile. As a CSS filter the same mask was worked out again at every
 * frame of a scroll (600 ms a frame in Chromium); here it is worked out once a page is drawn.
 */
export function sharpen(canvas, amount) {
  if (!worker) {
    worker = new Worker(new URL('./sharpen-worker.js', import.meta.url));
    worker.onmessage = ({ data }) => {
      waiting.get(data.id)?.(data.buffer);
      waiting.delete(data.id);
    };
  }
  const { width, height } = canvas;
  const context = canvas.getContext('2d');
  const image = context.getImageData(0, 0, width, height);
  const id = ++jobs;
  latest.set(canvas, id);
  return new Promise((resolve) => {
    waiting.set(id, (buffer) => {
      if (latest.get(canvas) === id && canvas.width === width && canvas.height === height) {
        context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
      }
      resolve();
    });
    worker.postMessage({ id, width, height, buffer: image.data.buffer, amount }, [image.data.buffer]);
  });
}

/** Marks the canvas as drawn again, so a sharpening still running for it is dropped. */
export function redrawn(canvas) {
  latest.delete(canvas);
}
