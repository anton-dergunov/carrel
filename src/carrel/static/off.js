// Carrel's additions to PDF.js, and parts of the page around it, any of which a page can be loaded
// without, for a measurement: the address's `off` names them (`/read/<pdf>?page=78&off=previews,gate`),
// and `all` is every addition to the reader (not the page's parts). experiments/pdf-renderers finds
// this way what in carrel makes PDF.js slower than it is alone. Nothing in the page offers it; it is
// read once, as the page loads.
//
// The reader's additions:
//   gate       scroll-gate.js: no page drawn while the paper flies past
//   previews   previews.js: a picture behind each page, and one taken of each page drawn
//   snapshots  snapshots.js: a tab's pages over the pane as it comes back
//   pinch      pinch.js: the pinch's touch and wheel listeners, and Safari's own zoom stopped
//   pan        pan.js: one finger's pan on the iPad
//   adjust     page-adjust.js: Settings → Pages drawn on each canvas
//   find       PDF.js's find controller
//   citemark   cite-mark.js: a citation's mark over the page
//
// The page's parts, in app.css, through `data-off` on <html>:
//   badge      the blur behind the page badge, over the pages
//   panes      the other tabs' panes, hidden under the PDF's, not rendered at all
//   contain    the panes' `contain: layout paint`
//   chat       the chat not painted (its place kept)
//   fixed      the body not `position: fixed`

export const READER_PARTS = ['gate', 'previews', 'snapshots', 'pinch', 'pan', 'adjust', 'find', 'citemark'];

const asked = new Set((new URLSearchParams(location.search).get('off') ?? '').split(',').filter(Boolean));
if (asked.size) document.documentElement.dataset.off = [...asked].join(' ');

/** Whether the page was loaded without `name`. */
export const off = (name) => asked.has(name) || (asked.has('all') && READER_PARTS.includes(name));
