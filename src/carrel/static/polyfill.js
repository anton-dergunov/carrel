// What PDF.js expects of the browser and Safari does not have yet: reading a stream with
// `for await` (its async iterator, missing in iPadOS 26.6). PDF.js reads a page's text that way
// for find, which on the iPad found nothing at all; the pages themselves are drawn another way.
// Imported before PDF.js. As the Streams standard has it: leaving the loop early cancels the
// stream, unless `preventCancel`.

if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype.values ??= async function* values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        yield value;
      }
    } finally {
      if (!finished && !preventCancel) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  ReadableStream.prototype[Symbol.asyncIterator] = ReadableStream.prototype.values;
}
