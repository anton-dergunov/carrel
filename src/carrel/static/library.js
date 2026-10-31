// The library as one document (GET /api/library), and what the views compute from it. Loaded
// once per page and asked again only when the server's copy changed (an ETag revalidates it).
//
// Everything below the loader is pure, and tested: filtering, sorting, the topic tree, the
// years, and the state each device keeps of the library tab.

export const TYPES = ['method', 'survey', 'benchmark', 'study', 'system', 'position', 'theory'];
// Lucide's icon for each type (app.html holds them as symbols).
export const TYPE_ICONS = {
  method: 'flask-conical',
  survey: 'map',
  benchmark: 'gauge',
  study: 'microscope',
  system: 'cpu',
  position: 'megaphone',
  theory: 'sigma',
};
export const SORTS = ['topic', 'added', 'published'];
export const TOUCHED = ['overview', 'review', 'chat'];
const LIBRARY_KEY = 'carrel.library';

let loading = null;
let current = null; // {etag, document}: asked again, an unchanged library is the same object

/** The library's document, with each paper made ready for the views. */
export function loadLibrary({ again = false } = {}) {
  if (!loading || again) {
    const asked = fetch('/api/library', { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const etag = response.headers.get('ETag');
      if (etag && current?.etag === etag) return current.document;
      const document = prepare(await response.json());
      current = { etag, document };
      return document;
    });
    loading = asked.catch((error) => {
      if (loading === asked) loading = null; // asked again next time
      throw error;
    });
  }
  return loading;
}

/** Adds what the views read often: each paper's year and the text a search looks through. */
export function prepare(document) {
  for (const paper of document.papers) {
    paper.title = plainTitle(paper.title);
    paper.year = paper.published ? String(paper.published).slice(0, 4) : '';
    paper.haystack = haystackOf(paper);
  }
  document.byText = new Map(document.papers.map((paper) => [paper.text, paper]));
  document.byPdf = new Map(document.papers.map((paper) => [paper.pdf.normalize('NFC'), paper]));
  return document;
}

const SUPERSCRIPT = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ' };
const SUBSCRIPT = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋' };
const TEX_SYMBOLS = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', infty: '∞', times: '×', cdot: '·', leq: '≤', geq: '≥', to: '→' };

/** A title's bits of TeX as plain text: "$\\tau^2$-Bench" → "τ²-Bench". What has no plain form keeps its letters. */
export function plainTitle(title) {
  return String(title).replace(/\$([^$]+)\$/g, (_, tex) => {
    const script = (text, table) => ([...text].every((c) => table[c]) ? [...text].map((c) => table[c]).join('') : null);
    return tex
      .replace(/\\(?:mathcal|mathbf|mathrm|text|textbf|textit|operatorname|mathit)\{([^}]*)\}/g, '$1')
      .replace(/\\([a-zA-Z]+)/g, (whole, name) => TEX_SYMBOLS[name] ?? name)
      .replace(/\^\{([^}]*)\}|\^(.)/g, (whole, group, one) => script(group ?? one, SUPERSCRIPT) ?? `^${group ?? one}`)
      .replace(/_\{([^}]*)\}|_(.)/g, (whole, group, one) => script(group ?? one, SUBSCRIPT) ?? `_${group ?? one}`)
      .replace(/[{}]/g, '');
  });
}

/** One lower-case text per paper: title, authors, summary, topic, type and year. */
export function haystackOf(paper) {
  return [paper.title, [paper.authors ?? []].flat().join(' '), paper.summary, paper.topic.replaceAll('/', ' '), paper.type, paper.year]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function words(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether a paper is in an area: its own folder or one under it. '' is the whole library. */
export function inArea(paper, area) {
  return !area || paper.topic === area || paper.topic.startsWith(`${area}/`);
}

/**
 * The papers that match every word of `query` and every chip: `areas` (any of them), `types`
 * (any; 'none' for a paper without one), `from`–`to` (years published), and `touched` (any of
 * overview, review, chat).
 */
export function filterPapers(papers, query = '', chips = {}) {
  const wanted = words(query);
  const { areas = [], types = [], from = null, to = null, touched = [] } = chips;
  return papers.filter((paper) => {
    if (!wanted.every((word) => paper.haystack.includes(word))) return false;
    if (areas.length && !areas.some((area) => inArea(paper, area))) return false;
    if (types.length && !types.includes(paper.type ?? 'none')) return false;
    if (from || to) {
      const year = Number(paper.year);
      if (!year || (from && year < from) || (to && year > to)) return false;
    }
    if (touched.length && !touched.some((mark) => isTouched(paper, mark))) return false;
    return true;
  });
}

export function isTouched(paper, mark) {
  if (mark === 'overview') return Boolean(paper.overview);
  if (mark === 'review') return Boolean(paper.reviews?.length);
  if (mark === 'chat') return Boolean(paper.chats);
  return Boolean(paper.overview || paper.reviews?.length || paper.chats);
}

/** The papers in order: by topic then title, or the newest first by date added or published. */
export function sortPapers(papers, sort = 'topic') {
  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const sorted = [...papers];
  if (sort === 'added' || sort === 'published') {
    const date = (paper) => String(paper[sort] ?? '');
    sorted.sort((a, b) => date(b).localeCompare(date(a)) || byTitle(a, b));
  } else {
    sorted.sort((a, b) => a.topic.localeCompare(b.topic) || byTitle(a, b));
  }
  return sorted;
}

/** The heading a sorted paper falls under: its topic, its year, or the month it was added. */
export function groupOf(paper, sort = 'topic') {
  if (sort === 'published') return paper.year || 'Undated';
  if (sort === 'added') return paper.added ? monthName(paper.added) : 'Undated';
  return paper.topic;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(date) {
  const [year, month] = String(date).split('-');
  return MONTHS[Number(month) - 1] ? `${MONTHS[Number(month) - 1]} ${year}` : String(year);
}

/** A date as "12 Oct" (or "12 Oct 2024" in another year than `now`'s). */
export function shortDate(date, now = new Date()) {
  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month) return String(date ?? '');
  const name = MONTHS[month - 1].slice(0, 3);
  const days = day ? `${day} ` : '';
  return year === now.getFullYear() ? `${days}${name}` : `${days}${name} ${year}`;
}

/**
 * The topics as a tree: [{path, name, scope, count, total, children}], children in the
 * document's order. `counts`, when given, replaces each topic's total (the matches of a search).
 */
export function topicTree(topics, counts = null) {
  const nodes = new Map();
  const roots = [];
  for (const topic of topics) {
    nodes.set(topic.path, { ...topic, name: topic.path.split('/').at(-1), children: [] });
  }
  for (const node of nodes.values()) {
    if (counts) node.total = counts.get(node.path) ?? 0;
    const parent = nodes.get(node.path.split('/').slice(0, -1).join('/'));
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** How many of `papers` each topic holds, its subtopics' included: Map path → count. */
export function areaCounts(papers) {
  const counts = new Map();
  for (const paper of papers) {
    const parts = paper.topic.split('/');
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join('/');
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

/** The topics on the way to `path`, from the top: ['llm', 'llm/evaluation']. */
export function ancestry(path) {
  const parts = path ? path.split('/') : [];
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** How many papers were published each year, every year from the first to the last: [{year, count}]. */
export function yearCounts(papers) {
  const counts = new Map();
  for (const paper of papers) {
    const year = Number(paper.year);
    if (year) counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  if (!counts.size) return [];
  const years = [...counts.keys()];
  const first = Math.min(...years);
  const last = Math.max(...years);
  const all = [];
  for (let year = first; year <= last; year++) all.push({ year, count: counts.get(year) ?? 0 });
  return all;
}

/** The review an area is read in: its own, else the nearest one above it. */
export function reviewFor(area, reviews) {
  for (const path of ancestry(area).reverse()) {
    const review = reviews.find((each) => each.scope === path);
    if (review) return review;
  }
  return null;
}

/** The reviews of areas inside `area` (not its own). */
export function reviewsInside(area, reviews) {
  return reviews.filter((review) => review.scope !== area && (!area || review.scope.startsWith(`${area}/`)));
}

// What each device keeps of the library tab.

export const VIEWS = ['desk', 'areas', 'all', 'timeline'];

export function defaultLibraryState() {
  return { view: 'desk', area: '', density: 'compact', sort: 'topic', depth: 'titles', timeline: 'published', chips: { areas: [], types: [], from: null, to: null, touched: [] } };
}

/** A remembered state, checked: whatever does not fit is left as it starts. */
export function restoreLibrary(stored) {
  const state = defaultLibraryState();
  if (!stored || typeof stored !== 'object') return state;
  if (VIEWS.includes(stored.view)) state.view = stored.view;
  if (['published', 'added'].includes(stored.timeline)) state.timeline = stored.timeline;
  if (typeof stored.area === 'string') state.area = stored.area.replace(/^\/+|\/+$/g, '');
  if (['compact', 'rich'].includes(stored.density)) state.density = stored.density;
  if (SORTS.includes(stored.sort)) state.sort = stored.sort;
  if (['titles', 'text', 'meaning'].includes(stored.depth)) state.depth = stored.depth;
  const chips = stored.chips && typeof stored.chips === 'object' ? stored.chips : {};
  const strings = (list, allowed) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string' && (!allowed || allowed.includes(item))) : []);
  state.chips.areas = strings(chips.areas);
  state.chips.types = strings(chips.types, [...TYPES, 'none']);
  state.chips.touched = strings(chips.touched, TOUCHED);
  for (const end of ['from', 'to']) {
    const year = Number(chips[end]);
    state.chips[end] = Number.isInteger(year) && year > 1000 && year < 3000 ? year : null;
  }
  return state;
}

export function loadLibraryState() {
  try {
    return restoreLibrary(JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? 'null'));
  } catch {
    return defaultLibraryState();
  }
}

export function saveLibraryState(state) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(state));
  } catch {
    // Private browsing: the state lasts as long as the page.
  }
}

/** Whether any chip narrows the list. */
export function chipsOn(chips) {
  return Boolean(chips.areas.length || chips.types.length || chips.from || chips.to || chips.touched.length);
}
