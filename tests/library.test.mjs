import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ancestry,
  areaCounts,
  chipsOn,
  defaultLibraryState,
  filterPapers,
  foundOutsideTitle,
  groupOf,
  matchRanges,
  plainTitle,
  prepare,
  restoreLibrary,
  reviewFor,
  reviewsInside,
  shortDate,
  sortPapers,
  sortRanks,
  topicTree,
  yearCounts,
} from '../src/carrel/static/library.js';

const doc = () =>
  prepare({
    papers: [
      { pdf: 'llm/eval/a.pdf', text: 'library/llm/eval/a.txt', title: 'Judging judges', authors: ['Lin Shi'], published: '2024-06-01', added: '2026-10-01', summary: 'Position bias in judges.', topic: 'llm/eval', type: 'study', reviews: ['llm/eval'] },
      { pdf: 'llm/eval/b.pdf', text: 'library/llm/eval/b.txt', title: '$\\tau$-bench', published: '2024-02-01', added: '2026-10-16', topic: 'llm/eval', type: 'benchmark', chats: 3 },
      { pdf: 'llm/c.pdf', text: 'library/llm/c.txt', title: 'Attention', published: '2017-06-12', added: '2026-09-30', topic: 'llm', overview: true },
      { pdf: 'recsys/d.pdf', text: 'library/recsys/d.txt', title: 'Wide & Deep', topic: 'recsys', type: 'method' },
    ],
    topics: [
      { path: 'llm', scope: 'LLMs', count: 1, total: 3 },
      { path: 'llm/eval', scope: 'Evaluation', count: 2, total: 2 },
      { path: 'recsys', scope: 'Recommenders', count: 1, total: 1 },
    ],
    reviews: [{ scope: 'llm/eval', title: 'Evaluating LLMs' }],
  });

const titles = (papers) => papers.map((paper) => paper.title);

test('every word must match, in the title, authors, summary, topic or type', () => {
  const { papers } = doc();
  assert.deepEqual(titles(filterPapers(papers, 'position judges')), ['Judging judges']);
  assert.deepEqual(titles(filterPapers(papers, 'SHI')), ['Judging judges']);
  assert.deepEqual(titles(filterPapers(papers, 'eval benchmark')), ['τ-bench']);
  assert.deepEqual(titles(filterPapers(papers, 'nothing here')), []);
  assert.equal(filterPapers(papers, '').length, 4);
});

test('chips: areas, types, years and what was touched', () => {
  const { papers } = doc();
  assert.deepEqual(titles(filterPapers(papers, '', { areas: ['llm/eval', 'recsys'] })), ['Judging judges', 'τ-bench', 'Wide & Deep']);
  assert.deepEqual(titles(filterPapers(papers, '', { areas: ['llm'] })).length, 3); // its folders' too
  assert.deepEqual(titles(filterPapers(papers, '', { areas: ['ll'] })), []); // a prefix is not an area
  assert.deepEqual(titles(filterPapers(papers, '', { types: ['none'] })), ['Attention']);
  assert.deepEqual(titles(filterPapers(papers, '', { from: 2018, to: 2024 })), ['Judging judges', 'τ-bench']);
  assert.deepEqual(titles(filterPapers(papers, '', { touched: ['overview', 'chat'] })), ['τ-bench', 'Attention']);
  assert.equal(chipsOn(defaultLibraryState().chips), false);
});

test('sorting, and the headings rows fall under', () => {
  const { papers } = doc();
  assert.deepEqual(titles(sortPapers(papers, 'topic')), ['Attention', 'Judging judges', 'τ-bench', 'Wide & Deep']);
  assert.deepEqual(titles(sortPapers(papers, 'added')), ['τ-bench', 'Judging judges', 'Attention', 'Wide & Deep']);
  assert.deepEqual(titles(sortPapers(papers, 'published')), ['Judging judges', 'τ-bench', 'Attention', 'Wide & Deep']);
  assert.equal(groupOf(papers[0], 'added'), 'October 2026');
  assert.equal(groupOf(papers[0], 'published'), '2024');
  assert.equal(groupOf(papers[3], 'published'), 'Undated');
});

test('the sort ranks follow sortPapers, kept per document', () => {
  const library = doc();
  for (const sort of ['topic', 'added', 'published']) {
    const rank = sortRanks(library, sort);
    assert.deepEqual(titles([...library.papers].sort((a, b) => rank.get(a) - rank.get(b))), titles(sortPapers(library.papers, sort)));
    assert.equal(sortRanks(library, sort), rank);
  }
  assert.notEqual(sortRanks(doc(), 'topic'), sortRanks(library, 'topic'));
});

test('the spans a search marks: any case, overlapping words merged', () => {
  assert.deepEqual(matchRanges('LLMs judge LLM output', ['llm']), [[0, 3], [11, 14]]);
  assert.deepEqual(matchRanges('abcd', ['ab', 'bc']), [[0, 3]]);
  assert.deepEqual(matchRanges('a+b (c)', ['+b', '(c)']), [[1, 3], [4, 7]]);
  assert.deepEqual(matchRanges('τ²-Bench', ['τ²']), [[0, 2]]);
  assert.deepEqual(matchRanges('', ['x']), []);
});

test('what a title search found outside the title', () => {
  const [judges, tau] = doc().papers;
  assert.deepEqual(foundOutsideTitle(judges, ['judging']), []);
  assert.deepEqual(foundOutsideTitle(judges, ['judging', 'shi']), [{ field: 'authors', text: 'Lin Shi', ranges: [[4, 7]] }]);
  assert.deepEqual(foundOutsideTitle(judges, ['bias', 'judges']), [{ field: 'summary', text: 'Position bias in judges.', ranges: [[9, 13], [17, 23]] }]);
  assert.deepEqual(
    foundOutsideTitle(tau, ['eval', 'bench', '2024']).map((each) => [each.field, each.text]),
    [
      ['area', 'llm/eval'],
      ['year', '2024'],
    ],
  );
  // A field comes only for a word the ones before it lack; a field the row shows is left out.
  const agents = { ...judges, title: 'Agents', summary: 'An LLM survey.', topic: 'llm/agents' };
  assert.deepEqual(foundOutsideTitle(agents, ['llm', 'agent']).map((each) => each.field), ['summary']);
  assert.deepEqual(foundOutsideTitle(agents, ['llm'], { shown: ['summary'] }), []);
  assert.deepEqual(foundOutsideTitle({ ...agents, summary: 'A survey.' }, ['llm']).map((each) => each.text), ['llm/agents']);
  const long = { ...judges, summary: `${'Some words come first here, '.repeat(4)}then the needle, and more.` };
  const [found] = foundOutsideTitle(long, ['needle']);
  assert.match(found.text, /^…\S.*needle, and more\.$/);
  assert.ok(found.text.indexOf('needle') <= 42);
  assert.deepEqual(found.ranges, [[found.text.indexOf('needle'), found.text.indexOf('needle') + 6]]);
});

test('the topic tree, with totals or with the matches of a search', () => {
  const { topics, papers } = doc();
  const tree = topicTree(topics);
  assert.deepEqual(tree.map((node) => [node.path, node.total, node.children.map((child) => child.name)]), [
    ['llm', 3, ['eval']],
    ['recsys', 1, []],
  ]);
  const counts = areaCounts(filterPapers(papers, 'judges'));
  assert.deepEqual([...counts], [['llm', 1], ['llm/eval', 1]]);
  assert.deepEqual(topicTree(topics, counts).map((node) => node.total), [1, 0]);
  assert.deepEqual(ancestry('llm/eval/x'), ['llm', 'llm/eval', 'llm/eval/x']);
  assert.deepEqual(ancestry(''), []);
});

test('years published, every year from the first to the last', () => {
  const { papers } = doc();
  const years = yearCounts(papers);
  assert.equal(years.length, 2024 - 2017 + 1);
  assert.deepEqual(years[0], { year: 2017, count: 1 });
  assert.deepEqual(years.at(-1), { year: 2024, count: 2 });
  assert.equal(years[1].count, 0);
  assert.deepEqual(yearCounts([]), []);
});

test("an area's review: its own, else the nearest above, and those inside", () => {
  const reviews = [{ scope: 'llm' }, { scope: 'llm/eval' }, { scope: 'search' }];
  assert.equal(reviewFor('llm/eval/benchmarks', reviews).scope, 'llm/eval');
  assert.equal(reviewFor('llm/agents', reviews).scope, 'llm');
  assert.equal(reviewFor('recsys', reviews), null);
  assert.deepEqual(reviewsInside('llm', reviews).map((r) => r.scope), ['llm/eval']);
  assert.equal(reviewsInside('', reviews).length, 3);
});

test('titles with TeX read as text', () => {
  assert.equal(plainTitle('$\\tau^2$-Bench: x'), 'τ²-Bench: x');
  assert.equal(plainTitle('$k$-NN and $O(n^{2})$'), 'k-NN and O(n²)');
  assert.equal(plainTitle('$\\mathcal{V}$-usable $x_{12}$'), 'V-usable x₁₂');
  assert.equal(plainTitle('No maths'), 'No maths');
});

test('dates in short', () => {
  const now = new Date(2026, 9, 30);
  assert.equal(shortDate('2026-10-12', now), '12 Oct');
  assert.equal(shortDate('2024-03-02', now), '2 Mar 2024');
  assert.equal(shortDate('2024-03', now), 'Mar 2024');
});

test("a device's remembered library is checked", () => {
  assert.deepEqual(restoreLibrary(null), defaultLibraryState());
  const state = restoreLibrary({
    view: 'all',
    area: '/llm/eval/',
    density: 'huge',
    sort: 'published',
    depth: 'text',
    chips: { areas: ['llm', 7], types: ['method', 'poem', 'none'], from: 2019, to: 'x', touched: ['chat', 'other'] },
  });
  assert.equal(restoreLibrary({ view: 'graph' }).view, 'desk');
  assert.equal(restoreLibrary({ view: 'map' }).view, 'map');
  assert.equal(restoreLibrary({ view: 'timeline', timeline: 'added' }).timeline, 'added');
  assert.deepEqual(state, {
    view: 'all',
    area: 'llm/eval',
    density: 'compact',
    sort: 'published',
    depth: 'text',
    timeline: 'published',
    chips: { areas: ['llm'], types: ['method', 'none'], from: 2019, to: null, touched: ['chat'] },
  });
});
