import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysAgo, starredList, tagsByUse } from '../src/carrel/static/desk.js';
import { orderTags, tagName } from '../src/carrel/static/marks.js';

test("a tag's name as the engine makes it", () => {
  assert.equal(tagName('Memory Talk'), 'memory-talk');
  assert.equal(tagName('  carrel  '), 'carrel');
  assert.equal(tagName('Café / NeurIPS 2026!'), 'cafe-neurips-2026');
  assert.equal(tagName('!!!'), '');
  assert.equal(tagName('x'.repeat(41)), '');
});

test("a picker offers this device's recent tags first, then the latest used", () => {
  const tags = [
    { name: 'old', latest: '2026-01-01' },
    { name: 'new', latest: '2026-10-30' },
    { name: 'mid', latest: '2026-06-01' },
    { name: 'also-new', latest: '2026-10-30' },
  ];
  assert.deepEqual(orderTags(tags).map((tag) => tag.name), ['also-new', 'new', 'mid', 'old']);
  assert.deepEqual(orderTags(tags, ['old', 'gone']).map((tag) => tag.name), ['old', 'also-new', 'new', 'mid']);
});

test('the desk: the newest star first, the tag used last first', () => {
  const papers = [
    { title: 'B', starred: '2026-10-01' },
    { title: 'A', starred: '2026-10-30' },
    { title: 'C' },
    { title: 'D', starred: '2026-10-01' },
  ];
  const { papers: shown, total } = starredList(papers, 2);
  assert.deepEqual(shown.map((paper) => paper.title), ['A', 'B']);
  assert.equal(total, 3);
  assert.deepEqual(tagsByUse([{ name: 'b', latest: '2026-01-01' }, { name: 'a', latest: '2026-02-01' }, { name: 'c' }]).map((tag) => tag.name), ['a', 'b', 'c']);
  // On the same day, the one this device used last leads.
  const sameDay = [{ name: 'carrel', latest: '2026-11-01' }, { name: 'thesis', latest: '2026-11-01' }];
  assert.deepEqual(tagsByUse(sameDay, ['thesis']).map((tag) => tag.name), ['thesis', 'carrel']);
});

test('how long ago a star was', () => {
  assert.equal(daysAgo('2026-11-01', '2026-11-01'), 'today');
  assert.equal(daysAgo('2026-10-31', '2026-11-01'), 'yesterday');
  assert.equal(daysAgo('2026-10-28', '2026-11-01'), '4 days ago');
  assert.equal(daysAgo('2026-10-01', '2026-11-01'), '1 Oct');
});
