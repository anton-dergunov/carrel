import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nestedTreemap, squarify } from '../src/carrel/static/treemap.js';

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

test('children inside a large tile, below its header, inside its gutter', () => {
  const nodes = [
    { value: 80, children: [{ value: 50 }, { value: 30 }] },
    { value: 20, children: [{ value: 10 }, { value: 10 }] },
  ];
  const [big, small] = nestedTreemap(nodes, { x: 0, y: 0, width: 400, height: 300 }, { gutter: 4, header: 24, smallest: { width: 120, height: 84 } });
  assert.equal(big.children.length, 2);
  for (const child of big.children) {
    assert.ok(child.x >= big.x && child.x + child.width <= big.x + big.width + 1e-9);
    assert.ok(child.y >= big.y + 24 && child.y + child.height <= big.y + big.height + 1e-9);
  }
  assert.equal(small.children.length, 0); // too small for its children: 76 px wide
});
