// Sharpens a page's pixels for Settings → Pages (page-adjust.js): an unsharp mask, the page plus
// `amount` times the page less a [1 2 1]/4 blur each way, about one device pixel wide. The mask
// the reader judged in crisp-pages; done here, once a page is drawn, since the same mask as a CSS
// filter was worked out again at every frame of a scroll. A message is {id, width, height, buffer,
// amount}; the reply is the same buffer, sharpened.

self.onmessage = ({ data }) => {
  const { id, width, height, buffer, amount } = data;
  sharpen(new Uint8ClampedArray(buffer), width, height, amount);
  self.postMessage({ id, buffer }, [buffer]);
};

function sharpen(px, w, h, amount) {
  // The blur across, from the page as drawn, kept apart: each pixel below is changed once read.
  const across = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;
      const l = (row + Math.max(0, x - 1)) * 4;
      const r = (row + Math.min(w - 1, x + 1)) * 4;
      const o = (row + x) * 3;
      for (let c = 0; c < 3; c++) across[o + c] = (px[l + c] + 2 * px[i + c] + px[r + c]) / 4;
    }
  }
  // The blur down, from the blur across, and the mask.
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w;
    const row = y * w;
    const down = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (across[(up + x) * 3 + c] + 2 * across[(row + x) * 3 + c] + across[(down + x) * 3 + c]) / 4;
        px[i + c] = px[i + c] + amount * (px[i + c] - blur);
      }
    }
  }
}
