// While the paper scrolls fast, PDF.js starts drawing no page: the previews behind the pages show
// instead, and the pages in view are drawn once the scroll slows down.
//
// PDF.js draws every page that comes into view, however briefly. A fast wheel flick through a paper
// crossed some twenty pages, each a canvas of 8 MP at the Mac's width taking 70–130 ms, and the main
// thread spent the flick on pages already gone: the frames took 30–70 ms, and WebKit painted
// nothing where the pages came in, so the pane showed its grey for 1.6–2 s over three flicks. Held
// back, the same flicks showed 0.2–0.3 s of grey, and the page in view is sharp about 0.1 s after
// the flick ends.

// Faster than this many screens a second is a flick, not reading.
const FAST_SCREENS_PER_S = 2;
// The scroll's speed is measured over this long, and needs this many scroll events in it: a jump
// (a link, a citation, the contents) is one or two, and is drawn at once.
const WINDOW_MS = 120;
const MIN_SAMPLES = 3;
// How soon to look again while held back.
const RETRY_MS = 80;

/**
 * Holds `viewer`'s drawing back while `container` scrolls fast, as long as `when()` is true. It
 * takes the place of the viewer's `forceRendering`, which its rendering queue calls to start the
 * next page.
 */
export function holdWhileFast({ viewer, container, when = () => true }) {
  const samples = [];
  container.addEventListener(
    'scroll',
    () => {
      samples.push({ t: performance.now(), top: container.scrollTop, left: container.scrollLeft });
      if (samples.length > 16) samples.shift();
    },
    { passive: true },
  );

  const force = viewer.forceRendering.bind(viewer);
  let timer = 0;
  viewer.forceRendering = (visible) => {
    const fast = (FAST_SCREENS_PER_S * Math.max(container.clientHeight, 1)) / 1000; // px per ms
    if (when() && scrollSpeed(samples, performance.now()) > fast) {
      clearTimeout(timer);
      timer = setTimeout(() => viewer.renderingQueue.renderHighestPriority(), RETRY_MS);
      // Something is to be drawn: the queue does not go idle meanwhile.
      return true;
    }
    return force(visible);
  };
}

/** How fast the scroll went over the last `WINDOW_MS` before `now`, in px per ms; 0 for fewer
 * than `MIN_SAMPLES` scroll events, as a jump is. */
export function scrollSpeed(samples, now) {
  const recent = samples.filter((sample) => now - sample.t < WINDOW_MS);
  if (recent.length < MIN_SAMPLES) return 0;
  const first = recent[0];
  const last = recent.at(-1);
  const distance = Math.hypot(last.top - first.top, last.left - first.left);
  return distance / Math.max(16, now - first.t);
}
