// The reading page fills the part of the screen that is visible, and moves with it.
//
// When the iPad's keyboard comes up, Safari leaves the page its full height and scrolls it up
// to show the box being typed in, or sometimes does not, and the box ends up under the keyboard.
// Instead the page is pinned to the visual viewport, the area above the keyboard: the PDF gets
// shorter, and the chat keeps enough height to show the answer and what is being typed.
// (`interactive-widget=resizes-content` would do this in Chrome; Safari does not know it.)
// Every layout fits this area: above or below the paper, the chat is `--chat-height` tall; beside
// it or on a tab, it is as tall as the area.
//
// Safari still slides the whole page up while its keyboard rises, sometimes, and reports where
// it went only now and then, often at the end. Fitting then put the page back a moment late: the
// paper went up and came down, and the other way when the keyboard went away. So a tap on a box
// focuses it without that scroll, as lectern's find does, and while the keyboard comes and goes
// the page is fitted at every frame rather than at Safari's reports.
//
// A dialog (the chat's settings) is fitted to the visible area too (`--area-*`), but while one is
// open the page under it stays as it was: lifting the chat over the keyboard is no use then. It
// stays so until the keyboard the dialog brought has gone, or the page needs it for its own box;
// fitted as the dialog closed, the chat went up for a moment and came down with the keyboard.

// The most of the visible area the chat takes, above or below the paper, with the keyboard up.
const CHAT_MOST = 0.7;
// A visible area this much shorter than the window means a keyboard is up.
const KEYBOARD_PX = 120;
// How long the keyboard takes to come or go, and a little more.
const KEYBOARD_MS = 700;
const FIELDS = 'textarea, input:not([type="checkbox"], [type="radio"], [type="button"])';

/** `chatShare()` is the chat's share of the screen's height. Returns a function that fits again. */
export function fitToVisibleArea(chatShare) {
  const visible = window.visualViewport;
  if (!visible) return () => {};
  const root = document.documentElement;
  const shown = {};
  // Only what changed is set, since this runs at every frame while the keyboard moves.
  const set = (name, value) => {
    if (shown[name] !== value) root.style.setProperty(name, (shown[name] = value));
  };
  let held = false; // the page is kept as it was under a dialog
  const fit = () => {
    const height = visible.height;
    const keyboard = window.innerHeight - height > KEYBOARD_PX;
    set('--area-top', `${visible.offsetTop}px`);
    set('--area-height', `${height}px`);
    set('--area-bottom', `${Math.max(0, window.innerHeight - visible.offsetTop - height)}px`);
    if (document.querySelector('dialog[open]')) held = true;
    else if (!keyboard) held = false;
    if (held) return;
    set('--visible-top', `${visible.offsetTop}px`);
    set('--visible-height', `${height}px`);
    set('--chat-height', `${Math.round(Math.min(chatShare() * window.innerHeight, CHAT_MOST * height))}px`);
    root.classList.toggle('keyboard', keyboard);
  };

  // Every frame for a while: the keyboard is coming or going.
  let until = 0;
  let frame = 0;
  const follow = () => {
    until = performance.now() + KEYBOARD_MS;
    const step = () => {
      fit();
      frame = performance.now() < until ? requestAnimationFrame(step) : 0;
    };
    frame ||= requestAnimationFrame(step);
  };

  visible.addEventListener('resize', fit);
  visible.addEventListener('scroll', fit);
  window.addEventListener('resize', fit);
  // A dialog closed: the page fits the area as it is now. (`close` does not bubble; it is caught
  // on its way down.)
  document.addEventListener('close', fit, true);
  document.addEventListener('focusin', (event) => {
    if (!event.target.matches?.(FIELDS)) return;
    // A box of the page's own, with the keyboard still up from a dialog: the page makes room now.
    if (!event.target.closest('dialog')) held = false;
    follow();
  });
  document.addEventListener('focusout', (event) => {
    if (event.target.matches?.(FIELDS)) follow();
  });
  // A tap on a box that is not being typed in: focus it here, without the scroll towards it.
  // The keyboard still comes up, since this is the tap itself. A finger that moved was scrolling.
  let moved = false;
  document.addEventListener('touchstart', () => (moved = false), { passive: true });
  document.addEventListener('touchmove', () => (moved = true), { passive: true });
  document.addEventListener(
    'touchend',
    (event) => {
      const field = event.target.closest?.(FIELDS);
      if (moved || !field || field === document.activeElement || field.disabled || field.readOnly) return;
      event.preventDefault();
      field.focus({ preventScroll: true });
    },
    { passive: false },
  );
  fit();
  return fit;
}
