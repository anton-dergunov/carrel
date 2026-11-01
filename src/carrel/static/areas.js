// Areas: the library by its topic folders. On a wide pane the tree sits beside the area's page;
// on a narrow one the page alone, entered from the maps, with a breadcrumb back up (CSS decides,
// by the pane's width).
//
// An area's page: its scope, the map of its subtopics, its review's card, a histogram of the
// years its papers were published (a tap narrows the rows to a year), then the rows, which
// papers.js fills. While a search narrows it, the subtopics are bars of what matches instead.
// The library's own page is the map of the top-level areas, every area as bars, and the reviews.

import { ancestry, areaCounts, inArea, reviewFor, reviewsInside, shortDate, topicTree, yearCounts } from './library.js';
import { layoutToFit, layoutTreemap, mapNodes } from './treemap.js';
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

  const map = query || searching ? null : areaMap(doc, area);
  if (!area && map) {
    parts.push(map);
    // Every area, as bars: the list of the library, sorted, the ones the map merged too.
    const largest = childrenOf(doc, '').sort((a, b) => b.total - a.total);
    const every = subtopicBars(largest, doc.papers, '', doc, 'Every area');
    parts.push(every, reviewShelf(doc.reviews, 'Reviews'));
    page.replaceChildren(...parts);
    return null;
  }

  if (map) parts.push(map);
  if (area) parts.push(reviewCard(area, doc.reviews));
  const children = childrenOf(doc, area);
  if (children.length && !searching && !map) parts.push(subtopicBars(children, inHere, area, doc));
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


// The area map: the library's areas, or an area's subtopics, as a treemap two levels deep, laid
// out by treemap.js. Every tile names its topic and its count, or is merged into "+N more":
// inside a tile, that tile's rest, which enters its area, whose own map names them; at the map's
// own level, a card that lists them (moreCard). The library's map fills the pane under it; an
// area's is as short as it can be while naming all it can.

const AREA_MAP = { min: 140, max: 640, share: 0.62 };
const LIBRARY_MAP = { min: 340, margin: 16 };

const widths = new Map();
let canvas = null;
let family = null;

/** A text's width in the page's reading font, as the labels are drawn. */
function measure(text, size, weight) {
  const key = `${weight} ${size} ${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    canvas ??= document.createElement('canvas').getContext('2d');
    family ??= getComputedStyle(document.documentElement).getPropertyValue('--reading').trim() || 'serif';
    canvas.font = `${weight} ${size}px ${family}`;
    width = canvas.measureText(text).width;
    widths.set(key, width);
  }
  return width;
}

const held = new WeakMap(); // a "+N more" tile at the map's own level → what it holds

/** The map of `area` ('' for the library), or null when it has no subtopics. */
function areaMap(doc, area) {
  const nodes = mapNodes(doc.topics, area, areaName);
  if (!nodes.some((node) => !node.own)) return null;
  const box = element('div', area ? 'treemap area-map' : 'treemap');
  box.setAttribute('role', 'list');
  box.setAttribute('aria-label', area ? `${areaName(area)} by subtopic` : 'The library by area');
  const hue = hues(doc);
  let drawnWidth = 0;
  let drawnHeight = 0;
  let drawnScale = 0;
  const draw = () => {
    if (!box.isConnected) {
      document.removeEventListener('carrel:look', draw);
      return observer.disconnect();
    }
    const width = box.clientWidth;
    if (!width) return;
    const height = area ? 0 : libraryHeight(box, width);
    // The labels are laid out for the library's text size (boot.js).
    const scale = window.carrelLook?.scale('library') ?? 1;
    if (width === drawnWidth && height === drawnHeight && scale === drawnScale) return;
    // The keyboard takes from the pane while the search box has it: the map stays as it was.
    if (width === drawnWidth && scale === drawnScale && document.activeElement?.matches('input, textarea')) return;
    drawnWidth = width;
    drawnHeight = height;
    drawnScale = scale;
    const laid = area
      ? layoutToFit(nodes, width, { min: AREA_MAP.min, max: Math.round(Math.min(AREA_MAP.max, width * AREA_MAP.share)), measure, scale })
      : { ...layoutTreemap(nodes, { x: 0, y: 0, width, height }, { measure, more: 'areas', scale }), height };
    box.style.height = `${laid.height}px`;
    // What the map names, for scripts/shots.py.
    Object.assign(box.dataset, { named: `${laid.named}/${laid.of}`, inner: `${laid.inner}/${laid.innerOf}`, smallest: String(laid.smallest ?? '') });
    box.replaceChildren(...laid.tiles.flatMap((tile) => [drawTile(tile, area, hue, true), ...tile.children.map((child) => drawTile(child, tile.item.path, hue, false))]));
  };
  const observer = new ResizeObserver(draw);
  observer.observe(box);
  if (!area) observer.observe(document.getElementById('papers-pane'));
  document.addEventListener('carrel:look', draw);
  requestAnimationFrame(draw);
  return box;
}

/** The library's map: as tall as the pane leaves under it, between 340 px and as tall as wide. */
function libraryHeight(box, width) {
  const pane = box.closest('#papers-pane');
  if (!pane) return Math.round(width * AREA_MAP.share);
  const top = box.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  return Math.round(Math.max(LIBRARY_MAP.min, Math.min(width, pane.clientHeight - top - LIBRARY_MAP.margin)));
}

/** A tile: a link to its topic; its rest, merged, a link into `parent` or (at the top) the card's. */
function drawTile(tile, parent, hue, top) {
  const { item } = tile;
  let node;
  if (item.own) {
    // The papers filed in the topic itself: on its own page they are the rows below.
    node = top ? element('div', 'tile own') : areaLink(item.path, 'tile own', '');
  } else if (item.merged) {
    node = areaLink(parent, 'tile more', '');
    if (top) {
      delete node.dataset.area;
      node.dataset.more = '';
      node.setAttribute('aria-haspopup', 'dialog');
      held.set(node, { members: item.members, area: parent, hue });
    }
  } else {
    node = areaLink(item.path, 'tile', '');
  }
  if (!top) node.classList.add('sub');
  place(node, tile);
  node.setAttribute('role', 'listitem');
  const path = item.merged ? parent : item.path;
  node.style.setProperty('--hue', path ? `var(--area-${hueOf(path, hue)})` : 'var(--muted)');
  node.title = tileTitle(item);
  if (tile.label) node.append(drawLabel(tile.label));
  return node;
}

function tileTitle(item) {
  if (item.merged) return item.members.map((member) => `${member.name}: ${number.format(member.value)}`).join('\n');
  if (item.own) return `Filed in ${areaName(item.path)} itself: ${plural(item.value, 'paper')}`;
  return `${item.name}: ${plural(item.value, 'paper')}`;
}

function place(node, rect) {
  Object.assign(node.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  return node;
}

function drawLabel(fitted) {
  const { name, count } = fitted.said;
  const box = element('span', fitted.below ? 'label count-below' : 'label');
  box.style.fontSize = `${fitted.size}px`;
  box.append(element('span', 'name', name));
  const tally = box.appendChild(element('span', 'count', count));
  tally.style.fontSize = `${fitted.countSize}px`;
  return box;
}

/**
 * The card that a "+N more" tile at a map's own level opens: what it holds, largest first, each
 * a row with a bar and a link to its page. Null for any other element.
 */
export function moreCard(tile) {
  const what = held.get(tile);
  if (!what) return null;
  const { members, area, hue } = what;
  const most = Math.max(1, ...members.map((member) => member.value));
  const rows = members.map((member) => {
    const row = member.own ? element('div', 'bar-row') : areaLink(member.path, 'bar-row', '');
    row.append(element('span', 'name', member.name));
    const track = row.appendChild(element('span', 'track'));
    const bar = track.appendChild(element('span', 'bar-fill'));
    bar.style.width = `${(member.value / most) * 100}%`;
    bar.style.setProperty('--hue', `var(--area-${hueOf(member.path, hue)})`);
    row.append(element('span', 'count', number.format(member.value)));
    return row;
  });
  const title = area ? `${plural(members.length, 'more subtopic')} in ${areaName(area)}` : plural(members.length, 'more area');
  return [element('div', 'sheet-header', title), ...rows];
}
