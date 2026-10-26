// Where the chat sits: below, above, left or right of the paper, or on a tab of its own; shown
// or hidden; and how much of the screen it takes, dragged at the split. Each device remembers
// its own, since a tablet held upright, one held sideways and the laptop want different ones.

export const PLACES = ['bottom', 'top', 'left', 'right', 'tab'];
export const DEFAULT_LAYOUT = { place: 'bottom', hidden: false, share: 0.4 };
const SHARE_MIN = 0.15;
const SHARE_MAX = 0.85;
const LAYOUT_KEY = 'carrel.layout';

/** A remembered layout, checked: whatever does not fit is the default. */
export function restoreLayout(stored) {
  const layout = { ...DEFAULT_LAYOUT };
  if (!stored || typeof stored !== 'object') return layout;
  if (PLACES.includes(stored.place)) layout.place = stored.place;
  if (typeof stored.hidden === 'boolean') layout.hidden = stored.hidden;
  if (typeof stored.share === 'number' && Number.isFinite(stored.share)) layout.share = clampShare(stored.share);
  return layout;
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
 * and the layout sheet. `onChange(layout)` follows every change; `onDragEnd` follows a drag.
 */
export function startLayout({ onChange, onDragEnd }) {
  const body = document.body;
  const divider = document.getElementById('divider');
  const toggle = document.getElementById('chat-toggle');
  const button = document.getElementById('layout-button');
  const sheet = document.getElementById('layout-sheet');
  let layout = load();

  function apply() {
    for (const place of PLACES) body.classList.toggle(`chat-${place}`, layout.place === place);
    body.classList.toggle('chat-hidden', layout.hidden && layout.place !== 'tab');
    body.style.setProperty('--chat-share', String(layout.share));
    toggle.hidden = layout.place === 'tab';
    toggle.setAttribute('aria-pressed', String(!layout.hidden));
    for (const choice of sheet.querySelectorAll('[data-place]')) {
      choice.setAttribute('aria-checked', String(choice.dataset.place === layout.place));
    }
    onChange(layout);
  }

  function set(patch, { keep = true } = {}) {
    layout = { ...layout, ...patch };
    if (keep) save(layout);
    apply();
  }

  // The split, dragged.
  divider.addEventListener('pointerdown', (event) => {
    if (layout.place === 'tab') return;
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    body.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (event) => {
    if (!body.classList.contains('dragging')) return;
    const share = shareAt(layout.place, event.clientX, event.clientY, window.innerWidth, window.innerHeight);
    if (share != null) set({ share }, { keep: false });
  });
  const release = () => {
    if (!body.classList.contains('dragging')) return;
    body.classList.remove('dragging');
    save(layout);
    onDragEnd();
  };
  divider.addEventListener('pointerup', release);
  divider.addEventListener('pointercancel', release);
  // A double tap on the split puts it back where it started.
  divider.addEventListener('dblclick', () => set({ share: DEFAULT_LAYOUT.share }));

  toggle.addEventListener('click', () => set({ hidden: !layout.hidden }));

  // The sheet: where the chat sits.
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
    set({ share: DEFAULT_LAYOUT.share });
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
    return { ...DEFAULT_LAYOUT };
  }
}

function save(layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private browsing: the layout lasts as long as the page.
  }
}
