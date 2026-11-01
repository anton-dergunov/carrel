// Work on a variant's pixels, at the device's own pixels: an unsharp mask, and Sauvola's
// threshold for scans. A message is {id, width, height, buffer, op, ...}; the reply is the
// same buffer, changed.

self.onmessage = ({ data }) => {
  const { id, width, height, buffer, op } = data;
  const pixels = new Uint8ClampedArray(buffer);
  if (op === 'sharpen') sharpen(pixels, width, height, data.amount);
  if (op === 'sauvola') sauvola(pixels, width, height, data.k, data.window);
  self.postMessage({ id, buffer }, [buffer]);
};

// out = in + amount * (in - blur), the blur a [1 2 1]/4 kernel each way: about one device pixel.
function sharpen(px, w, h, amount) {
  const src = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    src[j] = px[i];
    src[j + 1] = px[i + 1];
    src[j + 2] = px[i + 2];
  }
  const tmp = new Float32Array(src.length);
  const at = (x, y) => (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      for (let c = 0; c < 3; c++) tmp[o + c] = (src[l + c] + 2 * src[o + c] + src[r + c]) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const u = at(x, y - 1);
      const d = at(x, y + 1);
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (tmp[u + c] + 2 * tmp[o + c] + tmp[d + c]) / 4;
        px[i + c] = src[o + c] + amount * (src[o + c] - blur);
      }
    }
  }
}

// A pixel is ink when darker than mean * (1 + k * (sd / 128 - 1)) of the window around it.
function sauvola(px, w, h, k, window) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      rowSum += g;
      rowSq += g * g;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rowSum;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rowSq;
    }
  }
  const half = window >> 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w, x + half + 1);
      const n = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      const s2 = sq[y1 * W + x1] - sq[y0 * W + x1] - sq[y1 * W + x0] + sq[y0 * W + x0];
      const mean = s / n;
      const sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
      const i = (y * w + x) * 4;
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const v = g > mean * (1 + k * (sd / 128 - 1)) ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
}
