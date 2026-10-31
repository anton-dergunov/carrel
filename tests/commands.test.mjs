import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFindKey, runCommand, stepTab } from '../src/carrel/static/commands.js';
import { wheelFactor } from '../src/carrel/static/pinch.js';

test('a command says whether it did anything', () => {
  const done = [];
  const commands = { find: () => done.push('find'), 'close-tab': () => false };
  assert.equal(runCommand(commands, 'find'), true);
  assert.deepEqual(done, ['find']);
  assert.equal(runCommand(commands, 'close-tab'), false);
  // Unknown names, and what every object inherits, run nothing.
  assert.equal(runCommand(commands, 'nothing'), false);
  assert.equal(runCommand(commands, 'toString'), false);
  assert.equal(runCommand(commands, '__proto__'), false);
});

test('the find key is ⌘F on a Mac and Ctrl+F elsewhere, alone', () => {
  const key = (props) => ({ key: 'f', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...props });
  assert.equal(isFindKey(key({ metaKey: true }), true), true);
  assert.equal(isFindKey(key({ metaKey: true, key: 'F' }), true), true);
  assert.equal(isFindKey(key({ ctrlKey: true }), true), false);
  assert.equal(isFindKey(key({ ctrlKey: true }), false), true);
  assert.equal(isFindKey(key({ metaKey: true, shiftKey: true }), true), false);
  assert.equal(isFindKey(key({ metaKey: true, key: 'g' }), true), false);
});

test('next and previous tab wrap round the strip', () => {
  const keys = ['papers', 'a.pdf', 'b.pdf'];
  assert.equal(stepTab(keys, 'papers', 1), 'a.pdf');
  assert.equal(stepTab(keys, 'b.pdf', 1), 'papers');
  assert.equal(stepTab(keys, 'papers', -1), 'b.pdf');
  // A tab not in the strip (the chat beside the paper) counts as the first.
  assert.equal(stepTab(keys, 'chat', 1), 'a.pdf');
  assert.equal(stepTab([], 'papers', 1), 'papers');
});

test('a trackpad pinch zooms by small steps, a mouse wheel by notches', () => {
  // Spreading the fingers is a negative deltaY, and zooms in.
  assert.ok(wheelFactor({ deltaY: -5 }) > 1);
  assert.ok(Math.abs(wheelFactor({ deltaY: -5 }) - Math.exp(0.06)) < 1e-9);
  assert.ok(wheelFactor({ deltaY: 5 }) < 1);
  // A notch of a mouse wheel is about a quarter more, not three times.
  const notch = wheelFactor({ deltaY: -100 });
  assert.ok(notch > 1.2 && notch < 1.35);
  const line = wheelFactor({ deltaY: -3, deltaMode: 1 });
  assert.ok(line > 1.05 && line < 1.1);
});
