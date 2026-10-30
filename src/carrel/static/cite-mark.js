// A citation's mark: the rectangles a paper link names (`rect=`, as the engine's `paperlib locate`
// writes them), drawn over the page. It is an overlay of the page, never an annotation: nothing is
// written to the PDF. It arrives with a brief ring that settles, then rests until the reader taps
// the page, presses Escape, follows another citation or leaves the paper; scrolling keeps it.
//
// Ported from vscode-pdf-viewer (its src/webview/citeGeometry.ts and citeMark.ts, the styles in
// its main.css); keep the two in step.

/** A rectangle taller than this (points) is a block (a table, a figure, an equation), outlined. */
export const BLOCK_HEIGHT = 24;
/** Space around a line's box ([x, y]) and a block's box, in points. */
export const LINE_PAD = [2, 1.5];
export const BLOCK_PAD = 6;
/** Room kept above a block too tall for the view, as a share of the view. */
export const TALL_TOP = 1 / 6;
const FADE_MS = 220;
/** The arrival's fade and ring (app.css), after which the mark rests. */
const ARRIVAL_MS = 900;

/**
 * A rectangle [x0, y0, x1, y1] in points from the top-left of the unrotated crop box
 * (`width` × `height`), as fractions of the page shown turned clockwise by `rotation` degrees;
 * clipped to the page, and null when nothing of it is on the page.
 */
export function pageFractions(r, width, height, rotation) {
  const x0 = Math.max(0, r[0]) / width;
  const y0 = Math.max(0, r[1]) / height;
  const x1 = Math.min(width, r[2]) / width;
  const y1 = Math.min(height, r[3]) / height;
  if (!(x0 < x1 && y0 < y1)) return null;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [1 - y1, x0, 1 - y0, x1];
    case 180:
      return [1 - x1, 1 - y1, 1 - x0, 1 - y0];
    case 270:
      return [y0, 1 - x1, y1, 1 - x0];
    default:
      return [x0, y0, x1, y1];
  }
}

/** A mark's boxes with their padding, as fractions of the page shown: [{box, block}]. */
export function markBoxes(rects, width, height, rotation) {
  const boxes = [];
  for (const r of rects) {
    const block = r[3] - r[1] > BLOCK_HEIGHT;
    const [padX, padY] = block ? [BLOCK_PAD, BLOCK_PAD] : LINE_PAD;
    const box = pageFractions([r[0] - padX, r[1] - padY, r[2] + padX, r[3] + padY], width, height, rotation);
    if (box) boxes.push({ box, block });
  }
  return boxes;
}

/** Where to scroll so a mark's span [top, bottom] (pixels in the scroll content) sits in a view. */
export function scrollFor(top, bottom, view) {
  const height = bottom - top;
  return Math.max(0, height > view * (1 - 2 * TALL_TOP) ? top - view * TALL_TOP : (top + bottom) / 2 - view / 2);
}

/** The citation mark of the shared viewer: at most one at a time. */
export function createCiteMark({ viewer, eventBus, container }) {
  let shown = null; // {page, boxes, element}

  // PDF.js empties a page's div when it draws the page again (at another zoom, say).
  eventBus.on('pagerender', ({ pageNumber }) => attach(pageNumber));
  eventBus.on('pagerendered', ({ pageNumber }) => attach(pageNumber));
  container.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && event.target.closest('.page')) clear(true);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shown && !event.target.closest('input, textarea, dialog')) clear(true);
  });

  /**
   * Marks rectangles on a page of `pdfDocument` and scrolls them into the middle of the view.
   * False when none of them is on the page, which then shows nothing.
   */
  async function show(pdfDocument, pageNumber, rects) {
    clear(false);
    if (!(pageNumber >= 1 && pageNumber <= viewer.pagesCount)) return false;
    const page = await pdfDocument.getPage(pageNumber);
    const [vx0, vy0, vx1, vy1] = page.view;
    const boxes = markBoxes(rects, vx1 - vx0, vy1 - vy0, page.rotate + viewer.pagesRotation);
    if (!boxes.length) return false;
    const element = document.createElement('div');
    element.className = 'cite-mark';
    element.setAttribute('aria-hidden', 'true');
    for (const { box, block } of boxes) {
      const part = document.createElement('div');
      part.className = block ? 'cite-block' : 'cite-line';
      Object.assign(part.style, {
        left: `${box[0] * 100}%`,
        top: `${box[1] * 100}%`,
        width: `${(box[2] - box[0]) * 100}%`,
        height: `${(box[3] - box[1]) * 100}%`,
      });
      element.append(part);
    }
    shown = { page: pageNumber, boxes, element };
    scrollTo(shown);
    attach(pageNumber);
    // The ring plays once the page is drawn, so it is seen; then the mark rests, so that PDF.js
    // drawing the page again (which attaches the mark again) does not play it again.
    const arrive = () => {
      element.classList.add('arriving');
      setTimeout(() => element.classList.replace('arriving', 'rested'), ARRIVAL_MS);
    };
    if (viewer.getPageView(pageNumber - 1)?.renderingState === 3 /* FINISHED */) {
      arrive();
    } else {
      const timer = setTimeout(arrive, 600);
      const drawn = ({ pageNumber: number }) => {
        if (number !== pageNumber) return;
        clearTimeout(timer);
        eventBus.off('pagerendered', drawn);
        arrive();
      };
      eventBus.on('pagerendered', drawn);
    }
    return true;
  }

  /** Takes the mark away: faded when the reader dismisses it, at once when it is replaced. */
  function clear(fade) {
    const gone = shown;
    shown = null;
    if (!gone) return;
    if (!fade || !gone.element.isConnected) {
      gone.element.remove();
      return;
    }
    gone.element.classList.add('leaving');
    setTimeout(() => gone.element.remove(), FADE_MS);
  }

  function attach(pageNumber) {
    if (shown?.page !== pageNumber) return;
    const div = viewer.getPageView(pageNumber - 1)?.div;
    if (div && shown.element.parentElement !== div) div.append(shown.element);
  }

  function scrollTo({ page, boxes }) {
    const div = viewer.getPageView(page - 1)?.div;
    if (!div) return;
    const pageBox = div.getBoundingClientRect();
    const view = container.getBoundingClientRect();
    const pageTop = pageBox.top - view.top + container.scrollTop;
    const pageLeft = pageBox.left - view.left + container.scrollLeft;
    const left = Math.min(...boxes.map((b) => b.box[0]));
    const top = Math.min(...boxes.map((b) => b.box[1]));
    const right = Math.max(...boxes.map((b) => b.box[2]));
    const bottom = Math.max(...boxes.map((b) => b.box[3]));
    container.scrollTop = scrollFor(pageTop + top * pageBox.height, pageTop + bottom * pageBox.height, container.clientHeight);
    // Sideways only when zoomed in far enough that the mark is out of view.
    const markLeft = pageLeft + left * pageBox.width;
    const markRight = pageLeft + right * pageBox.width;
    if (markLeft < container.scrollLeft || markRight > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = Math.max(0, (markLeft + markRight) / 2 - container.clientWidth / 2);
    }
  }

  return { show, clear, visible: () => shown !== null };
}
