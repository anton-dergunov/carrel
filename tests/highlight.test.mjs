import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIGHLIGHT_COLORS, LONGEST_PASSAGE, passage } from '../src/carrel/static/highlight.js';

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
