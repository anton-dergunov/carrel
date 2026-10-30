import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIGHLIGHT_COLORS, LONGEST_PASSAGE, lineBoxes, passage } from '../src/carrel/static/highlight.js';

test('a passage is the selection on one line', () => {
  assert.equal(passage('  Wide and\n deep,\tjointly\n\ntrained. '), 'Wide and deep, jointly trained.');
});

test('a long passage is cut, and says so', () => {
  const cut = passage('word '.repeat(2000));
  assert.equal(cut.length <= LONGEST_PASSAGE, true);
  assert.equal(cut.endsWith('word…'), true);
});

test("the colours are vscode-pdf-viewer's", () => {
  assert.deepEqual(
    HIGHLIGHT_COLORS.map(({ name, value }) => `${name}=${value}`),
    ['yellow=#ffeb3b', 'green=#a5d6a7', 'blue=#81d4fa', 'pink=#f48fb1', 'orange=#ffb74d', 'purple=#ce93d8'],
  );
});

// lineBoxes' cases are vscode-pdf-viewer's test/lineBoxes.test.ts; keep them in step.
const box = (x, y, width, height) => ({ x, y, width, height });
const rounded = (boxes) => boxes.map((each) => Object.fromEntries(Object.entries(each).map(([k, v]) => [k, +v.toFixed(4)])));

test('a line with a narrow space between two words is one box', () => {
  const words = [box(0.1, 0.5, 0.2, 0.02), box(0.3, 0.5, 0.005, 0.02), box(0.32, 0.5, 0.2, 0.02)];
  assert.deepEqual(rounded(lineBoxes(words, 1)), [box(0.1, 0.5, 0.42, 0.02)]);
});

test('spans of other heights on a line make it as tall as the tallest', () => {
  const smallCaps = [box(0.1, 0.5, 0.01, 0.02), box(0.11, 0.504, 0.03, 0.016), box(0.14, 0.5, 0.01, 0.02)];
  assert.deepEqual(rounded(lineBoxes(smallCaps, 1)), [box(0.1, 0.5, 0.05, 0.02)]);
});

test('two lines stay two boxes, in order', () => {
  const lines = [box(0.1, 0.52, 0.3, 0.02), box(0.1, 0.5, 0.4, 0.02)];
  assert.deepEqual(rounded(lineBoxes(lines, 1)), [box(0.1, 0.5, 0.4, 0.02), box(0.1, 0.52, 0.3, 0.02)]);
});

test('two columns side by side stay apart', () => {
  const columns = [box(0.1, 0.5, 0.35, 0.02), box(0.5, 0.5, 0.35, 0.02)];
  assert.deepEqual(rounded(lineBoxes(columns, 1)), columns);
});

test("a gap is measured against the line's height in the page's proportions", () => {
  // 0.03 of the width is 0.0225 of the height on a page 3:4, wider than the line.
  const words = [box(0.1, 0.5, 0.2, 0.02), box(0.33, 0.5, 0.2, 0.02)];
  assert.equal(lineBoxes(words, 0.75).length, 2);
  assert.equal(lineBoxes(words, 0.5).length, 1);
});

test('no boxes are left as they are', () => {
  assert.equal(lineBoxes(null, 1), null);
  assert.deepEqual(lineBoxes([], 1), []);
});
