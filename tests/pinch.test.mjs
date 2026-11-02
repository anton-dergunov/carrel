import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pinchToZoom, wheelFactor } from '../src/carrel/static/pinch.js';
import { blocking, fakePane } from './fake-pane.mjs';

const keys = {};
globalThis.window = { addEventListener: (type, fn) => (keys[type] = fn) };
globalThis.document = { elementFromPoint: () => null };

function zoomable() {
  const pane = fakePane();
  const viewer = { viewer: { style: {} }, pagesCount: 3, currentScale: 1, getPageView: () => null };
  pinchToZoom({ container: pane, viewer, eventBus: { on() {} } });
  return { pane, viewer };
}

const fingers = (...xs) => xs.map((x) => ({ clientX: x, clientY: 500 }));

test('the pane is never made to wait for a scroll while nothing is pinched', () => {
  const { pane } = zoomable();
  assert.deepEqual(blocking(pane), []);
});

test("a touch pinch holds the fingers' moves only while it lasts", () => {
  const { pane, viewer } = zoomable();
  pane.fire('touchstart', { touches: fingers(300, 500) });
  assert.deepEqual(blocking(pane), ['touchmove']);
  assert.equal(pane.style.overflow, 'hidden');
  pane.fire('touchmove', { touches: fingers(200, 600) });
  pane.fire('touchend', { touches: fingers(200) });
  assert.deepEqual(blocking(pane), []);
  assert.equal(pane.style.overflow, '');
  assert.equal(viewer.currentScale, 2);
});

test('the wheel is held only while ctrl is, for a mouse to zoom without scrolling', () => {
  const { pane, viewer } = zoomable();
  keys.keydown({ ctrlKey: true });
  assert.deepEqual(blocking(pane), ['wheel']);
  let cancelled = false;
  pane.fire('wheel', { ctrlKey: true, deltaY: -50, clientX: 400, clientY: 500, preventDefault: () => (cancelled = true) });
  assert.equal(cancelled, true);
  assert.equal(viewer.viewer.style.transform, `translate(0px, 0px) scale(${wheelFactor({ deltaY: -50 })})`);
  keys.keyup({ ctrlKey: false });
  assert.deepEqual(blocking(pane), []);
  assert.equal(pane.listeners.filter(({ type }) => type === 'wheel').length, 1);
});

test("a trackpad's pinch, with no key held, zooms through the passive wheel", () => {
  const { pane, viewer } = zoomable();
  pane.fire('wheel', { ctrlKey: true, deltaY: -50, clientX: 400, clientY: 500, preventDefault: () => assert.fail('cancelled') });
  assert.equal(pane.style.overflow, 'hidden');
  assert.equal(viewer.viewer.style.transform, `translate(0px, 0px) scale(${wheelFactor({ deltaY: -50 })})`);
  assert.deepEqual(blocking(pane), []);
});
