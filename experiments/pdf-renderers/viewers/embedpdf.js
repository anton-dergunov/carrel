// EmbedPDF's viewer: PDFium compiled to WebAssembly, drawing in a worker, each page a whole picture
// at low resolution with tiles of the part in view over it (its tiling plugin). Its toolbars,
// sidebars and menus are left out (an empty UI schema), and nothing is fetched from elsewhere: the
// WebAssembly is ours, and the fonts it would load from Google and jsDelivr are not loaded.

import EmbedPDF from '/vendor/embedpdf/embedpdf.js';
import { asked, createFrames, failed, paperInfo } from './frames.js';

const GREY = 'rgb(223, 223, 223)';

try {
  const { paper: id, page } = asked();
  const paper = await paperInfo(id);
  const frames = createFrames('embedpdf', id);
  const viewer = EmbedPDF.init({
    type: 'container',
    target: document.getElementById('pane'),
    src: `${location.origin}/pdf/${id}`,
    worker: true,
    wasmUrl: `${location.origin}/vendor/embedpdf/pdfium.wasm`,
    fontFallback: null,
    fonts: { ui: null, signature: null },
    theme: { preference: 'light', light: { background: { app: GREY } } },
    ui: { schema: { id: 'empty', version: '1.0.0', toolbars: {}, menus: {}, sidebars: {}, modals: {}, selectionMenus: {} } },
    disabledCategories: ['annotation', 'redaction', 'form'],
    stamp: { manifests: [] },
    zoom: { defaultZoomLevel: 'fit-width' },
    scroll: { defaultPageGap: 8 },
    viewport: { viewportGap: 0 },
  });
  const registry = await viewer.registry;
  const scroll = registry.getPlugin('scroll').provides();
  scroll.onLayoutReady(() => {
    scroll.scrollToPage({ pageNumber: page ?? paper.page, behavior: 'instant' });
  });
  window.embedpdf = { viewer, registry, frames };
} catch (error) {
  failed(error);
}
