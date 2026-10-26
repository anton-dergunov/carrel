// The paper list: narrow it as the reader types, by every word in the title or the topic.
const filter = document.getElementById('filter');
const sections = [...document.querySelectorAll('#papers section')];
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
