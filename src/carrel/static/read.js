// The reading page: the PDF on top, drawn with PDF.js, and the chat underneath.

import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { startChat } from './chat.js';
import { sameFile } from './links.js';

// The viewer component reads the library from `globalThis.pdfjsLib` when its module is
// evaluated, so it is imported only after this.
globalThis.pdfjsLib = pdfjsLib;
const { EventBus, LinkTarget, PDFLinkService, PDFViewer } = await import('./vendor/pdfjs/pdf_viewer.mjs');

const ASSETS = '/static/vendor/pdfjs/';
// Room left above a destination: hyperref anchors a float below its caption.
const DEST_CONTEXT_PX = 72;

pdfjsLib.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;

const pdf = document.body.dataset.pdf;
const container = document.getElementById('viewerContainer');
const pageLabel = document.getElementById('page-label');

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
const viewer = new PDFViewer({ container, eventBus, linkService, removePageBorders: true });
linkService.setViewer(viewer);
// Links inside the PDF go through this too.
linkService.goToDestination = (dest) => scrollToDestination(dest);

let pdfDocument = null;
let pendingTarget = targetFromLocation();

const showPage = (pageNumber) => {
  pageLabel.textContent = `p. ${pageNumber} of ${viewer.pagesCount}`;
};
eventBus.on('pagesinit', () => {
  viewer.currentScaleValue = 'page-width';
  showPage(viewer.currentPageNumber);
  if (pendingTarget) {
    void goTo(pendingTarget);
    pendingTarget = null;
  }
});
eventBus.on('pagechanging', ({ pageNumber }) => showPage(pageNumber));
new ResizeObserver(() => {
  if (viewer.pagesCount) {
    const page = viewer.currentPageNumber;
    viewer.currentScaleValue = 'page-width';
    viewer.currentPageNumber = page;
  }
}).observe(container);

/** A target given in the page's own address: /read/<file>?page=7&dest=table.2 */
function targetFromLocation() {
  const query = new URLSearchParams(location.search);
  const page = Number.parseInt(query.get('page') ?? '', 10);
  const dest = query.get('dest') || undefined;
  return page > 0 || dest ? { page: page > 0 ? page : undefined, dest } : null;
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

/** A citation: this paper moves the viewer, another paper opens in its place. */
function openTarget(target) {
  if (sameFile(target.file, pdf)) {
    void goTo(target);
    return;
  }
  const query = new URLSearchParams();
  if (target.page) query.set('page', String(target.page));
  if (target.dest) query.set('dest', target.dest);
  const path = target.file.split('/').map(encodeURIComponent).join('/');
  location.href = `/read/${path}${query.size ? `?${query}` : ''}`;
}

startChat({ pdf, currentPage: () => viewer.currentPageNumber || null, openTarget });

pdfDocument = await pdfjsLib.getDocument({
  url: document.body.dataset.pdfUrl,
  cMapUrl: `${ASSETS}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ASSETS}standard_fonts/`,
  wasmUrl: `${ASSETS}wasm/`,
  iccUrl: `${ASSETS}iccs/`,
}).promise;
viewer.setDocument(pdfDocument);
linkService.setDocument(pdfDocument, null);
