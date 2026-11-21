// The peek at a paper a link names, in a review or a chat: a small card with the paper's title,
// year and summary, and Open, plus Open at p. N for each page of it the same paragraph cites, and
// the reader's star. One card for the page, over whichever pane the link is in.

import { parsePaperLink, sameFile } from './links.js';
import { starButton } from './marks.js';
import { element, marks, shortAuthors, typeIcon } from './rows.js';

/**
 * `openPaper({pdf, title})` and `openTarget({file, page})` open tabs. Returns `show(link, paper,
 * area)`, for a paper ({pdf, title, …} as the library's document has it) and the element whose
 * box the card stays in, `toggle(…)`, the same unless that link's peek is open, which it closes,
 * and `close()`.
 */
export function startPeek({ openPaper, openTarget }) {
  const peek = document.getElementById('peek');
  let peeked = null; // the link whose peek is open

  function show(link, paper, area) {
    close();
    const title = paper.title ?? link.textContent;
    const card = [];
    const kicker = element('p', 'peek-kicker');
    if (paper.type) kicker.append(typeIcon(paper.type));
    kicker.append(element('span', '', [paper.type, paper.topic, paper.year].filter(Boolean).join(' · ')));
    if (paper.text) kicker.append(marks(paper));
    card.push(kicker, element('p', 'peek-title', title));
    const authors = shortAuthors(paper.authors, 4);
    if (authors) card.push(element('p', 'peek-authors', authors));
    if (paper.summary) card.push(element('p', 'peek-summary', paper.summary));
    const actions = element('div', 'peek-actions');
    const openButton = actions.appendChild(element('button', 'primary', 'Open'));
    openButton.type = 'button';
    openButton.addEventListener('click', () => {
      close();
      openPaper({ pdf: paper.pdf, title });
    });
    for (const page of citedPages(link, paper.pdf)) {
      const button = actions.appendChild(element('button', 'secondary', `p. ${page}`));
      button.type = 'button';
      button.title = `Open at page ${page}`;
      button.addEventListener('click', () => {
        close();
        openTarget({ file: paper.pdf, page });
      });
    }
    if (paper.text) actions.append(starButton(paper.pdf, paper.starred));
    peek.replaceChildren(...card, actions);
    peek.hidden = false;
    peeked = link;
    link.classList.add('peeked');
    place(link, area);
  }

  function toggle(link, paper, area) {
    if (peeked === link) close();
    else show(link, paper, area);
  }

  /** Under the link when there is room, else over it; inside the area's width. */
  function place(link, area) {
    const box = link.getBoundingClientRect();
    const bounds = area.getBoundingClientRect();
    const width = Math.min(380, bounds.width - 24);
    peek.style.width = `${width}px`;
    const left = Math.max(bounds.left + 12, Math.min(box.left + box.width / 2 - width / 2, bounds.right - width - 12));
    peek.style.left = `${left}px`;
    const height = peek.offsetHeight;
    const below = box.bottom + 8;
    const top = below + height <= bounds.bottom - 8 ? below : Math.max(bounds.top + 8, box.top - height - 8);
    peek.style.top = `${top}px`;
  }

  function close() {
    if (peek.hidden) return;
    peek.hidden = true;
    peek.replaceChildren();
    peeked?.classList.remove('peeked');
    peeked = null;
  }

  document.addEventListener('pointerdown', (event) => {
    if (!peek.hidden && !peek.contains(event.target) && event.target !== peeked && !peeked?.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  return { show, toggle, close };
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
