// What acts on the paper showing, kept off the screen until asked for, since the paper and the
// chat already share a small one:
//
// - the page badge, faint in the PDF's corner, which opens what the library knows of the paper
//   (from its frontmatter and the agent's note, with no model call), a field to go to a page,
//   and its contents;
// - find, which takes the place of the tabs in the bar while it is open.

import { commandLog, runCommand } from './library-edits.js';
import { drawMarkdown } from './markdown.js';

/**
 * `showOverview()` shows the paper's overview note, beside it; `openPaper({pdf, title})` opens
 * another paper in its tab (a similar one); `onRemoved(pdf)` follows a paper taken out of the
 * library from its sheet.
 */
export function startPaperTools({ reader, showOverview, openPaper = () => {}, onRemoved = () => {} }) {
  const body = document.body;
  const badge = document.getElementById('page-badge');
  const sheet = document.getElementById('contents-sheet');
  const pageForm = document.getElementById('go-to-page');
  const pageNumber = document.getElementById('page-number');
  const pageCount = document.getElementById('page-count');
  const outlineNav = document.getElementById('outline');
  const infoBox = document.getElementById('paper-info');
  const findButton = document.getElementById('find-button');
  const findForm = document.getElementById('find');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');

  // The contents.

  let outlineOf = null; // the paper whose outline is drawn

  function openContents(open) {
    sheet.hidden = !open;
    badge.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const count = reader.pagesCount();
    pageNumber.max = String(count);
    pageNumber.value = String(reader.currentPage() ?? '');
    pageCount.textContent = `of ${count}`;
    // Asked each time: the overview note comes and goes.
    void drawInfo(reader.file());
    if (outlineOf !== reader.file()) {
      outlineOf = reader.file();
      void drawOutline(outlineOf);
    }
  }

  async function drawOutline(file) {
    outlineNav.replaceChildren();
    const items = await reader.outline();
    if (file !== reader.file()) return;
    if (!items.length) {
      outlineNav.append(Object.assign(document.createElement('p'), { className: 'none', textContent: 'This PDF has no contents.' }));
      return;
    }
    outlineNav.append(outlineList(items));
  }

  // What the library knows of the paper.

  async function drawInfo(file) {
    const response = await fetch(`/api/paper/${file.split('/').map(encodeURIComponent).join('/')}`).catch(() => null);
    const paper = response?.ok ? await response.json().catch(() => null) : null;
    if (file !== reader.file()) return;
    if (!paper?.info) {
      infoBox.hidden = true;
      return;
    }
    const fields = Object.fromEntries(paper.info.fields);
    const parts = [element('h2', 'title', fields.title ?? paper.title)];
    const byline = element('p', 'byline');
    if (fields.authors?.length) byline.append(authors([fields.authors].flat()));
    if (fields.published) byline.append(element('span', 'year', String(fields.published).slice(0, 4)));
    const where = source(fields);
    if (where) byline.append(where);
    parts.push(byline);
    if (fields.summary) parts.push(element('p', 'summary', fields.summary));
    const facts = element('p', 'facts');
    const note = paper.info.note;
    for (const [label, value] of [
      ['Type', fields.type ?? note?.type],
      ['Topic', paper.info.topic],
      ['Added', fields.added],
      ['Text layer', fields['text-layer']],
    ]) {
      if (value) facts.append(element('span', 'fact', `${label}: ${value}`));
    }
    if (facts.childElementCount) parts.push(facts);
    if (note) parts.push(agentNote(note));
    parts.push(similarPapers(file));
    if (paper.info.overview) {
      const button = element('button', 'plain overview-link', 'Overview');
      button.type = 'button';
      button.addEventListener('click', () => {
        openContents(false);
        showOverview();
      });
      parts.push(button);
    }
    const remove = element('button', 'plain remove-paper', 'Remove from the library…');
    remove.type = 'button';
    remove.addEventListener('click', () => remove.replaceWith(confirmRemove(file, fields.title ?? paper.title)));
    parts.push(remove);
    infoBox.replaceChildren(...parts);
    infoBox.hidden = false;
  }

  /** Removing, once the reader confirms it, with an optional reason to keep it out. */
  function confirmRemove(file, title) {
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
    keep.addEventListener('click', () => void drawInfo(file));
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
              openContents(false);
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

  /** The papers nearest this one by meaning, filled in when the laptop answers. */
  function similarPapers(file) {
    const box = element('div', 'similar');
    box.hidden = true;
    void (async () => {
      const response = await fetch(`/api/similar/${file.split('/').map(encodeURIComponent).join('/')}`).catch(() => null);
      const found = response?.ok ? await response.json().catch(() => null) : null;
      if (!found?.papers?.length || file !== reader.file()) return;
      box.append(element('div', 'note-title', 'Similar papers'));
      const list = box.appendChild(element('ul'));
      for (const paper of found.papers) {
        const button = list.appendChild(element('li')).appendChild(element('button', 'plain'));
        button.type = 'button';
        button.append(element('span', 'name', paper.title));
        if (paper.year) button.append(element('span', 'year', paper.year));
        button.addEventListener('click', () => {
          openContents(false);
          openPaper({ pdf: paper.pdf, title: paper.title });
        });
      }
      box.hidden = false;
    })();
    return box;
  }

  /** What the agent's reading wrote: the family and the evidence, and the digest, folded. */
  function agentNote(note) {
    const box = element('div', 'agent-note');
    box.append(element('div', 'note-title', "The agent's reading"));
    for (const [label, value] of [
      ['Family', note.family],
      ['Evidence', note.evidence],
    ]) {
      if (!value) continue;
      const line = box.appendChild(element('p', 'note-field'));
      line.append(element('span', 'label', label), value);
    }
    if (note.digest) {
      const fold = box.appendChild(element('details', 'digest'));
      const points = (note.digest.match(/^- /gm) ?? []).length;
      fold.append(element('summary', '', points ? `Digest · ${points} points` : 'Digest'));
      const body = fold.appendChild(element('div', 'answer'));
      // Drawn when first opened: a digest is twenty lines of markdown.
      fold.addEventListener('toggle', () => {
        if (fold.open && !body.childElementCount) drawMarkdown(body, note.digest);
      });
    }
    return box;
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

  function outlineList(items) {
    const list = document.createElement('ul');
    for (const item of items) {
      const entry = list.appendChild(document.createElement('li'));
      const link = entry.appendChild(document.createElement('button'));
      link.type = 'button';
      link.textContent = item.title;
      link.disabled = !item.dest;
      link.addEventListener('click', () => {
        openContents(false);
        void reader.goToDestination(item.dest);
      });
      if (item.items?.length) entry.append(outlineList(item.items));
    }
    return list;
  }

  badge.addEventListener('click', () => openContents(sheet.hidden));
  pageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const page = Number.parseInt(pageNumber.value, 10);
    if (page >= 1 && page <= reader.pagesCount()) {
      pageNumber.blur();
      openContents(false);
      void reader.goTo({ page });
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!sheet.hidden && !sheet.contains(event.target) && !badge.contains(event.target)) openContents(false);
  });

  // Find.

  function openFind() {
    body.classList.add('finding');
    findForm.hidden = false;
    findInput.focus({ preventScroll: true });
    findInput.select();
    if (findInput.value) reader.find(findInput.value);
  }

  function closeFind() {
    if (findForm.hidden) return;
    body.classList.remove('finding');
    findForm.hidden = true;
    findCount.textContent = '';
    reader.endFind();
  }

  const again = (previous) => {
    if (findInput.value) reader.find(findInput.value, { again: true, previous });
  };

  findButton.addEventListener('click', openFind);
  findForm.addEventListener('submit', (event) => {
    event.preventDefault();
    again(false);
  });
  findInput.addEventListener('input', () => {
    if (findInput.value) reader.find(findInput.value);
    else findCount.textContent = '';
  });
  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      again(event.shiftKey);
    } else if (event.key === 'Escape') {
      closeFind();
    }
  });
  document.getElementById('find-previous').addEventListener('click', () => again(true));
  document.getElementById('find-next').addEventListener('click', () => again(false));
  document.getElementById('find-done').addEventListener('click', closeFind);

  return {
    /** Opens find with `term` in it; the reader finds it once the paper is at its page. */
    showFind(term) {
      body.classList.add('finding');
      findForm.hidden = false;
      findInput.value = term;
      findCount.textContent = '…';
    },
    /** The page in view, on the badge. */
    showPage(page, count) {
      badge.hidden = !count;
      badge.textContent = `${page} / ${count}`;
      if (!sheet.hidden) pageNumber.value = String(page);
    },
    showFound({ current, total, pending }) {
      if (!findInput.value) findCount.textContent = '';
      else if (pending && !total) findCount.textContent = '…';
      else findCount.textContent = total ? `${current} of ${total}` : 'Not found';
    },
    /** Another tab is showing: the tools of this paper close. */
    leave() {
      closeFind();
      openContents(false);
    },
  };
}

function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text != null) made.textContent = text;
  return made;
}
