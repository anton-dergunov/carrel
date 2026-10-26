import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampShare, restoreLayout, shareAt } from '../src/carrel/static/layout.js';
import {
  CHAT,
  PAPERS,
  closePaper,
  emptyTabs,
  fileFromPath,
  openPaper,
  paperInView,
  readingUrl,
  restoreTabs,
  show,
  targetFromQuery,
  withPlace,
} from '../src/carrel/static/tabs.js';

const A = { pdf: 'recsys/A.pdf', title: 'A' };
const B = { pdf: 'recsys/B.pdf', title: 'B' };
const C = { pdf: 'llm/C.pdf', title: 'C' };

const pdfs = (state) => state.papers.map((paper) => paper.pdf);

test('a paper opens in a tab after the one showing, and shows', () => {
  let state = openPaper(openPaper(emptyTabs(), A), B);
  state = show(state, A.pdf);
  state = openPaper(state, C);
  assert.deepEqual(pdfs(state), [A.pdf, C.pdf, B.pdf]);
  assert.equal(state.active, C.pdf);
});

test('a paper already open only shows', () => {
  const state = openPaper(show(openPaper(openPaper(emptyTabs(), A), B), PAPERS), A);
  assert.deepEqual(pdfs(state), [A.pdf, B.pdf]);
  assert.equal(state.active, A.pdf);
});

test('from the list, a paper opens at the end', () => {
  const state = openPaper(show(openPaper(openPaper(emptyTabs(), A), B), PAPERS), C);
  assert.deepEqual(pdfs(state), [A.pdf, B.pdf, C.pdf]);
});

test('closing the tab showing shows its right neighbour, else its left, else the list', () => {
  let state = openPaper(openPaper(openPaper(emptyTabs(), A), B), C);
  state = closePaper(show(state, B.pdf), B.pdf);
  assert.equal(state.active, C.pdf);
  state = closePaper(state, C.pdf);
  assert.equal(state.active, A.pdf);
  state = closePaper(state, A.pdf);
  assert.equal(state.active, PAPERS);
  assert.equal(state.last, null);
});

test('closing another tab leaves the one showing', () => {
  const state = closePaper(openPaper(openPaper(emptyTabs(), A), B), A.pdf);
  assert.equal(state.active, B.pdf);
});

test('over the list or the chat, a question is about the paper shown last', () => {
  let state = openPaper(openPaper(emptyTabs(), A), B);
  state = show(show(state, A.pdf), CHAT);
  assert.equal(paperInView(state).pdf, A.pdf);
  state = show(state, PAPERS);
  assert.equal(paperInView(state).pdf, A.pdf);
  assert.equal(paperInView(emptyTabs()), null);
});

test('a tab keeps its place', () => {
  const place = { page: 3, scale: 'page-width', left: 0, top: 500 };
  const state = withPlace(openPaper(emptyTabs(), A), A.pdf, place);
  assert.deepEqual(state.papers[0].place, place);
});

test('a remembered state is checked', () => {
  assert.deepEqual(restoreTabs(null), emptyTabs());
  assert.deepEqual(restoreTabs({ papers: 'nonsense' }), emptyTabs());
  const state = restoreTabs({
    papers: [A, { pdf: '' }, A, { pdf: B.pdf }, 7],
    active: 'gone.pdf',
    last: B.pdf,
  });
  assert.deepEqual(state, {
    papers: [
      { ...A, place: null },
      { pdf: B.pdf, title: 'B', place: null },
    ],
    active: PAPERS,
    last: B.pdf,
  });
  assert.equal(restoreTabs({ papers: [A], active: A.pdf }).active, A.pdf);
});

test('the address names the paper showing', () => {
  const url = readingUrl('recsys/Wide & Deep.pdf', { page: 2, dest: 'table.1' });
  assert.equal(url, '/read/recsys/Wide%20%26%20Deep.pdf?page=2&dest=table.1');
  assert.equal(fileFromPath(new URL(url, 'http://x').pathname), 'recsys/Wide & Deep.pdf');
  assert.equal(fileFromPath('/'), null);
  assert.deepEqual(targetFromQuery('?page=2&dest=table.1'), { page: 2, dest: 'table.1' });
  assert.equal(targetFromQuery(''), null);
});

test('a remembered layout is checked', () => {
  assert.deepEqual(restoreLayout(null), { place: 'bottom', hidden: false, share: 0.4 });
  assert.deepEqual(restoreLayout({ place: 'left', hidden: true, share: 0.99 }), { place: 'left', hidden: true, share: 0.85 });
  assert.equal(restoreLayout({ place: 'sideways' }).place, 'bottom');
  assert.equal(clampShare(0), 0.15);
});

test('the split follows the finger', () => {
  assert.equal(shareAt('bottom', 0, 700, 800, 1000), 0.3);
  assert.equal(shareAt('top', 0, 300, 800, 1000), 0.3);
  assert.equal(shareAt('left', 200, 0, 800, 1000), 0.25);
  assert.equal(shareAt('right', 600, 0, 800, 1000), 0.25);
  assert.equal(shareAt('tab', 0, 0, 800, 1000), null);
});
