import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turnTarget } from '../src/carrel/static/pager.js';

const box = { view: 1000, height: 5000, carry: 50 };

test('a turn moves a screenful less the lines carried over', () => {
  assert.deepEqual(turnTarget({ ...box, top: 0, direction: 1 }), { to: 950, retraced: false });
  assert.deepEqual(turnTarget({ ...box, top: 1900, direction: -1 }), { to: 950, retraced: false });
});

test('a turn stops at either end', () => {
  assert.equal(turnTarget({ ...box, top: 3900, direction: 1 }).to, 4000);
  assert.equal(turnTarget({ ...box, top: 300, direction: -1 }).to, 0);
  assert.equal(turnTarget({ ...box, top: 2000, direction: 'start' }).to, 0);
  assert.equal(turnTarget({ ...box, top: 2000, direction: 'end' }).to, 4000);
});

test('going back retraces the turn before', () => {
  const turns = [{ from: 3700, to: 4000, direction: 1 }];
  assert.deepEqual(turnTarget({ ...box, top: 4000, direction: -1, turns }), { to: 3700, retraced: true });
  // Not when the page was moved since, or for a second turn the same way.
  assert.deepEqual(turnTarget({ ...box, top: 3500, direction: -1, turns }), { to: 2550, retraced: false });
  assert.equal(turnTarget({ ...box, top: 4000, direction: 1, turns }).retraced, false);
});

test("a page that starts near the bottom of the screen starts the next one", () => {
  assert.equal(turnTarget({ ...box, top: 0, direction: 1, pageTops: [0, 880, 1760] }).to, 880);
  assert.equal(turnTarget({ ...box, top: 0, direction: 1, pageTops: [0, 980, 1960] }).to, 980);
  // Higher up, the turn is a whole screen; and going back never snaps.
  assert.equal(turnTarget({ ...box, top: 0, direction: 1, pageTops: [0, 500, 1500] }).to, 950);
  assert.equal(turnTarget({ ...box, top: 1900, direction: -1, pageTops: [0, 1000, 2000] }).to, 950);
});
