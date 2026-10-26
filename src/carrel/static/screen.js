// The reading page fills the part of the screen that is visible, and moves with it.
//
// When the iPad's keyboard comes up, Safari leaves the page its full height and scrolls it up
// to show the box being typed in, or sometimes does not, and the box ends up under the keyboard.
// Instead the page is pinned to the visual viewport, the area above the keyboard: the PDF gets
// shorter, and the chat keeps enough height to show the answer and what is being typed.
// (`interactive-widget=resizes-content` would do this in Chrome; Safari does not know it.)

// The chat's share of the screen, and the most of the visible area it takes with the keyboard up.
const CHAT_SHARE = 0.4;
const CHAT_MOST = 0.7;
// A visible area this much shorter than the window means a keyboard is up.
const KEYBOARD_PX = 120;

export function fitToVisibleArea() {
  const visible = window.visualViewport;
  if (!visible) return;
  const root = document.documentElement;
  let frame = 0;
  const fit = () => {
    frame = 0;
    const height = visible.height;
    root.style.setProperty('--visible-top', `${visible.offsetTop}px`);
    root.style.setProperty('--visible-height', `${height}px`);
    root.style.setProperty('--chat-height', `${Math.round(Math.min(CHAT_SHARE * window.innerHeight, CHAT_MOST * height))}px`);
    root.classList.toggle('keyboard', window.innerHeight - height > KEYBOARD_PX);
  };
  const later = () => {
    frame ||= requestAnimationFrame(fit);
  };
  visible.addEventListener('resize', later);
  visible.addEventListener('scroll', later);
  window.addEventListener('resize', later);
  fit();
}
