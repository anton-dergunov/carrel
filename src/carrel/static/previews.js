// A small picture of each page, shown behind it until PDF.js has drawn the page itself.
//
// PDF.js draws a page only once it scrolls into view, and keeps about ten drawn; a page further
// away is a white sheet until it is drawn again. Scrolled fast, or opened in a tab (the papers
// share one viewer, so a tab's paper is loaded again and every page starts blank), the pane went
// white for a moment. With a preview behind each page, it shows the page blurred instead, and
// sharpens as PDF.js draws it.
//
// A page's preview is taken from its own canvas each time PDF.js draws it, which costs no drawing
// of its own (and keeps highlights current); the pages not drawn yet are drawn small while the
// viewer is idle, nearest to the page in view first. The last few papers keep theirs, so coming
// back to a tab shows its pages at once.

const WIDTH = 540; // the preview's width in pixels: a blur at full size, which is all it is for
const QUALITY = 0.72;
const PAPERS = 6; // the papers whose previews are kept
const IDLE_MS = 400; // no page drawn for this long, and the viewer is idle
const MOST_PAGES = 600;

export function createPreviews({ viewer, eventBus }) {
  const style = document.head.appendChild(document.createElement('style'));
  // file → Map(page number → object URL), the most recent paper last.
  const papers = new Map();
  let file = null;
  let pdf = null;
  let lastDrawn = 0;
  let filling = 0; // which fill is running, so a new paper stops the old one
  let frame = 0;

  eventBus.on('pagerender', () => (lastDrawn = performance.now()));
  eventBus.on('pagerendered', ({ source, pageNumber, isDetailView, error }) => {
    lastDrawn = performance.now();
    if (isDetailView || error || !source?.canvas?.width) return;
    capture(file, pageNumber, source.canvas);
  });

  /** The paper about to be shown: its previews, if it has any, are behind its pages at once. */
  function show(nextFile, document) {
    file = nextFile;
    pdf = document;
    const kept = papers.get(file) ?? new Map();
    papers.delete(file);
    papers.set(file, kept);
    while (papers.size > PAPERS) {
      const [oldest, urls] = papers.entries().next().value;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      papers.delete(oldest);
    }
    redraw();
    void fill(++filling, file, document);
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
    const urls = papers.get(owner);
    if (!urls) return; // the paper's previews were let go meanwhile
    const old = urls.get(page);
    urls.set(page, URL.createObjectURL(blob));
    if (old) URL.revokeObjectURL(old);
    if (owner === file) redraw();
  }

  /** The pages not drawn yet, drawn small while the viewer is idle, nearest to the page in view. */
  async function fill(run, owner, document) {
    const count = Math.min(document.numPages, MOST_PAGES);
    const tried = new Set(); // a page whose preview failed is not tried again
    while (run === filling) {
      const wait = IDLE_MS - (performance.now() - lastDrawn);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      const urls = papers.get(owner);
      const next = nearestMissing(urls, viewer.currentPageNumber || 1, count, tried);
      if (!next) return;
      tried.add(next);
      try {
        const page = await document.getPage(next);
        if (run !== filling) return;
        const viewport = page.getViewport({ scale: WIDTH / page.getViewport({ scale: 1 }).width });
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport }).promise;
        if (run !== filling || urls.has(next)) continue; // drawn by the viewer meanwhile
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
        if (blob) keep(owner, next, blob);
      } catch {
        return; // the paper was closed under it
      }
      // A breath between pages, so a page the reader scrolls to is drawn first.
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  function redraw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const urls = papers.get(file) ?? new Map();
      let rules = '';
      for (const [page, url] of urls) {
        const at = `#viewer .page[data-page-number="${page}"]`;
        rules += `${at}{background:#fff url("${url}") center/100% 100% no-repeat}${at}.loading::after{display:none}\n`;
      }
      style.textContent = rules;
    });
  }

  return { show };
}

/** The page nearest `current` (ahead first) among pages 1…count with no preview and not in
 * `skip`, or 0. */
export function nearestMissing(urls, current, count, skip = new Set()) {
  for (let distance = 0; distance < count; distance++) {
    for (const page of [current + distance, current - distance]) {
      if (page >= 1 && page <= count && !urls.has(page) && !skip.has(page)) return page;
    }
  }
  return 0;
}
