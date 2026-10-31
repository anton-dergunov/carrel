// A search the laptop answers, for the box's Text and Meaning depths: asked once the typing
// pauses, the request before it aborted, and the last answer kept, so drawing it again (another
// view, a chip changed) asks nothing.

import { element } from './rows.js';

/** Returns `ask(slot, key, url, draw, waiting)`, which draws `waiting` into `slot`, then calls
 * `draw(results)` with the answer to `url` (the last one again when `key` is the same), and
 * `stop()`. */
export function startAsking({ wait = 300 } = {}) {
  let timer = 0;
  let asking = null; // the request in flight, aborted by the next
  let last = null; // {key, results}
  let slotNow = null;

  function stop() {
    clearTimeout(timer);
    asking?.abort();
    asking = null;
  }

  function ask(slot, key, url, draw, waiting) {
    slotNow = slot;
    stop();
    if (last?.key === key) {
      draw(last.results);
      return;
    }
    slot.replaceChildren(note(waiting, 'searching'));
    timer = setTimeout(async () => {
      const controller = new AbortController();
      asking = controller;
      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
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
      if (slotNow === slot) draw(results);
    }, wait);
  }

  return { ask, stop };
}

export function note(text, className = '') {
  return element('p', `list-note ${className}`.trim(), text);
}
