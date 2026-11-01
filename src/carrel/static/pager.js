// Turning pages on e-ink, as Lectern does: scrolling smears on an e-ink screen, so what is in view
// moves a screenful at a time, at once. A turn carries the last two lines over, so the eye finds
// its place; going back retraces the turns made, so Previous then Next ends where it began. In the
// PDF, a page whose top is in the last quarter of the screen starts the next one, rather than the
// gap between two pages.
//
// What turns is what is in view: the paper, the library, a review or the chat on its tab, by the
// ‹ › in the strip, the page keys, or a tap on the paper's left or right edge; the chat beside them
// by its own ‹ › on its status line. Only on e-ink; elsewhere the page scrolls as it always has.

const CARRY_LINES = 2;
const SHORTEST_TURN = 120;
// A tap this far in from either side of the paper turns it.
const EDGE = 0.3;
const KEYS = { PageDown: 1, ' ': 1, ArrowRight: 1, PageUp: -1, ArrowLeft: -1, Home: 'start', End: 'end' };

/**
 * Where a turn goes: from `top` in a box `view` px tall over `height` px of content, by
 * `direction` (1, -1, 'start' or 'end'), carrying `carry` px over. `turns` are the turns made so
 * far ({from, to, direction}, the last one last), and `pageTops` the tops of the PDF's pages.
 * Returns {to, retraced}: retraced when it undoes the last turn, which the caller pops.
 */
export function turnTarget({ top, view, height, carry, direction, turns = [], pageTops = [] }) {
  const last = Math.max(0, height - view);
  if (direction === 'start') return { to: 0, retraced: false };
  if (direction === 'end') return { to: last, retraced: false };
  const made = turns.at(-1);
  if (made && made.direction === -direction && Math.abs(made.to - top) <= 1) return { to: made.from, retraced: true };
  const step = Math.max(SHORTEST_TURN, view - carry);
  let to = Math.min(last, Math.max(0, top + direction * step));
  if (direction > 0) {
    // A page that starts in the last quarter of what was in view: everything above it was seen.
    const snap = pageTops.find((page) => page > top + 1 && page >= top + view - Math.max(carry, view / 4) && page <= top + view);
    if (snap !== undefined) to = Math.min(last, snap);
  }
  return { to: Math.round(to), retraced: false };
}

/** A box that turns: `pageTops()` gives the PDF's pages' tops inside it. Returns `turn(direction)`. */
export function turnable(box, { pageTops = () => [] } = {}) {
  let turns = [];
  let turnedTo = -1;
  // Moved any other way, the turns made no longer lead back anywhere.
  box.addEventListener('scroll', () => {
    if (Math.abs(box.scrollTop - turnedTo) > 1) turns = [];
  }, { passive: true });

  function turn(direction) {
    const line = 1.5 * Number.parseFloat(getComputedStyle(box).fontSize);
    const top = box.scrollTop;
    const { to, retraced } = turnTarget({
      top,
      view: box.clientHeight,
      height: box.scrollHeight,
      carry: CARRY_LINES * line,
      direction,
      turns,
      pageTops: pageTops(),
    });
    if (retraced) turns.pop();
    else if (typeof direction === 'number' && Math.abs(to - top) > 1) turns.push({ from: top, to, direction });
    else if (typeof direction !== 'number') turns = [];
    if (turns.length > 200) turns.shift();
    turnedTo = to;
    box.scrollTo({ top: to, behavior: 'instant' });
  }
  return { turn };
}

/** Runs the page turns: `eink()` says whether they are on now. */
export function startPaging({ eink = () => window.carrelLook?.eink() ?? false } = {}) {
  const body = document.body;
  const pdf = document.getElementById('viewerContainer');
  const pdfPages = () => {
    const at = pdf.getBoundingClientRect().top - pdf.scrollTop;
    return [...pdf.querySelectorAll('.page')].map((page) => page.getBoundingClientRect().top - at).sort((a, b) => a - b);
  };
  const boxes = {
    paper: turnable(pdf, { pageTops: pdfPages }),
    papers: turnable(document.getElementById('papers-pane')),
    review: turnable(document.getElementById('review-pane')),
    chat: turnable(document.getElementById('log')),
  };
  const chatPart = boxes.chat;

  /** What is in view, to turn: the tab showing (the Map pans, and does not turn). */
  function inView() {
    const active = body.dataset.active;
    if (active === 'papers' && document.getElementById('papers-pane').dataset.view === 'map') return null;
    return boxes[active] ?? null;
  }

  for (const [id, direction] of [['page-back', -1], ['page-on', 1]]) {
    document.getElementById(id).addEventListener('click', () => inView()?.turn(direction));
  }
  for (const [id, direction] of [['chat-back', -1], ['chat-on', 1]]) {
    document.getElementById(id).addEventListener('click', () => chatPart.turn(direction));
  }

  document.addEventListener('keydown', (event) => {
    const direction = KEYS[event.key];
    if (!eink() || !direction || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector('dialog[open]') || event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const box = event.target.closest?.('#chat-pane') ? chatPart : inView();
    if (!box) return;
    event.preventDefault();
    box.turn(event.shiftKey && direction === 1 && event.key === ' ' ? -1 : direction);
  });

  // A tap on the paper's left or right edge, unless it does something of its own: a link, a
  // highlight (highlight.js takes it first), the pen, or a selection.
  document.addEventListener('click', (event) => {
    if (!eink() || event.defaultPrevented || !pdf.contains(event.target)) return;
    if (event.target.closest('a, button, input, .annotationLayer section')) return;
    if (String(window.getSelection()) || document.getElementById('pen').getAttribute('aria-pressed') === 'true') return;
    const rect = pdf.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    if (x < EDGE) boxes.paper.turn(-1);
    else if (x > 1 - EDGE) boxes.paper.turn(1);
  });
}
