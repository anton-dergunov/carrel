import assert from 'node:assert/strict';
import { test } from 'node:test';

// As Safari 26.6 has it: streams that `for await` cannot read.
delete ReadableStream.prototype[Symbol.asyncIterator];
delete ReadableStream.prototype.values;
await import('../src/carrel/static/polyfill.js');

function stream(chunks, onCancel = () => {}) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel: onCancel,
  });
}

test('a stream is read with for await', async () => {
  const read = [];
  for await (const chunk of stream(['a', 'b', 'c'])) read.push(chunk);
  assert.deepEqual(read, ['a', 'b', 'c']);
});

test('leaving the loop early cancels the stream, and lets it go', async () => {
  let cancelled = false;
  const source = stream(['a', 'b'], () => (cancelled = true));
  for await (const chunk of source) {
    assert.equal(chunk, 'a');
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(source.locked, false);
});
