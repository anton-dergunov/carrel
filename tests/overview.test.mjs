import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromObsidian } from '../src/carrel/static/overview.js';

test('an Obsidian note as plain markdown', () => {
  const note = '---\ntitle: "Zep"\ntags: [a, b]\n---\n\n> [!abstract]\n> A memory.\n\nSee [[Agent memory]] and [[LightRAG|its rival]].\n';
  assert.equal(fromObsidian(note), '\n> **Abstract**\n>\n> A memory.\n\nSee Agent memory and its rival.\n');
  assert.equal(fromObsidian('> [!note]- Why it works\n> Because.'), '> **Why it works**\n>\n> Because.');
  // A rule further down is not properties.
  assert.equal(fromObsidian('Text\n---\nmore\n---\n'), 'Text\n---\nmore\n---\n');
});
