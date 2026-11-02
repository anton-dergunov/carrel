// The pages a paper's tab showed, kept as they were drawn, and put back over the pane when the tab
// comes back, until PDF.js has drawn them again.
//
// The papers share one viewer, so a tab's paper is laid out afresh each time it is shown: its pages
// went white, then sharp, 150–250 ms after the click. A copy of the
// canvases in view, taken as the tab is left, looks the same as the pages PDF.js draws again; it is
// shown over the pane at the click, where the pages were, and each page's copy goes once PDF.js has
// drawn that page, so the swap underneath does not show.
//
// The copies wait in the page, hidden: WebKit showed a canvas kept so in the next frame (17 ms),
// one appended at the click only after 24–33 ms, and one made at the click after 48–124 ms. Moved
// into its page, a copy was as slow again, so it stays over the pane, and any scroll, zoom or key
// of the reader's takes the copies away.
//
// A copy is of PDF.js's own canvases, with whatever Settings → Pages drew on them, so nothing is
// drawn on it again; the canvases' CSS filters apply to it as well (app.css). It hides the page's
// text and highlights only until the page is drawn, at most `SHOWN_MS`.

const SHOWN_MS = 2000;
// What the reader does that moves or changes the pages, and so ends the copies.
const INPUT = ['wheel', 'pointerdown', 'touchstart', 'keydown'];

/**
 * Copies for the last `papers` papers. `take(file)` copies the pages of `file` in view, while they
 * still are; `cover(file)` shows them over the pane; `clear()` takes them away.
 */
export function createSnapshots({ viewer, eventBus, container, papers = 3 }) {
  // file → {layer, width, height, sheets: Map(page → sheet)}, the most recent last; width and
  // height are the pane's.
  const kept = new Map();
  // The copies showing: {layer, sheets}.
  let covering = null;
  let timer = 0;

  eventBus.on('pagerendered', ({ pageNumber, cssTransform, error }) => {
    const sheet = covering?.sheets.get(pageNumber);
    if (cssTransform || !sheet) return;
    if (error || drawn(viewer.getPageView(pageNumber - 1))) {
      covering.sheets.delete(pageNumber);
      sheet.remove();
      free(sheet);
      if (!covering.sheets.size) clear();
    }
  });
  for (const type of INPUT) container.addEventListener(type, () => covering && clear(), { capture: true, passive: true });

  function take(file) {
    if (!file || !viewer.pagesCount || !container.clientWidth) return;
    const box = container.getBoundingClientRect();
    const sheets = new Map();
    const current = viewer.currentPageNumber || 1;
    for (let number = Math.max(1, current - 2); number <= Math.min(viewer.pagesCount, current + 3); number++) {
      const view = viewer.getPageView(number - 1);
      const rect = view?.div?.getBoundingClientRect();
      if (!rect || rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) continue;
      if (!drawn(view)) continue;
      const canvases = [...view.div.querySelectorAll('.canvasWrapper > canvas')]
        .filter((canvas) => canvas.width && !canvas.hidden)
        .map(copy);
      if (!canvases.length) continue;
      const sheet = document.createElement('div');
      sheet.style.cssText = `left:${rect.left - box.left}px;top:${rect.top - box.top}px;width:${rect.width}px;height:${rect.height}px`;
      sheet.toggleAttribute('data-scan', view.div.hasAttribute('data-scan'));
      sheet.append(...canvases);
      sheets.set(number, sheet);
    }
    if (!sheets.size) return;
    forget(file);
    const layer = document.createElement('div');
    layer.className = 'pane-snapshot';
    layer.style.visibility = 'hidden';
    layer.append(...sheets.values());
    container.after(layer);
    kept.set(file, { layer, width: container.clientWidth, height: container.clientHeight, sheets });
    while (kept.size > papers) forget(kept.keys().next().value);
  }

  function cover(file) {
    clear();
    const entry = kept.get(file);
    if (!entry) return;
    kept.delete(file);
    // A pane of another size (resized meanwhile) would not match; a hidden one is shown with it.
    if (container.clientWidth && (container.clientWidth !== entry.width || container.clientHeight !== entry.height)) {
      discard(entry);
      return;
    }
    entry.layer.style.visibility = '';
    covering = entry;
    timer = setTimeout(clear, SHOWN_MS);
    return true;
  }

  function clear() {
    clearTimeout(timer);
    if (covering) discard(covering);
    covering = null;
  }

  function forget(file) {
    const entry = kept.get(file);
    kept.delete(file);
    if (entry) discard(entry);
  }

  return { take, cover, clear };
}

function discard({ layer, sheets }) {
  layer.remove();
  for (const sheet of sheets.values()) free(sheet);
}

/** Whether a page is drawn whole: its canvas, and the sharper one over the part in view if it has one. */
function drawn(view) {
  const FINISHED = 3; // PDF.js's RenderingStates.FINISHED
  return view?.renderingState === FINISHED && (!view.detailView || view.detailView.renderingState === FINISHED);
}

function copy(canvas) {
  const twin = document.createElement('canvas');
  twin.width = canvas.width;
  twin.height = canvas.height;
  twin.getContext('2d').drawImage(canvas, 0, 0);
  twin.className = canvas.className;
  twin.style.cssText = canvas.style.cssText;
  twin.ariaHidden = 'true';
  return twin;
}

/** Gives a copy's memory back at once, rather than when it is collected. */
function free(sheet) {
  for (const canvas of sheet.querySelectorAll('canvas')) canvas.width = canvas.height = 0;
}
