// One finger scrolls a zoomed paper along the axis it mostly moves, on the iPad.
//
// Zoomed past the page's width, a swipe down also drifts sideways: iPad Safari scrolls a box
// exactly as the finger goes, where Android locks the scroll to the axis the swipe runs along.
// WebKit offers no such lock for a box that scrolls, and no CSS gives one (`touch-action` is
// fixed when the finger lands, before its direction is known); setting the sideways scroll back
// while Safari scrolls fights its own scrolling, which runs apart from the page, and jitters. So
// while the paper is wider than its pane, one finger's pan is carrel's: its moves are cancelled
// and the scroll follows them on the axis chosen when the finger has gone `SLOP` px, as
// UIScrollView's directional lock does, and coasts when it lifts, at UIScrollView's rate.
//
// Safari keeps the rest: a paper at page width, a long press (selecting text, the pen, a
// selection's handles), two fingers (pinch.js), and every device but an iPad or iPhone.

// How far the finger goes before its axis is chosen.
const SLOP = 10;
// A swipe this close to an axis keeps to it (30°).
const LOCK = Math.tan(Math.PI / 6);
// A finger held this long before it moves is selecting, not scrolling.
const LONG_PRESS_MS = 400;
// The finger's speed at release is measured over its last moves within this long.
const VELOCITY_MS = 100;
// UIScrollView's normal deceleration, per millisecond.
const DECELERATION = 0.998;
// Coasting stops below this speed (px/ms).
const STOP_SPEED = 0.02;
// After a pan, the click that lifting the finger may send is not a tap.
const CLICK_AFTER_PAN_MS = 400;

/** The axis a move of `dx`, `dy` keeps to: 'y', 'x', or 'both' for a diagonal. */
export function axisFor(dx, dy) {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x <= y * LOCK) return 'y';
  if (y <= x * LOCK) return 'x';
  return 'both';
}

/** A move of `dx`, `dy` kept to `axis`. */
export function onAxis(axis, dx, dy) {
  return { dx: axis === 'y' ? 0 : dx, dy: axis === 'x' ? 0 : dy };
}

/**
 * The finger's speed (px/ms) as it lifts at `now`, from `samples` ({t, x, y}, the last one
 * last) and kept to `axis`; none when it had stopped before lifting.
 */
export function releaseVelocity(samples, axis, now) {
  const last = samples.at(-1);
  if (!last || now - last.t > VELOCITY_MS / 2) return { vx: 0, vy: 0 };
  const first = samples.find((sample) => last.t - sample.t <= VELOCITY_MS) ?? last;
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  const { dx, dy } = onAxis(axis, last.x - first.x, last.y - first.y);
  return { vx: dx / dt, vy: dy / dt };
}

/**
 * One step of coasting, `dt` ms long, at speed `vx`, `vy`: how far it goes, the speed after it,
 * and whether it has stopped.
 */
export function coastStep({ vx, vy }, dt) {
  const decay = DECELERATION ** dt;
  // The distance the decaying speed covers in `dt`, exactly, so a slow frame goes as far.
  const reach = (1 - decay) / -Math.log(DECELERATION);
  const next = { vx: vx * decay, vy: vy * decay };
  return { dx: vx * reach, dy: vy * reach, ...next, done: Math.hypot(next.vx, next.vy) < STOP_SPEED };
}

/** Whether this is an iPad or an iPhone: touches, and WebKit's own gesture events. */
function iosTouch() {
  return 'ontouchstart' in window && 'ongesturestart' in window;
}

/** Pans `container` along an axis; `motion()` says whether it may coast. */
export function panAlongAxis({ container, motion = () => window.carrelLook?.motion() ?? true }) {
  if (!iosTouch()) return;
  let pan = null;
  let coast = null;
  let pannedAt = -Infinity;

  container.addEventListener(
    'touchstart',
    (event) => {
      stopCoasting();
      pan = null;
      if (event.touches.length !== 1) return;
      // A pinch has the container (pinch.js), or there is nothing sideways to drift into.
      if (container.style.overflow === 'hidden' || container.scrollWidth <= container.clientWidth + 1) return;
      const { clientX: x, clientY: y } = event.touches[0];
      pan = { from: { x, y }, at: { x, y }, began: performance.now(), axis: null, safari: false, samples: [] };
    },
    { passive: true },
  );

  container.addEventListener(
    'touchmove',
    (event) => {
      if (!pan || pan.safari) return;
      if (event.touches.length !== 1 || container.style.overflow === 'hidden') {
        pan = null;
        return;
      }
      const now = performance.now();
      const { clientX: x, clientY: y } = event.touches[0];
      if (!pan.axis) {
        const dx = x - pan.from.x;
        const dy = y - pan.from.y;
        if (!pan.samples.length && now - pan.began > LONG_PRESS_MS) {
          pan.safari = true;
          return;
        }
        event.preventDefault();
        pan.samples.push({ t: now, x, y });
        if (Math.hypot(dx, dy) < SLOP) return;
        // Chosen: the way the finger has come so far is scrolled at once, on that axis.
        pan.axis = axisFor(dx, dy);
        pan.at = pan.from;
        pan.place = { left: container.scrollLeft, top: container.scrollTop };
      }
      event.preventDefault();
      const { dx, dy } = onAxis(pan.axis, x - pan.at.x, y - pan.at.y);
      pan.place = scrollBy(pan.place, dx, dy);
      pan.at = { x, y };
      pan.samples.push({ t: now, x, y });
      while (pan.samples.length > 2 && now - pan.samples[0].t > VELOCITY_MS) pan.samples.shift();
    },
    { passive: false },
  );

  for (const type of ['touchend', 'touchcancel']) {
    container.addEventListener(type, (event) => {
      if (!pan) return;
      const done = pan;
      pan = null;
      if (!done.axis) return;
      pannedAt = performance.now();
      if (type === 'touchend' && !event.touches.length && motion()) {
        startCoasting(releaseVelocity(done.samples, done.axis, pannedAt), done.place);
      }
    });
  }

  // Lifting the finger after a pan is not a tap: not a link, nor e-ink's turn at the edge.
  container.addEventListener(
    'click',
    (event) => {
      if (performance.now() - pannedAt < CLICK_AFTER_PAN_MS) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true },
  );

  container.addEventListener('wheel', stopCoasting, { passive: true });

  /**
   * Scrolls from `place` ({left, top}, kept in fractions of a pixel, which the container may
   * round) by the finger's move `dx`, `dy`, within the content. Returns the new place, and which
   * edges it met.
   */
  function scrollBy(place, dx, dy) {
    const left = clamp(place.left - dx, 0, container.scrollWidth - container.clientWidth);
    const top = clamp(place.top - dy, 0, container.scrollHeight - container.clientHeight);
    if (dx) container.scrollLeft = left;
    if (dy) container.scrollTop = top;
    return { left, top, edgeX: left !== place.left - dx, edgeY: top !== place.top - dy };
  }

  function startCoasting({ vx, vy }, place) {
    if (Math.hypot(vx, vy) < STOP_SPEED) return;
    coast = { vx, vy, last: performance.now(), place, frame: 0 };
    coast.frame = requestAnimationFrame(glide);
  }

  function glide(now) {
    if (!coast) return;
    const { place } = coast;
    // Moved by anything else (a link, a tab, a turn), it stops.
    if (Math.abs(container.scrollLeft - place.left) > 1 || Math.abs(container.scrollTop - place.top) > 1) {
      coast = null;
      return;
    }
    const step = coastStep(coast, Math.max(0, now - coast.last));
    const next = scrollBy(place, step.dx, step.dy);
    // At an edge the speed along it is spent.
    const vx = next.edgeX ? 0 : step.vx;
    const vy = next.edgeY ? 0 : step.vy;
    if (step.done || Math.hypot(vx, vy) < STOP_SPEED) {
      coast = null;
      return;
    }
    coast = { ...coast, vx, vy, last: now, place: next };
    coast.frame = requestAnimationFrame(glide);
  }

  function stopCoasting() {
    if (coast) cancelAnimationFrame(coast.frame);
    coast = null;
  }
}

function clamp(value, low, high) {
  return Math.min(Math.max(low, high), Math.max(low, value));
}
