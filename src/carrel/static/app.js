// The app, on one page: the library and the open papers and reviews in tabs, and the chat beside
// them (or on a tab of its own). Moving between tabs never reloads the page, so the chat stays as
// it is; the address only says which tab is showing, so a reload comes back to it.

import './report.js'; // first, so it hears what goes wrong in the others
import { startChat } from './chat.js';
import { startHighlights } from './highlight.js';
import { restoreLayout, shareOf, startLayout } from './layout.js';
import { sameFile } from './links.js';
import { startPaperTools } from './paper-tools.js';
import { loadLibrary } from './library.js';
import { startLibrary } from './papers.js';
import { createReader } from './read.js';
import { startReviews } from './review.js';
import { fitToVisibleArea } from './screen.js';
import {
  CHAT,
  PAPERS,
  areaFromPath,
  closePaper,
  fileFromPath,
  itemInView,
  keyOf,
  loadTabs,
  openPaper,
  openReview,
  paperInView,
  readingUrl,
  reviewFromPath,
  reviewKey,
  reviewOfKey,
  reviewUrl,
  saveTabs,
  show,
  targetFromQuery,
  withPlace,
} from './tabs.js';

const body = document.body;
const libraryName = body.dataset.library;
const tabStrip = document.getElementById('tabs');
const paperTabs = document.getElementById('paper-tabs');
const papersTab = document.getElementById('tab-papers');
const chatTab = document.getElementById('tab-chat');
const chatToggle = document.getElementById('chat-toggle');
const question = document.getElementById('question');
papersTab.dataset.key = PAPERS;
chatTab.dataset.key = CHAT;

let state = loadTabs();
let layout = restoreLayout(null);
// The library's document, once loaded: which review a file is, for the chat.
let libraryDocument = null;
loadLibrary()
  .then((loaded) => {
    libraryDocument = loaded;
  })
  .catch(() => {});
// Set once the first tab is shown; before that the parts starting only draw nothing.
let ready = false;
// Something happened in the chat while it was out of sight: an answer, or a question for the reader.
let unseen = false;

// Saving the tabs and the address waits for the scrolling to settle: Safari refuses more than a
// hundred address changes in ten seconds.
let settle = 0;
function keepSoon() {
  clearTimeout(settle);
  settle = setTimeout(() => {
    saveTabs(state);
    const paper = shownPaper();
    if (paper && paper.pdf === reader.file()) history.replaceState(null, '', addressOf(paper));
  }, 500);
}

const reader = createReader({
  onPage: (page, count) => tools.showPage(page, count),
  onPlace(place) {
    state = withPlace(state, reader.file(), place);
    keepSoon();
  },
  onFound: (found) => tools.showFound(found),
  onSaved: (saved) => highlights.showSaved(saved),
});
const tools = startPaperTools({
  reader,
  openPaper(paper) {
    state = openPaper(state, paper);
    go(paper.pdf);
  },
  onRemoved(pdf) {
    close(pdf);
    void library.reload();
  },
  showOverview() {
    revealChat();
    chat.showOverview();
  },
});
const highlights = startHighlights({
  reader,
  onPassage: (passage) => chat.quote(passage),
  onAsk() {
    revealChat();
    chat.focus();
  },
});

const refitScreen = fitToVisibleArea(() => shareOf(layout));
startLayout({
  onChange(next) {
    const moved = next.place !== layout.place || next.hidden !== layout.hidden;
    layout = next;
    refitScreen();
    if (!moved || !ready) return;
    if (state.active === CHAT && layout.place !== 'tab') go(paperInView(state)?.pdf ?? PAPERS, { push: false });
    else render();
  },
  onResize(next) {
    layout = next;
    refitScreen();
  },
  onDragEnd: () => reader.refit(),
});

const library = startLibrary({
  openPaper(paper) {
    state = openPaper(state, paper);
    go(paper.pdf);
  },
  openReview: (scope, title) => showReview(scope, title),
  openTarget: (target) => void openTarget(target),
  onAddress() {
    if (state.active === PAPERS) history.pushState(null, '', library.address());
  },
  tabs: () => state.papers,
});

const reviews = startReviews({
  openPaper(paper) {
    state = openPaper(state, paper);
    go(paper.pdf);
  },
  openTarget: (target) => void openTarget(target),
  openReview: (scope, title) => showReview(scope, title),
  onPlace(scope, place) {
    state = withPlace(state, reviewKey(scope), place);
    keepSoon();
  },
  onTitle(scope, title) {
    const key = reviewKey(scope);
    if (state.papers.some((entry) => keyOf(entry) === key && entry.title !== title)) {
      state = { ...state, papers: state.papers.map((entry) => (keyOf(entry) === key ? { ...entry, title } : entry)) };
      saveTabs(state);
      render();
    }
  },
});

const chat = startChat({
  currentPaper: () => paperInView(state)?.pdf ?? null,
  currentReview: () => itemInView(state)?.review ?? null,
  openReview: (scope, title) => showReview(scope, title),
  reviewNamed(file) {
    const found = libraryDocument?.reviews.find((review) => review.path === file);
    return found ? { scope: found.scope, title: found.title } : null;
  },
  papers: () => libraryDocument?.papers ?? [],
  currentPage: () => {
    const paper = paperInView(state);
    if (!paper) return null;
    return paper.pdf === reader.file() ? reader.currentPage() : (paper.place?.page ?? null);
  },
  openTarget,
  reveal: revealChat,
  onActivity() {
    if (ready && !chatShowing()) {
      unseen = true;
      render();
    }
  },
});

/** The paper whose tab is showing, if a paper's is. */
function shownPaper() {
  return state.papers.find((entry) => entry.pdf && entry.pdf === state.active) ?? null;
}

/** The review whose tab is showing, if a review's is. */
function shownReview() {
  const scope = reviewOfKey(state.active);
  return scope ? (state.papers.find((entry) => entry.review === scope) ?? null) : null;
}

/** Opens a review's tab, or shows it. */
function showReview(scope, title, { push = true } = {}) {
  state = openReview(state, { review: scope, title });
  go(reviewKey(scope), { push });
}

/** Brings the chat into view: its tab, or the pane when it is hidden. */
function revealChat() {
  if (layout.place === 'tab') go(CHAT);
  else if (layout.hidden) chatToggle.click();
}

function chatShowing() {
  return layout.place === 'tab' ? state.active === CHAT : !layout.hidden;
}

function pdfUrl(file) {
  return `/pdf/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function addressOf(paper, target) {
  if (target?.page || target?.dest) return readingUrl(paper.pdf, target);
  return readingUrl(paper.pdf, paper.place?.page > 1 ? { page: paper.place.page } : undefined);
}

/** Shows a tab: the library, the chat, a paper or a review, at its remembered place or at `target`. */
function go(key, { target = null, push = true } = {}) {
  if (key !== state.active) {
    reader.clearMark();
    tools.leave();
    highlights.leave();
    reviews.leave();
  }
  state = show(state, key);
  if (state.active === CHAT && layout.place !== 'tab') {
    const item = itemInView(state);
    state = show(state, item ? keyOf(item) : PAPERS);
  }
  const paper = shownPaper();
  if (paper) {
    if (paper.pdf !== reader.file()) tools.showPage(0, 0);
    reader.open(paper.pdf, pdfUrl(paper.pdf), target ? { target } : { place: paper.place }).catch(() => void lost(paper.pdf));
    if (target?.search) tools.showFind(target.search);
  }
  const review = shownReview();
  if (review) void reviews.show(review.review, review.place);
  if (state.active === PAPERS) void library.reload();
  if (state.active !== CHAT) {
    const address = paper ? addressOf(paper, target) : review ? reviewUrl(review.review) : library.address();
    if (push && address !== location.pathname + location.search) history.pushState(null, '', address);
    else history.replaceState(null, '', address);
  }
  saveTabs(state);
  render();
}

function close(key) {
  state = closePaper(state, key);
  if (chat.quoted()?.pdf === key) chat.quote(null);
  const scope = reviewOfKey(key);
  if (scope) reviews.close(scope);
  go(state.active, { push: false });
}

/** A paper that would not load: its tab goes when the library no longer has it. */
async function lost(pdf) {
  const response = await fetch(`/api/paper/${pdf.split('/').map(encodeURIComponent).join('/')}`).catch(() => null);
  if (response?.status === 404) close(pdf);
}

/** Opens a paper the page has no tab for, asking the server for its title. */
async function openFile(file, target, { push = true } = {}) {
  let paper;
  try {
    const response = await fetch(`/api/paper/${file.split('/').map(encodeURIComponent).join('/')}`);
    if (!response.ok) throw new Error(response.statusText);
    paper = await response.json();
  } catch {
    return; // not a paper of the library's: nothing to open
  }
  state = openPaper(state, { pdf: paper.pdf, title: paper.title });
  go(paper.pdf, { target, push });
}

/** A citation: the paper's tab, opened when it has none, at the cited spot. */
async function openTarget(target) {
  const open = state.papers.find((entry) => entry.pdf && sameFile(entry.pdf, target.file));
  if (open) go(open.pdf, { target });
  else await openFile(target.file, target);
}

function render() {
  const paper = shownPaper();
  const review = shownReview();
  body.dataset.active = paper ? 'paper' : review ? 'review' : state.active;
  if (chatShowing()) unseen = false;

  paperTabs.replaceChildren(
    ...state.papers.map((entry) => {
      const { title } = entry;
      const key = keyOf(entry);
      const tab = document.createElement('span');
      tab.className = entry.review ? 'tab paper review' : 'tab paper';
      tab.dataset.key = key;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(key === state.active));
      tab.title = entry.review ? `Review: ${title}` : title;
      const label = tab.appendChild(document.createElement('button'));
      label.type = 'button';
      label.className = 'label';
      if (entry.review) label.append(icon('book-open-text'));
      label.append(title);
      // Every tab has its close button, so any tab closes with one tap and showing one moves nothing.
      const close = tab.appendChild(document.createElement('button'));
      close.type = 'button';
      close.className = 'close';
      close.setAttribute('aria-label', `Close ${title}`);
      close.append(icon('close'));
      return tab;
    }),
  );
  papersTab.setAttribute('aria-selected', String(state.active === PAPERS));
  chatTab.hidden = layout.place !== 'tab';
  chatTab.setAttribute('aria-selected', String(state.active === CHAT));
  chatTab.classList.toggle('unseen', unseen);
  chatToggle.classList.toggle('unseen', unseen);
  tabStrip.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  // The paper or review a question is about, said where the question is typed.
  const about = itemInView(state);
  if (about?.review) question.placeholder = `Ask about the review “${shorten(about.title, 40)}”`;
  else question.placeholder = about ? `Ask about “${shorten(about.title, 48)}”` : 'Ask about the library';
  chat.about(paperInView(state)?.pdf ?? null);
  document.title = paper?.title ?? (review ? `Review: ${review.title}` : libraryName);
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'use'));
  use.setAttribute('href', `#i-${name}`);
  return svg;
}

function shorten(text, length) {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

tabStrip.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-key]');
  if (!tab) return;
  if (event.target.closest('.close')) close(tab.dataset.key);
  else go(tab.dataset.key);
});

window.addEventListener('popstate', () => {
  const scope = reviewFromPath(location.pathname);
  if (scope) return showReview(scope, undefined, { push: false });
  const file = fileFromPath(location.pathname);
  if (!file) {
    const area = areaFromPath(location.pathname);
    if (area != null || library.view() === 'areas') library.showArea(area ?? '');
    return go(PAPERS, { push: false });
  }
  const target = targetFromQuery(location.search);
  const open = state.papers.find((entry) => entry.pdf && sameFile(entry.pdf, file));
  // Back to a tab: where the reader left it, not the page the address kept.
  if (open) go(open.pdf, { target: target?.dest || target?.rect || !open.place ? target : null, push: false });
  else void openFile(file, target, { push: false });
});

// The page the server was asked for, or, at /, the tab that was showing last: the Home Screen app
// always starts at /, and comes back where it was.
const given = body.dataset.pdf;
if (body.dataset.review) {
  showReview(body.dataset.review, document.title, { push: false });
} else if (body.dataset.area) {
  library.showArea(body.dataset.area);
  go(PAPERS, { push: false });
} else if (given) {
  state = openPaper(state, { pdf: given, title: body.dataset.pdfTitle });
  const target = targetFromQuery(location.search);
  const place = shownPaper().place;
  // An address this page wrote itself names the page of the place it keeps; the place is exact.
  go(given, { target: target?.dest || target?.rect || target?.page !== place?.page ? target : null, push: false });
} else {
  go(state.active, { push: false });
}
ready = true;
