import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelName } from '../src/carrel/static/chat.js';
import { modelLine } from '../src/carrel/static/settings.js';

test('the sheet says when this chat runs on another model than the one chosen', () => {
  assert.equal(modelLine('haiku', 'opus', modelName), 'This chat stays on Haiku; the next one starts on Opus.');
  assert.equal(modelLine('opus', 'opus', modelName), '');
  assert.equal(modelLine(null, 'opus', modelName), '');
  assert.equal(modelLine('opus', null, modelName), '');
});
