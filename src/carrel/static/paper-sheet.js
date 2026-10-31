// What the library knows of a paper, in the page badge's sheet, with no model call: the title
// and byline, then sections that fold with a tap (About, the agent's reading, its digest, the
// similar papers, the contents), then Overview and Remove. Each section's header says what is
// inside, so a folded one still tells the reader whether to open it. Which sections are folded
// is kept per device.

import { areaName } from './areas.js';
import { TYPE_ICONS } from './library.js';
import { commandLog, runCommand } from './library-edits.js';
import { drawMarkdown } from './markdown.js';
import { element, icon } from './rows.js';

const SHEET_KEY = 'carrel.sheet';

/** The sections, in their order, and whether each is open on a new device. */
export const SECTIONS = {
  about: true,
  reading: false,
  digest: false,
  similar: false,
  contents: true,
};

/** The folded sections from what was stored: unknown names and bad shapes are dropped. */
export function restoreSheet(stored) {
  const defaults = Object.keys(SECTIONS).filter((id) => !SECTIONS[id]);
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.folded)) return { folded: new Set(defaults) };
  return { folded: new Set(stored.folded.filter((id) => Object.hasOwn(SECTIONS, id))) };
}

/** The digest's points: its top-level bullets. */
export function digestPoints(digest) {
  return (String(digest ?? '').match(/^[-*] /gm) ?? []).length;
}

/** "9 entries": the contents' top level. */
export function contentsNote(items) {
  if (!items.length) return 'none';
  return items.length === 1 ? '1 entry' : `${items.length} entries`;
}

/** "position · data centric ml". */
export function aboutNote(type, topic) {
  return [type, topic && areaName(topic)].filter(Boolean).join(' · ');
}

let state = null; // the folds, read when the first section is drawn

function folds() {
  if (!state) {
    try {
      state = restoreSheet(JSON.parse(localStorage.getItem(SHEET_KEY) ?? 'null'));
    } catch {
      state = restoreSheet(null);
    }
  }
  return state;
}

function saveFolds() {
  try {
    localStorage.setItem(SHEET_KEY, JSON.stringify({ folded: [...folds().folded] }));
  } catch {
    // Private browsing: the folds last as long as the page.
  }
}

/**
 * A section that folds: a header row (icon, title, a note on what is inside, a chevron) over its
 * body. A `foldedNote` shows only while the section is folded, as it repeats what the body says.
 * `onOpen` runs the first time the body shows, for what is drawn only when wanted.
 */
export function foldSection(id, iconName, title, body, { note = '', foldedNote = false, onOpen } = {}) {
  const box = element('section', 'fold');
  box.dataset.fold = id;
  const head = box.appendChild(element('button', 'fold-head'));
  head.type = 'button';
  const bodyBox = box.appendChild(element('div', 'fold-body'));
  bodyBox.id = `fold-${id}`;
  bodyBox.append(body);
  head.setAttribute('aria-controls', bodyBox.id);
  head.append(icon(iconName, 'icon fold-icon'), element('span', 'fold-title', title));
  const noteBox = head.appendChild(element('span', foldedNote ? 'fold-note folded-only' : 'fold-note', note));
  head.append(icon('chevron-right', 'icon chevron'));

  let drawn = false;
  const show = (open) => {
    head.setAttribute('aria-expanded', String(open));
    bodyBox.hidden = !open;
    if (open && !drawn) {
      drawn = true;
      onOpen?.();
    }
  };
  show(!folds().folded.has(id));
  head.addEventListener('click', () => {
    const open = bodyBox.hidden;
    if (open) folds().folded.delete(id);
    else folds().folded.add(id);
    saveFolds();
    show(open);
  });
  return {
    box,
    setNote(text) {
      noteBox.textContent = text;
    },
  };
}

/**
 * Draws the paper's sheet: `info` takes the head and the sections beside it, `similar` the
 * similar papers, `actions` Overview and Remove. `isCurrent(file)` tells an answer that came too
 * late, after the reader moved on; `close()` closes the sheet.
 */
export function startPaperSheet({ info, similar, actions, isCurrent, close, showOverview, openPaper, onRemoved }) {
  async function draw(file) {
    const paper = await getJson(`/api/paper/${pathUrl(file)}`);
    if (!isCurrent(file)) return;
    for (const box of [info, similar, actions]) {
      box.replaceChildren();
      box.hidden = true;
    }
    if (!paper?.info) return;
    const fields = Object.fromEntries(paper.info.fields);
    const note = paper.info.note;
    const title = fields.title ?? paper.title;

    const head = element('header', 'paper-head');
    head.append(element('h2', 'paper-title', title));
    const byline = head.appendChild(element('p', 'byline'));
    if (fields.authors?.length) byline.append(authors([fields.authors].flat()));
    if (fields.published) byline.append(element('span', 'year', String(fields.published).slice(0, 4)));
    const where = source(fields);
    if (where) byline.append(where);
    if (!byline.childElementCount) byline.remove();
    info.append(head);

    const type = fields.type ?? note?.type;
    const about = aboutBody(fields, type, paper.info.topic);
    if (about) info.append(foldSection('about', 'info', 'About', about, { note: aboutNote(type, paper.info.topic), foldedNote: true }).box);
    const reading = note && readingBody(note);
    if (reading) info.append(foldSection('reading', 'book-open-check', "The agent's reading", reading, { note: note.family ?? '', foldedNote: true }).box);
    if (note?.digest) {
      const body = element('div', 'answer digest');
      const points = digestPoints(note.digest);
      info.append(
        foldSection('digest', 'scroll-text', 'Digest', body, {
          note: points ? `${points} points` : '',
          // Drawn when first opened: a digest is twenty lines of markdown.
          onOpen: () => drawMarkdown(body, note.digest),
        }).box,
      );
    }
    info.hidden = false;

    if (paper.info.overview) {
      const button = actions.appendChild(element('button', 'plain sheet-action'));
      button.type = 'button';
      button.append(icon('notebook-text'), 'Overview');
      button.addEventListener('click', () => {
        close();
        showOverview();
      });
    }
    const remove = actions.appendChild(element('button', 'plain sheet-action remove-paper'));
    remove.type = 'button';
    remove.append(icon('trash'), 'Remove from the library…');
    remove.addEventListener('click', () => {
      const box = confirmRemove(file, title, () => box.replaceWith(remove));
      remove.replaceWith(box);
    });
    actions.hidden = false;

    void drawSimilar(file);
  }

  /** The papers nearest this one by meaning, once the laptop answers. */
  async function drawSimilar(file) {
    const found = await getJson(`/api/similar/${pathUrl(file)}`);
    if (!found?.papers?.length || !isCurrent(file)) return;
    const list = element('ul', 'similar');
    for (const paper of found.papers) {
      const button = list.appendChild(element('li')).appendChild(element('button', 'plain'));
      button.type = 'button';
      button.append(element('span', 'name', paper.title));
      if (paper.year) button.append(element('span', 'year', paper.year));
      button.addEventListener('click', () => {
        close();
        openPaper({ pdf: paper.pdf, title: paper.title });
      });
    }
    similar.replaceChildren(foldSection('similar', 'orbit', 'Similar papers', list, { note: String(found.papers.length) }).box);
    similar.hidden = false;
  }

  /** Removing, once the reader confirms it, with an optional reason to keep it out. */
  function confirmRemove(file, title, keepIt) {
    const box = element('div', 'confirm-remove');
    box.append(element('p', 'warning', "This deletes the paper's text, its PDF with your highlights, and the agent's note. Your overview note and the reviews stay."));
    const reason = box.appendChild(element('input'));
    reason.type = 'text';
    reason.placeholder = 'Why (optional): keeps it from being proposed again';
    reason.setAttribute('aria-label', 'Why it is removed');
    const buttons = box.appendChild(element('div', 'buttons'));
    const yes = buttons.appendChild(element('button', 'danger', 'Remove'));
    yes.type = 'button';
    const keep = buttons.appendChild(element('button', 'plain', 'Keep it'));
    keep.type = 'button';
    keep.addEventListener('click', keepIt);
    const log = commandLog();
    log.box.hidden = true;
    box.append(log.box);
    yes.addEventListener('click', async () => {
      yes.disabled = keep.disabled = reason.disabled = true;
      log.box.hidden = false;
      log.say(`Removing “${title}”…`, 'working');
      try {
        const ended = await runCommand(
          '/api/remove',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdf: file, reason: reason.value }) },
          log.line,
        );
        if (ended.removed) {
          // The engine's check afterwards fails while a review still links the paper.
          log.say(ended.code ? 'Removed. A review still links it: the output above names it.' : 'Removed.', 'done');
          setTimeout(
            () => {
              close();
              onRemoved(file);
            },
            ended.code ? 4000 : 900,
          );
        } else {
          log.say('Not removed: the output above says why.', 'error');
          keep.disabled = false;
        }
      } catch (error) {
        log.say(String(error.message || error), 'error');
        keep.disabled = false;
      }
    });
    return box;
  }

  return { draw };
}

/** The summary, then the facts as label and value: the type with its icon, the topic, and so on. */
function aboutBody(fields, type, topic) {
  const body = element('div', 'about');
  if (fields.summary) body.append(element('p', 'summary', fields.summary));
  const facts = element('dl', 'facts');
  for (const [label, value, iconName] of [
    ['Type', type, TYPE_ICONS[type]],
    ['Topic', topic && topic.split('/').map(areaName).join(' › ')],
    ['Added', fields.added],
    ['Text layer', fields['text-layer']],
  ]) {
    if (!value) continue;
    const term = element('dt', '', label);
    const detail = element('dd');
    if (iconName) detail.append(icon(iconName));
    detail.append(String(value));
    facts.append(term, detail);
  }
  if (facts.childElementCount) body.append(facts);
  return body.childElementCount ? body : null;
}

/** What the agent's reading wrote: the family and the evidence. */
function readingBody(note) {
  const body = element('dl', 'reading');
  for (const [label, value] of [
    ['Family', note.family],
    ['Evidence', note.evidence],
  ]) {
    if (value) body.append(element('dt', '', label), element('dd', '', value));
  }
  return body.childElementCount ? body : null;
}

/** The authors, the first few shown and the rest a tap away. */
function authors(names) {
  const SHOWN = 3;
  if (names.length <= SHOWN + 1) return element('span', 'authors', names.join(', '));
  const fold = element('details', 'authors');
  fold.append(element('summary', '', `${names.slice(0, SHOWN).join(', ')} and ${names.length - SHOWN} more`));
  fold.append(element('span', 'all', names.join(', ')));
  return fold;
}

/** Where the paper comes from: its arXiv page, or its address. */
function source(fields) {
  const href = fields.arxiv ? `https://arxiv.org/abs/${fields.arxiv}` : fields.url;
  if (!href || !/^https?:/.test(href)) return null;
  const link = element('a', 'source', fields.arxiv ? `arXiv ${fields.arxiv}` : new URL(href).hostname);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

function pathUrl(file) {
  return file.split('/').map(encodeURIComponent).join('/');
}

async function getJson(url) {
  const response = await fetch(url).catch(() => null);
  return response?.ok ? response.json().catch(() => null) : null;
}
