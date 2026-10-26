import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelName } from '../src/carrel/static/chat.js';

test('the model as the status line names it', () => {
  assert.equal(modelName('haiku'), 'Haiku');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('claude-sonnet-5'), 'Sonnet 5');
});
