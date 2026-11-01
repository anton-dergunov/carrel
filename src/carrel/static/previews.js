// A small picture of each page, shown behind it until PDF.js has drawn the page itself.
//
// PDF.js draws a page only once it scrolls into view, and keeps about ten drawn; a page further
// away is a white sheet until it is drawn again. Scrolled fast, or opened in a tab (the papers
// share one viewer, so a tab's paper is laid out again and every page starts blank), the pane went
// white for a moment. With a picture behind each page, it shows the page blurred instead, and
// sharpens as PDF.js draws it.
//
// The pictures are the laptop's (previews.py), made once for each version of a PDF and kept by the
// browser too, so a paper has them from the first frame, after a launch as well. A page PDF.js has
// drawn gives its own instead, taken from its canvas at no drawing cost: it carries a highlight
// made since and Settings → Pages' strokes. Before a paper is shown, the pictures of the pages it
// opens at are decoded, so its first frame is not white while they load.

const WIDTH = 540; // the width of the pictures taken from a canvas: the laptop's are as wide
const QUALITY = 0.72;
const PAPERS = 6; // the papers whose taken pictures are kept
// The pages either side of the one in view whose pictures are asked for: a book's are not all
// fetched at once.
const AROUND = 50;
const READY_MS = 120; // how long a paper waits for the pictures it opens at
const LOADING = 4; // the pictures loaded at once ahead of a scroll

/** The address of the laptop's picture of page `page` of `file`, at `version` (the PDF's ETag). */
export function previewUrl(file, version, page) {
  const path = file.split('/').map(encodeURIComponent).join('/');
  const v = (version ?? '').replace(/^W\//, '').replaceAll('"', '');
  return `/api/preview/${path}?page=${page}&v=${encodeURIComponent(v)}`;
}

export function createPreviews({ eventBus }) {
  const style = document.head.appendChild(document.createElement('style'));
  // file → {version, urls: Map(page number → object URL)}: the pictures taken from drawn canvases,
  // the most recent paper last.
  const taken = new Map();
  let file = null;
  let version = null;
  let count = 0;
  let current = 1;
  let shownAround = 1; // the page the pictures asked for are centred on
  let frame = 0;
  // The pictures of the paper showing, loaded ahead: WebKit loads a page's picture only when the
  // page comes into view, and a flick then showed white pages while they came from the disk.
  let loaded = [];
  let loading = 0; // which paper's loading runs, so a new paper stops the old one's

  eventBus.on('pagechanging', ({ pageNumber }) => {
    current = pageNumber;
    if (Math.abs(current - shownAround) > AROUND / 2) redraw();
  });

  eventBus.on('pagerendered', ({ source, pageNumber, isDetailView, error }) => {
    if (isDetailView || error || !source?.canvas?.width) return;
    capture(file, pageNumber, source.canvas);
  });

  /** The paper about to be shown, at `nextVersion`, with `pages` pages, at page `at`: its pictures
   * are behind its pages at once. */
  function show(nextFile, nextVersion, pages, at = 1) {
    // Pictures taken of another version show what the paper was.
    if (taken.get(nextFile)?.version !== nextVersion) forget(nextFile);
    file = nextFile;
    version = nextVersion;
    count = pages;
    current = at;
    const kept = taken.get(file) ?? { version, urls: new Map() };
    taken.delete(file);
    taken.set(file, kept);
    while (taken.size > PAPERS) forget(taken.keys().next().value);
    redraw();
    void loadAhead(++loading);
  }

  /** Loads the pictures within AROUND pages of the one in view, nearest first, a few at a time. */
  async function loadAhead(run) {
    loaded = [];
    const order = [];
    for (let distance = 0; distance <= AROUND; distance++) {
      for (const page of distance ? [current + distance, current - distance] : [current]) {
        if (page >= 1 && page <= count) order.push(page);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300)); // after the paper's own first frames
    for (let i = 0; i < order.length && run === loading; i += LOADING) {
      const batch = order.slice(i, i + LOADING).map((page) => {
        const image = new Image();
        image.src = taken.get(file)?.urls.get(page) ?? previewUrl(file, version, page);
        loaded.push(image);
        return image.decode().catch(() => null);
      });
      await Promise.all(batch);
    }
  }

  /** Waits, at most READY_MS, until the pictures of `pages` of `file` at `atVersion` are decoded. */
  function ready(readyFile, atVersion, pages) {
    const own = taken.get(readyFile)?.version === atVersion ? taken.get(readyFile).urls : new Map();
    const urls = pages.filter((page) => page >= 1).map((page) => own.get(page) ?? previewUrl(readyFile, atVersion, page));
    const decoded = urls.map((url) => {
      const image = new Image();
      image.src = url;
      return image.decode().catch(() => null);
    });
    return Promise.race([Promise.all(decoded), new Promise((resolve) => setTimeout(resolve, READY_MS))]);
  }

  function capture(owner, page, canvas) {
    if (!owner || owner !== file) return;
    const small = document.createElement('canvas');
    small.width = WIDTH;
    small.height = Math.max(1, Math.round((canvas.height * WIDTH) / canvas.width));
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    small.toBlob((blob) => blob && keep(owner, page, blob), 'image/jpeg', QUALITY);
  }

  function keep(owner, page, blob) {
    const urls = taken.get(owner)?.urls;
    if (!urls) return; // the paper's pictures were let go meanwhile
    const old = urls.get(page);
    urls.set(page, URL.createObjectURL(blob));
    if (old) URL.revokeObjectURL(old);
    if (owner === file) redraw();
  }

  function forget(owner) {
    for (const url of taken.get(owner)?.urls.values() ?? []) URL.revokeObjectURL(url);
    taken.delete(owner);
  }

  function redraw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const urls = taken.get(file)?.urls ?? new Map();
      let rules = '';
      shownAround = current;
      for (let page = Math.max(1, current - AROUND); page <= Math.min(count, current + AROUND); page++) {
        const url = urls.get(page) ?? previewUrl(file, version, page);
        const at = `#viewer .page[data-page-number="${page}"]`;
        rules += `${at}{background:#fff url("${url}") center/100% 100% no-repeat}${at}.loading::after{display:none}\n`;
      }
      style.textContent = rules;
    });
  }

  return { show, ready };
}
