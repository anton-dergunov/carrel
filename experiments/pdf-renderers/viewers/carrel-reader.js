// Carrel's reader module (read.js) on its own, opening the paper asked for at its middle page; the
// address's `off` reaches it as in carrel (off.js).

import { asked, failed, paperInfo } from './frames.js';

// `css=pdfjs`: PDF.js's stylesheet alone, with the bench's pane, instead of carrel's; `css=scrollerbg`:
// carrel's, with the pane's colour on the scrolling element itself rather than on its parent.
const css = new URLSearchParams(location.search).get('css');
const style = (text) => document.head.append(Object.assign(document.createElement('style'), { textContent: text }));
if (css === 'pdfjs') {
  for (const link of document.querySelectorAll('link[href="/static/app.css"], link[href="/static/themes.css"]')) link.remove();
  style('#viewerContainer { position: absolute; inset: 0; overflow: auto; isolation: isolate; background: rgb(223, 223, 223); } .pdfViewer .page { margin: 0 auto 8px; } #page-badge { display: none; }');
} else if (css === 'scrollerbg') {
  style('#viewerContainer { background: var(--pdf-bg); }');
}
const { createReader } = await import('/static/read.js');

try {
  const { paper: id, page } = asked();
  const paper = await paperInfo(id);
  const badge = document.getElementById('page-badge');
  const reader = createReader({
    onPage(number, count) {
      badge.hidden = !count;
      badge.textContent = `${number} / ${count}`;
    },
    onPlace() {},
    onFound() {},
    onSaved() {},
  });
  await reader.open(`bench/${id}.pdf`, `/pdf/${id}`, { target: { page: page ?? paper.page } });
} catch (error) {
  failed(error);
}
