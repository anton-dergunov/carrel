// Where the chat sits: below, above, left or right of the paper, or on a tab of its own; shown
// or hidden; and how much of the screen it takes, dragged at the split, kept for each side, since
// a chat below wants a share of the height and one beside a share of the width. Each device
// remembers its own, since a tablet held upright, one held sideways and the laptop want different ones.

export const PLACES = ['bottom', 'top', 'left', 'right', 'tab'];
const SIDES = ['bottom', 'top', 'left', 'right'];
export const DEFAULT_SHARE = 0.4;
export const DEFAULT_LAYOUT = {
  place: 'bottom',
  hidden: false,
  shares: Object.fromEntries(SIDES.map((side) => [side, DEFAULT_SHARE])),
};
const SHARE_MIN = 0.15;
const SHARE_MAX = 0.85;
const LAYOUT_KEY = 'carrel.layout';

/** A remembered layout, checked: whatever does not fit is the default. */
export function restoreLayout(stored) {
  const layout = { ...DEFAULT_LAYOUT, shares: { ...DEFAULT_LAYOUT.shares } };
  if (!stored || typeof stored !== 'object') return layout;
  if (PLACES.includes(stored.place)) layout.place = stored.place;
  if (typeof stored.hidden === 'boolean') layout.hidden = stored.hidden;
  for (const side of SIDES) {
    const share = stored.shares?.[side];
    if (typeof share === 'number' && Number.isFinite(share)) layout.shares[side] = clampShare(share);
  }
  return layout;
}

/** The chat's share of the screen where it sits now. */
export function shareOf(layout) {
  return layout.shares[layout.place] ?? DEFAULT_SHARE;
}

export function clampShare(share) {
  return Math.min(SHARE_MAX, Math.max(SHARE_MIN, share));
}

/** The chat's share when the split is dragged to (x, y), on a screen width × height. */
export function shareAt(place, x, y, width, height) {
  switch (place) {
    case 'bottom':
      return clampShare((height - y) / height);
    case 'top':
      return clampShare(y / height);
    case 'left':
      return clampShare(x / width);
    case 'right':
      return clampShare((width - x) / width);
    default:
      return null;
  }
}

/**
 * Applies the remembered layout to the page and runs its controls: the split, the Chat button
 * and the view sheet. `onChange(layout)` follows every change, `onResize(layout)` the size
 * while the split is dragged, and `onDragEnd()` the drag's end.
 */
export function startLayout({ onChange, onResize, onDragEnd }) {
  const body = document.body;
  const divider = document.getElementById('divider');
  const toggle = document.getElementById('chat-toggle');
  const button = document.getElementById('view-button');
  const sheet = document.getElementById('view-sheet');
  let layout = load();

  function apply() {
    for (const place of PLACES) body.classList.toggle(`chat-${place}`, layout.place === place);
    body.classList.toggle('chat-hidden', layout.hidden && layout.place !== 'tab');
    body.style.setProperty('--chat-share', String(shareOf(layout)));
    // The Chat button draws where the chat sits, outlined when it is hidden. On a tab of its own,
    // the chat's tab does this button's work.
    toggle.hidden = layout.place === 'tab';
    toggle.setAttribute('aria-pressed', String(!layout.hidden));
    if (layout.place !== 'tab') {
      toggle.querySelector('use').setAttribute('href', `#i-panel-${layout.place}${layout.hidden ? '-dashed' : ''}`);
    }
    for (const choice of sheet.querySelectorAll('[data-place]')) {
      choice.setAttribute('aria-checked', String(choice.dataset.place === layout.place));
    }
    onChange(layout);
  }

  function set(patch) {
    layout = { ...layout, ...patch };
    save(layout);
    apply();
  }

  // The split, dragged: the panes follow the finger, one step a frame, and the size is kept when
  // it lifts. The PDF keeps its scale meanwhile and fits the new width at the end (read.js).
  let drag = null;
  divider.addEventListener('pointerdown', (event) => {
    if (layout.place === 'tab') return;
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    drag = { share: shareOf(layout), frame: 0 };
    body.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (event) => {
    if (!drag) return;
    drag.share = shareAt(layout.place, event.clientX, event.clientY, window.innerWidth, window.innerHeight);
    drag.frame ||= requestAnimationFrame(() => {
      if (!drag) return;
      drag.frame = 0;
      layout = { ...layout, shares: { ...layout.shares, [layout.place]: drag.share } };
      body.style.setProperty('--chat-share', String(drag.share));
      onResize(layout);
    });
  });
  const release = () => {
    if (!drag) return;
    cancelAnimationFrame(drag.frame);
    const { share } = drag;
    drag = null;
    body.classList.remove('dragging');
    set({ shares: { ...layout.shares, [layout.place]: share } });
    onDragEnd();
  };
  divider.addEventListener('pointerup', release);
  divider.addEventListener('pointercancel', release);
  // A double tap on the split puts it back where it started.
  divider.addEventListener('dblclick', () => set({ shares: { ...layout.shares, [layout.place]: DEFAULT_SHARE } }));

  toggle.addEventListener('click', () => set({ hidden: !layout.hidden }));

  // The sheet: where the chat sits, and later how the paper is shown.
  const openSheet = (open) => {
    sheet.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => openSheet(sheet.hidden));
  for (const choice of sheet.querySelectorAll('[data-place]')) {
    choice.addEventListener('click', () => {
      set({ place: choice.dataset.place, hidden: false });
      openSheet(false);
    });
  }
  document.getElementById('reset-size').addEventListener('click', () => {
    set({ shares: { ...layout.shares, [layout.place]: DEFAULT_SHARE } });
    openSheet(false);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!sheet.hidden && !sheet.contains(event.target) && !button.contains(event.target)) openSheet(false);
  });

  apply();
  return { get: () => layout, set };
}

function load() {
  try {
    return restoreLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'));
  } catch {
    return restoreLayout(null);
  }
}

function save(layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private browsing: the layout lasts as long as the page.
  }
}
