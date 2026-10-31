import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortTitle, wrapLines } from '../src/carrel/static/meaning-map.js';
import { indicesOf, mapData } from '../src/carrel/static/map-view.js';

test("a dot's title: the name before a short colon, else its first words", () => {
  assert.equal(shortTitle('Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory'), 'Mem0');
  assert.equal(shortTitle('Attention Is All You Need'), 'Attention Is All You Need');
  assert.equal(shortTitle('A Survey on the Memory Mechanism of Large Language Model based Agents'), 'A Survey on the Memory Mechanism…');
  // A colon after a long opening is not a name.
  assert.equal(shortTitle('Why do large language models sometimes fail at this: a study'), 'Why do large language models…');
  assert.equal(shortTitle(''), '');
});

test('a title in lines, broken between words, the last ending in … when it goes on', () => {
  assert.deepEqual(wrapLines('one two three four', 9), ['one two', 'three', 'four']);
  assert.deepEqual(wrapLines('aa bb cc dd ee ff', 5, 2), ['aa bb', 'cc dd…']);
  assert.deepEqual(wrapLines('', 10), []);
});

test("the server's map joined to the library: papers it no longer holds left out, neighbours renumbered", () => {
  const paper = (text, topic, title) => ({ text, topic, title, pdf: `${text}.pdf` });
  const papers = [paper('a', 'llm/memory', 'Mem0: Memory'), paper('c', 'recsys', 'Wide & Deep')];
  const doc = { papers, topics: [{ path: 'llm' }, { path: 'recsys' }], byText: new Map(papers.map((p) => [p.text, p])) };
  const drawn = {
    side: 1000,
    contours: [],
    points: [
      { id: 'a', x: 1, y: 2, r: 0, h: 1, rank: 0.5, near: [1, 2] },
      { id: 'gone', x: 3, y: 4, r: 0, h: 1, rank: 0.4, near: [0] },
      { id: 'c', x: 5, y: 6, r: 1, h: 2, rank: 1, near: [1, 0] },
    ],
    regions: [
      { id: 'r0', level: 'region', index: 0, folders: ['memory', 'agents'], name: 'agent memory' },
      { id: 'r1', level: 'region', index: 1, folders: ['recsys'] },
    ],
  };
  const data = mapData(drawn, doc);
  assert.deepEqual(data.points.map((p) => p.id), ['a', 'c']);
  assert.deepEqual(data.points.map((p) => p.near), [[1], [0]]);
  assert.deepEqual(data.points.map((p) => [p.short, p.hue]), [['Mem0', 1], ['Wide & Deep', 2]]);
  assert.deepEqual(data.regions.map((r) => [r.label, r.named]), [['agent memory', true], ['recsys', false]]);
  assert.deepEqual([...indicesOf(data.points, [papers[1]])], [1]);
});
