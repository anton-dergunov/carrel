// The paper list, on its own tab: narrow it as the reader types, by every word in the title or
// the topic, and open a paper in a tab of its own.

import { fileFromPath } from './tabs.js';

export function startPaperList({ openPaper }) {
  const list = document.getElementById('papers');
  const filter = document.getElementById('filter');
  const sections = [...list.querySelectorAll('section')];
  const entries = sections.map((section) => {
    const topic = section.querySelector('h2').textContent.toLowerCase();
    const items = [...section.querySelectorAll('li')].map((li) => [li, `${topic} ${li.textContent.toLowerCase()}`]);
    return [section, items];
  });

  filter.addEventListener('input', () => {
    const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const [section, items] of entries) {
      let shown = 0;
      for (const [li, text] of items) {
        const match = words.every((word) => text.includes(word));
        li.hidden = !match;
        shown += match;
      }
      section.hidden = shown === 0;
    }
  });

  list.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    const pdf = link && fileFromPath(new URL(link.href).pathname);
    if (!pdf) return;
    event.preventDefault();
    openPaper({ pdf, title: link.textContent });
  });
}
