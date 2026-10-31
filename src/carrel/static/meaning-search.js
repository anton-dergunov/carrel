// The search box's Meaning depth: the papers nearest a description by what they are about,
// ranked on the laptop (GET /api/meaning) in the area showing or the whole library. They come
// as rows, nearest first, each with a small meter after its year of how near it is among them.

import { element, paperRow } from './rows.js';
import { note, startAsking } from './server-search.js';

const WAIT_MS = 400;
export const SHORTEST = 3;
export const STEPS = 4;

/** How close a paper is among the results, 1 to STEPS: the nearest is STEPS, the farthest 1. */
export function closeness(score, top, floor) {
  if (!(top > floor)) return STEPS;
  const share = Math.min(1, Math.max(0, (score - floor) / (top - floor)));
  return 1 + Math.round(share * (STEPS - 1));
}

/**
 * Returns `search(slot, query, topic, lookup, {rich})`, which draws the papers into `slot` once
 * they come (`lookup(found)` gives a found paper's entry in the library, or null for one the
 * chips leave out), and `stop()`.
 */
export function startMeaningSearch() {
  const asking = startAsking({ wait: WAIT_MS });

  function search(slot, query, topic, lookup = (found) => found, { rich = false } = {}) {
    query = query.trim();
    if (query.length < SHORTEST) {
      asking.stop();
      slot.replaceChildren(note('Describe what you are looking for, in a few words or a sentence.'));
      return;
    }
    const url = `/api/meaning?${new URLSearchParams({ q: query, topic })}`;
    asking.ask(slot, `${topic}\n${query}`, url, (results) => draw(slot, results, topic, lookup, rich), 'Searching by meaning…');
  }

  function draw(slot, results, topic, lookup, rich) {
    const found = results.papers;
    const shown = found.map((paper) => ({ ...paper, entry: lookup(paper) })).filter((paper) => paper.entry);
    const head = element('h3', 'group text-head');
    const where = topic ? ` in ${topic}` : '';
    const filtered = shown.length < found.length ? `, ${shown.length} through the filters` : '';
    head.append(element('span', 'name', `Meaning: the ${found.length} papers nearest “${results.query}”${where}${filtered}`));
    const list = element('div', `rows ${rich ? 'rich' : 'compact'}`);
    const top = found[0]?.score ?? 0;
    const floor = found.at(-1)?.score ?? 0;
    for (const paper of shown) list.append(row(paper, closeness(paper.score, top, floor), rich));
    const parts = [head, list];
    if (found.length && !shown.length) parts.push(note('None of them passes the filters.'));
    if (!found.length) parts.push(note('No papers here.'));
    slot.replaceChildren(...parts);
  }

  function row(found, steps, rich) {
    const made = paperRow(found.entry, { rich, topic: true });
    const meter = element('span', 'near');
    meter.title = `Nearness ${steps} of ${STEPS} among these results`;
    meter.setAttribute('aria-label', meter.title);
    meter.setAttribute('role', 'img');
    meter.append(...Array.from({ length: STEPS }, (_, i) => element('span', i < steps ? 'on' : '')));
    made.querySelector('.head').append(meter);
    return made;
  }

  return { search, stop: asking.stop };
}
