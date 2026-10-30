import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromObsidian } from '../src/carrel/static/overview.js';

test('an Obsidian note as markdown', () => {
  const note = '---\ntitle: "Zep"\ntags: [a, b]\n---\n\n> [!abstract]\n> A memory.\n\nSee [[Agent memory]] and [[LightRAG|its rival]].\n';
  assert.equal(fromObsidian(note), '\n> [!abstract]\n> A memory.\n\nSee Agent memory and its rival.\n');
  // A rule further down is not properties.
  assert.equal(fromObsidian('Text\n---\nmore\n---\n'), 'Text\n---\nmore\n---\n');
});
