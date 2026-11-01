import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitLabel, keepLargest, layoutToFit, layoutTreemap, mapNodes, squarify, stretch, TOP_TEXT } from '../src/carrel/static/treemap.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;
// A text as wide as its letters at about half the size each: near enough to the reading serif.
const measure = (text, size) => text.length * size * 0.55;

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
  const { tiles, kept } = keepLargest(items, (list) => [squarify(list, rect)], big, merge);
  assert.equal(kept, 3);
  const merged = tiles.find((tile) => tile.item.members);
  assert.deepEqual(merged.item.members.map((item) => item.name), ['t3', 't4', 't5', 't6']);
  assert.equal(merged.item.value, 8);
  // All fit: nothing merged.
  assert.equal(keepLargest(items, (list) => [squarify(list, rect)], () => true, merge).kept, 7);
  // One small item is never merged alone: it goes with the next smallest.
  const three = [{ value: 100 }, { value: 50 }, { value: 1 }];
  const fitsBig = (tile) => tile.item.members || tile.item.value >= 50;
  assert.equal(keepLargest(three, (list) => [squarify(list, rect)], fitsBig, merge).kept, 1);
  // Nothing fits: every item laid out, none kept.
  assert.equal(keepLargest(three, (list) => [squarify(list, rect)], () => false, merge).kept, 0);
});

test('an item marked last goes after the others, whatever its size', () => {
  const tiles = squarify([{ value: 10 }, { value: 50, last: true }, { value: 30 }], { x: 0, y: 0, width: 90, height: 10 });
  assert.deepEqual(tiles.map((tile) => tile.item.value), [30, 10, 50]);
  assert.ok(tiles.at(-1).x >= tiles[0].x && tiles.at(-1).x + tiles.at(-1).width <= 90 + 1e-9);
});

test('a tolerance breaks the rows elsewhere, and still fills the rectangle in proportion', () => {
  const items = [30, 22, 14, 9, 8, 6, 4, 3].map((value) => ({ value }));
  const rect = { x: 0, y: 0, width: 400, height: 250 };
  const shapes = new Set();
  for (const tolerance of [0.6, 0.8, 1, 1.3, 1.7]) {
    const tiles = squarify(items, rect, { tolerance });
    assert.equal(tiles.length, items.length);
    const scale = (400 * 250) / 96;
    for (const tile of tiles) assert.ok(Math.abs(tile.width * tile.height - tile.item.value * scale) < 1e-6);
    shapes.add(tiles.map((tile) => `${tile.width.toFixed(1)}×${tile.height.toFixed(1)}`).join(' '));
  }
  assert.ok(shapes.size > 1);
});

test('of the candidates that fit, the least stretched is kept', () => {
  const items = [{ value: 2 }, { value: 1 }, { value: 1 }];
  const square = [{ item: items[0], x: 0, y: 0, width: 10, height: 10 }];
  const thin = [{ item: items[0], x: 0, y: 0, width: 40, height: 2 }];
  const wide = [{ item: items[0], x: 0, y: 0, width: 20, height: 5 }];
  const merge = (members) => ({ value: 2, members });
  const { tiles } = keepLargest(items, () => [thin, wide, square], () => true, merge);
  assert.equal(tiles, square);
  assert.equal(keepLargest(items, () => [thin, wide, square], (tile) => tile.width > 10, merge).tiles, wide);
  assert.equal(stretch({ width: 40, height: 2 }), 20);
});

test('a label wraps between words, puts its count under the name when it must, or does not fit', () => {
  const said = { name: 'reinforcement learning', count: '75' };
  const wide = fitLabel(said, 400, 40, TOP_TEXT, measure);
  assert.equal(wide.size, 15);
  assert.equal(wide.below, false);
  // In 100 px "deep learning" (107 px at 15 px) wraps, and "learning 1,234" is too long for a line.
  const narrow = fitLabel({ name: 'deep learning', count: '1,234' }, 104, 80, TOP_TEXT, measure);
  assert.equal(narrow.size, 15);
  assert.equal(narrow.below, true);
  assert.ok(Math.abs(narrow.height - (2 * 15 * 1.2 + 12 * 1.2)) < 1e-9);
  // Too narrow for the long word even at 11 px: no label.
  assert.equal(fitLabel(said, 70, 200, TOP_TEXT, measure), null);
  // Shorter than one line: no label.
  assert.equal(fitLabel(said, 400, 12, TOP_TEXT, measure), null);
});

const topic = (path, count, total = count) => ({ path, count, total });
const name = (path) => path.split('/').at(-1).replaceAll('-', ' ');

test('the nodes: two levels under the root, and a general tile for papers filed beside subtopics', () => {
  const topics = [
    topic('llm', 0, 160),
    topic('llm/architecture', 20, 60),
    topic('llm/architecture/attention', 25),
    topic('llm/architecture/state-space', 15),
    topic('llm/post-training', 1, 100),
    topic('llm/post-training/rl', 60),
    topic('llm/post-training/data', 39),
    topic('graphs', 10),
  ];
  const library = mapNodes(topics, '', name);
  assert.deepEqual(library.map((node) => [node.name, node.value]), [['llm', 160], ['graphs', 10]]);
  assert.deepEqual(library[0].children.map((node) => node.name), ['architecture', 'post training']);
  assert.deepEqual(library[0].children[0].children, [], 'two levels only');
  const llm = mapNodes(topics, 'llm', name);
  // 20 of 60 in architecture itself: a tile; 1 of 100 in post-training: none.
  assert.deepEqual(llm[0].children.map((node) => [node.name, node.value, Boolean(node.own)]), [['attention', 25, false], ['state space', 15, false], ['general', 20, true]]);
  assert.deepEqual(llm[1].children.map((node) => node.name), ['rl', 'data']);
  // On architecture's own page, its own papers are a tile among its subtopics.
  assert.deepEqual(mapNodes(topics, 'llm/architecture', name).map((node) => [node.name, Boolean(node.own)]), [['attention', false], ['state space', false], ['general', true]]);
  // A leaf has nothing to map.
  assert.deepEqual(mapNodes(topics, 'graphs', name), []);
});

test('the map names what it can, merges the rest as "+N more areas" at the top, and fills the rectangle', () => {
  const values = [400, 300, 200, 150, 100, 60, 40, 30, 4, 3, 2];
  const topics = values.map((value, i) => topic(`area-${String.fromCharCode(97 + i)}`, value));
  const nodes = mapNodes(topics, '', name);
  const laid = layoutTreemap(nodes, { x: 0, y: 0, width: 600, height: 400 }, { measure, more: 'areas' });
  const merged = laid.tiles.find((tile) => tile.item.merged);
  assert.ok(merged, 'the smallest are merged');
  assert.equal(merged.label.said.name, `+${merged.item.members.length} more areas`);
  assert.equal(laid.named + merged.item.members.length, values.length);
  assert.equal(laid.of, values.length);
  for (const tile of laid.tiles) assert.ok(tile.label, `${tile.item.name} is named`);
  const area = laid.tiles.reduce((sum, tile) => sum + (tile.width + 3) * (tile.height + 3), 0);
  assert.ok(Math.abs(area - 600 * 400) < 1e-6);
  assert.ok(laid.smallest >= 11 && laid.smallest <= 15);
});

test('subtopics are drawn inside a tile large enough, under its label', () => {
  const topics = [topic('big', 0, 300), topic('big/one', 150), topic('big/two', 100), topic('big/three', 50), topic('small', 20)];
  const laid = layoutTreemap(mapNodes(topics, '', name), { x: 0, y: 0, width: 600, height: 400 }, { measure });
  const big = laid.tiles.find((tile) => tile.item.path === 'big');
  assert.deepEqual(big.children.map((child) => child.item.name).sort(), ['one', 'three', 'two']);
  for (const child of big.children) assert.ok(child.y >= big.y + big.label.height && child.x >= big.x);
  assert.equal(laid.inner, 3);
  assert.equal(laid.innerOf, 3);
});

test("an area's map is as short as it can be while naming as much as it would when tall", () => {
  const topics = [topic('graphs', 0, 58), topic('graphs/graph-neural-networks', 40), topic('graphs/graph-embeddings', 18)];
  const nodes = mapNodes(topics, 'graphs', name);
  const laid = layoutToFit(nodes, 700, { min: 140, max: 434, measure });
  assert.equal(laid.height, 140);
  assert.equal(laid.named, 2);
  const many = Array.from({ length: 14 }, (_, i) => topic(`llm/topic-number-${i}`, 20 + i * 5));
  const tall = layoutToFit(mapNodes([topic('llm', 0, 1000), ...many], 'llm', name), 700, { min: 140, max: 434, measure });
  assert.ok(tall.height > 140);
  const full = layoutTreemap(mapNodes([topic('llm', 0, 1000), ...many], 'llm', name), { x: 0, y: 0, width: 700, height: 434 }, { measure });
  assert.equal(tall.named + tall.inner, full.named + full.inner);
});
