// PDF.js as carrel configures its viewer (read.js), and nothing of carrel's around it: no previews
// behind the pages, no gate that holds drawing during a flick, no snapshots. The renderer alone.

import '/static/polyfill.js'; // before PDF.js
import * as pdfjsLib from '/static/vendor/pdfjs/pdf.min.mjs';
import { asked, createFrames, failed, paperInfo } from './frames.js';

globalThis.pdfjsLib = pdfjsLib;
const { EventBus, PDFLinkService, PDFViewer } = await import('/static/vendor/pdfjs/pdf_viewer.mjs');
const ASSETS = '/static/vendor/pdfjs/';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;

try {
  const { paper: id, page } = asked();
  const paper = await paperInfo(id);
  const frames = createFrames('pdfjs', id);
  const container = document.getElementById('pane');
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({ container, eventBus, linkService, removePageBorders: true });
  linkService.setViewer(viewer);

  // A page's canvas is its first and sharp pixels at once; PDF.js's detail canvas, when zoomed
  // past its cap, is not counted.
  eventBus.on('pagerendered', ({ pageNumber, cssTransform }) => cssTransform || frames.sharp(pageNumber));
  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = 'page-width';
    viewer.currentPageNumber = page ?? paper.page;
    observe(container, frames);
  });

  const data = await (await fetch(`/pdf/${id}`)).arrayBuffer();
  const task = pdfjsLib.getDocument({
    data,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableHWA: true,
  });
  const pdf = await task.promise;
  viewer.setDocument(pdf);
  linkService.setDocument(pdf);
} catch (error) {
  failed(error);
}

// The pages in view, as PDF.js lays them out: a div per page, numbered.
function observe(container, frames) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const page = Number(entry.target.dataset.pageNumber);
        if (entry.isIntersecting) {
          frames.seen(page);
          if (entry.target.querySelector('canvas')) frames.sharp(page);
        } else frames.gone(page);
      }
    },
    { root: container },
  );
  for (const div of container.querySelectorAll('.page')) observer.observe(div);
}
