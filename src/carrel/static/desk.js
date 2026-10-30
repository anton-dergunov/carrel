// Desk: what to pick up again, what came in lately, and how far the reviews have got. It gives
// the reader a reason to open the library tab.
//
// - Continue: the papers and reviews open on this device, then the papers carrel's chats were
//   about lately.
// - Recently added: the newest papers, and how many came this week.
// - Reviews: each group of review scopes (`review_scopes` in the library's config), a pip per
//   scope, filled once it has a review, and how much of the group the agent has read.

import { areaName, hueOf, hues, plural } from './areas.js';
import { inArea, shortDate, sortPapers } from './library.js';
import { element, icon, paperRow, typeIcon } from './rows.js';
import { areaUrl, readingUrl, reviewUrl } from './tabs.js';

const CONTINUE = 8;
const RECENT = 8;
const DAY_MS = 86_400_000;

/** "today", "yesterday", "3 days ago", else the date. */
export function whenAgo(seconds, now = Date.now()) {
  const then = new Date(seconds * 1000);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((today - then) / DAY_MS);
  if (then >= today) return 'today';
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return shortDate(then.toISOString().slice(0, 10), new Date(now));
}

/** A paper file's stem, as a chat names its paper. */
function stemOf(path) {
  return path.split('/').at(-1).replace(/\.(pdf|txt|md)$/i, '').normalize('NFC');
}

/**
 * What to continue: [{paper | review, page, asked}], the device's open tabs first (`tabs`, as
 * tabs.js keeps them), then the papers of recent chats (`chats`, as /api/chats lists them).
 */
export function continueList(doc, tabs, chats = []) {
  const byStem = new Map(doc.papers.map((paper) => [stemOf(paper.text), paper]));
  const asked = new Map();
  for (const chat of chats) {
    const paper = chat.paper && byStem.get(String(chat.paper).normalize('NFC'));
    if (paper && !asked.has(paper)) asked.set(paper, chat.last_modified);
  }
  const items = [];
  const seen = new Set();
  for (const entry of tabs) {
    if (entry.review) {
      const review = doc.reviews.find((each) => each.scope === entry.review);
      if (review) items.push({ review });
      continue;
    }
    const paper = doc.byPdf.get(entry.pdf.normalize('NFC'));
    if (!paper || seen.has(paper)) continue;
    seen.add(paper);
    items.push({ paper, page: entry.place?.page ?? null, asked: asked.get(paper) ?? null });
  }
  for (const [paper, at] of asked) {
    if (!seen.has(paper)) {
      seen.add(paper);
      items.push({ paper, page: null, asked: at });
    }
  }
  return items.slice(0, CONTINUE);
}

/** The newest papers, and how many were added in the week up to `today` ('YYYY-MM-DD'). */
export function recentlyAdded(papers, today, count = RECENT) {
  const sorted = sortPapers(papers.filter((paper) => paper.added), 'added');
  const weekAgo = new Date(new Date(`${today}T00:00:00`) - 6 * DAY_MS).toISOString().slice(0, 10);
  return { papers: sorted.slice(0, count), thisWeek: sorted.filter((paper) => paper.added >= weekAgo).length };
}

/** Each group of review scopes: [{group, scopes: [{scope, papers, read, review}], reviewed, read, papers}]. */
export function reviewProgress(doc) {
  return doc.scopes.map(({ group, scopes }) => {
    const rows = scopes.map((scope) => {
      const papers = doc.papers.filter((paper) => inArea(paper, scope));
      return {
        scope,
        papers: papers.length,
        read: papers.filter((paper) => paper.read).length,
        review: doc.reviews.find((review) => review.scope === scope) ?? null,
      };
    });
    return {
      group,
      scopes: rows,
      reviewed: rows.filter((row) => row.review).length,
      papers: rows.reduce((sum, row) => sum + row.papers, 0),
      read: rows.reduce((sum, row) => sum + row.read, 0),
    };
  });
}

/** Draws the desk into `container`; `tabs` are the device's open tabs, `chats` the recent chats. */
export function drawDesk(container, doc, { tabs, chats, today }) {
  const parts = [];
  const items = continueList(doc, tabs, chats);
  if (items.length) {
    const section = element('section', 'desk-section');
    section.append(element('h3', 'section-title', 'Continue'));
    const list = section.appendChild(element('div', 'continue'));
    for (const item of items) list.append(item.review ? reviewItem(item.review) : paperItem(item));
    parts.push(section);
  }

  const recent = recentlyAdded(doc.papers, today);
  const added = element('section', 'desk-section');
  const head = added.appendChild(element('h3', 'section-title'));
  head.append(element('span', '', 'Recently added'), element('span', 'aside', recent.thisWeek ? `this week: ${recent.thisWeek}` : 'none this week'));
  const rows = added.appendChild(element('div', 'rows rich'));
  for (const paper of recent.papers) rows.append(paperRow(paper, { rich: true, topic: true, summary: false, date: 'added' }));
  const all = added.appendChild(element('button', 'plain see-all', 'Every paper, newest first →'));
  all.type = 'button';
  all.dataset.allBy = 'added';
  parts.push(added);

  parts.push(progress(doc));
  if (!items.length) parts.unshift(element('p', 'desk-hello', 'Papers you open, and the ones you ask about, will wait for you here.'));
  container.replaceChildren(...parts);
}

function paperItem({ paper, page, asked }) {
  const link = element('a', 'continue-item');
  link.href = readingUrl(paper.pdf, page ? { page } : undefined);
  link.dataset.pdf = paper.pdf;
  if (page) link.dataset.page = String(page);
  link.append(typeIcon(paper.type));
  const main = link.appendChild(element('span', 'main'));
  main.append(element('span', 'title', paper.title));
  const meta = [areaName(paper.topic), page && `p. ${page}`, asked && `asked ${whenAgo(asked)}`].filter(Boolean).join(' · ');
  main.append(element('span', 'meta', meta));
  return link;
}

function reviewItem(review) {
  const link = element('a', 'continue-item review');
  link.href = reviewUrl(review.scope);
  link.dataset.review = review.scope;
  link.dataset.title = review.title;
  const glyph = link.appendChild(element('span', 'type'));
  glyph.append(icon('book-open-text'));
  const main = link.appendChild(element('span', 'main'));
  main.append(element('span', 'title', review.title), element('span', 'meta', `Review · ${review.scope}`));
  return link;
}

function progress(doc) {
  const section = element('section', 'desk-section progress');
  section.append(element('h3', 'section-title', 'Reviews'));
  const hue = hues(doc);
  for (const group of reviewProgress(doc)) {
    const row = section.appendChild(element('div', 'progress-row'));
    row.append(element('span', 'group', group.group || 'Areas'));
    const pips = row.appendChild(element('span', 'pips'));
    for (const scope of group.scopes) {
      const pip = pips.appendChild(element('a', `pip${scope.review ? ' reviewed' : scope.papers && scope.read === scope.papers ? ' read' : ''}`));
      pip.href = areaUrl(scope.scope);
      pip.dataset.area = scope.scope;
      pip.style.setProperty('--hue', `var(--area-${hueOf(scope.scope, hue)})`);
      const state = scope.review ? `reviewed ${shortDate(scope.review.checked || scope.review.updated)}` : 'no review yet';
      pip.title = `${scope.scope}: ${scope.read} of ${plural(scope.papers, 'paper')} read, ${state}`;
      pip.setAttribute('aria-label', pip.title);
    }
    const share = group.papers ? Math.round((group.read / group.papers) * 100) : 0;
    row.append(element('span', 'tally', `${group.reviewed}/${group.scopes.length} reviewed · ${share}% read`));
  }
  const key = section.appendChild(element('p', 'progress-key'));
  key.append(element('span', 'pip reviewed'), ' reviewed ', element('span', 'pip read'), ' read, no review ', element('span', 'pip'), ' to read');
  return section;
}
