// Areas: the library by its topic folders. On a wide pane the tree sits beside the area's page;
// on a narrow one the page alone, entered from the treemap and the subtopics' bars, with a
// breadcrumb back up (CSS decides, by the pane's width).
//
// An area's page: its scope, its review's card, its subtopics as count bars, a histogram of
// the years its papers were published (a tap narrows the rows to a year), then the rows, which
// papers.js fills. The library's own page is a treemap of the top-level areas and the reviews.

import { ancestry, areaCounts, inArea, reviewFor, reviewsInside, shortDate, topicTree, yearCounts } from './library.js';
import { keepLargest, squarify } from './treemap.js';
import { element, icon } from './rows.js';
import { areaUrl, reviewUrl } from './tabs.js';

const AREA_HUES = 12;
const number = new Intl.NumberFormat('en');

/** A folder's name as the views show it: "search-and-ranking" → "search and ranking". */
export function areaName(path) {
  return path ? path.split('/').at(-1).replaceAll('-', ' ') : 'Library';
}

export function plural(count, one, many = `${one}s`) {
  return `${number.format(count)} ${count === 1 ? one : many}`;
}

/** Each top-level area's hue, by its place in the topic file. */
export function hues(doc) {
  const tops = doc.topics.filter((topic) => !topic.path.includes('/'));
  return new Map(tops.map((topic, i) => [topic.path, (i % AREA_HUES) + 1]));
}

export function hueOf(path, map) {
  return map.get(path.split('/')[0]) ?? 1;
}

function areaLink(path, className, label) {
  const link = element('a', className, label ?? areaName(path));
  link.href = areaUrl(path);
  link.dataset.area = path;
  return link;
}

// The tree.

/**
 * The topic tree into `nav`: each folder with its count (the matches of a search, when `counts`
 * is given), the ones on the way to `area` open, `expanded` the ones the reader opened.
 */
export function drawTree(nav, doc, { area, counts = null, expanded }) {
  const open = new Set([...ancestry(area), ...expanded]);
  const hue = hues(doc);
  const list = (nodes, depth) => {
    const ul = element('ul');
    for (const node of nodes) {
      if (counts && !node.total && node.path !== area) continue;
      const li = ul.appendChild(element('li'));
      const row = li.appendChild(element('div', 'tree-row'));
      row.style.setProperty('--depth', String(depth));
      if (node.path === area) row.classList.add('current');
      if (node.children.length) {
        const toggle = row.appendChild(element('button', 'chevron'));
        toggle.type = 'button';
        toggle.dataset.toggle = node.path;
        const isOpen = open.has(node.path);
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', `${isOpen ? 'Close' : 'Open'} ${areaName(node.path)}`);
        toggle.append(icon('chevron-right'));
      } else {
        row.append(element('span', 'chevron-space'));
      }
      const link = row.appendChild(areaLink(node.path, 'name'));
      if (depth === 0) link.style.setProperty('--hue', `var(--area-${hueOf(node.path, hue)})`);
      row.append(element('span', 'count', number.format(node.total)));
      if (node.children.length && open.has(node.path)) li.append(list(node.children, depth + 1));
    }
    return ul;
  };
  const top = element('div', 'tree-row tree-root');
  if (!area) top.classList.add('current');
  top.append(element('span', 'chevron-space'), areaLink('', 'name', 'All areas'));
  top.append(element('span', 'count', number.format(counts ? sum(counts, doc) : doc.papers.length)));
  nav.replaceChildren(top, list(topicTree(doc.topics, counts), 0));
}

function sum(counts, doc) {
  return doc.topics.filter((topic) => !topic.path.includes('/')).reduce((total, topic) => total + (counts.get(topic.path) ?? 0), 0);
}

// An area's page.

/**
 * Draws an area's page into `page`, for the papers of the area that match (`matches`). Returns
 * the element papers.js fills with the rows (or a text search's results).
 */
export function drawAreaPage(page, doc, { area, matches, query, year, searching }) {
  const topic = doc.topics.find((each) => each.path === area);
  const inHere = matches.filter((paper) => inArea(paper, area));
  const total = area ? (topic?.total ?? 0) : doc.papers.length;
  const parts = [breadcrumb(area)];

  const head = element('header', 'area-head');
  head.append(element('h2', 'area-title', areaName(area)));
  const counted = query ? `${number.format(inHere.length)} of ${plural(total, 'paper')} match` : plural(total, 'paper');
  head.append(element('span', 'area-count', counted));
  parts.push(head);
  if (topic?.scope) parts.push(element('p', 'lede', topic.scope));

  if (!area && !query && !searching) {
    parts.push(treemap(doc));
    // Every area, as bars: the ones too small to name in the treemap are here too.
    const largest = childrenOf(doc, '').sort((a, b) => b.total - a.total);
    const every = subtopicBars(largest, doc.papers, '', doc, 'Every area');
    every.id = 'all-areas';
    parts.push(every, reviewShelf(doc.reviews, 'Reviews'));
    page.replaceChildren(...parts);
    return null;
  }

  if (area) parts.push(reviewCard(area, doc.reviews));
  const children = childrenOf(doc, area);
  if (children.length && !searching) parts.push(subtopicBars(children, inHere, area, doc));
  const years = yearCounts(inHere);
  if (years.length > 1 && !searching) parts.push(histogram(years, year, area ? `var(--area-${hueOf(area, hues(doc))})` : 'var(--muted)'));
  const rows = element('div', 'rows-slot');
  parts.push(rows);
  page.replaceChildren(...parts);
  return rows;
}

function childrenOf(doc, area) {
  const depth = area ? area.split('/').length + 1 : 1;
  return doc.topics.filter((topic) => topic.path.split('/').length === depth && (!area || topic.path.startsWith(`${area}/`)));
}

function breadcrumb(area) {
  const nav = element('nav', 'breadcrumb');
  nav.setAttribute('aria-label', 'Where this area is');
  nav.append(areaLink('', 'crumb', 'Library'));
  for (const path of ancestry(area).slice(0, -1)) {
    nav.append(icon('chevron-right', 'icon sep'), areaLink(path, 'crumb'));
  }
  if (!area) nav.hidden = true;
  return nav;
}

/** The area's review: its own, else the one above that covers it, and those inside it. */
function reviewCard(area, reviews) {
  const box = element('div', 'reviews');
  const review = reviewFor(area, reviews);
  if (review && review.scope === area) {
    box.append(card(review));
  } else if (review) {
    const covered = element('a', 'review-covered');
    covered.href = reviewUrl(review.scope);
    covered.dataset.review = review.scope;
    covered.dataset.title = review.title;
    covered.append(icon('book-open-text'), element('span', '', `Covered by the review of ${review.scope}`), element('span', 'read', 'Read →'));
    box.append(covered);
  } else {
    box.append(element('p', 'review-none', 'No review of this area yet.'));
  }
  const inside = reviewsInside(area, reviews);
  if (inside.length) box.append(reviewShelf(inside, 'Reviews inside'));
  return box;
}

function card(review) {
  const link = element('a', 'review-card');
  link.href = reviewUrl(review.scope);
  link.dataset.review = review.scope;
  link.dataset.title = review.title;
  const kicker = link.appendChild(element('span', 'kicker'));
  kicker.append(icon('book-open-text'), element('span', '', ['Review', review.updated && `updated ${shortDate(review.updated)}`, `cites ${review.cites}`].filter(Boolean).join(' · ')));
  link.append(element('span', 'review-title', review.title));
  if (review.abstract) link.append(element('span', 'abstract', review.abstract));
  link.append(element('span', 'read', 'Read →'));
  return link;
}

function reviewShelf(reviews, title) {
  const section = element('section', 'review-shelf');
  section.append(element('h3', 'section-title', title));
  const grid = section.appendChild(element('div', 'shelf'));
  for (const review of reviews) {
    const link = grid.appendChild(element('a', 'review-chip'));
    link.href = reviewUrl(review.scope);
    link.dataset.review = review.scope;
    link.dataset.title = review.title;
    link.append(element('span', 'review-title', review.title), element('span', 'meta', `${review.scope} · ${review.cites} papers`));
  }
  return section;
}

/** The subtopics, each a bar as long as its share of the largest. */
function subtopicBars(children, papers, area, doc, title = 'Subtopics') {
  const counts = areaCounts(papers);
  const hue = hues(doc);
  const rows = children.map((topic) => ({ topic, count: counts.get(topic.path) ?? 0 }));
  const most = Math.max(1, ...rows.map((row) => row.count));
  const section = element('section', 'subtopics');
  section.append(element('h3', 'section-title', title));
  for (const { topic, count } of rows) {
    const link = section.appendChild(areaLink(topic.path, 'bar-row'));
    link.textContent = '';
    link.title = topic.scope;
    if (!count) link.classList.add('empty');
    link.append(element('span', 'name', areaName(topic.path)));
    const track = link.appendChild(element('span', 'track'));
    const bar = track.appendChild(element('span', 'bar-fill'));
    bar.style.width = `${(count / most) * 100}%`;
    bar.style.setProperty('--hue', `var(--area-${hueOf(topic.path, hue)})`);
    link.append(element('span', 'count', number.format(count)));
  }
  if (!area) section.classList.add('top');
  return section;
}

/** The years published, a bar each; a tap narrows the rows to that year, a second tap widens them. */
function histogram(years, chosen, hue) {
  const section = element('section', 'years');
  const heading = section.appendChild(element('h3', 'section-title'));
  heading.append(element('span', '', 'Published'));
  if (chosen) {
    const clear = heading.appendChild(element('button', 'plain', `${chosen} · show every year`));
    clear.type = 'button';
    clear.dataset.year = String(chosen);
  }
  const most = Math.max(...years.map((each) => each.count));
  const bars = section.appendChild(element('div', 'histogram'));
  bars.style.setProperty('--hue', hue);
  bars.style.gridTemplateColumns = `repeat(${years.length}, minmax(0, 1fr))`;
  // A label under every year when there are few, else under every fifth.
  const every = years.length <= 12 ? 1 : 5;
  for (const { year, count } of years) {
    const bar = bars.appendChild(element('button', 'year-bar'));
    bar.type = 'button';
    bar.dataset.year = String(year);
    bar.disabled = !count;
    bar.title = `${year}: ${plural(count, 'paper')}`;
    bar.setAttribute('aria-label', bar.title);
    bar.setAttribute('aria-pressed', String(year === chosen));
    const fill = bar.appendChild(element('span', 'fill'));
    fill.style.height = count ? `${Math.max(4, (count / most) * 100)}%` : '0';
    if (count) fill.append(element('span', 'value', String(count)));
    const label = bar.appendChild(element('span', 'tick', year % every === 0 || years.length <= 12 ? String(year) : ''));
    label.setAttribute('aria-hidden', 'true');
  }
  return section;
}

// The treemap of the whole library.
//
// Every tile names its area and its count, or is merged: an area's subtopics too small for a
// label become one "+N more" tile, which opens the area's page (its subtopic bars list them),
// and the smallest areas one "+N more areas" tile, which goes to the list of every area under
// the treemap. A label is measured before it is drawn (fitLabel), so it is never cut.

const GUTTER = 3;
const PAD = { x: 8, y: 5 }; // a label's padding inside its tile
const SUB_PAD = { x: 6, y: 4 };

function treemap(doc) {
  const box = element('div', 'treemap');
  box.setAttribute('role', 'list');
  box.setAttribute('aria-label', 'The library by area');
  const hue = hues(doc);
  const nodes = topicTree(doc.topics).map((node) => ({
    value: node.total,
    path: node.path,
    children: node.children.map((child) => ({ value: child.total, path: child.path })),
  }));
  let width = 0;
  const draw = () => {
    const now = box.clientWidth;
    if (!now || now === width) return;
    width = now;
    const height = Math.round(Math.min(640, Math.max(340, now * 0.62)));
    box.style.height = `${height}px`;
    const drawn = [];
    for (const tile of layoutTreemap(nodes, { x: 0, y: 0, width: now, height })) {
      const area = tile.item.merged ? '' : tile.item.path;
      const link = place(areaLink(area, 'tile', ''), tile);
      link.setAttribute('role', 'listitem');
      if (tile.item.merged) {
        // The areas too small to name: the list of every area, under the treemap.
        link.classList.add('more');
        link.href = '#all-areas';
        delete link.dataset.area;
        link.dataset.scroll = 'all-areas';
      }
      link.style.setProperty('--hue', tile.item.merged ? 'var(--muted)' : `var(--area-${hueOf(area, hue)})`);
      link.title = tileTitle(tile.item);
      if (tile.label) link.append(drawLabel(tile.item, tile.label));
      drawn.push(link);
      for (const child of tile.children) {
        // A merged subtopic tile opens its area's page, where the bars name them all.
        const sub = place(areaLink(child.item.merged ? tile.item.path : child.item.path, 'tile sub', ''), child);
        if (child.item.merged) sub.classList.add('more');
        sub.style.setProperty('--hue', `var(--area-${hueOf(tile.item.path, hue)})`);
        sub.title = tileTitle(child.item);
        if (child.label) sub.append(drawLabel(child.item, child.label));
        drawn.push(sub);
      }
    }
    box.replaceChildren(...drawn);
  };
  new ResizeObserver(draw).observe(box);
  requestAnimationFrame(draw);
  return box;
}

// The rest, merged: laid out last, in the corner where the smallest tiles are.
const merge = (members) => ({ merged: true, last: true, members, value: members.reduce((sum, item) => sum + item.value, 0), children: [] });

/** What a tile says: its name, or for a merged one "+N more", then the count. */
function tileText(item, top) {
  if (!item.merged) return { name: areaName(item.path), count: number.format(item.value) };
  return { name: `+${item.members.length} more${top ? ' areas' : ''}`, count: number.format(item.value) };
}

function tileTitle(item) {
  if (!item.merged) return `${areaName(item.path)}: ${plural(item.value, 'paper')}`;
  return item.members.map((member) => `${areaName(member.path)}: ${number.format(member.value)}`).join('\n');
}

/**
 * The tiles to draw: the top-level areas, each with its label and, inside a tile large enough,
 * its subtopics below the label. Tiles that cannot hold a label are merged, at each level.
 */
function layoutTreemap(nodes, rect) {
  const half = GUTTER / 2;
  const inset = (tile) => ({ ...tile, x: tile.x + half, y: tile.y + half, width: Math.max(0, tile.width - GUTTER), height: Math.max(0, tile.height - GUTTER) });
  const topLabel = (tile, height = tile.height) => fitLabel(tileText(tile.item, true), tile.width - 2 * PAD.x, height - 2 * PAD.y, TOP_TEXT);
  const { tiles: tops } = keepLargest(nodes, (items) => squarify(items, rect).map(inset), (tile) => topLabel(tile) !== null, merge);
  return tops.map((tile) => {
    const children = tile.item.children ?? [];
    if (children.length < 2 || tile.width < 110 || tile.height < 90) return { ...tile, label: topLabel(tile), children: [] };
    // The header takes what its label needs, at most a third of the tile.
    const label = topLabel(tile, Math.max(30, tile.height / 3));
    if (!label) return { ...tile, label: topLabel(tile), children: [] };
    const header = label.height + 2 * PAD.y;
    const area = { x: tile.x + half, y: tile.y + header, width: tile.width - GUTTER, height: tile.height - header - half };
    const subLabel = (child) => fitLabel(tileText(child.item, false), child.width - 2 * SUB_PAD.x, child.height - 2 * SUB_PAD.y, SUB_TEXT);
    const { tiles: laid, kept } = keepLargest(children, (items) => squarify(items, area).map(inset), (child) => subLabel(child) !== null, merge);
    // Not even one subtopic can be named: the tile shows its own label alone.
    if (!kept) return { ...tile, label: topLabel(tile), children: [] };
    return { ...tile, label, children: laid.map((child) => ({ ...child, label: subLabel(child) })) };
  });
}

function place(element, rect) {
  Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  return element;
}

// Labels are measured with the page's own font: the name wraps between words, never inside one,
// at the largest size from the text's own down to 11 px at which it fits; the count follows on
// the name's last line when there is room, else on a line of its own. A label that does not fit
// at 11 px is not drawn, and its tile is merged.
const TOP_TEXT = { size: 15, weight: 600, count: 12 };
const SUB_TEXT = { size: 13.5, weight: 400, count: 11.5 };
const SMALLEST_TEXT = 11;
const LINE = 1.2;
const MOST_LINES = 3;
const SAFETY = 4; // px: the canvas measures a little narrower than WebKit draws
let measure = null;
let family = null;

function textWidth(text, size, weight) {
  measure ??= document.createElement('canvas').getContext('2d');
  family ??= getComputedStyle(document.documentElement).getPropertyValue('--reading').trim() || 'serif';
  measure.font = `${weight} ${size}px ${family}`;
  return measure.measureText(text).width;
}

/** The lines `words` wrap into at `width` px, or null when a word alone is wider. */
function wrap(words, width, size, weight) {
  const lines = [];
  let line = '';
  for (const word of words) {
    if (textWidth(word, size, weight) > width) return null;
    const longer = line ? `${line} ${word}` : word;
    if (line && textWidth(longer, size, weight) > width) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  lines.push(line);
  return lines;
}

/** How a label of {name, count} fits in `width` × `height` px: {size, countSize, below, height, said}, or null. */
function fitLabel({ name, count }, width, height, text) {
  const said = { name, count };
  width -= SAFETY;
  if (width <= 0 || height <= 0) return null;
  for (let size = text.size; size >= SMALLEST_TEXT; size -= 0.5) {
    const countSize = Math.min(text.count, size);
    const lines = wrap(name.split(' '), width, size, text.weight);
    if (!lines || lines.length > MOST_LINES) continue;
    const countWidth = textWidth(count, countSize, 400) + 6;
    const below = textWidth(lines.at(-1), size, text.weight) + countWidth > width;
    const needed = lines.length * size * LINE + (below ? countSize * LINE : 0);
    if (needed <= height) return { size, countSize, below, height: needed, said };
  }
  return null;
}

function drawLabel(item, fitted) {
  const { name, count } = fitted.said;
  const box = element('span', fitted.below ? 'label count-below' : 'label');
  box.style.fontSize = `${fitted.size}px`;
  box.append(element('span', 'name', name));
  const tally = box.appendChild(element('span', 'count', count));
  tally.style.fontSize = `${fitted.countSize}px`;
  return box;
}
