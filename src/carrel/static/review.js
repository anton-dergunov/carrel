// A literature review, in a tab of its own: reading one is long work, with many trips to a cited
// paper and back, and a tab keeps its place. Each open review is drawn once and kept.
//
// Its links: a paper's (to its text file) opens a peek, a small card with the paper's title,
// year and summary, and Open, plus Open at p. N for each page of it the same paragraph cites;
// a page link (`http://pdf.invalid/…`) opens the paper there, as in the chat; a link to another
// review opens that review's tab; a web link opens a new tab.

import { decode, parsePaperLink, sameFile } from './links.js';
import { loadLibrary, shortDate } from './library.js';
import { drawCallouts, drawMarkdown } from './markdown.js';
import { element, marks, shortAuthors, typeIcon } from './rows.js';

const PLACE_MS = 400;

/**
 * `openPaper({pdf, title})`, `openTarget({file, page})` and `openReview(scope, title)` open
 * tabs; `onPlace(scope, place)` follows the place in a review to come back to; `onTitle(scope,
 * title)` gives a review's title once it is known. Returns `show(scope, place)`, `close(scope)`.
 */
export function startReviews({ openPaper, openTarget, openReview, onPlace, onTitle = () => {} }) {
  const pane = document.getElementById('review-pane');
  const peek = document.getElementById('peek');
  const open = new Map(); // scope → {article, links, ready}
  let showing = null;
  let held = null; // the review whose place the pane's scroll holds
  let peeked = null; // the link whose peek is open

  async function show(scope, place) {
    closePeek();
    if (held && held !== scope) keepPlace(held);
    showing = scope;
    let review = open.get(scope);
    if (!review) {
      review = { article: element('article', 'review'), links: new Map(), ready: null };
      review.article.dataset.scope = scope;
      review.article.append(element('p', 'list-note', 'Loading the review…'));
      open.set(scope, review);
      pane.append(review.article);
      review.ready = load(scope, review);
    }
    for (const [each, kept] of open) kept.article.hidden = each !== scope;
    await review.ready;
    if (showing !== scope || held === scope) return;
    held = scope;
    restore(place);
  }

  /** The place in the review the pane shows, kept now: another is about to be shown. */
  function keepPlace(scope) {
    if (pane.scrollHeight) onPlace(scope, { top: pane.scrollTop / pane.scrollHeight });
  }

  /** Another tab is showing: the review's place is kept at once, not after the scroll settles. */
  function leave() {
    closePeek();
    if (held && held === showing) keepPlace(held);
  }

  async function load(scope, review) {
    let data;
    try {
      const response = await fetch(`/api/review/${scope.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(response.status === 404 ? 'The library has no review of this area.' : response.statusText);
      data = await response.json();
    } catch (error) {
      review.article.replaceChildren(element('p', 'list-note error', String(error.message || error)));
      open.delete(scope); // asked again when shown again
      return;
    }
    const library = await loadLibrary().catch(() => null);
    const entry = library?.reviews.find((each) => each.scope === scope);
    for (const [target, value] of Object.entries(data.links)) review.links.set(decode(target).normalize('NFC'), value);
    review.library = library;

    const head = element('header', 'review-head');
    const kicker = head.appendChild(element('p', 'kicker'));
    kicker.append(element('span', 'scope', scope));
    if (data.updated) kicker.append(element('span', '', `updated ${shortDate(data.updated)}`));
    if (entry) kicker.append(element('span', '', `cites ${entry.cites} papers`));
    const body = element('div', 'answer review-body');
    drawMarkdown(body, data.markdown);
    drawCallouts(body);
    for (const link of body.querySelectorAll('a[href]')) {
      const kind = linkKind(review, link);
      if (kind) link.dataset.kind = kind;
    }
    review.article.replaceChildren(head, body);
    onTitle(scope, data.title);
  }

  /** What a link in a review leads to: 'paper', 'page', 'review', 'web', or null. */
  function linkKind(review, link) {
    const raw = link.getAttribute('href');
    if (parsePaperLink(link.href)) return 'page';
    const value = review.links.get(decode(raw).normalize('NFC'));
    if (value?.review) return 'review';
    if (value?.pdf) return 'paper';
    if (/^https?:/i.test(raw)) return 'web';
    return null;
  }

  function restore(place) {
    const top = place?.top;
    requestAnimationFrame(() => {
      pane.scrollTop = typeof top === 'number' ? top * Math.max(1, pane.scrollHeight) : 0;
    });
  }

  function close(scope) {
    open.get(scope)?.article.remove();
    open.delete(scope);
    if (showing === scope) showing = null;
    if (held === scope) held = null;
    closePeek();
  }

  // The peek at a cited paper.

  function showPeek(link, value, review) {
    closePeek();
    const paper = review.library?.byText.get(value.text);
    const title = paper?.title ?? link.textContent;
    const card = [];
    const kicker = element('p', 'peek-kicker');
    if (paper?.type) kicker.append(typeIcon(paper.type));
    kicker.append(element('span', '', [paper?.type, paper?.topic, paper?.year].filter(Boolean).join(' · ')));
    if (paper) kicker.append(marks(paper));
    card.push(kicker, element('p', 'peek-title', title));
    const authors = shortAuthors(paper?.authors, 4);
    if (authors) card.push(element('p', 'peek-authors', authors));
    if (paper?.summary) card.push(element('p', 'peek-summary', paper.summary));
    const actions = element('div', 'peek-actions');
    const openButton = actions.appendChild(element('button', 'primary', 'Open'));
    openButton.type = 'button';
    openButton.addEventListener('click', () => {
      closePeek();
      openPaper({ pdf: value.pdf, title });
    });
    for (const page of citedPages(link, value.pdf)) {
      const button = actions.appendChild(element('button', 'secondary', `p. ${page}`));
      button.type = 'button';
      button.title = `Open at page ${page}`;
      button.addEventListener('click', () => {
        closePeek();
        openTarget({ file: value.pdf, page });
      });
    }
    peek.replaceChildren(...card, actions);
    peek.hidden = false;
    peeked = link;
    link.classList.add('peeked');
    placePeek(link);
  }

  /** The pages of the same paper that the link's paragraph cites, in order. */
  function citedPages(link, pdf) {
    const block = link.closest('p, li, td, th, blockquote, .callout') ?? link.parentElement;
    const pages = new Set();
    for (const each of block.querySelectorAll('a[href^="http://pdf.invalid/"]')) {
      const target = parsePaperLink(each.href);
      if (target?.page && sameFile(target.file, pdf)) pages.add(target.page);
    }
    return [...pages].sort((a, b) => a - b);
  }

  /** Under the link when there is room, else over it; inside the pane's width. */
  function placePeek(link) {
    const box = link.getBoundingClientRect();
    const area = pane.getBoundingClientRect();
    const width = Math.min(380, area.width - 24);
    peek.style.width = `${width}px`;
    const left = Math.max(area.left + 12, Math.min(box.left + box.width / 2 - width / 2, area.right - width - 12));
    peek.style.left = `${left}px`;
    const height = peek.offsetHeight;
    const below = box.bottom + 8;
    const top = below + height <= area.bottom - 8 ? below : Math.max(area.top + 8, box.top - height - 8);
    peek.style.top = `${top}px`;
  }

  function closePeek() {
    if (peek.hidden) return;
    peek.hidden = true;
    peek.replaceChildren();
    peeked?.classList.remove('peeked');
    peeked = null;
  }

  pane.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const review = open.get(link.closest('article')?.dataset.scope);
    if (!review) return;
    const kind = link.dataset.kind;
    if (kind === 'page') {
      openTarget(parsePaperLink(link.href));
    } else if (kind === 'paper') {
      if (peeked === link) closePeek();
      else showPeek(link, review.links.get(decode(link.getAttribute('href')).normalize('NFC')), review);
    } else if (kind === 'review') {
      const scope = review.links.get(decode(link.getAttribute('href')).normalize('NFC')).review;
      openReview(scope);
    } else if (kind === 'web') {
      window.open(link.href, '_blank', 'noopener');
    }
  });

  let settle = 0;
  pane.addEventListener(
    'scroll',
    () => {
      closePeek();
      clearTimeout(settle);
      const scope = showing;
      settle = setTimeout(() => {
        if (scope && scope === showing && scope === held) keepPlace(scope);
      }, PLACE_MS);
    },
    { passive: true },
  );
  document.addEventListener('pointerdown', (event) => {
    if (!peek.hidden && !peek.contains(event.target) && event.target !== peeked && !peeked?.contains(event.target)) closePeek();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePeek();
  });

  return { show, close, leave, closePeek, showing: () => showing };
}
