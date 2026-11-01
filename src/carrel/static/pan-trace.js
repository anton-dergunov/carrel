// A trace of each gesture on the paper, on the iPad, sent to the laptop (`/api/trace`, a JSON line
// a gesture in the state folder's pan-trace.jsonl), while the stutter in pan.js's scrolling is
// looked into. Temporary: it goes once that is found.
//
// A gesture's trace holds every touch (when it was made, how late the page got it, whether it
// could still be cancelled and whether pan.js cancelled it), what pan.js decided (the lock, the
// release, each frame of the coast and why it stopped), every scroll of the container (marked
// when pan.js did not make it), every animation frame, and the pages PDF.js drew meanwhile.
// It is sent once the finger has lifted, any coast has stopped and the page has been still for
// `TAIL_MS`. The Stutter button in the paper's corner marks the moment a stutter was seen.

const TAIL_MS = 400;
// The longest a trace goes on; a finger held down longer is cut there.
const LONGEST_MS = 20_000;

const round = (value) => Math.round(value * 10) / 10;

/** A gesture tracer for `container`; `eventBus` is PDF.js's. */
export function createPanTrace({ container, eventBus, motion }) {
  const session = Math.random().toString(36).slice(2, 8);
  let count = 0;
  let record = null;
  let lastSent = null;
  let fingers = 0;
  let coasting = false;
  let expected = null; // the scroll pan.js last set
  let tail = 0;
  let frame = 0;

  function open(t) {
    count += 1;
    const box = container;
    record = {
      kind: 'gesture',
      id: `${session}-${count}`,
      at: new Date().toISOString(),
      page: decodeURIComponent(location.pathname),
      view: {
        width: box.clientWidth,
        height: box.clientHeight,
        scrollWidth: box.scrollWidth,
        scrollHeight: box.scrollHeight,
        left: round(box.scrollLeft),
        top: round(box.scrollTop),
        dpr: devicePixelRatio,
        motion: motion(),
      },
      t0: t,
      touches: [],
      notes: [],
      scrolls: [],
      frames: [],
      renders: [],
    };
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }

  function rel(t) {
    return round(t - record.t0);
  }

  function tick(t) {
    if (!record) return;
    record.frames.push(rel(t));
    if (t - record.t0 > LONGEST_MS) return send();
    frame = requestAnimationFrame(tick);
  }

  function settleLater() {
    clearTimeout(tail);
    if (!record || fingers || coasting) return;
    tail = setTimeout(send, TAIL_MS);
  }

  function send() {
    clearTimeout(tail);
    cancelAnimationFrame(frame);
    if (!record) return;
    const done = record;
    record = null;
    done.summary = summarise(done);
    lastSent = { id: done.id, at: performance.now() };
    post(done);
  }

  function touch(type) {
    return (event) => {
      const now = performance.now();
      fingers = event.touches.length;
      if (!record) {
        if (type !== 's') return;
        open(now);
      }
      const point = event.touches[0] ?? event.changedTouches?.[0];
      record.touches.push([
        rel(now),
        type,
        round(point?.clientX ?? 0),
        round(point?.clientY ?? 0),
        event.touches.length,
        event.cancelable ? 1 : 0,
        event.defaultPrevented ? 1 : 0,
        round(now - event.timeStamp), // how late the page got it
      ]);
      if (type === 'e' || type === 'c') settleLater();
    };
  }

  return {
    /** Listens to the touches; called after pan.js's own listeners, to see what they did. */
    listen() {
      const passive = { passive: true };
      container.addEventListener('touchstart', touch('s'), passive);
      container.addEventListener('touchmove', touch('m'), passive);
      container.addEventListener('touchend', touch('e'), passive);
      container.addEventListener('touchcancel', touch('c'), passive);
      container.addEventListener(
        'scroll',
        () => {
          if (!record) return;
          const left = container.scrollLeft;
          const top = container.scrollTop;
          const ours = expected && Math.abs(left - expected.left) <= 1 && Math.abs(top - expected.top) <= 1;
          record.scrolls.push([rel(performance.now()), round(left), round(top), ours ? 0 : 1]);
          settleLater();
        },
        passive,
      );
      for (const [name, phase] of [['pagerender', 'start'], ['pagerendered', 'end']]) {
        eventBus?.on(name, ({ pageNumber, source }) => {
          if (record) record.renders.push([rel(performance.now()), pageNumber ?? source?.id ?? 0, phase]);
        });
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') send();
      });
      addMarkButton();
    },

    /** What pan.js decided or did: `kind` and its data. */
    note(kind, data = {}) {
      if (kind === 'set') {
        expected = data;
        return;
      }
      if (kind === 'coast') coasting = true;
      if (kind === 'stop') coasting = false;
      // pan.js's touchstart runs before the trace's: a first finger begins the next gesture here.
      if (kind === 'start' && !fingers) {
        send();
        open(performance.now());
      }
      if (!record) return;
      record.notes.push([rel(performance.now()), kind, roundAll(data)]);
      if (kind === 'stop') settleLater();
    },
  };

  function addMarkButton() {
    const pane = document.getElementById('pdf-pane');
    if (!pane || document.getElementById('pan-mark')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'pan-mark';
    button.textContent = 'Stutter';
    button.title = 'Mark that the last swipe stuttered (scroll trace)';
    let marks = 0;
    button.addEventListener('click', () => {
      marks += 1;
      post({
        kind: 'mark',
        at: new Date().toISOString(),
        // The gesture going on, or the last one sent, and how long ago it ended.
        gesture: record?.id ?? lastSent?.id ?? null,
        ago: record ? 0 : lastSent ? Math.round(performance.now() - lastSent.at) : null,
      });
      button.textContent = `Stutter · ${marks}`;
    });
    pane.append(button);
  }
}

/** What to look at first in a trace. */
export function summarise({ touches, notes, scrolls, frames, renders }) {
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const moves = touches.filter((touch) => touch[1] === 'm');
  const moveGaps = moves.slice(1).map((touch, i) => touch[0] - moves[i][0]);
  return {
    duration: frames.at(-1) ?? 0,
    decision: notes.find((note) => note[1] === 'start')?.[2]?.decision ?? null,
    axis: notes.find((note) => note[1] === 'lock')?.[2]?.axis ?? null,
    stop: notes.find((note) => note[1] === 'stop')?.[2]?.reason ?? null,
    echoes: notes.filter((note) => note[1] === 'echo').length,
    moves: moves.length,
    uncancelable: moves.filter((touch) => !touch[5]).length,
    notPrevented: moves.filter((touch) => !touch[6]).length,
    longestLag: Math.max(0, ...touches.map((touch) => touch[7])),
    longestMoveGap: round(Math.max(0, ...moveGaps)),
    longestFrame: round(Math.max(0, ...gaps)),
    framesOver20: gaps.filter((gap) => gap > 20).length,
    framesOver34: gaps.filter((gap) => gap > 34).length,
    foreignScrolls: scrolls.filter((scroll) => scroll[3]).length,
    renders: renders.filter((render) => render[2] === 'end').length,
  };
}

function roundAll(data) {
  if (Array.isArray(data)) return data.map((value) => (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value && typeof value === 'object' ? roundAll(value) : value));
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value && typeof value === 'object' ? roundAll(value) : value;
  }
  return out;
}

function post(entry) {
  const body = JSON.stringify(entry);
  fetch('/api/trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    // A keepalive request may carry no more than 64 KB.
    keepalive: body.length < 60_000,
  }).catch(() => {});
}
