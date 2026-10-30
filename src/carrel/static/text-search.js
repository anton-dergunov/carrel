// The search box's Text depth: the papers' text, searched on the laptop (GET /api/search), in
// the area showing or the whole library. Results come grouped by paper, the most matches first,
// each with a few snippets and their pages; a tap on one opens the paper at that page, with the
// words in find.

import { element, paperRow } from './rows.js';
import { plural } from './areas.js';

const WAIT_MS = 300;
export const SHORTEST = 3;

/**
 * `openTarget({file, page, search})` opens a paper there. Returns `search(slot, query, topic,
 * lookup)`, which draws the results into `slot` once they come (`lookup(found)` gives a found
 * paper's entry in the library, or null for one the chips leave out), and `stop()`.
 */
export function startTextSearch({ openTarget }) {
  let timer = 0;
  let asking = null; // the request in flight, aborted by the next
  let last = null; // {key, results}: the last answer, drawn again without asking
  let slotNow = null;

  function stop() {
    clearTimeout(timer);
    asking?.abort();
    asking = null;
  }

  function search(slot, query, topic, lookup = (found) => found, { rich = false } = {}) {
    slotNow = slot;
    query = query.trim();
    if (query.length < SHORTEST) {
      stop();
      slot.replaceChildren(note(`Type ${SHORTEST} letters or more to search the papers' text.`));
      return;
    }
    const key = `${topic}\n${query}`;
    if (last?.key === key) {
      stop();
      draw(slot, last.results, topic, lookup, rich);
      return;
    }
    stop();
    slot.replaceChildren(note('Searching the papers…', 'searching'));
    timer = setTimeout(async () => {
      const controller = new AbortController();
      asking = controller;
      let response;
      try {
        response = await fetch(`/api/search?${new URLSearchParams({ q: query, topic })}`, { signal: controller.signal });
      } catch (error) {
        if (error.name !== 'AbortError' && slotNow === slot) slot.replaceChildren(note('Could not reach the laptop.', 'error'));
        return;
      }
      const results = await response.json().catch(() => ({ error: response.statusText }));
      if (asking !== controller) return;
      asking = null;
      if (!response.ok) {
        slot.replaceChildren(note(results.error ?? 'The search failed.', 'error'));
        return;
      }
      last = { key, results };
      if (slotNow === slot) draw(slot, results, topic, lookup, rich);
    }, WAIT_MS);
  }

  function draw(slot, results, topic, lookup, rich) {
    const shown = results.papers.map((found) => ({ ...found, entry: lookup(found) })).filter((found) => found.entry);
    const head = element('h3', 'group text-head');
    const where = topic ? ` in ${topic}` : '';
    const more = results.total > results.papers.length ? `, the ${results.papers.length} with the most matches shown` : '';
    head.append(element('span', 'name', `Text: ${plural(results.total, 'paper')}${where}${more}`));
    const parts = [head];
    if (results.papers.length && !shown.length) parts.push(note('None of them passes the filters.'));
    for (const paper of shown) parts.push(result(paper, results.query, rich));
    if (!results.total) parts.push(note(`No paper's text holds “${results.query}”.`));
    slot.replaceChildren(...parts);
  }

  function result(found, query, rich) {
    const box = element('div', 'text-result');
    const row = box.appendChild(paperRow(found.entry, { rich }));
    row.querySelector('.year').textContent = `${found.count}×`;
    row.querySelector('.year').title = `${plural(found.count, 'match', 'matches')} in its text`;
    const list = box.appendChild(element('ul', 'snippets'));
    for (const hit of found.hits) {
      const item = list.appendChild(element('li'));
      const button = item.appendChild(element('button', 'snippet'));
      button.type = 'button';
      button.append(element('span', 'page', hit.page ? `p. ${hit.page}` : 'p. 1'));
      const words = button.appendChild(element('span', 'words'));
      words.append(`…${hit.before.trimStart()}`, element('mark', '', hit.match), `${hit.after.trimEnd()}…`);
      button.addEventListener('click', () => openTarget({ file: found.pdf, page: hit.page ?? 1, search: query }));
    }
    const rest = found.count - found.hits.length;
    if (rest > 0) list.append(element('li', 'more', `+${rest} more in the paper`));
    return box;
  }

  return { search, stop };
}

function note(text, className = '') {
  return element('p', `list-note ${className}`.trim(), text);
}
