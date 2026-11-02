// A scrolling pane for the gesture tests: it keeps its listeners and the options they came with.

export function fakePane() {
  const listeners = [];
  return {
    listeners,
    style: {},
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 800,
    clientWidth: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 1000 }),
    addEventListener(type, fn, options) {
      listeners.push({ type, fn, passive: options?.passive ?? true });
    },
    removeEventListener(type, fn) {
      const at = listeners.findIndex((listener) => listener.type === type && listener.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    fire(type, event) {
      for (const listener of listeners.filter((one) => one.type === type)) listener.fn({ preventDefault() {}, ...event });
    },
  };
}

/** The pane's listeners that may cancel a scroll. */
export const blocking = (pane) =>
  pane.listeners.filter(({ type, passive }) => ['wheel', 'touchstart', 'touchmove'].includes(type) && !passive).map(({ type }) => type);
