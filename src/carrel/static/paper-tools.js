// What acts on the paper showing, kept off the screen until asked for, since the paper and the
// chat already share a small one:
//
// - the page badge, faint in the PDF's corner, which opens the paper's contents and a field to
//   go to a page;
// - find, which takes the place of the tabs in the bar while it is open.

export function startPaperTools({ reader }) {
  const body = document.body;
  const badge = document.getElementById('page-badge');
  const sheet = document.getElementById('contents-sheet');
  const pageForm = document.getElementById('go-to-page');
  const pageNumber = document.getElementById('page-number');
  const pageCount = document.getElementById('page-count');
  const outlineNav = document.getElementById('outline');
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
    findInput.focus();
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
