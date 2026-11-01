import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// The worker, run without a worker: its message handler on a stand-in `self`.
function sharpen(pixels, width, height, amount) {
  const replies = [];
  const self = { postMessage: (data) => replies.push(data) };
  vm.runInNewContext(readFileSync(new URL('../src/carrel/static/sharpen-worker.js', import.meta.url), 'utf8'), { self, Float32Array, Uint8ClampedArray, Math });
  const buffer = new Uint8ClampedArray(pixels).buffer;
  self.onmessage({ data: { id: 1, width, height, buffer, amount } });
  return Array.from(new Uint8ClampedArray(replies[0].buffer));
}

/** A row of grey pixels (RGBA), one value each. */
const row = (...greys) => greys.flatMap((g) => [g, g, g, 255]);

test('a flat page is left as it is', () => {
  const flat = [...row(200, 200, 200), ...row(200, 200, 200), ...row(200, 200, 200)];
  assert.deepEqual(sharpen(flat, 3, 3, 1), flat);
});

test('an edge is steepened: the dark side darker, the light side lighter, alpha kept', () => {
  const edge = [...row(255, 255, 0, 0), ...row(255, 255, 0, 0), ...row(255, 255, 0, 0)];
  const out = sharpen(edge, 4, 3, 1);
  const middle = out.slice(16, 32);
  assert.equal(middle[4], 255); // the light pixel next to the edge, already white
  assert.equal(middle[8], 0); // the dark pixel next to it, already black
  const grey = [...row(200, 200, 60, 60), ...row(200, 200, 60, 60), ...row(200, 200, 60, 60)];
  const steeper = sharpen(grey, 4, 3, 1).slice(16, 32);
  assert.ok(steeper[4] > 200 && steeper[8] < 60, `${steeper[4]} ${steeper[8]}`);
  assert.equal(steeper[3], 255);
  assert.equal(steeper[0], 200); // two pixels from the edge: unchanged
});

test('the amount scales the change', () => {
  const grey = [...row(200, 60), ...row(200, 60)];
  const light = sharpen(grey, 2, 2, 0.4)[0];
  const strong = sharpen(grey, 2, 2, 1)[0];
  assert.ok(200 < light && light < strong, `${light} ${strong}`);
});
