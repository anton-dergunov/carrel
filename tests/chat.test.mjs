import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelName, stem, wholeParagraphs } from '../src/carrel/static/chat.js';

test('the model as the status line names it', () => {
  assert.equal(modelName('haiku'), 'Haiku');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('claude-sonnet-5'), 'Sonnet 5');
});

test("a paper's stem, as its PDF and its text share it", () => {
  assert.equal(stem('llm/memory/A Paper. Its Subtitle.pdf'), 'A Paper. Its Subtitle');
  assert.equal(stem('library/llm/memory/A Paper. Its Subtitle.txt'), 'A Paper. Its Subtitle');
  assert.equal(stem('Zep. A Temporal Knowledge Graph'), 'Zep. A Temporal Knowledge Graph');
});

test('on e-ink a streaming answer is drawn a whole paragraph at a time', () => {
  assert.equal(wholeParagraphs('The first line, still being wr'), '');
  assert.equal(wholeParagraphs('One paragraph.\n\nThe next, half'), 'One paragraph.');
  assert.equal(wholeParagraphs('One.\n\nTwo.\n\nThr'), 'One.\n\nTwo.');
});
