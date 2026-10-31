import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STEPS, closeness } from '../src/carrel/static/meaning-search.js';

test('the nearest paper fills the meter and the farthest shows one step', () => {
  assert.equal(closeness(0.82, 0.82, 0.61), STEPS);
  assert.equal(closeness(0.61, 0.82, 0.61), 1);
  assert.equal(closeness(0.715, 0.82, 0.61), 3); // halfway rounds up
  assert.equal(closeness(0.66, 0.82, 0.61), 2);
});

test('one result, or all equally near, fills the meter', () => {
  assert.equal(closeness(0.7, 0.7, 0.7), STEPS);
  assert.equal(closeness(0.7, undefined, undefined), STEPS);
});

test('a score outside the range stays within the meter', () => {
  assert.equal(closeness(0.9, 0.8, 0.6), STEPS);
  assert.equal(closeness(0.5, 0.8, 0.6), 1);
});
