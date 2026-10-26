import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePaperLink, parseTargetParts, sameFile } from '../src/carrel/static/links.js';

// parseTargetParts: the cases of vscode-pdf-viewer's test/linkFormat.test.ts. The inputs are
// already percent-decoded.

test('file in the path, with destination and page', () => {
  assert.deepEqual(parseTargetParts('/llm/memory/Zep. A Temporal Knowledge Graph.pdf', 'dest=table.2&page=7'), {
    file: 'llm/memory/Zep. A Temporal Knowledge Graph.pdf',
    dest: 'table.2',
    page: 7,
    search: undefined,
  });
});

test('"&" survives in the file name and in the search phrase', () => {
  assert.deepEqual(parseTargetParts('/recsys/Wide & Deep Learning.pdf', 'page=2&search=wide & deep'), {
    file: 'recsys/Wide & Deep Learning.pdf',
    page: 2,
    dest: undefined,
    search: 'wide & deep',
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
  });
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
