// Two fingers zoom the PDF, and only the PDF: on the screen, or on a Mac's trackpad.
//
// PDF.js's own pinch rescales the viewer at every step of the gesture and moves the scroll to keep
// the point under the fingers; Safari scrolls the same container at the same time with the same
// fingers, and the two add up to the pages racing past. So a pinch here does nothing to the
// viewer until it ends: while the fingers move, the container cannot scroll and the pages are only
// scaled as a picture, around the point the pinch began on; when the fingers lift, the viewer
// takes the new scale once and the scroll is set so that point of the page sits under the fingers.
//
// A trackpad's pinch reaches the page as wheel events with ctrlKey (as ctrl and a mouse wheel do),
// with no event for the fingers lifting: the pinch ends when no wheel event has come for a moment.
//
// Safari would also zoom the whole page on a pinch anywhere else (the chat, the bars), whatever
// the viewport meta says; its own gesture events are cancelled for that.

const MIN_SCALE = 0.3;
const MAX_SCALE = 6;
// Lifting the fingers this close to the width that fits snaps to it, and the PDF fits again
// when the pane changes size.
const SNAP_TO_FIT = 0.06;
// A trackpad pinch has ended when no wheel event has come for this long.
const WHEEL_END_MS = 200;

/** How much one wheel event with ctrlKey zooms: a trackpad pinch sends small fractional steps, a
 * mouse wheel whole notches (by line, or in large whole pixels). The rates are the meaning map's. */
export function wheelFactor({ deltaY, deltaX = 0, deltaMode = 0 }) {
  const notch = deltaX === 0 && (deltaMode === 1 || (Math.abs(deltaY) >= 50 && Number.isInteger(deltaY)));
  const rate = deltaMode === 1 ? 0.025 : notch ? 0.0025 : 0.012;
  return Math.exp(-deltaY * rate);
}

export function stopPageZoom() {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }
}

export function pinchToZoom({ container, viewer, eventBus }) {
  const pages = viewer.viewer; // the element that holds the pages, scaled during the pinch
  let fitScale = null;
  let pinch = null;

  eventBus.on('scalechanging', ({ scale, presetValue }) => {
    if (presetValue === 'page-width') fitScale = scale;
  });

  container.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 2 && !pinch && viewer.pagesCount) {
        event.preventDefault();
        begin(middle(event.touches), distance(event.touches));
      }
    },
    { passive: false },
  );
  container.addEventListener(
    'touchmove',
    (event) => {
      if (!pinch) return;
      // Only a non-passive touchmove keeps Safari from scrolling with the same fingers.
      event.preventDefault();
      if (event.touches.length >= 2 && pinch.touch) move(middle(event.touches), distance(event.touches) / pinch.start);
    },
    { passive: false },
  );
  for (const type of ['touchend', 'touchcancel']) {
    container.addEventListener(type, (event) => {
      if (pinch?.touch && event.touches.length < 2) end();
    });
  }

  let wheelTimer = 0;
  container.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey || !viewer.pagesCount || pinch?.touch) return;
      event.preventDefault();
      const at = { x: event.clientX, y: event.clientY };
      if (!pinch) begin(at, null);
      move(pinch.center.client, pinch.spread * wheelFactor(event));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(end, WHEEL_END_MS);
    },
    { passive: false },
  );

  /** A pinch begins around `at` (in the window), with the fingers `start` apart; none for a wheel. */
  function begin(at, start) {
    const box = container.getBoundingClientRect();
    const center = { x: at.x - box.left, y: at.y - box.top, client: at };
    // The point of the content the pinch is about, in the scrolled content's coordinates.
    const point = { x: container.scrollLeft + center.x, y: container.scrollTop + center.y };
    pinch = {
      touch: start !== null,
      box,
      start,
      spread: 1,
      center,
      last: center,
      factor: 1,
      scale: viewer.currentScale,
      point,
      anchor: anchorAt(at),
    };
    // No native scrolling, and no momentum left over from a scroll the first finger began.
    container.style.overflow = 'hidden';
    pages.style.transformOrigin = `${point.x}px ${point.y}px`;
    pages.style.willChange = 'transform';
  }

  /** The fingers now at `at` (in the window), `spread` times as far apart as they began. */
  function move(at, spread) {
    const now = { x: at.x - pinch.box.left, y: at.y - pinch.box.top };
    const scale = clamp(pinch.scale * spread, MIN_SCALE, MAX_SCALE);
    // A wheel's steps multiply, and stop adding up at the scale's limits.
    pinch.spread = scale / pinch.scale;
    pinch.factor = scale / pinch.scale;
    pinch.last = now;
    const dx = now.x - pinch.center.x;
    const dy = now.y - pinch.center.y;
    pages.style.transform = `translate(${dx}px, ${dy}px) scale(${pinch.factor})`;
  }

  function end() {
    if (!pinch) return;
    clearTimeout(wheelTimer);
    const { factor, scale, point, anchor, last, box } = pinch;
    pinch = null;
    pages.style.transform = '';
    pages.style.transformOrigin = '';
    pages.style.willChange = '';
    const wanted = scale * factor;
    if (fitScale && Math.abs(wanted - fitScale) / fitScale < SNAP_TO_FIT) {
      viewer.currentScaleValue = 'page-width';
    } else if (Math.abs(factor - 1) > 0.01) {
      viewer.currentScale = wanted;
    }
    // The page's own point back under the fingers, wherever the new scale put the page.
    const page = anchor && viewer.getPageView(anchor.pageIndex)?.div;
    if (page) {
      const rect = page.getBoundingClientRect();
      container.scrollLeft += rect.left + anchor.fx * rect.width - (box.left + last.x);
      container.scrollTop += rect.top + anchor.fy * rect.height - (box.top + last.y);
    } else {
      // Between pages: the content scaled as a whole is near enough.
      const ratio = viewer.currentScale / scale;
      container.scrollLeft = point.x * ratio - last.x;
      container.scrollTop = point.y * ratio - last.y;
    }
    container.style.overflow = '';
  }

  /** The page under the fingers, and where on it they are, as fractions of its size. */
  function anchorAt({ x, y }) {
    const page = document.elementFromPoint(x, y)?.closest('.page');
    const number = Number(page?.dataset.pageNumber);
    if (!number) return null;
    const rect = page.getBoundingClientRect();
    return { pageIndex: number - 1, fx: (x - rect.left) / rect.width, fy: (y - rect.top) / rect.height };
  }
}

/** The point between two fingers, in the window. */
function middle(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function distance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
