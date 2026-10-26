// The PDF, drawn with PDF.js. Every paper tab shares this one viewer: a tab keeps its paper's
// place, and showing the tab loads the paper again and puts the place back. (A viewer per tab
// would keep a set of rendered pages per tab, which is what makes iPad Safari drop a page.)
//
// Highlights are PDF.js's highlight editors, kept in the PDF the way vscode-pdf-viewer keeps
// them, and every change is saved at once: an app that iOS closes in the background keeps
// nothing that was not. The editors stay in PDF.js's NONE mode, where selecting text does
// nothing to them; an edit enters HIGHLIGHT mode for as long as it takes.

import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { HIGHLIGHT_COLORS } from './highlight.js';
import { pinchToZoom, stopPageZoom } from './pinch.js';

// The viewer component reads the library from `globalThis.pdfjsLib` when its module is
// evaluated, so it is imported only after this.
globalThis.pdfjsLib = pdfjsLib;
const { EventBus, FindState, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } = await import('./vendor/pdfjs/pdf_viewer.mjs');
const { AnnotationEditorParamsType, AnnotationEditorType } = pdfjsLib;

const ASSETS = '/static/vendor/pdfjs/';
// Room left above a destination: hyperref anchors a float below its caption.
const DEST_CONTEXT_PX = 72;

pdfjsLib.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;

/**
 * The viewer in `#viewerContainer`. `onPage(number, count)` follows the page in view,
 * `onPlace(place)` the place to come back to: {page, scale, left, top}, the scale being
 * 'page-width' or a percentage, left and top in the page's own coordinates;
 * `onFound({current, total, pending})` what a search found; and `onSaved(state)` how the
 * last change to the highlights went: 'saved', 'unsaved' (to be tried again), or 'conflict'
 * (the PDF changed elsewhere, and the paper was loaded again without it).
 */
export function createReader({ onPage, onPlace, onFound, onSaved }) {
  const container = document.getElementById('viewerContainer');
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer = new PDFViewer({
    container,
    eventBus,
    linkService,
    findController,
    removePageBorders: true,
    annotationEditorMode: AnnotationEditorType.NONE,
    annotationEditorHighlightColors: HIGHLIGHT_COLORS.map((color) => `${color.name}=${color.value}`).join(','),
  });
  linkService.setViewer(viewer);
  // Links inside the PDF go through this too.
  linkService.goToDestination = (dest) => scrollToDestination(dest);

  let file = null;
  let pdfDocument = null;
  // The paper as loaded, for saving it: {file, url, document, version, base}.
  let paper = null;
  // Where to go once the document's pages are laid out: a place, or a target {page, dest}.
  let pending = null;
  let lastPlace = null;
  let uiManager = null;

  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = 'page-width';
    onPage(viewer.currentPageNumber, viewer.pagesCount);
    const { place, target } = pending ?? {};
    pending = null;
    if (place) restore(place);
    else if (target) void goTo(target);
  });
  eventBus.on('pagechanging', ({ pageNumber }) => onPage(pageNumber, viewer.pagesCount));
  eventBus.on('updateviewarea', ({ location }) => {
    if (file && location) {
      lastPlace = { page: location.pageNumber, scale: location.scale, left: Math.round(location.left), top: Math.round(location.top) };
      onPlace(lastPlace);
    }
  });

  eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => {
    onFound({ ...matchesCount, pending: state === FindState.PENDING });
  });
  eventBus.on('updatefindmatchescount', ({ matchesCount }) => onFound({ ...matchesCount, pending: false }));

  // A new document has a new editor manager.
  eventBus.on('annotationeditoruimanager', ({ uiManager: manager }) => {
    uiManager = manager;
    trackCommands(manager, edited);
  });

  // A change of height alone leaves the scale as it is: setting the page again would move the
  // scroll to the top of the page.
  let width = 0;
  new ResizeObserver(() => {
    if (container.clientWidth !== width) refit();
  }).observe(container);

  stopPageZoom();
  pinchToZoom({ container, viewer, eventBus });

  /**
   * Fits the width again, unless the reader zoomed in or out. Not while the split is dragged:
   * drawing every page at a new scale at each step is what makes dragging slow; the drag fits
   * once at its end.
   */
  function refit() {
    if (!container.clientWidth || document.body.classList.contains('dragging')) return;
    width = container.clientWidth;
    if (viewer.pagesCount && viewer.currentScaleValue === 'page-width') {
      const page = viewer.currentPageNumber;
      viewer.currentScaleValue = 'page-width';
      viewer.currentPageNumber = page;
    }
  }

  function restore({ page, scale, left, top }) {
    if (!(page >= 1 && page <= viewer.pagesCount)) return;
    if (typeof scale === 'number' && scale > 0) viewer.currentScale = scale / 100;
    else viewer.currentScaleValue = 'page-width';
    viewer.scrollPageIntoView({
      pageNumber: page,
      destArray: [null, { name: 'XYZ' }, left ?? null, top ?? null, null],
      ignoreDestinationZoom: true,
    });
  }

  /** A named destination wins over a page when the PDF has it; the page is the fallback. */
  async function goTo({ page, dest }) {
    const found = dest ? await scrollToDestination(dest) : false;
    if (!found && page && page <= viewer.pagesCount) {
      viewer.currentPageNumber = page;
    }
  }

  async function scrollToDestination(dest) {
    if (!pdfDocument) {
      return false;
    }
    const explicit = typeof dest === 'string' ? await pdfDocument.getDestination(dest).catch(() => null) : await dest;
    if (!Array.isArray(explicit)) {
      return false;
    }
    const [ref] = explicit;
    const pageNumber =
      ref && typeof ref === 'object'
        ? (await pdfDocument.getPageIndex(ref)) + 1
        : Number.isInteger(ref)
          ? ref + 1
          : 0;
    if (!(pageNumber >= 1 && pageNumber <= viewer.pagesCount)) {
      return false;
    }
    viewer.scrollPageIntoView({ pageNumber, destArray: explicit, ignoreDestinationZoom: true });
    container.scrollTop = Math.max(0, container.scrollTop - DEST_CONTEXT_PX);
    return true;
  }

  let loading = 0;
  // The open document's loading task, which is what PDF.js tears a document down through.
  let openTask = null;

  /**
   * Shows a paper: `place` puts back where the reader was, `target` ({page, dest}) goes to a
   * citation. The paper already shown only moves.
   */
  async function open(pdf, url, { place, target } = {}) {
    target = target?.page || target?.dest ? target : null;
    if (pdf === file) {
      if (!pdfDocument) pending = { place, target }; // still loading
      else if (target) await goTo(target);
      else if (place) restore(place);
      return;
    }
    file = pdf;
    pending = { place, target };
    const ticket = ++loading;
    // The paper showing is saved before it goes: its editors go with it.
    await saving;
    if (ticket !== loading) return;
    pdfDocument = null;
    let loaded, version, data, base;
    let task = null;
    try {
      // Fetched here rather than by PDF.js, for the version a save names.
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      version = response.headers.get('ETag');
      data = new Uint8Array(await response.arrayBuffer());
      base = data.length; // PDF.js hands the bytes to its worker, which empties `data`
      if (ticket !== loading) return;
      task = pdfjsLib.getDocument({
        data,
        cMapUrl: `${ASSETS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}standard_fonts/`,
        wasmUrl: `${ASSETS}wasm/`,
        iccUrl: `${ASSETS}iccs/`,
      });
      loaded = await task.promise;
    } catch (error) {
      if (ticket === loading) file = null; // asking again tries again
      throw error;
    }
    if (ticket !== loading) {
      // Another paper was asked for meanwhile.
      void task.destroy();
      return;
    }
    const previous = openTask;
    openTask = task;
    pdfDocument = loaded;
    paper = { file: pdf, url, document: loaded, version, base };
    uiManager = null;
    viewer.setDocument(loaded);
    linkService.setDocument(loaded, null);
    void previous?.destroy();
  }

  // Saving: one save at a time, and an edit made during one is saved after it.
  let saving = Promise.resolve();
  let dirty = false;
  let running = false;
  let unsaved = false;

  function edited() {
    dirty = true;
    if (running) return;
    running = true;
    saving = (async () => {
      try {
        while (dirty && paper) {
          dirty = false;
          await save(paper);
        }
      } finally {
        running = false;
      }
    })();
  }

  async function save(target) {
    let response;
    try {
      // saveDocument() warns when there is nothing to save; getData() is the paper as loaded.
      const { document } = target;
      const bytes = document.annotationStorage.size > 0 ? await document.saveDocument() : await document.getData();
      response = await fetch(target.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf', 'If-Match': target.version, 'X-Carrel-Base-Length': String(target.base) },
        body: bytes,
      });
    } catch (error) {
      // Offline, or the server asleep: tried again on the next edit, or when it may be back.
      console.warn(`Highlights not saved yet: ${error}`);
      unsaved = true;
      onSaved('unsaved');
      return;
    }
    if (response.status === 409) {
      unsaved = false;
      onSaved('conflict');
      if (paper === target) {
        // What is on the laptop now, at the same place.
        file = null;
        void open(target.file, target.url, { place: lastPlace });
      }
      return;
    }
    if (!response.ok) {
      console.warn(`Highlights not saved: ${response.status} ${await response.text()}`);
      unsaved = true;
      onSaved('unsaved');
      return;
    }
    target.version = response.headers.get('ETag');
    unsaved = false;
    onSaved('saved');
  }

  function retry() {
    if (unsaved && !running) edited();
  }
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retry();
  });

  /** Puts the editors in `mode`, and waits until they are. */
  async function editorMode(mode) {
    if (!uiManager || uiManager.getMode() === mode) return;
    const changed = new Promise((resolve) => eventBus.on('annotationeditormodechanged', resolve, { once: true }));
    viewer.annotationEditorMode = { mode };
    await changed;
  }

  /** What is selected in the paper showing: {text, page}, or null. */
  function selected() {
    const selection = document.getSelection();
    const text = selection?.isCollapsed ? '' : selection?.toString().trim();
    const layer = text ? textLayerOf(selection.anchorNode) : null;
    const page = layer?.closest('.page')?.dataset.pageNumber;
    return layer && container.contains(layer) ? { text, page: Number(page) || null } : null;
  }

  /** Highlights the text selected in the paper in `color`; its text, or null. */
  async function highlightSelection(color) {
    const text = selected()?.text;
    if (!uiManager || !text) return null;
    await editorMode(AnnotationEditorType.HIGHLIGHT);
    // With no editor selected, this is the colour of the next highlight.
    uiManager.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color);
    uiManager.highlightSelection('carrel');
    await editorMode(AnnotationEditorType.NONE);
    return text;
  }

  /**
   * The highlight at a point of the screen: {page, editorId} for one made since the paper was
   * loaded, {page, annotationId} for one in the file; with its `rect` on the screen.
   */
  function highlightAt(x, y) {
    const pageDiv = document.elementsFromPoint(x, y).find((element) => element.classList.contains('page'));
    if (!uiManager || !pageDiv) return null;
    const page = Number(pageDiv.dataset.pageNumber);
    const inside = (rect) => rect.width && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    for (const editor of uiManager.getEditors(page - 1)) {
      if (editor.editorType !== 'highlight' || editor.deleted || editor.isEmpty()) continue;
      const rect = editor.div.getBoundingClientRect();
      if (inside(rect)) return { page, editorId: editor.id, rect, color: editor.color };
    }
    for (const section of pageDiv.querySelectorAll('.annotationLayer .highlightAnnotation')) {
      const rect = section.getBoundingClientRect();
      if (!section.hidden && inside(rect)) return { page, annotationId: section.dataset.annotationId, rect };
    }
    return null;
  }

  /** Does `act(editor)` to a highlight `highlightAt` found, in HIGHLIGHT mode. */
  async function editHighlight(found, act) {
    if (!uiManager) return;
    await editorMode(AnnotationEditorType.HIGHLIGHT);
    // A highlight in the file is an editor only in this mode.
    const editor = [...uiManager.getEditors(found.page - 1)].find((each) =>
      found.editorId ? each.id === found.editorId : each.annotationElementId === found.annotationId,
    );
    if (editor) act(editor);
    await editorMode(AnnotationEditorType.NONE);
  }

  /** Gives a highlight another colour. */
  function recolor(found, color) {
    return editHighlight(found, (editor) => editor.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color));
  }

  /**
   * Removes a highlight, as vscode-pdf-viewer's eraser does: pdf.js's own delete selects the
   * highlight first, which builds a toolbar for it that then fails on the removed editor.
   */
  function remove(found) {
    return editHighlight(found, (editor) => {
      const layer = editor.parent;
      if (!layer) return;
      uiManager.addCommands({ cmd: () => editor.remove(), undo: () => layer.addOrRebuild(editor), mustExec: true });
    });
  }

  /** The words under a highlight, from the text drawn on its page. */
  async function textOf(found) {
    const pageView = viewer.getPageView(found.page - 1);
    let quads = null;
    if (found.editorId) {
      quads = uiManager?.getEditor(found.editorId)?.serialize()?.quadPoints;
    } else {
      const annotations = await pageView.pdfPage.getAnnotations();
      quads = annotations.find((annotation) => annotation.id === found.annotationId)?.quadPoints;
    }
    const textLayer = pageView.div.querySelector('.textLayer');
    if (!textLayer) return '';
    const box = pageView.div.getBoundingClientRect();
    const rects = quads?.length ? quadRects(quads, pageView.viewport, box) : [found.rect];
    return wordsIn(textLayer, rects);
  }

  /** Finds `query` in the paper: the next match, or with `previous` the one before. */
  function find(query, { again = false, previous = false } = {}) {
    eventBus.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }

  /** The paper's own contents, as PDF.js reads its outline: [{title, dest, items}]. */
  async function outline() {
    return (pdfDocument && (await pdfDocument.getOutline().catch(() => null))) ?? [];
  }

  return {
    open,
    goTo,
    refit,
    find,
    endFind: () => eventBus.dispatch('findbarclose', { source: null }),
    outline,
    goToDestination: (dest) => scrollToDestination(dest),
    file: () => file,
    pagesCount: () => (pdfDocument ? viewer.pagesCount : 0),
    currentPage: () => (pdfDocument ? viewer.currentPageNumber || null : null),
    selected,
    highlightSelection,
    highlightAt,
    recolor,
    remove,
    textOf,
  };
}

/** The text layer a node of a selection is in, if it is in one. */
function textLayerOf(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest('.textLayer') ?? null;
}

/**
 * Every highlight edit (create, recolor, delete) and every undo or redo goes through these
 * methods, so each one is a change to save. PDF.js's own "modified" flag would not do: it is
 * set merely by entering HIGHLIGHT mode, and misses removing a highlight already in the file.
 */
function trackCommands(uiManager, onEdited) {
  for (const method of ['addCommands', 'undo', 'redo']) {
    const original = uiManager[method].bind(uiManager);
    uiManager[method] = (...args) => {
      original(...args);
      // After PDF.js has put the change in the document's annotation storage.
      setTimeout(onEdited);
    };
  }
}

/** A highlight's quadrilaterals (PDF points, eight numbers each) as rectangles on the screen. */
function quadRects(quads, viewport, box) {
  const rects = [];
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]];
    const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
    const [x1, y1] = viewport.convertToViewportPoint(Math.min(...xs), Math.min(...ys));
    const [x2, y2] = viewport.convertToViewportPoint(Math.max(...xs), Math.max(...ys));
    rects.push(new DOMRect(box.left + Math.min(x1, x2), box.top + Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)));
  }
  return rects;
}

/** The characters of a text layer whose middle is inside one of `rects`, as words. */
function wordsIn(textLayer, rects) {
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const range = document.createRange();
  let text = '';
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const span = node.parentElement.getBoundingClientRect();
    if (!rects.some((rect) => overlaps(rect, span))) continue;
    let piece = '';
    for (let i = 0; i < node.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const char = range.getBoundingClientRect();
      const x = char.left + char.width / 2;
      const y = char.top + char.height / 2;
      if (rects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) piece += node.data[i];
    }
    if (piece) text += (text && !/\s$/.test(text) ? ' ' : '') + piece;
  }
  return text.replace(/\s+/g, ' ').trim();
}
