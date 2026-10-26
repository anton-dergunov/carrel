// The app, on one page: the paper list and the open papers in tabs, and the chat beside them
// (or on a tab of its own). Moving between tabs never reloads the page, so the chat stays as it
// is; the address only says which tab is showing, so a reload comes back to it.

import { startChat } from './chat.js';
import { restoreLayout, shareOf, startLayout } from './layout.js';
import { sameFile } from './links.js';
import { startPaperTools } from './paper-tools.js';
import { startPaperList } from './papers.js';
import { createReader } from './read.js';
import { fitToVisibleArea } from './screen.js';
import {
  CHAT,
  PAPERS,
  closePaper,
  fileFromPath,
  loadTabs,
  openPaper,
  paperInView,
  readingUrl,
  saveTabs,
  show,
  targetFromQuery,
  withPlace,
} from './tabs.js';

const body = document.body;
const library = body.dataset.library;
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
});
const tools = startPaperTools({ reader });

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

startPaperList({
  openPaper(paper) {
    state = openPaper(state, paper);
    go(paper.pdf);
  },
});

startChat({
  currentPaper: () => paperInView(state)?.pdf ?? null,
  currentPage: () => {
    const paper = paperInView(state);
    if (!paper) return null;
    return paper.pdf === reader.file() ? reader.currentPage() : (paper.place?.page ?? null);
  },
  openTarget,
  onActivity() {
    if (ready && !chatShowing()) {
      unseen = true;
      render();
    }
  },
});

/** The paper whose tab is showing, if a paper's is. */
function shownPaper() {
  return state.papers.find((paper) => paper.pdf === state.active) ?? null;
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

/** Shows a tab: the list, the chat, or a paper, at its remembered place or at `target`. */
function go(key, { target = null, push = true } = {}) {
  if (key !== state.active) tools.leave();
  state = show(state, key);
  if (state.active === CHAT && layout.place !== 'tab') state = show(state, paperInView(state)?.pdf ?? PAPERS);
  const paper = shownPaper();
  if (paper) {
    if (paper.pdf !== reader.file()) tools.showPage(0, 0);
    reader.open(paper.pdf, pdfUrl(paper.pdf), target ? { target } : { place: paper.place }).catch(() => void lost(paper.pdf));
  }
  if (state.active !== CHAT) {
    const address = paper ? addressOf(paper, target) : '/';
    if (push && address !== location.pathname + location.search) history.pushState(null, '', address);
    else history.replaceState(null, '', address);
  }
  saveTabs(state);
  render();
}

function close(pdf) {
  state = closePaper(state, pdf);
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
function openTarget(target) {
  const open = state.papers.find((paper) => sameFile(paper.pdf, target.file));
  if (open) go(open.pdf, { target });
  else void openFile(target.file, target);
}

function render() {
  const paper = shownPaper();
  body.dataset.active = paper ? 'paper' : state.active;
  if (chatShowing()) unseen = false;

  paperTabs.replaceChildren(
    ...state.papers.map(({ pdf, title }) => {
      const tab = document.createElement('span');
      tab.className = 'tab paper';
      tab.dataset.key = pdf;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(pdf === state.active));
      tab.title = title;
      const label = tab.appendChild(document.createElement('button'));
      label.type = 'button';
      label.className = 'label';
      label.textContent = title;
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

  // The paper a question is about, said where the question is typed.
  const about = paperInView(state);
  question.placeholder = about ? `Ask about “${shorten(about.title, 48)}”` : 'Ask about the library';
  document.title = paper?.title ?? library;
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
  const file = fileFromPath(location.pathname);
  if (!file) return go(PAPERS, { push: false });
  const target = targetFromQuery(location.search);
  const open = state.papers.find((paper) => sameFile(paper.pdf, file));
  // Back to a tab: where the reader left it, not the page the address kept.
  if (open) go(open.pdf, { target: target?.dest || !open.place ? target : null, push: false });
  else void openFile(file, target, { push: false });
});

// The page the server was asked for, or, at /, the tab that was showing last: the Home Screen app
// always starts at /, and comes back where it was.
const given = body.dataset.pdf;
if (given) {
  state = openPaper(state, { pdf: given, title: body.dataset.pdfTitle });
  const target = targetFromQuery(location.search);
  const place = shownPaper().place;
  // An address this page wrote itself names the page of the place it keeps; the place is exact.
  go(given, { target: target?.dest || target?.page !== place?.page ? target : null, push: false });
} else {
  go(state.active, { push: false });
}
ready = true;
