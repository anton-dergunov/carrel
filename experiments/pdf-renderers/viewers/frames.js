// What a viewer's page measures from the inside, kept by the bench (runs.jsonl): the frames that
// came late, and for each page the time from coming into view to its first pixels and to sharp.
// It cannot see a frame WebKit did not paint; the recordings (scripts/mac-bench/bench.py) do.
// The record is sent when the page is hidden (another tab, another app), or on the key S.

const LATE_MS = 25;

export function createFrames(viewer, paper) {
  let start = performance.now();
  let last = start;
  let frames = 0;
  let late = [];
  // page → {seen, first, sharp}, for the visit under way; visits done are kept in `pages`.
  let visits = new Map();
  let pages = [];

  const tick = (now) => {
    frames += 1;
    if (now - last > LATE_MS) late.push(Math.round(now - last));
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  function close(page) {
    const visit = visits.get(page);
    if (!visit) return;
    visits.delete(page);
    pages.push({
      page,
      first: visit.first == null ? null : Math.round(visit.first - visit.seen),
      sharp: visit.sharp == null ? null : Math.round(visit.sharp - visit.seen),
    });
  }

  function send(why) {
    for (const page of [...visits.keys()]) close(page);
    const record = {
      viewer,
      paper,
      why,
      agent: navigator.userAgent,
      dpr: devicePixelRatio,
      pane: [innerWidth, innerHeight],
      seconds: Math.round(performance.now() - start) / 1000,
      frames,
      late,
      pages,
    };
    start = performance.now();
    frames = 0;
    late = [];
    pages = [];
    void fetch('/api/log', { method: 'POST', body: JSON.stringify(record), keepalive: true });
  }

  document.addEventListener('visibilitychange', () => document.hidden && send('hidden'));
  document.addEventListener('keydown', (event) => event.key.toLowerCase() === 's' && send('key'));

  return {
    // A page came into view, or left it.
    seen(page) {
      if (!visits.has(page)) visits.set(page, { seen: performance.now(), first: null, sharp: null });
    },
    gone: close,
    // A page in view got its first pixels (a placeholder or a blurred version counts), or its sharp ones.
    first(page) {
      const visit = visits.get(page);
      if (visit && visit.first == null) visit.first = performance.now();
    },
    sharp(page) {
      const visit = visits.get(page);
      if (!visit) return;
      if (visit.first == null) visit.first = performance.now();
      if (visit.sharp == null) visit.sharp = performance.now();
    },
  };
}

// The paper and the page asked for in the address.
export function asked() {
  const query = new URLSearchParams(location.search);
  return { paper: query.get('paper') ?? 'text', page: Number(query.get('page')) || null };
}

export async function paperInfo(id) {
  const papers = await (await fetch('/api/papers')).json();
  const paper = papers.find((each) => each.id === id);
  if (!paper) throw new Error(`No paper ${id}`);
  return paper;
}

export function failed(error) {
  const box = document.getElementById('failed');
  box.textContent = String(error?.stack ?? error);
  console.error(error);
}
