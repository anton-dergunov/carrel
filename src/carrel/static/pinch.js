// Two fingers zoom the PDF, and only the PDF.
//
// PDF.js's own pinch rescales the viewer at every step of the gesture and moves the scroll to keep
// the point under the fingers; Safari scrolls the same container at the same time with the same
// fingers, and the two add up to the pages racing past. So a pinch here does nothing to the
// viewer until it ends: while the fingers move, the container cannot scroll and the pages are only
// scaled as a picture, around the point the pinch began on; when the fingers lift, the viewer
// takes the new scale once and the scroll is set so that point of the page sits under the fingers.
//
// Safari would also zoom the whole page on a pinch anywhere else (the chat, the bars), whatever
// the viewport meta says; its own gesture events are cancelled for that.

const MIN_SCALE = 0.3;
const MAX_SCALE = 6;
// Lifting the fingers this close to the width that fits snaps to it, and the PDF fits again
// when the pane changes size.
const SNAP_TO_FIT = 0.06;

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
        begin(event.touches);
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
      if (event.touches.length >= 2) move(event.touches);
    },
    { passive: false },
  );
  for (const type of ['touchend', 'touchcancel']) {
    container.addEventListener(type, (event) => {
      if (pinch && event.touches.length < 2) end();
    });
  }

  function begin(touches) {
    const box = container.getBoundingClientRect();
    const center = middle(touches, box);
    // The point of the content the pinch is about, in the scrolled content's coordinates.
    const point = { x: container.scrollLeft + center.x, y: container.scrollTop + center.y };
    pinch = {
      box,
      start: distance(touches),
      center,
      last: center,
      factor: 1,
      scale: viewer.currentScale,
      point,
      anchor: anchorAt(touches),
    };
    // No native scrolling, and no momentum left over from a scroll the first finger began.
    container.style.overflow = 'hidden';
    pages.style.transformOrigin = `${point.x}px ${point.y}px`;
    pages.style.willChange = 'transform';
  }

  function move(touches) {
    const now = middle(touches, pinch.box);
    const scale = clamp(pinch.scale * (distance(touches) / pinch.start), MIN_SCALE, MAX_SCALE);
    pinch.factor = scale / pinch.scale;
    pinch.last = now;
    const dx = now.x - pinch.center.x;
    const dy = now.y - pinch.center.y;
    pages.style.transform = `translate(${dx}px, ${dy}px) scale(${pinch.factor})`;
  }

  function end() {
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
  function anchorAt(touches) {
    const x = (touches[0].clientX + touches[1].clientX) / 2;
    const y = (touches[0].clientY + touches[1].clientY) / 2;
    const page = document.elementFromPoint(x, y)?.closest('.page');
    const number = Number(page?.dataset.pageNumber);
    if (!number) return null;
    const rect = page.getBoundingClientRect();
    return { pageIndex: number - 1, fx: (x - rect.left) / rect.width, fy: (y - rect.top) / rect.height };
  }
}

function middle(touches, box) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2 - box.left,
    y: (touches[0].clientY + touches[1].clientY) / 2 - box.top,
  };
}

function distance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
