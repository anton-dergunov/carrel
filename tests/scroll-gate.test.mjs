import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holdWhileFast, scrollSpeed } from '../src/carrel/static/scroll-gate.js';

test('a scroll is measured over its last 120 ms, from three events on', () => {
  const at = (t, top) => ({ t, top, left: 0 });
  assert.equal(scrollSpeed([at(0, 0), at(16, 400)], 20), 0); // a jump
  assert.equal(scrollSpeed([at(0, 0), at(16, 400), at(32, 800)], 40), 20);
  assert.equal(scrollSpeed([at(0, 0), at(16, 400), at(32, 800)], 200), 0); // over
  // Old events do not count.
  assert.equal(scrollSpeed([at(0, 0), at(500, 10_000), at(516, 10_100), at(532, 10_200)], 540), 5);
});

/** A viewer and its container, as much of them as the gate touches. */
function fakes() {
  const container = Object.assign(new EventTarget(), { clientHeight: 1000, scrollTop: 0, scrollLeft: 0 });
  const viewer = {
    drawn: 0,
    asked: 0,
    forceRendering() {
      this.drawn++;
      return true;
    },
    renderingQueue: {
      renderHighestPriority: () => viewer.asked++,
    },
  };
  return { container, viewer };
}

function flick(container) {
  for (let i = 1; i <= 5; i++) {
    container.scrollTop = i * 2000;
    container.dispatchEvent(new Event('scroll'));
  }
}

test('nothing is drawn while the paper flies past, and the pages in view are once it stops', async () => {
  const { container, viewer } = fakes();
  holdWhileFast({ viewer, container });
  flick(container);
  assert.equal(viewer.forceRendering(), true); // the queue is kept from going idle
  assert.equal(viewer.drawn, 0);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(viewer.asked, 1);
  viewer.forceRendering();
  assert.equal(viewer.drawn, 1);
});

test('a slow scroll, a jump and e-ink draw at once', () => {
  const { container, viewer } = fakes();
  let eink = false;
  holdWhileFast({ viewer, container, when: () => !eink });
  container.scrollTop = 300;
  container.dispatchEvent(new Event('scroll'));
  viewer.forceRendering();
  assert.equal(viewer.drawn, 1);
  eink = true;
  flick(container);
  viewer.forceRendering();
  assert.equal(viewer.drawn, 2);
});
