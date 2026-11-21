import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRects, libraryPath, namesFile, paperOfLink, parsePaperLink, parseRects, parseTargetParts, sameFile } from '../src/carrel/static/links.js';

// parseTargetParts: the cases of vscode-pdf-viewer's test/linkFormat.test.ts. The inputs are
// already percent-decoded.

test('file in the path, with destination and page', () => {
  assert.deepEqual(parseTargetParts('/llm/memory/Zep. A Temporal Knowledge Graph.pdf', 'dest=table.2&page=7'), {
    file: 'llm/memory/Zep. A Temporal Knowledge Graph.pdf',
    dest: 'table.2',
    page: 7,
    search: undefined,
    rect: undefined,
  });
});

test('"&" survives in the file name and in the search phrase', () => {
  assert.deepEqual(parseTargetParts('/recsys/Wide & Deep Learning.pdf', 'page=2&search=wide & deep'), {
    file: 'recsys/Wide & Deep Learning.pdf',
    page: 2,
    dest: undefined,
    search: 'wide & deep',
    rect: undefined,
  });
});

test('"+" in the file name is kept, not read as a space', () => {
  assert.equal(parseTargetParts('/graphs/Node2vec+.pdf', '')?.file, 'graphs/Node2vec+.pdf');
});

test('/open?file= form, for absolute paths', () => {
  assert.deepEqual(parseTargetParts('/open', 'file=/Users/me/x & y.pdf&page=3'), {
    file: '/Users/me/x & y.pdf',
    page: 3,
    dest: undefined,
    search: undefined,
    rect: undefined,
  });
});

test('links without a file are rejected', () => {
  assert.equal(parseTargetParts('/open', 'page=3'), undefined);
  assert.equal(parseTargetParts('/', ''), undefined);
});

test('invalid or empty values are ignored', () => {
  assert.deepEqual(parseTargetParts('/a.pdf', 'page=0&dest='), {
    file: 'a.pdf',
    page: undefined,
    dest: undefined,
    search: undefined,
    rect: undefined,
  });
});

test('rectangles beside a page, a destination and a title with "&"', () => {
  assert.deepEqual(parseTargetParts('/recsys/Wide & Deep.pdf', 'page=7&rect=71,402,541,520;71,522,300,534&dest=table.2'), {
    file: 'recsys/Wide & Deep.pdf',
    page: 7,
    dest: 'table.2',
    search: undefined,
    rect: [
      [71, 402, 541, 520],
      [71, 522, 300, 534],
    ],
  });
});

test('rectangles that are not four numbers in order are left out', () => {
  assert.deepEqual(parseRects('1,2,3,4;5,6,7;9,9,1,1;a,b,c,d;1.5,2.5,3.5,4.5'), [
    [1, 2, 3, 4],
    [1.5, 2.5, 3.5, 4.5],
  ]);
  assert.equal(parseRects(''), undefined);
  assert.equal(parseRects('1,2,,4'), undefined);
  assert.equal(parseTargetParts('/a.pdf', 'page=2&rect=nothing')?.rect, undefined);
});

test('rectangles are written back as a link writes them', () => {
  assert.equal(formatRects(parseRects('71,402,541,520;71,522,300,534')), '71,402,541,520;71,522,300,534');
});

// parsePaperLink: a link's href as the browser gives it, still encoded.

test('a citation as the guide writes it', () => {
  const href =
    'http://pdf.invalid/llm/memory/agent/Zep.%20A%20Temporal%20Knowledge%20Graph%20Architecture%20for%20Agent%20Memory.pdf?dest=table.2&page=7';
  assert.deepEqual(parsePaperLink(href), {
    file: 'llm/memory/agent/Zep. A Temporal Knowledge Graph Architecture for Agent Memory.pdf',
    dest: 'table.2',
    page: 7,
    search: undefined,
    rect: undefined,
  });
});

test('an encoded "&" in the file name', () => {
  assert.equal(parsePaperLink('http://pdf.invalid/recsys/Wide%20%26%20Deep.pdf?page=2')?.file, 'recsys/Wide & Deep.pdf');
});

test('other links are not paper links', () => {
  assert.equal(parsePaperLink('https://arxiv.org/abs/2501.13956'), undefined);
  assert.equal(parsePaperLink('https://pdf.invalid/a.pdf'), undefined);
  assert.equal(parsePaperLink('not a url'), undefined);
});

test('the same file in two Unicode forms', () => {
  assert.ok(sameFile('Précis.pdf', 'Précis.pdf'));
});

// A link to a library file, as an answer copies a review's: relative to the library's root.

const papers = [
  { text: 'library/representation-learning/embeddings/GloVe. Global Vectors for Word Representation.txt', pdf: 'representation-learning/embeddings/GloVe. Global Vectors for Word Representation.pdf' },
  { text: 'library/representation-learning/embeddings/Text Embeddings Reveal (Almost) As Much As Text.txt', pdf: 'representation-learning/embeddings/Text Embeddings Reveal (Almost) As Much As Text.pdf' },
  { text: 'library/nlp/Café au lait.txt', pdf: 'nlp/Café au lait.pdf' },
];

test('a paper by its text file, percent-encoded as an answer writes it', () => {
  assert.equal(paperOfLink('library/representation-learning/embeddings/GloVe.%20Global%20Vectors%20for%20Word%20Representation.txt', papers), papers[0]);
  assert.equal(paperOfLink('library/representation-learning/embeddings/Text%20Embeddings%20Reveal%20(Almost)%20As%20Much%20As%20Text.txt', papers), papers[1]);
});

test('a paper by "./", by an absolute path, or in another Unicode form', () => {
  assert.equal(paperOfLink('./library/nlp/Caf%C3%A9%20au%20lait.txt', papers), papers[2]);
  assert.equal(paperOfLink('/Users/someone/papers/library/nlp/Café au lait.txt', papers), papers[2]);
  assert.equal(paperOfLink('library/nlp/Café au lait.txt', papers), papers[2]);
  assert.equal(paperOfLink('library/nlp/Café au lait.txt#L3', papers), papers[2]);
});

test('no paper for another file, a web link, a page link or an anchor', () => {
  assert.equal(paperOfLink('library/nlp/Thé.txt', papers), undefined);
  assert.equal(paperOfLink('nlp/Café au lait.txt', papers), undefined); // not a path from the root
  assert.equal(paperOfLink('https://arxiv.org/abs/1310.4546', papers), undefined);
  assert.equal(paperOfLink('http://pdf.invalid/nlp/Caf%C3%A9%20au%20lait.pdf?page=2', papers), undefined);
  assert.equal(paperOfLink('#notes', papers), undefined);
  assert.equal(paperOfLink(null, papers), undefined);
});

test('a review by its path', () => {
  assert.equal(libraryPath('reviews/representation-learning.md'), 'reviews/representation-learning.md');
  assert.ok(namesFile(libraryPath('./reviews/representation-learning.md'), 'reviews/representation-learning.md'));
  assert.ok(namesFile('/Users/someone/papers/reviews/llm.md', 'reviews/llm.md'));
  assert.ok(!namesFile('/Users/someone/papers/reviews/other-llm.md', 'reviews/llm.md'));
  assert.ok(!namesFile('old/reviews/llm.md', 'reviews/llm.md'));
});
