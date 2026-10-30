// A paper's row, shared by every view of the library. The whole row is the link to the paper.
//
// Compact: the type's icon in the gutter, the title, the marks and the year.
// Rich: the same, then the authors, the type (and the topic, where the rows are not grouped by
// it), and the summary in two lines.
//
// The marks: the reader's overview note, a review that cites the paper, the chats about it.

import { TYPE_ICONS, shortDate } from './library.js';
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
  if (paper.overview) box.append(mark('notebook-text', 'Your overview note'));
  if (paper.reviews?.length) {
    const label = `Cited in the review${paper.reviews.length > 1 ? 's' : ''} of ${paper.reviews.join(', ')}`;
    box.append(mark('book-open-text', label, paper.reviews.length > 1 ? paper.reviews.length : null));
  }
  if (paper.chats) box.append(mark('chat', `Asked about ${paper.chats} time${paper.chats > 1 ? 's' : ''} in carrel`, paper.chats > 1 ? paper.chats : null));
  return box;
}

function mark(name, label, count = null) {
  const span = element('span', 'mark');
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
    if (meta) main.append(element('span', 'meta', meta));
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
