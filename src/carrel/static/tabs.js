// The tabs: the paper list, one tab per open paper, and the chat when it is set to be a tab.
// Each device remembers its open papers, where it was in each, and which tab was showing.
//
// The state is a plain object, {papers: [{pdf, title, place}], active, last}, where `active` is
// 'papers', 'chat' or a paper's PDF, and `last` the paper shown last, which is the one a question
// is about while the list or the chat is showing. The functions here return a new state.

export const PAPERS = 'papers';
export const CHAT = 'chat';
const TABS_KEY = 'carrel.tabs';

export function emptyTabs() {
  return { papers: [], active: PAPERS, last: null };
}

/** A remembered state, checked: whatever does not fit is left out. */
export function restoreTabs(stored) {
  const state = emptyTabs();
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.papers)) return state;
  const seen = new Set();
  for (const paper of stored.papers) {
    if (!paper || typeof paper.pdf !== 'string' || !paper.pdf || seen.has(paper.pdf)) continue;
    seen.add(paper.pdf);
    state.papers.push({
      pdf: paper.pdf,
      title: typeof paper.title === 'string' && paper.title ? paper.title : titleOf(paper.pdf),
      place: paper.place && typeof paper.place === 'object' ? paper.place : null,
    });
  }
  if (stored.active === CHAT || seen.has(stored.active)) state.active = stored.active;
  if (seen.has(stored.last)) state.last = stored.last;
  return state;
}

/** Shows a paper, opening a tab for it after the one showing when it has none. */
export function openPaper(state, { pdf, title }) {
  if (state.papers.some((paper) => paper.pdf === pdf)) return show(state, pdf);
  const at = state.papers.findIndex((paper) => paper.pdf === state.active);
  const papers = [...state.papers];
  papers.splice(at < 0 ? papers.length : at + 1, 0, { pdf, title: title || titleOf(pdf), place: null });
  return { ...state, papers, active: pdf, last: pdf };
}

/** Closes a paper's tab; when it was showing, its right neighbour shows, else its left, else the list. */
export function closePaper(state, pdf) {
  const at = state.papers.findIndex((paper) => paper.pdf === pdf);
  if (at < 0) return state;
  const papers = state.papers.filter((paper) => paper.pdf !== pdf);
  let { active, last } = state;
  if (active === pdf) active = (papers[at] ?? papers[at - 1])?.pdf ?? PAPERS;
  if (last === pdf) last = isPaper({ papers }, active) ? active : null;
  return { ...state, papers, active, last };
}

export function show(state, key) {
  if (key !== PAPERS && key !== CHAT && !isPaper(state, key)) return state;
  return { ...state, active: key, last: isPaper(state, key) ? key : state.last };
}

export function withPlace(state, pdf, place) {
  return { ...state, papers: state.papers.map((paper) => (paper.pdf === pdf ? { ...paper, place } : paper)) };
}

export function isPaper(state, key) {
  return state.papers.some((paper) => paper.pdf === key);
}

/** The paper a question is about: the one showing, or, over the list or the chat, the last one shown. */
export function paperInView(state) {
  return state.papers.find((paper) => paper.pdf === state.active) ?? state.papers.find((paper) => paper.pdf === state.last) ?? null;
}

// The address says which tab is showing: / for the list, /read/<file>?page=… for a paper.

export function readingUrl(file, target) {
  const query = new URLSearchParams();
  if (target?.page) query.set('page', String(target.page));
  if (target?.dest) query.set('dest', target.dest);
  const path = file.split('/').map(encodeURIComponent).join('/');
  return `/read/${path}${query.size ? `?${query}` : ''}`;
}

/** The paper an address names, or null for any other page. */
export function fileFromPath(pathname) {
  if (!pathname.startsWith('/read/')) return null;
  return decodeURIComponent(pathname.slice('/read/'.length)) || null;
}

/** A target given in an address: /read/<file>?page=7&dest=table.2 */
export function targetFromQuery(search) {
  const query = new URLSearchParams(search);
  const page = Number.parseInt(query.get('page') ?? '', 10);
  const dest = query.get('dest') || undefined;
  return page > 0 || dest ? { page: page > 0 ? page : undefined, dest } : null;
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
