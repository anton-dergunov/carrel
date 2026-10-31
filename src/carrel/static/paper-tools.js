// What acts on the paper showing, kept off the screen until asked for, since the paper and the
// chat already share a small one:
//
// - the page badge, faint in the PDF's corner, which opens the paper's sheet: a field to go to a
//   page, what the library knows of the paper (paper-sheet.js), and its contents. The sheet is
//   small, by the badge, and closes with a tap anywhere else; it opens out over the page below the
//   tabs, chat and all, and then stays until it is closed. On a phone it opens over the whole page
//   at once.
// - find, which takes the place of the tabs in the bar while it is open.

import { contentsNote, foldSection, startPaperSheet } from './paper-sheet.js';

/**
 * `showOverview()` shows the paper's overview note, beside it; `openPaper({pdf, title})` opens
 * another paper in its tab (a similar one); `onRemoved(pdf)` follows a paper taken out of the
 * library from its sheet.
 */
export function startPaperTools({ reader, showOverview, openPaper = () => {}, onRemoved = () => {} }) {
  const body = document.body;
  const pane = document.getElementById('pdf-pane');
  const badge = document.getElementById('page-badge');
  const sheet = document.getElementById('contents-sheet');
  const sizeButton = document.getElementById('sheet-size');
  const closeButton = document.getElementById('sheet-close');
  const pageForm = document.getElementById('go-to-page');
  const pageNumber = document.getElementById('page-number');
  const pageCount = document.getElementById('page-count');
  const outlineNav = document.getElementById('outline');
  const findButton = document.getElementById('find-button');
  const findForm = document.getElementById('find');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');
  // A phone's screen is too small for the sheet beside the badge: it takes the whole page.
  const phone = matchMedia('(max-width: 599px)');

  const paperSheet = startPaperSheet({
    info: document.getElementById('paper-info'),
    similar: document.getElementById('paper-similar'),
    actions: document.getElementById('paper-actions'),
    isCurrent: (file) => file === reader.file(),
    close: () => openContents(false),
    showOverview,
    openPaper,
    onRemoved,
  });

  // The sheet.

  let large = false; // opened out, over the pane (or the page, on a phone)
  let outlineOf = null; // the paper whose outline is drawn
  const outlineList = document.createElement('div');
  const contents = foldSection('contents', 'list-tree', 'Contents', outlineList);
  outlineNav.append(contents.box);

  function openContents(open, { wide = phone.matches } = {}) {
    sheet.hidden = !open;
    badge.setAttribute('aria-expanded', String(open));
    setLarge(open && wide);
    if (!open) return;
    sheet.scrollTop = 0;
    const count = reader.pagesCount();
    pageNumber.max = String(count);
    pageNumber.value = String(reader.currentPage() ?? '');
    pageCount.textContent = `of ${count}`;
    // Asked each time: the overview note comes and goes.
    void paperSheet.draw(reader.file());
    if (outlineOf !== reader.file()) {
      outlineOf = reader.file();
      void drawOutline(outlineOf);
    }
  }

  function setLarge(on) {
    large = on;
    sheet.classList.toggle('large', on);
    sheet.classList.toggle('full', on && phone.matches);
    // The pane contains its layout, so a sheet over the whole page has to leave it.
    const home = on ? body : pane;
    if (sheet.parentElement !== home) {
      home.insertBefore(sheet, on ? null : badge.nextSibling);
      sheet.scrollTop = 0;
    }
    sizeButton.hidden = phone.matches;
    closeButton.hidden = !on;
    const label = on ? 'Make it small' : 'Open out';
    sizeButton.setAttribute('aria-label', label);
    sizeButton.title = label;
    sizeButton.querySelector('use').setAttribute('href', on ? '#i-minimize-2' : '#i-maximize-2');
  }

  async function drawOutline(file) {
    outlineList.replaceChildren();
    contents.setNote('');
    const items = await reader.outline();
    if (file !== reader.file()) return;
    contents.setNote(contentsNote(items));
    if (!items.length) {
      outlineList.append(Object.assign(document.createElement('p'), { className: 'none', textContent: 'This PDF has no contents.' }));
      return;
    }
    outlineList.append(outlineTree(items));
  }

  function outlineTree(items) {
    const list = document.createElement('ul');
    for (const item of items) {
      const entry = list.appendChild(document.createElement('li'));
      const link = entry.appendChild(document.createElement('button'));
      link.type = 'button';
      link.textContent = item.title;
      link.disabled = !item.dest;
      link.addEventListener('click', () => {
        openContents(false);
        void reader.goToDestination(item.dest);
      });
      if (item.items?.length) entry.append(outlineTree(item.items));
    }
    return list;
  }

  badge.addEventListener('click', () => openContents(sheet.hidden));
  sizeButton.addEventListener('click', () => setLarge(!large));
  closeButton.addEventListener('click', () => openContents(false));
  phone.addEventListener('change', () => {
    if (!sheet.hidden) setLarge(large || phone.matches);
  });
  pageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const page = Number.parseInt(pageNumber.value, 10);
    if (page >= 1 && page <= reader.pagesCount()) {
      pageNumber.blur();
      openContents(false);
      void reader.goTo({ page });
    }
  });
  // The small sheet closes with a tap anywhere else; opened out, it stays until it is closed.
  document.addEventListener('pointerdown', (event) => {
    if (!sheet.hidden && !large && !sheet.contains(event.target) && !badge.contains(event.target)) openContents(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.hidden && !event.defaultPrevented) openContents(false);
  });

  // Find.

  function openFind() {
    body.classList.add('finding');
    findForm.hidden = false;
    findInput.focus({ preventScroll: true });
    findInput.select();
    if (findInput.value) reader.find(findInput.value);
  }

  function closeFind() {
    if (findForm.hidden) return;
    body.classList.remove('finding');
    findForm.hidden = true;
    findCount.textContent = '';
    reader.endFind();
  }

  const again = (previous) => {
    if (findInput.value) reader.find(findInput.value, { again: true, previous });
  };

  findButton.addEventListener('click', openFind);
  findForm.addEventListener('submit', (event) => {
    event.preventDefault();
    again(false);
  });
  findInput.addEventListener('input', () => {
    if (findInput.value) reader.find(findInput.value);
    else findCount.textContent = '';
  });
  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      again(event.shiftKey);
    } else if (event.key === 'Escape') {
      closeFind();
    }
  });
  document.getElementById('find-previous').addEventListener('click', () => again(true));
  document.getElementById('find-next').addEventListener('click', () => again(false));
  document.getElementById('find-done').addEventListener('click', closeFind);

  return {
    /** Opens find with `term` in it; the reader finds it once the paper is at its page. */
    showFind(term) {
      body.classList.add('finding');
      findForm.hidden = false;
      findInput.value = term;
      findCount.textContent = '…';
    },
    /** The page in view, on the badge. */
    showPage(page, count) {
      badge.hidden = !count;
      badge.textContent = `${page} / ${count}`;
      if (!sheet.hidden) pageNumber.value = String(page);
    },
    showFound({ current, total, pending }) {
      if (!findInput.value) findCount.textContent = '';
      else if (pending && !total) findCount.textContent = '…';
      else findCount.textContent = total ? `${current} of ${total}` : 'Not found';
    },
    /** Another tab is showing: the tools of this paper close. */
    leave() {
      closeFind();
      openContents(false);
    },
  };
}
