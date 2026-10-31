import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SECTIONS, aboutNote, contentsNote, digestPoints, restoreSheet } from '../src/carrel/static/paper-sheet.js';

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
