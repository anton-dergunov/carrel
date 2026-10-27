// What acts on the paper showing, kept off the screen until asked for, since the paper and the
// chat already share a small one:
//
// - the page badge, faint in the PDF's corner, which opens what the library knows of the paper
//   (from its frontmatter, with no model call), a field to go to a page, and its contents;
// - find, which takes the place of the tabs in the bar while it is open.

/** `showOverview()` shows the paper's overview note, beside it. */
export function startPaperTools({ reader, showOverview }) {
  const body = document.body;
  const badge = document.getElementById('page-badge');
  const sheet = document.getElementById('contents-sheet');
  const pageForm = document.getElementById('go-to-page');
  const pageNumber = document.getElementById('page-number');
  const pageCount = document.getElementById('page-count');
  const outlineNav = document.getElementById('outline');
  const infoBox = document.getElementById('paper-info');
  const findButton = document.getElementById('find-button');
  const findForm = document.getElementById('find');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');

  // The contents.

  let outlineOf = null; // the paper whose outline is drawn

  function openContents(open) {
    sheet.hidden = !open;
    badge.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const count = reader.pagesCount();
    pageNumber.max = String(count);
    pageNumber.value = String(reader.currentPage() ?? '');
    pageCount.textContent = `of ${count}`;
    // Asked each time: the overview note comes and goes.
    void drawInfo(reader.file());
    if (outlineOf !== reader.file()) {
      outlineOf = reader.file();
      void drawOutline(outlineOf);
    }
  }

  async function drawOutline(file) {
    outlineNav.replaceChildren();
    const items = await reader.outline();
    if (file !== reader.file()) return;
    if (!items.length) {
      outlineNav.append(Object.assign(document.createElement('p'), { className: 'none', textContent: 'This PDF has no contents.' }));
      return;
    }
    outlineNav.append(outlineList(items));
  }

  // What the library knows of the paper.

  async function drawInfo(file) {
    const response = await fetch(`/api/paper/${file.split('/').map(encodeURIComponent).join('/')}`).catch(() => null);
    const paper = response?.ok ? await response.json().catch(() => null) : null;
    if (file !== reader.file()) return;
    if (!paper?.info) {
      infoBox.hidden = true;
      return;
    }
    const fields = Object.fromEntries(paper.info.fields);
    const parts = [element('h2', 'title', fields.title ?? paper.title)];
    const byline = element('p', 'byline');
    if (fields.authors?.length) byline.append(authors([fields.authors].flat()));
    if (fields.published) byline.append(element('span', 'year', String(fields.published).slice(0, 4)));
    const where = source(fields);
    if (where) byline.append(where);
    parts.push(byline);
    if (fields.summary) parts.push(element('p', 'summary', fields.summary));
    const facts = element('p', 'facts');
    for (const [label, value] of [
      ['Type', fields.type],
      ['Topic', paper.info.topic],
      ['Added', fields.added],
      ['Text layer', fields['text-layer']],
    ]) {
      if (value) facts.append(element('span', 'fact', `${label}: ${value}`));
    }
    if (facts.childElementCount) parts.push(facts);
    if (paper.info.overview) {
      const button = element('button', 'plain overview-link', 'Overview');
      button.type = 'button';
      button.addEventListener('click', () => {
        openContents(false);
        showOverview();
      });
      parts.push(button);
    }
    infoBox.replaceChildren(...parts);
    infoBox.hidden = false;
  }

  /** The authors, the first few shown and the rest a tap away. */
  function authors(names) {
    const SHOWN = 3;
    if (names.length <= SHOWN + 1) return element('span', 'authors', names.join(', '));
    const fold = element('details', 'authors');
    fold.append(element('summary', '', `${names.slice(0, SHOWN).join(', ')} and ${names.length - SHOWN} more`));
    fold.append(element('span', 'all', names.join(', ')));
    return fold;
  }

  /** Where the paper comes from: its arXiv page, or its address. */
  function source(fields) {
    const href = fields.arxiv ? `https://arxiv.org/abs/${fields.arxiv}` : fields.url;
    if (!href || !/^https?:/.test(href)) return null;
    const link = element('a', 'source', fields.arxiv ? `arXiv ${fields.arxiv}` : new URL(href).hostname);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  function outlineList(items) {
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
      if (item.items?.length) entry.append(outlineList(item.items));
    }
    return list;
  }

  badge.addEventListener('click', () => openContents(sheet.hidden));
  pageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const page = Number.parseInt(pageNumber.value, 10);
    if (page >= 1 && page <= reader.pagesCount()) {
      pageNumber.blur();
      openContents(false);
      void reader.goTo({ page });
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!sheet.hidden && !sheet.contains(event.target) && !badge.contains(event.target)) openContents(false);
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

function element(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text != null) made.textContent = text;
  return made;
}
