import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepLargest, squarify } from '../src/carrel/static/treemap.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("the paper's own example: areas in proportion, the rectangle filled", () => {
  const values = [6, 6, 4, 3, 2, 2, 1];
  const rect = { x: 0, y: 0, width: 6, height: 4 };
  const tiles = squarify(values.map((value) => ({ value })), rect);
  assert.equal(tiles.length, values.length);
  for (const tile of tiles) assert.ok(close(tile.width * tile.height, tile.item.value), `${tile.item.value}`);
  assert.ok(close(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0), 24));
  for (const tile of tiles) {
    assert.ok(tile.x >= -1e-9 && tile.y >= -1e-9 && tile.x + tile.width <= 6 + 1e-9 && tile.y + tile.height <= 4 + 1e-9);
  }
  // The first row is the two sixes, side by side down the left.
  assert.deepEqual(tiles.slice(0, 2).map((tile) => [tile.x, tile.y, tile.width, tile.height]), [[0, 0, 3, 2], [0, 2, 3, 2]]);
});

test('no tiles overlap, and none of no value is drawn', () => {
  const items = [40, 12, 9, 7, 7, 3, 1, 0, -2].map((value, i) => ({ value, i }));
  const tiles = squarify(items, { x: 10, y: 20, width: 300, height: 180 });
  assert.equal(tiles.length, 7);
  for (const a of tiles) {
    for (const b of tiles) {
      if (a === b) continue;
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-6;
      assert.ok(!overlap);
    }
  }
  assert.deepEqual(squarify([], { x: 0, y: 0, width: 10, height: 10 }), []);
});

test('the largest that can be named are kept, the rest merged into one', () => {
  const items = [100, 60, 40, 3, 2, 2, 1].map((value, i) => ({ value, name: `t${i}` }));
  const rect = { x: 0, y: 0, width: 300, height: 200 };
  const merge = (members) => ({ value: members.reduce((sum, item) => sum + item.value, 0), members });
  const big = (tile) => tile.width * tile.height >= 1500;
  const { tiles, kept } = keepLargest(items, (list) => squarify(list, rect), big, merge);
  assert.equal(kept, 3);
  const merged = tiles.find((tile) => tile.item.members);
  assert.deepEqual(merged.item.members.map((item) => item.name), ['t3', 't4', 't5', 't6']);
  assert.equal(merged.item.value, 8);
  // All fit: nothing merged.
  assert.equal(keepLargest(items, (list) => squarify(list, rect), () => true, merge).kept, 7);
  // One small item is never merged alone: it goes with the next smallest.
  const three = [{ value: 100 }, { value: 50 }, { value: 1 }];
  const fitsBig = (tile) => tile.item.members || tile.item.value >= 50;
  assert.equal(keepLargest(three, (list) => squarify(list, rect), fitsBig, merge).kept, 1);
  // Nothing fits: every item laid out, none kept.
  assert.equal(keepLargest(three, (list) => squarify(list, rect), () => false, merge).kept, 0);
});

test('an item marked last goes after the others, whatever its size', () => {
  const tiles = squarify([{ value: 10 }, { value: 50, last: true }, { value: 30 }], { x: 0, y: 0, width: 90, height: 10 });
  assert.deepEqual(tiles.map((tile) => tile.item.value), [30, 10, 50]);
  assert.ok(tiles.at(-1).x >= tiles[0].x && tiles.at(-1).x + tiles.at(-1).width <= 90 + 1e-9);
});
