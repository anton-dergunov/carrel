// A paper's row, shared by every view of the library. The whole row is the link to the paper.
//
// Compact: the type's icon in the gutter, the title, the marks and the year.
// Rich: the same, then the authors, the type (and the topic, where the rows are not grouped by
// it), and the summary in two lines.
//
// The marks: the reader's star (to read later), their highlights in the PDF, their tags, their
// overview note, a review that cites the paper, the chats about it.
//
// A title search marks its words in the row (`markRow`), and when some are not in the title, a
// line under it says where they are: the summary, the authors, the area, the type or the year.

import { TYPE_ICONS, foundOutsideTitle, matchRanges, shortDate } from './library.js';
import { readingUrl } from './tabs.js';

const SVG = 'http://www.w3.org/2000/svg';

/** A Lucide icon from the page's symbols. */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = svg.appendChild(document.createElementNS(SVG, 'use'));
  use.setAttribute('href', `#i-${name}`);
  return svg;
}

export function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text != null) made.textContent = text;
  return made;
}

/** "Zheng, Chiang, Sheng …": the first authors' surnames. */
export function shortAuthors(authors, shown = 3) {
  const names = [authors ?? []].flat().filter(Boolean);
  if (!names.length) return '';
  const surname = (name) => name.trim().split(/\s+/).at(-1);
  const first = names.slice(0, shown).map(surname).join(', ');
  return names.length > shown ? `${first} …` : first;
}

/** The marks on a paper, each an icon with what it means as its label. */
export function marks(paper) {
  const box = element('span', 'marks');
  if (paper.starred) box.append(mark('star', `Starred to read, ${paper.starred}`, null, 'starred'));
  if (paper.highlights) box.append(mark('highlighter', `${paper.highlights} highlight${paper.highlights > 1 ? 's' : ''} in the PDF`, paper.highlights));
  if (paper.tags?.length) box.append(mark('tag', `Tagged ${paper.tags.join(', ')}`, paper.tags.length > 1 ? paper.tags.length : null));
  if (paper.overview) box.append(mark('notebook-text', 'Your overview note'));
  if (paper.reviews?.length) {
    const label = `Cited in the review${paper.reviews.length > 1 ? 's' : ''} of ${paper.reviews.join(', ')}`;
    box.append(mark('book-open-text', label, paper.reviews.length > 1 ? paper.reviews.length : null));
  }
  if (paper.chats) box.append(mark('chat', `Asked about ${paper.chats} time${paper.chats > 1 ? 's' : ''} in carrel`, paper.chats > 1 ? paper.chats : null));
  return box;
}

function mark(name, label, count = null, kind = '') {
  const span = element('span', kind ? `mark ${kind}` : 'mark');
  span.title = label;
  span.setAttribute('aria-label', label);
  span.setAttribute('role', 'img');
  span.append(icon(name));
  if (count) span.append(element('span', 'count', String(count)));
  return span;
}

/** The type's icon, in the row's gutter; an empty gutter for a paper without one. */
export function typeIcon(type) {
  const box = element('span', 'type');
  if (type && TYPE_ICONS[type]) {
    box.title = type;
    box.setAttribute('aria-label', type);
    box.setAttribute('role', 'img');
    box.append(icon(TYPE_ICONS[type]));
  }
  return box;
}

/**
 * A paper's row: an <a> to its reading page, `data-pdf` naming it. `rich` adds the second and
 * third lines (`summary: false`, the second alone); `topic` names the paper's topic in them;
 * `date` is the one the row shows, 'published' (the year) or 'added'.
 */
export function paperRow(paper, { rich = false, topic = false, date = 'published', summary = true } = {}) {
  const row = element('a', `paper-row ${rich ? 'rich' : 'compact'}`);
  row.href = readingUrl(paper.pdf);
  row.dataset.pdf = paper.pdf;
  row.append(typeIcon(paper.type));
  const main = row.appendChild(element('span', 'main'));
  const head = main.appendChild(element('span', 'head'));
  head.append(element('span', 'title', paper.title), marks(paper));
  const when = date === 'added' && paper.added ? shortDate(paper.added) : paper.year;
  head.append(element('span', 'year', when || ''));
  if (rich) {
    const meta = [shortAuthors(paper.authors), paper.type, topic && paper.topic].filter(Boolean).join(' · ');
    if (meta || paper.tags?.length) {
      const line = main.appendChild(element('span', 'meta'));
      line.append(element('span', 'meta-text', meta));
      for (const tag of paper.tags ?? []) line.append(element('span', 'tag-name', tag));
    }
    if (summary && paper.summary) main.append(element('span', 'summary', paper.summary));
  }
  return row;
}

/** A heading between groups of rows. */
export function groupHeading(text, count) {
  const heading = element('h3', 'group');
  heading.append(element('span', 'name', text));
  if (count != null) heading.append(element('span', 'count', String(count)));
  return heading;
}

const FOUND_LABELS = { summary: 'summary', authors: 'by', area: 'area', type: 'type', year: 'published', tags: 'tagged' };

/**
 * Marks the `words` (lower-case) of a title search in a row from `paperRow`, and adds the line
 * saying where the ones outside the title were found; no words clears both. A rich row's authors
 * and summary are marked where they are; the line leaves the summary out and comes last. Rows are kept and placed again, so a row
 * remembers the words it was marked for and is only changed when they change.
 */
export function markRow(row, paper, words) {
  const key = words.join(' ');
  if ((row.dataset.marked ?? '') === key) return;
  row.dataset.marked = key;
  fillMarked(row.querySelector('.title'), paper.title, words);
  const summary = row.querySelector('.summary');
  if (summary) fillMarked(summary, paper.summary, words);
  const meta = row.querySelector('.meta-text');
  if (meta) fillMarked(meta, meta.textContent, words);
  row.querySelector('.found')?.remove();
  const found = words.length ? foundOutsideTitle(paper, words, { shown: summary ? ['summary'] : [] }) : [];
  row.classList.toggle('has-found', found.length > 0);
  if (!found.length) return;
  const line = element('span', 'found');
  found.forEach((each, i) => {
    if (i) line.append(' · ');
    line.append(element('span', 'found-label', FOUND_LABELS[each.field]), ' ');
    const text = line.appendChild(element('span', `found-${each.field}`));
    appendMarked(text, each.text, each.ranges);
  });
  // Under the title in a compact row; in a rich one, under what it already shows.
  if (row.classList.contains('rich')) row.querySelector('.main').append(line);
  else row.querySelector('.head').after(line);
}

function fillMarked(box, text, words) {
  if (!words.length) {
    box.textContent = text;
    return;
  }
  box.replaceChildren();
  appendMarked(box, text, matchRanges(text, words));
}

/** `text` into `box`, its `ranges` in <mark>. */
export function appendMarked(box, text, ranges) {
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) box.append(text.slice(at, start));
    box.append(element('mark', '', text.slice(start, end)));
    at = end;
  }
  if (at < text.length) box.append(text.slice(at));
}
