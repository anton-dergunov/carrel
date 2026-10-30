// Highlights, and the passage the next question carries.
//
// The pen in the bar switches highlighting on, as Lectern's does: while it is on, text selected
// in the paper is highlighted once the selection has settled, in the colour used last. A page
// cannot add to the menu iOS shows for a selection, nor tell on which side of the selection it
// will put it (below near the top of the screen, above near the bottom), so nothing is offered
// beside a selection. A tap on a highlight opens a small panel instead: no text is selected
// then, so iOS shows no menu. It recolours the highlight, removes it, or asks about it.
//
// What is selected in the paper, or just highlighted, becomes the passage the next question
// carries (chat.js shows it over the question box). Tapping the box clears the selection on
// iOS, so the passage is kept here, not read from the selection when the question is sent.

/** vscode-pdf-viewer's colours, by its names: a highlight is the same colour in both. */
export const HIGHLIGHT_COLORS = [
  { name: 'yellow', label: 'Yellow', value: '#ffeb3b' },
  { name: 'green', label: 'Green', value: '#a5d6a7' },
  { name: 'blue', label: 'Blue', value: '#81d4fa' },
  { name: 'pink', label: 'Pink', value: '#f48fb1' },
  { name: 'orange', label: 'Orange', value: '#ffb74d' },
  { name: 'purple', label: 'Purple', value: '#ce93d8' },
];

// The longest passage a question carries; the server cuts a longer one too.
export const LONGEST_PASSAGE = 4000;
const PEN_KEY = 'carrel.pen';
const COLOR_KEY = 'carrel.highlight-color';
// A selection unchanged this long, with no finger down, is what the reader meant (Lectern's).
const SETTLE_MS = 800;
// A selection unchanged this long is the passage; it is not highlighted, so it can be quicker.
const PASSAGE_MS = 300;
const NOTICE_MS = 6000;

/**
 * A selection's boxes as PDF.js measures them for a highlight, joined line by line: one box from
 * a line's first word to its last, as tall as its tallest. PDF.js measures the text layer's
 * spans, and a space the PDF sets as an item of its own gets a span one space of the browser's
 * font wide, however wide the paper made it, so the highlight would have a hole there; small
 * capitals and the like give spans of other heights. Boxes further apart than the line is high
 * stay apart: the gutter between two columns is not highlighted. `boxes` are `{x, y, width,
 * height}` as fractions of the page, whose width over height is `aspect`. vscode-pdf-viewer's
 * `src/webview/lineBoxes.ts` is the same; keep the two in step.
 */
export function lineBoxes(boxes, aspect) {
  if (!boxes?.length) return boxes;
  const lines = [];
  for (const box of [...boxes].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))) {
    const line = lines.find((each) => overlap(each, box) >= Math.min(each.height, box.height) / 2);
    if (line) {
      line.boxes.push(box);
      const bottom = Math.max(line.y + line.height, box.y + box.height);
      line.y = Math.min(line.y, box.y);
      line.height = bottom - line.y;
    } else {
      lines.push({ y: box.y, height: box.height, boxes: [box] });
    }
  }
  const joined = [];
  for (const line of lines) {
    let run = null;
    for (const box of line.boxes.sort((a, b) => a.x - b.x)) {
      if (run && (box.x - (run.x + run.width)) * aspect <= line.height) {
        run.width = Math.max(run.width, box.x + box.width - run.x);
      } else {
        run = { x: box.x, y: line.y, width: box.width, height: line.height };
        joined.push(run);
      }
    }
  }
  return joined;
}

function overlap(a, b) {
  return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
}

/** Selected text as a question carries it: on one line, and not too long. */
export function passage(text) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > LONGEST_PASSAGE ? `${line.slice(0, LONGEST_PASSAGE - 1).trimEnd()}…` : line;
}

/**
 * The pen, the panel and the passage, for the paper `reader` shows. `onPassage({pdf, page,
 * text})` gives the passage the next question carries; `onAsk()` is the panel's Ask, before
 * its passage comes: iOS opens the keyboard only for a box focused during the tap itself.
 */
export function startHighlights({ reader, onPassage, onAsk }) {
  const container = document.getElementById('viewerContainer');
  const pen = document.getElementById('pen');
  const panel = document.getElementById('mark-panel');
  const swatches = document.getElementById('mark-colors');
  const notice = document.getElementById('pdf-notice');

  let marking = load(PEN_KEY) === 'on';
  let color = HIGHLIGHT_COLORS.some((each) => each.value === load(COLOR_KEY)) ? load(COLOR_KEY) : HIGHLIGHT_COLORS[0].value;
  let shown = null; // the highlight the panel is for

  // The pen.

  function setMarking(on) {
    marking = on;
    pen.setAttribute('aria-pressed', String(on));
    store(PEN_KEY, on ? 'on' : 'off');
  }
  pen.addEventListener('click', () => setMarking(!marking));
  setMarking(marking);

  // The selection: the passage, and with the pen on, a highlight.

  let fingerDown = false;
  let passageTimer = 0;
  let settleTimer = 0;
  container.addEventListener('pointerdown', () => (fingerDown = true));
  for (const type of ['pointerup', 'pointercancel', 'touchend']) {
    document.addEventListener(type, () => (fingerDown = false));
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(passageTimer);
    clearTimeout(settleTimer);
    passageTimer = setTimeout(takePassage, PASSAGE_MS);
    if (marking) settleTimer = setTimeout(settled, SETTLE_MS);
  });

  function takePassage() {
    const found = reader.selected();
    if (found) onPassage({ pdf: reader.file(), page: found.page, text: passage(found.text) });
  }

  async function settled() {
    if (!marking || !reader.selected()) return;
    // Not while it is still being dragged out.
    if (fingerDown) {
      settleTimer = setTimeout(settled, SETTLE_MS / 2);
      return;
    }
    takePassage();
    await reader.highlightSelection(color);
  }

  // A tap on a highlight.

  container.addEventListener('click', (event) => {
    if (reader.selected()) return;
    const found = reader.highlightAt(event.clientX, event.clientY);
    if (found) {
      event.preventDefault();
      openPanel(found);
    } else {
      closePanel();
    }
  });

  for (const each of HIGHLIGHT_COLORS) {
    const swatch = swatches.appendChild(document.createElement('button'));
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.color = each.value;
    swatch.style.setProperty('--swatch', each.value);
    swatch.setAttribute('aria-label', each.label);
    swatch.title = each.label;
    swatch.addEventListener('click', () => {
      const found = shown;
      closePanel();
      color = each.value;
      store(COLOR_KEY, color);
      if (found) void reader.recolor(found, color);
    });
  }
  document.getElementById('mark-remove').addEventListener('click', () => {
    const found = shown;
    closePanel();
    if (found) void reader.remove(found);
  });
  document.getElementById('mark-ask').addEventListener('click', async () => {
    const found = shown;
    closePanel();
    if (!found) return;
    onAsk();
    const text = await reader.textOf(found);
    if (text) onPassage({ pdf: reader.file(), page: found.page, text: passage(text) });
  });

  function openPanel(found) {
    shown = found;
    for (const swatch of swatches.children) {
      swatch.setAttribute('aria-pressed', String(sameColor(swatch.dataset.color, found.color)));
    }
    panel.hidden = false;
    // Under the highlight, or above it when there is no room below; inside the paper's pane.
    const pane = container.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const below = found.rect.bottom + 8;
    const top = below + height <= pane.bottom - 8 ? below : Math.max(pane.top + 8, found.rect.top - 8 - height);
    const left = Math.min(Math.max(pane.left + 8, found.rect.left + found.rect.width / 2 - width / 2), pane.right - 8 - width);
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  function closePanel() {
    shown = null;
    panel.hidden = true;
  }

  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target)) closePanel();
  });
  container.addEventListener('scroll', () => {
    if (!panel.hidden) closePanel();
  });

  // How saving went.

  let noticeTimer = 0;
  function say(text) {
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.hidden = true), NOTICE_MS);
  }

  return {
    /** How the last change to the highlights was saved (`createReader`'s `onSaved`). */
    showSaved(state) {
      pen.classList.toggle('unsaved', state === 'unsaved');
      pen.title = state === 'unsaved' ? 'Highlight what I select · a change is not saved yet' : 'Highlight what I select';
      if (state === 'conflict') say('This paper changed on another device, so it was loaded again. Your last change to its highlights was not saved.');
    },
    /** Another tab is showing. */
    leave() {
      closePanel();
      notice.hidden = true;
    },
  };
}

function sameColor(a, b) {
  return typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing: the choice lasts as long as the page.
  }
}
