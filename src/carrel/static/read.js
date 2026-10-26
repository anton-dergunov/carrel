// The PDF, drawn with PDF.js. Every paper tab shares this one viewer: a tab keeps its paper's
// place, and showing the tab loads the paper again and puts the place back. (A viewer per tab
// would keep a set of rendered pages per tab, which is what makes iPad Safari drop a page.)

import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { pinchToZoom, stopPageZoom } from './pinch.js';

// The viewer component reads the library from `globalThis.pdfjsLib` when its module is
// evaluated, so it is imported only after this.
globalThis.pdfjsLib = pdfjsLib;
const { EventBus, LinkTarget, PDFLinkService, PDFViewer } = await import('./vendor/pdfjs/pdf_viewer.mjs');

const ASSETS = '/static/vendor/pdfjs/';
// Room left above a destination: hyperref anchors a float below its caption.
const DEST_CONTEXT_PX = 72;

pdfjsLib.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;

/**
 * The viewer in `#viewerContainer`. `onPage(number, count)` follows the page in view, and
 * `onPlace(place)` the place to come back to: {page, scale, left, top}, the scale being
 * 'page-width' or a percentage, left and top in the page's own coordinates.
 */
export function createReader({ onPage, onPlace }) {
  const container = document.getElementById('viewerContainer');
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
  const viewer = new PDFViewer({ container, eventBus, linkService, removePageBorders: true });
  linkService.setViewer(viewer);
  // Links inside the PDF go through this too.
  linkService.goToDestination = (dest) => scrollToDestination(dest);

  let file = null;
  let pdfDocument = null;
  // Where to go once the document's pages are laid out: a place, or a target {page, dest}.
  let pending = null;

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
      onPlace({ page: location.pageNumber, scale: location.scale, left: Math.round(location.left), top: Math.round(location.top) });
    }
  });

  new ResizeObserver(() => refit()).observe(container);

  stopPageZoom();
  pinchToZoom({ container, viewer, eventBus });

  /** Fits the width again, unless the reader zoomed in or out; not while the split is dragged. */
  function refit() {
    if (document.body.classList.contains('dragging') || !container.clientWidth) return;
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
    pdfDocument = null;
    pending = { place, target };
    const ticket = ++loading;
    const task = pdfjsLib.getDocument({
      url,
      cMapUrl: `${ASSETS}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSETS}standard_fonts/`,
      wasmUrl: `${ASSETS}wasm/`,
      iccUrl: `${ASSETS}iccs/`,
    });
    let loaded;
    try {
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
    viewer.setDocument(loaded);
    linkService.setDocument(loaded, null);
    void previous?.destroy();
  }

  return {
    open,
    goTo,
    refit,
    file: () => file,
    currentPage: () => (pdfDocument ? viewer.currentPageNumber || null : null),
  };
}
