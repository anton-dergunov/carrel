import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SECTIONS, aboutNote, contentsNote, digestPoints, interleave, restoreSheet } from '../src/carrel/static/paper-sheet.js';

test('a new device folds the sections that start folded', () => {
  const folded = Object.keys(SECTIONS).filter((id) => !SECTIONS[id]);
  for (const stored of [null, undefined, 'about', 7, {}, { folded: 'digest' }]) {
    assert.deepEqual([...restoreSheet(stored).folded].sort(), folded.sort());
  }
});

test('the folds kept are read back, without names it does not know', () => {
  assert.deepEqual([...restoreSheet({ folded: ['about', 'contents', 'nope', 3, null] }).folded], ['about', 'contents']);
  // Every section open is a choice too, not a missing one.
  assert.deepEqual([...restoreSheet({ folded: [] }).folded], []);
});

test("a digest's points are its top-level bullets", () => {
  assert.equal(digestPoints('- Claim: x\n- Method: y\n  - nested\n* Result: z\nprose - not a point'), 3);
  assert.equal(digestPoints(''), 0);
  assert.equal(digestPoints(undefined), 0);
});

test("the contents' note counts its top level", () => {
  assert.equal(contentsNote([]), 'no table');
  assert.equal(contentsNote([{ title: 'Introduction' }]), '1 entry');
  assert.equal(contentsNote([{ items: [{}, {}] }, {}, {}]), '3 entries');
});

test("About's note is the type and the area's name", () => {
  assert.equal(aboutNote('position', 'data-centric-ml'), 'position · data centric ml');
  assert.equal(aboutNote('method', 'llm/agent-memory'), 'method · agent memory');
  assert.equal(aboutNote(undefined, 'llm'), 'llm');
  assert.equal(aboutNote('survey', null), 'survey');
});

test('the contents note counts the highlights too', () => {
  assert.equal(contentsNote([{}, {}], 4), '2 entries · 4 highlights');
  assert.equal(contentsNote([], 1), '1 highlight');
  assert.equal(contentsNote([], 0), 'no table');
});

test('each highlight goes under the last heading at or above it', () => {
  // Depth first: 1 Intro (p1), 1.1 Setup (p2, low), 2 Method (p3), and one leading nowhere.
  const places = [{ page: 1, top: 80 }, { page: 2, top: 500 }, { page: 3, top: 60 }, null];
  const at = (page, top) => ({ page, rect: [72, top, 300, top + 10] });
  const highlights = [at(1, 40), at(1, 300), at(2, 100), at(2, 520), at(3, 59), at(9, 10)];
  const { before, under } = interleave(places, highlights);
  assert.deepEqual(before, [highlights[0]]); // above the first heading
  assert.deepEqual(under.get(0), [highlights[1], highlights[2]]);
  assert.deepEqual(under.get(1), [highlights[3]]);
  // A heading's place is a little above its line: a highlight on it belongs to it.
  assert.deepEqual(under.get(2), [highlights[4], highlights[5]]);
  assert.equal(under.has(3), false);
  // With no places at all (no outline), every highlight comes before.
  assert.equal(interleave([], highlights).before.length, highlights.length);
});
