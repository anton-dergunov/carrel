// Desk: what to pick up again, what came in lately, and how far the reviews have got. It gives
// the reader a reason to open the library tab.
//
// - Continue: the papers and reviews open on this device, then the papers carrel's chats were
//   about lately.
// - Starred: the papers the reader starred to read later, the newest star first.
// - Tags: the reader's tags, the one used last first (the project of the moment), each opening
//   its papers in All; a pencil edits its description and name, or deletes it.
// - Recently added: the newest papers, and how many came this week.
// - Reviews: each group of review scopes (`review_scopes` in the library's config), a pip per
//   scope, filled once it has a review, and how much of the group the agent has read.

import { areaName, hueOf, hues, plural } from './areas.js';
import { inArea, shortDate, sortPapers } from './library.js';
import { deleteTag, editTag, recentTags, tagName } from './marks.js';
import { element, icon, paperRow, typeIcon } from './rows.js';
import { areaUrl, readingUrl, reviewUrl } from './tabs.js';

const CONTINUE = 8;
const STARRED = 8;
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

/** The starred papers, the newest star first: {papers, total}. */
export function starredList(papers, count = STARRED) {
  const starred = papers.filter((paper) => paper.starred).sort((a, b) => b.starred.localeCompare(a.starred) || a.title.localeCompare(b.title));
  return { papers: starred.slice(0, count), total: starred.length };
}

/**
 * The reader's tags, the one used last first; on the same day, the one this device used last
 * (`recent`, its names the latest first), then by name.
 */
export function tagsByUse(tags = [], recent = []) {
  const place = (name) => (recent.includes(name) ? recent.indexOf(name) : Infinity);
  return [...tags].sort((a, b) => String(b.latest ?? '').localeCompare(String(a.latest ?? '')) || place(a.name) - place(b.name) || a.name.localeCompare(b.name));
}

/** "today", "yesterday", "3 days ago", else the date: how long ago a day ('YYYY-MM-DD') was. */
export function daysAgo(day, today) {
  const days = Math.round((new Date(`${today}T00:00:00`) - new Date(`${day}T00:00:00`)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return shortDate(day, new Date(`${today}T00:00:00`));
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

  const starred = starredList(doc.papers);
  if (starred.total) {
    const section = element('section', 'desk-section starred');
    const head = section.appendChild(element('h3', 'section-title'));
    head.append(element('span', '', 'Starred to read'), element('span', 'aside', String(starred.total)));
    const list = section.appendChild(element('div', 'continue'));
    for (const paper of starred.papers) list.append(starredItem(paper, today));
    if (starred.total > starred.papers.length) {
      const all = section.appendChild(element('button', 'plain see-all', `All ${starred.total} starred →`));
      all.type = 'button';
      all.dataset.allStarred = '';
    }
    parts.push(section);
  }

  if (doc.tags?.length) parts.push(tagSection(doc));

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

function starredItem(paper, today) {
  const link = element('a', 'continue-item');
  link.href = readingUrl(paper.pdf);
  link.dataset.pdf = paper.pdf;
  link.append(typeIcon(paper.type));
  const main = link.appendChild(element('span', 'main'));
  main.append(element('span', 'title', paper.title));
  main.append(element('span', 'meta', [`starred ${daysAgo(paper.starred, today)}`, areaName(paper.topic)].join(' · ')));
  return link;
}

/** The tags, a card each: its name and count, its description, and a pencil. */
function tagSection(doc) {
  const section = element('section', 'desk-section tags');
  const head = section.appendChild(element('h3', 'section-title'));
  head.append(element('span', '', 'Your tags'), element('span', 'aside', String(doc.tags.length)));
  const list = section.appendChild(element('div', 'tag-cards'));
  for (const tag of tagsByUse(doc.tags, recentTags())) list.append(tagCard(tag));
  return section;
}

function tagCard(tag) {
  const card = element('div', 'tag-card');
  const open = card.appendChild(element('button', 'plain tag-open'));
  open.type = 'button';
  open.dataset.allTag = tag.name;
  const name = open.appendChild(element('span', 'tag-title'));
  name.append(icon('tag'), element('span', 'name', tag.name), element('span', 'count', String(tag.count)));
  if (tag.about) open.append(element('span', 'about', tag.about));
  const edit = card.appendChild(element('button', 'icon-button tag-edit'));
  edit.type = 'button';
  edit.setAttribute('aria-label', `Edit the tag ${tag.name}`);
  edit.title = 'Describe, rename or delete';
  edit.append(icon('pencil'));
  edit.addEventListener('click', () => card.replaceWith(tagEditor(tag, () => editor.replaceWith(card))));
  let editor = null;
  const tagEditor = (each, cancel) => {
    editor = element('form', 'tag-card tag-editor');
    const nameField = editor.appendChild(element('input'));
    nameField.type = 'text';
    nameField.value = each.name;
    nameField.setAttribute('aria-label', 'Name');
    nameField.autocapitalize = 'none';
    nameField.spellcheck = false;
    const about = editor.appendChild(element('textarea'));
    about.rows = 2;
    about.value = each.about ?? '';
    about.placeholder = 'What it gathers papers for (optional)';
    about.setAttribute('aria-label', 'What it is for');
    const problem = editor.appendChild(element('p', 'problem'));
    problem.hidden = true;
    const buttons = editor.appendChild(element('div', 'buttons'));
    const save = buttons.appendChild(element('button', '', 'Save'));
    save.type = 'submit';
    const keep = buttons.appendChild(element('button', 'plain', 'Cancel'));
    keep.type = 'button';
    keep.addEventListener('click', cancel);
    const remove = buttons.appendChild(element('button', 'plain danger-text', 'Delete…'));
    remove.type = 'button';
    let sure = false;
    const fail = (error) => {
      problem.hidden = false;
      problem.textContent = String(error.message || error);
    };
    remove.addEventListener('click', async () => {
      if (!sure) {
        sure = true;
        remove.textContent = `Delete: it comes off ${each.count} paper${each.count === 1 ? '' : 's'}`;
        return;
      }
      try {
        await deleteTag(each.name); // the desk is drawn again
      } catch (error) {
        fail(error);
      }
    });
    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      const renamed = tagName(nameField.value);
      if (!renamed) return fail('A name needs letters or digits.');
      try {
        await editTag(each.name, { about: about.value, rename: renamed !== each.name ? renamed : undefined });
      } catch (error) {
        fail(error);
      }
    });
    queueMicrotask(() => about.focus({ preventScroll: true }));
    return editor;
  };
  return card;
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
