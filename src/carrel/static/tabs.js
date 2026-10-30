// The tabs: the library, one tab per open paper or review, and the chat when it is set to be a
// tab. Each device remembers what it has open, where it was in each, and which tab was showing.
//
// The state is a plain object, {papers: [entry], active, last}. An entry is a paper,
// {pdf, title, place}, or a review, {review: scope, title, place}; its key (keyOf) is its PDF,
// or `review:<scope>` (a topic path holds no colon). `active` is 'papers', 'chat' or an entry's
// key, and `last` the key of the entry shown last, which is the one a question is about while
// the library or the chat is showing. The functions here return a new state.

import { formatRects, parseRects } from './links.js';

export const PAPERS = 'papers';
export const CHAT = 'chat';
const TABS_KEY = 'carrel.tabs';
const REVIEW = 'review:';

export function emptyTabs() {
  return { papers: [], active: PAPERS, last: null };
}

/** An entry's key: its PDF, or `review:<scope>`. */
export function keyOf(entry) {
  return entry.review ? `${REVIEW}${entry.review}` : entry.pdf;
}

export function reviewKey(scope) {
  return `${REVIEW}${scope}`;
}

/** The scope a key names, when it is a review's. */
export function reviewOfKey(key) {
  return typeof key === 'string' && key.startsWith(REVIEW) ? key.slice(REVIEW.length) : null;
}

/** A remembered state, checked: whatever does not fit is left out. */
export function restoreTabs(stored) {
  const state = emptyTabs();
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.papers)) return state;
  const seen = new Set();
  for (const entry of stored.papers) {
    if (!entry || typeof entry !== 'object') continue;
    const place = entry.place && typeof entry.place === 'object' ? entry.place : null;
    let made = null;
    if (typeof entry.review === 'string' && entry.review) {
      made = { review: entry.review, title: textOr(entry.title, entry.review), place };
    } else if (typeof entry.pdf === 'string' && entry.pdf) {
      made = { pdf: entry.pdf, title: textOr(entry.title, titleOf(entry.pdf)), place };
    }
    if (!made || seen.has(keyOf(made))) continue;
    seen.add(keyOf(made));
    state.papers.push(made);
  }
  if (stored.active === CHAT || seen.has(stored.active)) state.active = stored.active;
  if (seen.has(stored.last)) state.last = stored.last;
  return state;
}

function textOr(text, otherwise) {
  return typeof text === 'string' && text ? text : otherwise;
}

/** Shows an entry, opening a tab for it after the one showing when it has none. */
function openEntry(state, entry) {
  const key = keyOf(entry);
  if (isTab(state, key)) return show(state, key);
  const at = state.papers.findIndex((each) => keyOf(each) === state.active);
  const papers = [...state.papers];
  papers.splice(at < 0 ? papers.length : at + 1, 0, entry);
  return { ...state, papers, active: key, last: key };
}

/** Shows a paper, opening a tab for it after the one showing when it has none. */
export function openPaper(state, { pdf, title }) {
  return openEntry(state, { pdf, title: title || titleOf(pdf), place: null });
}

/** Shows a review, opening a tab for it after the one showing when it has none. */
export function openReview(state, { review, title }) {
  return openEntry(state, { review, title: title || review, place: null });
}

/** Closes a tab; when it was showing, its right neighbour shows, else its left, else the list. */
export function closePaper(state, key) {
  const at = state.papers.findIndex((entry) => keyOf(entry) === key);
  if (at < 0) return state;
  const papers = state.papers.filter((entry) => keyOf(entry) !== key);
  let { active, last } = state;
  if (active === key) active = (papers[at] && keyOf(papers[at])) ?? (papers[at - 1] && keyOf(papers[at - 1])) ?? PAPERS;
  if (last === key) last = isTab({ papers }, active) ? active : null;
  return { ...state, papers, active, last };
}

export function show(state, key) {
  if (key !== PAPERS && key !== CHAT && !isTab(state, key)) return state;
  return { ...state, active: key, last: isTab(state, key) ? key : state.last };
}

export function withPlace(state, key, place) {
  return { ...state, papers: state.papers.map((entry) => (keyOf(entry) === key ? { ...entry, place } : entry)) };
}

/** Whether `key` is an open tab's, a paper's or a review's. */
export function isTab(state, key) {
  return state.papers.some((entry) => keyOf(entry) === key);
}

/** Whether `key` is an open paper's. */
export function isPaper(state, key) {
  return state.papers.some((entry) => entry.pdf && entry.pdf === key);
}

/** What a question is about: the entry showing, or, over the list or the chat, the one shown last. */
export function itemInView(state) {
  return state.papers.find((entry) => keyOf(entry) === state.active) ?? state.papers.find((entry) => keyOf(entry) === state.last) ?? null;
}

/** The paper a question is about, when what is in view is a paper. */
export function paperInView(state) {
  const item = itemInView(state);
  return item?.pdf ? item : null;
}

// The address says which tab is showing: / for the library (/area/<topic> at an area),
// /read/<file>?page=… for a paper, /review/<scope> for a review.

export function readingUrl(file, target) {
  const query = new URLSearchParams();
  if (target?.page) query.set('page', String(target.page));
  if (target?.dest) query.set('dest', target.dest);
  if (target?.rect) query.set('rect', formatRects(target.rect));
  return `/read/${pathOf(file)}${query.size ? `?${query}` : ''}`;
}

export function reviewUrl(scope) {
  return `/review/${pathOf(scope)}`;
}

export function areaUrl(topic) {
  return topic ? `/area/${pathOf(topic)}` : '/';
}

function pathOf(text) {
  return text.split('/').map(encodeURIComponent).join('/');
}

function after(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(pathname.slice(prefix.length)).replace(/\/+$/, '') || null;
  } catch {
    return null;
  }
}

/** The paper an address names, or null for any other page. */
export function fileFromPath(pathname) {
  return after(pathname, '/read/');
}

/** The review an address names, or null. */
export function reviewFromPath(pathname) {
  return after(pathname, '/review/');
}

/** The area of the library an address names, or null. */
export function areaFromPath(pathname) {
  return after(pathname, '/area/');
}

/** A target given in an address: /read/<file>?page=7&dest=table.2&search=…&rect=… */
export function targetFromQuery(search) {
  const query = new URLSearchParams(search);
  const page = Number.parseInt(query.get('page') ?? '', 10);
  const dest = query.get('dest') || undefined;
  const find = query.get('search') || undefined;
  const rect = parseRects(query.get('rect') ?? '');
  if (!(page > 0) && !dest && !find) return null;
  const target = { page: page > 0 ? page : undefined, dest };
  if (find) target.search = find;
  if (rect && page > 0) target.rect = rect;
  return target;
}

function titleOf(pdf) {
  return pdf.split('/').at(-1).replace(/\.pdf$/i, '');
}

export function loadTabs() {
  try {
    return restoreTabs(JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null'));
  } catch {
    return emptyTabs();
  }
}

export function saveTabs(state) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(state));
  } catch {
    // Private browsing: the tabs last as long as the page.
  }
}
