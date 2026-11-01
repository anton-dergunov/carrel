import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelName } from '../src/carrel/static/chat.js';
import { modelLine, sectionFor } from '../src/carrel/static/settings.js';

test('the sheet says when this chat runs on another model than the one chosen', () => {
  assert.equal(modelLine('haiku', 'opus', modelName), 'This chat stays on Haiku; the next one starts on Opus.');
  assert.equal(modelLine('opus', 'opus', modelName), '');
  assert.equal(modelLine(null, 'opus', modelName), '');
  assert.equal(modelLine('opus', null, modelName), '');
});

test('the model opens the settings at the chat, anything else at the top', () => {
  assert.equal(sectionFor('chat'), 'chat');
  assert.equal(sectionFor(), 'top');
  assert.equal(sectionFor('colours'), 'top');
});
