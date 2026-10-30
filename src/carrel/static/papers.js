// The library, on its own tab: one search box, and the views it narrows.
//
// - Desk: what to continue, what came in lately, and the reviews' progress (desk.js).
// - Areas: the topic tree and an area's page (areas.js); the library's own page is a treemap.
// - All: every paper, with filter chips (area, type, years, touched).
// - Timeline: the papers by year published, or by month added, a dot each (timeline.js).
//
// The box searches at two depths: Titles narrows the rows on the device, by every word, in the
// title, the authors, the summary, the topic and the type; Text searches the papers' text on the
// laptop (text-search.js). Rows are compact or rich, sorted by topic, date added or published.
// Each device remembers its view, area, rows, sort, chips and depth.

import { drawAreaPage, drawTree, plural } from './areas.js';
import { drawDesk } from './desk.js';
import { startAdding } from './library-edits.js';
import { drawTimeline } from './timeline.js';
import {
  TOUCHED,
  TYPES,
  TYPE_ICONS,
  ancestry,
  areaCounts,
  chipsOn,
  filterPapers,
  groupOf,
  inArea,
  loadLibrary,
  loadLibraryState,
  saveLibraryState,
  sortPapers,
  topicTree,
  yearCounts,
} from './library.js';
import { element, groupHeading, icon, paperRow } from './rows.js';
import { areaUrl } from './tabs.js';
import { startTextSearch } from './text-search.js';

const TYPING_MS = 120;
const number = new Intl.NumberFormat('en');
const TOUCHED_LABELS = { overview: ['notebook-text', 'Has your overview note'], review: ['book-open-text', 'Cited in a review'], chat: ['chat', 'Asked about in carrel'] };

/**
 * `openPaper({pdf, title}, target)` and `openReview(scope, title)` open a tab; `openTarget({file,
 * page, search})` opens a paper at a place; `onAddress()` says the library's address changed (an
 * area entered); `tabs()` gives the device's open tabs, for the desk. Returns `showArea(area)`,
 * `address()` and `reload()`.
 */
export function startLibrary({ openPaper, openReview, openTarget, onAddress = () => {}, tabs = () => [] }) {
  const pane = document.getElementById('papers-pane');
  const filter = document.getElementById('filter');
  const depthControl = document.getElementById('depth');
  const viewControl = document.getElementById('views');
  const countLabel = document.getElementById('library-count');
  const optionsButton = document.getElementById('library-options');
  const optionsSheet = document.getElementById('options-sheet');
  const chipsBar = document.getElementById('chips');
  const chipSheet = document.getElementById('chip-sheet');
  const areasView = document.getElementById('areas-view');
  const tree = document.getElementById('area-tree');
  const areaPage = document.getElementById('area-page');
  const allView = document.getElementById('all-view');
  const deskView = document.getElementById('desk-view');
  const timelineView = document.getElementById('timeline-view');
  const views = { desk: deskView, areas: areasView, all: allView, timeline: timelineView };

  let doc = null;
  let state = loadLibraryState();
  let year = null; // the year an area's histogram narrows the rows to
  const expanded = new Set(); // the tree's folders the reader opened
  const rows = new Map(); // rows made, by paper and look, used again at each draw
  const text = startTextSearch({ openTarget });
  let chats = { at: 0, list: [] }; // carrel's recent chats, for the desk

  function save() {
    saveLibraryState(state);
  }

  // Drawing.

  function render() {
    viewControl.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.view === state.view)));
    depthControl.querySelectorAll('[data-depth]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.depth === state.depth)));
    filter.placeholder = state.depth === 'text' ? "Search the papers' text" : 'Search titles, authors, summaries';
    pane.dataset.view = state.view;
    for (const [name, view] of Object.entries(views)) view.hidden = name !== state.view;
    chipsBar.hidden = state.view !== 'all';
    if (!doc) return;
    if (state.view === 'all') drawAll();
    else if (state.view === 'areas') drawAreas();
    else if (state.view === 'timeline') drawTimelineView();
    else drawDeskView();
  }

  /** The desk; with words in the box, the papers that match, as All lists them. */
  function drawDeskView() {
    if (searchingText()) {
      countLabel.textContent = '';
      text.search(deskView, filter.value, '', lookup(doc.papers), { rich: state.density === 'rich' });
      return;
    }
    text.stop();
    if (titleQuery().trim()) {
      const matches = filterPapers(doc.papers, titleQuery());
      countLabel.textContent = `${number.format(matches.length)} of ${plural(doc.papers.length, 'paper')}`;
      fillRows(deskView, matches, { topic: state.sort !== 'topic' });
      return;
    }
    countLabel.textContent = '';
    drawDesk(deskView, doc, { tabs: tabs(), chats: chats.list, today: localDate() });
    if (Date.now() - chats.at > 60_000) void fetchChats();
  }

  async function fetchChats() {
    chats.at = Date.now();
    const response = await fetch('/api/chats').catch(() => null);
    const list = response?.ok ? await response.json().catch(() => null) : null;
    if (!Array.isArray(list)) return;
    chats = { at: Date.now(), list };
    if (state.view === 'desk' && !filter.value.trim()) drawDesk(deskView, doc, { tabs: tabs(), chats: chats.list, today: localDate() });
  }

  function drawTimelineView() {
    if (searchingText()) {
      countLabel.textContent = '';
      text.search(timelineView, filter.value, '', lookup(doc.papers), { rich: state.density === 'rich' });
      return;
    }
    text.stop();
    const matches = filterPapers(doc.papers, titleQuery());
    const narrowed = matches.length !== doc.papers.length;
    countLabel.textContent = narrowed ? `${number.format(matches.length)} of ${plural(doc.papers.length, 'paper')}` : plural(doc.papers.length, 'paper');
    drawTimeline(timelineView, doc, matches, { mode: state.timeline });
  }

  function localDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function searchingText() {
    return state.depth === 'text' && filter.value.trim().length > 0;
  }

  function titleQuery() {
    return state.depth === 'titles' ? filter.value : '';
  }

  function drawAll() {
    drawChips();
    const matches = filterPapers(doc.papers, titleQuery(), state.chips);
    if (searchingText()) {
      countLabel.textContent = '';
      text.search(allView, filter.value, '', lookup(matches), { rich: state.density === 'rich' });
      return;
    }
    text.stop();
    const narrowed = matches.length !== doc.papers.length;
    countLabel.textContent = narrowed ? `${number.format(matches.length)} of ${plural(doc.papers.length, 'paper')}` : plural(doc.papers.length, 'paper');
    fillRows(allView, matches, { topic: state.sort !== 'topic' });
  }

  function drawAreas() {
    let area = state.area;
    if (area && !doc.topics.some((topic) => topic.path === area)) area = state.area = '';
    const query = titleQuery();
    const matches = query ? filterPapers(doc.papers, query) : doc.papers;
    drawTree(tree, doc, { area, counts: query ? areaCounts(matches) : null, expanded });
    countLabel.textContent = '';
    const slot = drawAreaPage(areaPage, doc, { area, matches, query, year, searching: searchingText() });
    if (!slot) {
      text.stop();
      return;
    }
    if (searchingText()) {
      text.search(slot, filter.value, area, lookup(doc.papers), { rich: state.density === 'rich' });
      return;
    }
    text.stop();
    let papers = matches.filter((paper) => inArea(paper, area));
    if (year) papers = papers.filter((paper) => Number(paper.year) === year);
    fillRows(slot, papers, { topic: false, under: area });
  }

  /** A text search's paper as the library has it, when it is among `allowed`. */
  function lookup(allowed) {
    const set = new Set(allowed);
    return (found) => {
      const entry = doc.byText.get(found.text);
      return entry && set.has(entry) ? entry : null;
    };
  }

  /** The rows of `papers`, sorted and under their headings, into `slot`. */
  function fillRows(slot, papers, { topic, under = '' }) {
    const sorted = sortPapers(papers, state.sort);
    const rich = state.density === 'rich';
    const date = state.sort === 'added' ? 'added' : 'published';
    const parts = [];
    let group = null;
    const groups = new Map();
    for (const paper of sorted) {
      const name = groupName(paper, under);
      groups.set(name, (groups.get(name) ?? 0) + 1);
    }
    const headed = groups.size > 1 || state.sort !== 'topic';
    for (const paper of sorted) {
      const name = groupName(paper, under);
      if (headed && name !== group) {
        group = name;
        parts.push(groupHeading(name, groups.get(name)));
      }
      parts.push(row(paper, { rich, topic, date }));
    }
    if (!sorted.length) parts.push(element('p', 'list-note', emptyNote()));
    const list = element('div', `rows ${rich ? 'rich' : 'compact'}`);
    list.append(...parts);
    slot.replaceChildren(list);
  }

  function groupName(paper, under) {
    if (state.sort !== 'topic') return groupOf(paper, state.sort);
    if (!under) return paper.topic;
    return paper.topic === under ? under.split('/').at(-1).replaceAll('-', ' ') : paper.topic.slice(under.length + 1);
  }

  function emptyNote() {
    if (filter.value.trim()) return `No paper matches “${filter.value.trim()}”${chipsOn(state.chips) && state.view === 'all' ? ' with these filters' : ''}.`;
    if (year) return `No paper of ${year} here.`;
    return 'No papers here.';
  }

  function row(paper, look) {
    const key = `${paper.pdf}\n${look.rich}\n${look.topic}\n${look.date}`;
    let made = rows.get(key);
    if (!made) {
      made = paperRow(paper, look);
      rows.set(key, made);
    }
    return made;
  }

  // The chips of All.

  function drawChips() {
    const chips = state.chips;
    const parts = [
      chip('areas', 'Area', chips.areas.length ? listLabel(chips.areas) : null),
      chip('types', 'Type', chips.types.length ? listLabel(chips.types) : null),
      chip('years', 'Years', chips.from || chips.to ? `${chips.from ?? '…'}–${chips.to ?? '…'}` : null),
      chip('touched', 'Touched', chips.touched.length ? listLabel(chips.touched.map((mark) => ({ overview: 'overview', review: 'review', chat: 'chat' })[mark])) : null),
    ];
    if (chipsOn(chips)) {
      const clear = element('button', 'plain clear-chips', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        state.chips = { areas: [], types: [], from: null, to: null, touched: [] };
        save();
        render();
      });
      parts.push(clear);
    }
    chipsBar.replaceChildren(...parts);
  }

  function listLabel(items) {
    return items.length > 2 ? `${items[0]} +${items.length - 1}` : items.join(', ');
  }

  function chip(name, label, value) {
    const button = element('button', 'chip');
    button.type = 'button';
    button.dataset.chip = name;
    button.setAttribute('aria-pressed', String(Boolean(value)));
    button.setAttribute('aria-expanded', String(!chipSheet.hidden && chipSheet.dataset.chip === name));
    button.append(element('span', 'chip-label', value ? `${label}: ${value}` : label), icon('down', 'icon chevron'));
    return button;
  }

  function openChip(name, anchor) {
    if (!chipSheet.hidden && chipSheet.dataset.chip === name) return closeSheets();
    closeSheets();
    chipSheet.dataset.chip = name;
    const builders = { areas: areaChoices, types: typeChoices, years: yearChoices, touched: touchedChoices };
    chipSheet.replaceChildren(...builders[name]());
    showSheet(chipSheet, anchor);
    drawChips();
  }

  /** A choice in a chip's sheet: a row with a check that shows whether it is on. */
  function choice({ label, count, on, iconName = null, depth = 0, toggle }) {
    const button = element('button', 'choice');
    button.type = 'button';
    button.setAttribute('role', 'menuitemcheckbox');
    button.setAttribute('aria-checked', String(on));
    button.style.setProperty('--depth', String(depth));
    button.append(element('span', 'check', ''));
    if (iconName) button.append(icon(iconName));
    button.append(element('span', 'choice-label', label));
    if (count != null) button.append(element('span', 'count', number.format(count)));
    button.addEventListener('click', () => {
      toggle();
      button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
      save();
      render();
    });
    return button;
  }

  function toggleIn(list, item) {
    const at = list.indexOf(item);
    if (at < 0) list.push(item);
    else list.splice(at, 1);
  }

  function areaChoices() {
    const counts = areaCounts(doc.papers);
    const items = [];
    const walk = (nodes, depth) => {
      for (const node of nodes) {
        items.push(choice({ label: node.name.replaceAll('-', ' '), count: counts.get(node.path) ?? 0, on: state.chips.areas.includes(node.path), depth, toggle: () => toggleIn(state.chips.areas, node.path) }));
        if (depth < 1) walk(node.children, depth + 1);
      }
    };
    walk(topicTree(doc.topics), 0);
    return [element('div', 'sheet-header', 'Areas, and the folders in them'), scroller(items)];
  }

  function typeChoices() {
    const counts = new Map();
    for (const paper of doc.papers) counts.set(paper.type ?? 'none', (counts.get(paper.type ?? 'none') ?? 0) + 1);
    const items = TYPES.map((type) => choice({ label: type, count: counts.get(type) ?? 0, on: state.chips.types.includes(type), iconName: TYPE_ICONS[type], toggle: () => toggleIn(state.chips.types, type) }));
    if (counts.get('none')) items.push(choice({ label: 'no type yet', count: counts.get('none'), on: state.chips.types.includes('none'), toggle: () => toggleIn(state.chips.types, 'none') }));
    return [element('div', 'sheet-header', 'What kind of paper'), ...items];
  }

  function yearChoices() {
    const years = yearCounts(doc.papers).map((each) => each.year);
    const select = (end, label) => {
      const box = element('label', 'year-field');
      box.append(element('span', '', label));
      const field = box.appendChild(element('select'));
      field.append(new Option('Any', ''));
      for (const year of [...years].reverse()) field.append(new Option(String(year), String(year)));
      field.value = state.chips[end] ? String(state.chips[end]) : '';
      field.addEventListener('change', () => {
        state.chips[end] = field.value ? Number(field.value) : null;
        const { from, to } = state.chips;
        if (from && to && from > to) state.chips[end === 'from' ? 'to' : 'from'] = state.chips[end];
        save();
        render();
        chipSheet.replaceChildren(...yearChoices());
      });
      return box;
    };
    const fields = element('div', 'year-fields');
    fields.append(select('from', 'From'), select('to', 'To'));
    return [element('div', 'sheet-header', 'Published'), fields];
  }

  function touchedChoices() {
    const items = TOUCHED.map((mark) => {
      const [iconName, label] = TOUCHED_LABELS[mark];
      const count = doc.papers.filter((paper) => (mark === 'overview' ? paper.overview : mark === 'review' ? paper.reviews?.length : paper.chats)).length;
      return choice({ label, count, on: state.chips.touched.includes(mark), iconName, toggle: () => toggleIn(state.chips.touched, mark) });
    });
    return [element('div', 'sheet-header', 'Papers you have worked with'), ...items];
  }

  function scroller(items) {
    const box = element('div', 'choices-scroll');
    box.append(...items);
    return box;
  }

  // Sheets.

  function showSheet(sheet, anchor) {
    sheet.hidden = false;
    const box = anchor.getBoundingClientRect();
    const width = sheet.offsetWidth;
    sheet.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
    sheet.style.top = `${box.bottom + 6}px`;
    sheet.style.maxHeight = `${Math.max(160, window.innerHeight - box.bottom - 24)}px`;
  }

  function closeSheets() {
    const was = !chipSheet.hidden;
    chipSheet.hidden = true;
    optionsSheet.hidden = true;
    optionsButton.setAttribute('aria-expanded', 'false');
    if (was && doc && state.view === 'all') drawChips();
  }

  function drawOptions() {
    const segmented = (label, name, values) => {
      const group = element('div', 'option');
      group.append(element('span', 'option-label', label));
      const control = group.appendChild(element('div', 'segmented small'));
      control.setAttribute('role', 'radiogroup');
      control.setAttribute('aria-label', label);
      for (const [value, text] of values) {
        const button = control.appendChild(element('button', '', text));
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(state[name] === value));
        button.addEventListener('click', () => {
          state[name] = value;
          save();
          drawOptions();
          render();
        });
      }
      return group;
    };
    optionsSheet.replaceChildren(
      segmented('Sort by', 'sort', [
        ['topic', 'Topic'],
        ['added', 'Added'],
        ['published', 'Published'],
      ]),
      segmented('Rows', 'density', [
        ['compact', 'Compact'],
        ['rich', 'Rich'],
      ]),
    );
  }

  // Moving about.

  function showArea(area, { push = false } = {}) {
    const next = (area ?? '').replace(/^\/+|\/+$/g, '');
    if (next !== state.area) year = null;
    state.area = next;
    state.view = 'areas';
    save();
    render();
    areaPage.scrollIntoView?.({ block: 'start' });
    pane.scrollTop = 0;
    if (push) onAddress();
  }

  function address() {
    return state.view === 'areas' ? areaUrl(state.area) : '/';
  }

  // Events.

  let typing = 0;
  filter.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(render, state.depth === 'text' ? 0 : TYPING_MS);
  });
  filter.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') filter.blur();
  });

  depthControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-depth]');
    if (!button) return;
    state.depth = button.dataset.depth;
    save();
    render();
    filter.focus({ preventScroll: true });
  });

  viewControl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button || button.dataset.view === state.view) return;
    state.view = button.dataset.view;
    save();
    closeSheets();
    render();
    pane.scrollTop = 0;
    onAddress();
  });

  optionsButton.addEventListener('click', () => {
    if (!optionsSheet.hidden) return closeSheets();
    closeSheets();
    drawOptions();
    optionsButton.setAttribute('aria-expanded', 'true');
    showSheet(optionsSheet, optionsButton);
    optionsSheet.style.left = `${Math.max(8, optionsButton.getBoundingClientRect().right - optionsSheet.offsetWidth)}px`;
  });

  chipsBar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chip]');
    if (button) openChip(button.dataset.chip, button);
  });

  document.addEventListener('pointerdown', (event) => {
    if (chipSheet.hidden && optionsSheet.hidden) return;
    if (event.target.closest('#chip-sheet, #options-sheet, #chips [data-chip], #library-options')) return;
    closeSheets();
  });
  pane.addEventListener('scroll', () => {
    if (!chipSheet.hidden || !optionsSheet.hidden) closeSheets();
  }, { passive: true });

  pane.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const path = toggle.dataset.toggle;
      const open = toggle.getAttribute('aria-expanded') === 'true';
      if (open) {
        expanded.delete(path);
        // Closing a folder on the way to the area showing goes up to it.
        if (ancestry(state.area).includes(path) && state.area !== path) return showArea(path, { push: true });
      } else {
        expanded.add(path);
      }
      drawTree(tree, doc, { area: state.area, counts: titleQuery() ? areaCounts(filterPapers(doc.papers, titleQuery())) : null, expanded });
      return;
    }
    const mode = event.target.closest('[data-timeline]');
    if (mode) {
      state.timeline = mode.dataset.timeline;
      save();
      render();
      return;
    }
    const listYear = event.target.closest('[data-list-year]');
    if (listYear) {
      // A year of the timeline: its papers, in All.
      const year = Number(listYear.dataset.listYear);
      state.view = 'all';
      state.chips = { areas: [], types: [], from: year, to: year, touched: [] };
      save();
      render();
      pane.scrollTop = 0;
      onAddress();
      return;
    }
    const allBy = event.target.closest('[data-all-by]');
    if (allBy) {
      state.view = 'all';
      state.sort = allBy.dataset.allBy;
      state.chips = { areas: [], types: [], from: null, to: null, touched: [] };
      save();
      render();
      pane.scrollTop = 0;
      onAddress();
      return;
    }
    const yearButton = event.target.closest('[data-year]');
    if (yearButton) {
      const chosen = Number(yearButton.dataset.year);
      year = year === chosen ? null : chosen;
      render();
      return;
    }
    const link = event.target.closest('a[href]');
    if (!link) return;
    if (link.dataset.pdf) {
      event.preventDefault();
      openPaper({ pdf: link.dataset.pdf, title: link.querySelector('.title')?.textContent });
    } else if (link.dataset.review) {
      event.preventDefault();
      openReview(link.dataset.review, link.dataset.title);
    } else if (link.dataset.area != null) {
      event.preventDefault();
      showArea(link.dataset.area, { push: true });
    }
  });

  /** Asks for the library again: a 304 when nothing changed, and nothing is drawn again. */
  async function reload() {
    let next;
    try {
      next = await loadLibrary({ again: Boolean(doc) });
    } catch {
      if (!doc) areaPage.replaceChildren(element('p', 'list-note error', 'Could not load the library from the laptop.'));
      return;
    }
    if (next === doc) return;
    doc = next;
    rows.clear();
    render();
  }

  startAdding({ topics: () => doc?.topics ?? [], onAdded: () => void reload(), openPaper });

  // The tree stays in view under the header, as tall as the pane leaves it.
  new ResizeObserver(() => {
    pane.style.setProperty('--bar-height', `${document.getElementById('library-bar').offsetHeight}px`);
    pane.style.setProperty('--pane-height', `${pane.clientHeight}px`);
  }).observe(pane);
  new ResizeObserver(() => pane.style.setProperty('--bar-height', `${document.getElementById('library-bar').offsetHeight}px`)).observe(document.getElementById('library-bar'));

  render();
  void reload();
  return { showArea, address, reload, area: () => state.area, view: () => state.view };
}
