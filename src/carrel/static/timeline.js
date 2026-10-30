// Timeline: the papers by the year they were published, a dot each, coloured by top-level area,
// so the shape of the library over time shows at a glance. By the date added it is a diary of
// what the reader collected, month by month. A tap on a year lists that year's papers (All,
// with the years chip set); a year of three papers or fewer names them.

import { areaName, hueOf, hues, plural } from './areas.js';
import { monthName } from './library.js';
import { element, paperRow } from './rows.js';

const NAMED = 3;
const number = new Intl.NumberFormat('en');

/** The papers in rows, newest first: [{key, label, papers}], by year published or month added. */
export function timelineRows(papers, mode = 'published') {
  const rows = new Map();
  for (const paper of papers) {
    let key = mode === 'added' ? String(paper.added ?? '').slice(0, 7) : paper.year;
    if (!key) key = '';
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(paper);
  }
  return [...rows]
    .sort(([a], [b]) => (!a ? 1 : !b ? -1 : b.localeCompare(a)))
    .map(([key, list]) => ({ key, label: !key ? 'Undated' : mode === 'added' ? monthName(key) : key, papers: list }));
}

/** Draws the timeline of `papers` into `container`. */
export function drawTimeline(container, doc, papers, { mode }) {
  const hue = hues(doc);
  const order = new Map(doc.topics.filter((topic) => !topic.path.includes('/')).map((topic, i) => [topic.path, i]));
  const top = (paper) => paper.topic.split('/')[0];

  const head = element('div', 'timeline-head');
  const control = head.appendChild(element('div', 'segmented small'));
  control.setAttribute('role', 'radiogroup');
  control.setAttribute('aria-label', 'Arrange by');
  for (const [value, text] of [
    ['published', 'Published'],
    ['added', 'Added'],
  ]) {
    const button = control.appendChild(element('button', '', text));
    button.type = 'button';
    button.dataset.timeline = value;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(mode === value));
  }
  // The legend: each top-level area that has papers here, with its count.
  const legend = head.appendChild(element('div', 'legend'));
  const counts = new Map();
  for (const paper of papers) counts.set(top(paper), (counts.get(top(paper)) ?? 0) + 1);
  for (const [area, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const item = legend.appendChild(element('a', 'legend-item'));
    item.href = `/area/${area}`;
    item.dataset.area = area;
    item.append(element('span', `dot hue-${hueOf(area, hue)}`), element('span', 'name', areaName(area)), element('span', 'count', number.format(count)));
  }

  const rows = element('div', 'timeline');
  for (const row of timelineRows(papers, mode)) {
    const line = rows.appendChild(element('div', 'tl-row'));
    const label = line.appendChild(element(mode === 'published' && row.key ? 'button' : 'span', 'tl-label', row.label));
    if (label.tagName === 'BUTTON') {
      label.type = 'button';
      label.dataset.listYear = row.key;
      label.title = `List the papers of ${row.key}`;
    }
    const dots = line.appendChild(element('span', 'dots'));
    dots.setAttribute('role', 'img');
    dots.setAttribute('aria-label', `${row.label}: ${plural(row.papers.length, 'paper')}`);
    const sorted = [...row.papers].sort((a, b) => (order.get(top(a)) ?? 99) - (order.get(top(b)) ?? 99));
    for (const paper of sorted) dots.append(element('span', `dot hue-${hueOf(paper.topic, hue)}`));
    line.append(element('span', 'count', number.format(row.papers.length)));
    if (row.papers.length <= NAMED) {
      const named = line.appendChild(element('div', 'named'));
      for (const paper of row.papers) named.append(paperRow(paper, { topic: true }));
    }
  }
  if (!papers.length) rows.append(element('p', 'list-note', 'No papers match.'));
  container.replaceChildren(head, rows);
}
