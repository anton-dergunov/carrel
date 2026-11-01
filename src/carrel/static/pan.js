// One finger scrolls a zoomed paper along the axis it mostly moves, on the iPad.
//
// Zoomed past the page's width, a swipe down also drifts sideways: iPad Safari scrolls a box
// exactly as the finger goes, where Android locks the scroll to the axis the swipe runs along.
// WebKit offers no such lock for a box that scrolls, and no CSS gives one (`touch-action` is
// fixed when the finger lands, before its direction is known); setting the sideways scroll back
// while Safari scrolls fights its own scrolling, which runs apart from the page, and jitters. So
// while the paper is wider than its pane, one finger's pan is carrel's: its moves are cancelled
// and the scroll follows them on the axis chosen when the finger has gone `SLOP` px, as
// UIScrollView's directional lock does.
//
// The rest is made to feel like Safari's own scrolling, with the numbers Flutter's iOS scrolling
// measured against UIScrollView (BSD): the speed at release weighs the last few moves as iOS does,
// the page coasts at UIScrollView's normal deceleration, and a flick while it still coasts adds
// to its speed, so flick after flick goes faster.
//
// Safari keeps the rest: a paper at page width, a long press (selecting text, the pen, a
// selection's handles), two fingers (pinch.js), and every device but an iPad or iPhone.

// How far the finger goes before its axis is chosen.
const SLOP = 6;
// A swipe this close to an axis keeps to it (30°).
const LOCK = Math.tan(Math.PI / 6);
// A finger held this long before it moves is selecting, not scrolling.
const LONG_PRESS_MS = 400;
// A finger that has not moved for this long before lifting has stopped, and nothing coasts.
const STOPPED_MS = 40;
// UIScrollView's normal deceleration, per millisecond.
const DECELERATION = 0.998;
// Coasting stops below this speed (px/ms), and a release slower than this does not coast.
const STOP_SPEED = 0.02;
// A flick while coasting keeps the speed it had only if it is in the same direction, at least
// half as fast, and the finger never rested on the way.
const CARRY_FACTOR = 0.5;
const CARRY_REST_MS = 50;
// The fastest a finger's release counts for, and a coast with what flicks before it carried (px/ms).
const MAX_RELEASE = 8;
const MAX_SPEED = 40;
// After a pan, or a tap that stopped a coast, the click that lifting the finger sends is not a tap.
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
 * last) and kept to `axis`, as iOS estimates it: the speeds over the last three moves, the
 * newest weighed least (it is the noisiest, as the finger lifts). None when it had stopped.
 */
export function releaseVelocity(samples, axis, now) {
  const last = samples.at(-1);
  if (!last || now - last.t > STOPPED_MS) return { vx: 0, vy: 0 };
  const weights = [0.05, 0.35, 0.6]; // the newest move first
  let vx = 0;
  let vy = 0;
  let weighed = 0;
  for (let i = 0; i < weights.length; i++) {
    const end = samples.at(-1 - i);
    const start = samples.at(-2 - i);
    if (!start) break;
    const dt = end.t - start.t;
    if (dt <= 0) continue;
    vx += (weights[i] * (end.x - start.x)) / dt;
    vy += (weights[i] * (end.y - start.y)) / dt;
    weighed += weights[i];
  }
  if (!weighed) return { vx: 0, vy: 0 };
  // Fewer than three moves: the weights there are, made whole.
  const { dx, dy } = onAxis(axis, vx / weighed, vy / weighed);
  return { vx: clamp(dx, -MAX_RELEASE, MAX_RELEASE), vy: clamp(dy, -MAX_RELEASE, MAX_RELEASE) };
}

/** The speed a coast at `v` (px/ms, one axis) lends a flick in its direction (Flutter's iOS fit). */
export function carriedSpeed(v) {
  const perSecond = Math.min(0.000816 * Math.abs(v * 1000) ** 1.967, 40000);
  return (Math.sign(v) * perSecond) / 1000;
}

/** A release at `v` (px/ms, one axis) with `carried` from the coast it interrupted. */
export function withCarry(v, carried) {
  if (!carried || Math.sign(v) !== Math.sign(carried) || Math.abs(v) <= Math.abs(carried) * CARRY_FACTOR) return v;
  return clamp(v + carried, -MAX_SPEED, MAX_SPEED);
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

/** The time of a touch event, on `performance.now()`'s clock. */
function timeOf(event) {
  const now = performance.now();
  const t = event.timeStamp;
  return t > 0 && t <= now && now - t < 1000 ? t : now;
}

/**
 * Pans `container` along an axis; `motion()` says whether it may coast. `trace` (pan-trace.js)
 * is told what it decides and does.
 */
export function panAlongAxis({ container, motion = () => window.carrelLook?.motion() ?? true, trace = null }) {
  if (!iosTouch()) return;
  const note = (kind, data) => trace?.note(kind, data);
  let pan = null;
  let coast = null;
  let quietUntil = -Infinity;

  container.addEventListener(
    'touchstart',
    (event) => {
      // What the coast this touch stops was doing, for a flick that carries it on.
      const was = stopCoasting('touch');
      pan = null;
      const decision =
        event.touches.length !== 1 ? 'fingers'
        : container.style.overflow === 'hidden' ? 'pinch'
        : container.scrollWidth <= container.clientWidth + 1 ? 'page-width'
        : 'pan';
      note('start', { decision, was });
      // Two fingers; a pinch has the container (pinch.js); or there is nothing sideways to drift into.
      if (decision !== 'pan') return;
      const { clientX: x, clientY: y } = event.touches[0];
      const t = timeOf(event);
      pan = { from: { x, y }, at: { x, y }, began: t, axis: null, safari: false, samples: [{ t, x, y }], was, rested: false };
    },
    { passive: true },
  );

  container.addEventListener(
    'touchmove',
    (event) => {
      if (!pan || pan.safari) return;
      if (event.touches.length !== 1 || container.style.overflow === 'hidden') {
        note('drop', { fingers: event.touches.length, axis: pan.axis });
        pan = null;
        return;
      }
      const t = timeOf(event);
      const { clientX: x, clientY: y } = event.touches[0];
      const previous = pan.samples.at(-1);
      if (t - previous.t > CARRY_REST_MS) pan.rested = true;
      if (!pan.axis) {
        if (pan.samples.length === 1 && t - pan.began > LONG_PRESS_MS) {
          pan.safari = true;
          note('long-press', { held: t - pan.began });
          return;
        }
        event.preventDefault();
        record(t, x, y);
        const dx = x - pan.from.x;
        const dy = y - pan.from.y;
        if (Math.hypot(dx, dy) < SLOP) return;
        // Chosen: the way the finger has come so far is scrolled at once, on that axis.
        pan.axis = axisFor(dx, dy);
        pan.at = pan.from;
        pan.place = { left: container.scrollLeft, top: container.scrollTop };
        note('lock', { axis: pan.axis, dx, dy, after: t - pan.began });
      } else {
        event.preventDefault();
        record(t, x, y);
      }
      const { dx, dy } = onAxis(pan.axis, x - pan.at.x, y - pan.at.y);
      pan.place = scrollBy(pan.place, dx, dy);
      pan.at = { x, y };
    },
    { passive: false },
  );

  /** One more of the finger's places; two at the same moment are one. */
  function record(t, x, y) {
    const samples = pan.samples;
    if (t - samples.at(-1).t < 1) samples.pop();
    samples.push({ t, x, y });
    if (samples.length > 8) samples.shift();
  }

  for (const type of ['touchend', 'touchcancel']) {
    container.addEventListener(type, (event) => {
      if (!pan) return;
      const done = pan;
      pan = null;
      if (done.was) quietUntil = performance.now() + CLICK_AFTER_PAN_MS;
      if (!done.axis) return;
      quietUntil = performance.now() + CLICK_AFTER_PAN_MS;
      if (type !== 'touchend' || event.touches.length || !motion()) {
        note('end', { type, fingers: event.touches.length, motion: motion() });
        return;
      }
      const lifted = timeOf(event);
      const release = releaseVelocity(done.samples, done.axis, lifted);
      let { vx, vy } = release;
      if (done.was && !done.rested) {
        vx = withCarry(vx, carriedSpeed(done.was.vx));
        vy = withCarry(vy, carriedSpeed(done.was.vy));
      }
      note('release', {
        release,
        vx,
        vy,
        was: done.was,
        rested: done.rested,
        // The finger's last places, as [ms before it lifted, x, y].
        last: done.samples.slice(-5).map((sample) => [lifted - sample.t, sample.x, sample.y]),
      });
      startCoasting({ vx, vy }, done.place);
    });
  }

  // Lifting the finger after a pan is not a tap: not a link, nor e-ink's turn at the edge; nor
  // is the tap that stops a coast, as on iOS.
  container.addEventListener(
    'click',
    (event) => {
      if (performance.now() < quietUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true },
  );

  container.addEventListener('wheel', () => stopCoasting('wheel'), { passive: true });

  trace?.listen();

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
    note('set', { left, top });
    return { left, top, edgeX: left !== place.left - dx, edgeY: top !== place.top - dy };
  }

  function startCoasting({ vx, vy }, place) {
    if (Math.hypot(vx, vy) < STOP_SPEED) {
      note('no-coast', { vx, vy });
      return;
    }
    note('coast', { vx, vy });
    coast = { vx, vy, released: performance.now(), last: null, place, frame: 0 };
    coast.frame = requestAnimationFrame(glide);
  }

  function glide(now) {
    if (!coast) return;
    const { place } = coast;
    // Moved by anything else (a link, a tab, a turn), it stops.
    if (Math.abs(container.scrollLeft - place.left) > 1 || Math.abs(container.scrollTop - place.top) > 1) {
      note('stop', { reason: 'moved', left: container.scrollLeft, top: container.scrollTop, place });
      coast = null;
      return;
    }
    // The first frame goes as far as the time since the finger lifted, so the page never pauses.
    const dt = coast.last === null ? performance.now() - coast.released : now - coast.last;
    const step = coastStep(coast, Math.max(0, dt));
    const next = scrollBy(place, step.dx, step.dy);
    // At an edge the speed along it is spent.
    const vx = next.edgeX ? 0 : step.vx;
    const vy = next.edgeY ? 0 : step.vy;
    note('frame', { dt, dx: step.dx, dy: step.dy, vx, vy, late: performance.now() - now });
    if (step.done || Math.hypot(vx, vy) < STOP_SPEED) {
      note('stop', { reason: step.done ? 'slow' : 'edge' });
      coast = null;
      return;
    }
    coast = { ...coast, vx, vy, last: now, place: next };
    coast.frame = requestAnimationFrame(glide);
  }

  /** Stops a coast, for `reason`; returns its speed then, or null when none was running. */
  function stopCoasting(reason) {
    if (!coast) return null;
    note('stop', { reason });
    cancelAnimationFrame(coast.frame);
    const { vx, vy } = coast;
    coast = null;
    return { vx, vy };
  }
}

function clamp(value, low, high) {
  return Math.min(Math.max(low, high), Math.max(low, value));
}
