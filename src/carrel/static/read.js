// The reading page: the PDF on top, drawn with PDF.js, and the chat underneath. Another paper
// opens in place, so the chat stays as it is.

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

// Pinching scales the PDF after this long without moving, as PDF.js's own viewer does.
const PINCH_DRAWING_DELAY_MS = 400;

let pdf = document.body.dataset.pdf;
const container = document.getElementById('viewerContainer');
const pageLabel = document.getElementById('page-label');
const titleLabel = document.querySelector('#chat-pane .title');

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
eventBus.on('pagechanging', ({ pageNumber }) => {
  showPage(pageNumber);
  // The address keeps the page, so a reload comes back to it.
  history.replaceState(history.state, '', readingUrl(pdf, { page: pageNumber > 1 ? pageNumber : undefined }));
});
new ResizeObserver(() => {
  // Fit the width again, unless the reader zoomed in or out.
  if (viewer.pagesCount && viewer.currentScaleValue === 'page-width') {
    const page = viewer.currentPageNumber;
    viewer.currentScaleValue = 'page-width';
    viewer.currentPageNumber = page;
  }
}).observe(container);

// Two fingers zoom the PDF, not the page (the page's own zoom is off in the CSS).
new pdfjsLib.TouchManager({
  container,
  signal: new AbortController().signal,
  onPinching: (origin, previousDistance, distance) => {
    viewer.updateScale({ drawingDelay: PINCH_DRAWING_DELAY_MS, scaleFactor: distance / previousDistance, origin });
  },
});

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
  } else {
    void openPaper(target.file, target);
  }
}

function readingUrl(file, target) {
  const query = new URLSearchParams();
  if (target?.page) query.set('page', String(target.page));
  if (target?.dest) query.set('dest', target.dest);
  const path = file.split('/').map(encodeURIComponent).join('/');
  return `/read/${path}${query.size ? `?${query}` : ''}`;
}

/** Another paper in the viewer, with the chat left as it is. */
async function openPaper(file, target, { push = true } = {}) {
  const path = file.split('/').map(encodeURIComponent).join('/');
  let paper;
  try {
    const response = await fetch(`/api/paper/${path}`);
    if (!response.ok) throw new Error(response.statusText);
    paper = await response.json();
  } catch {
    // Not one this page can open; the reading page says why.
    location.href = readingUrl(file, target);
    return;
  }
  pdf = paper.pdf;
  document.body.dataset.pdf = pdf;
  document.title = paper.title;
  titleLabel.textContent = paper.title;
  if (push) history.pushState(null, '', readingUrl(pdf, target));
  pendingTarget = target?.page || target?.dest ? target : null;
  await load(paper.pdf_url);
}

window.addEventListener('popstate', () => {
  const file = decodeURIComponent(location.pathname.replace(/^\/read\//, ''));
  const target = targetFromLocation();
  if (sameFile(file, pdf)) {
    if (target) void goTo(target);
  } else {
    void openPaper(file, target, { push: false });
  }
});

let loading = 0;
// The open document's loading task, which is what PDF.js tears a document down through.
let openTask = null;

async function load(url) {
  const ticket = ++loading;
  const task = pdfjsLib.getDocument({
    url,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
  });
  const loaded = await task.promise;
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

startChat({ currentPaper: () => pdf, currentPage: () => viewer.currentPageNumber || null, openTarget });

await load(document.body.dataset.pdfUrl);
