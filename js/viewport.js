// Keeping the app pinned to the part of the screen you can actually see.
//
// iOS does not shrink the layout viewport when the keyboard opens. It slides
// the whole page up and leaves `position: fixed` measuring against a viewport
// that is now taller than the window. The result is the bug you can watch
// happen: tap the reply box, and the tab bar and compose row end up floating in
// the middle of the screen with the rest of the page still drawn underneath
// them. No amount of `100dvh` fixes it, because dvh describes the layout
// viewport too.
//
// The visual viewport is the one that tells the truth. This publishes it as two
// custom properties and a body class, and the CSS does the rest:
//
//   --vvh  height of what's actually visible
//   --kb   how much of the window the keyboard is covering
//   body.kb-open   set while the keyboard is up
//
// Everything degrades quietly: without visualViewport (older desktop browsers)
// --kb stays 0, .kb-open never appears, and the layout is exactly what it was.

const root = document.documentElement;
// Below this, a viewport change is a browser chrome nudge — Safari's collapsing
// address bar — not a keyboard. Treating those as "keyboard open" would flicker
// the tab bar away every time you scrolled.
const KEYBOARD_MIN = 90;

let raf = 0;

function measure() {
  raf = 0;
  const vv = window.visualViewport;
  if (!vv) return;
  // offsetTop is how far the page has been scrolled up behind the keyboard;
  // without it the inset reads as zero on iOS at the moment the keyboard opens.
  const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
  root.style.setProperty("--kb", `${covered}px`);
  document.body.classList.toggle("kb-open", covered > KEYBOARD_MIN);
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(measure);
}

export function initViewport() {
  const vv = window.visualViewport;
  root.style.setProperty("--vvh", `${Math.round(window.innerHeight)}px`);
  root.style.setProperty("--kb", "0px");
  if (!vv) return;
  vv.addEventListener("resize", schedule);
  // The keyboard animates in, and iOS reports the geometry as it goes — so the
  // final value arrives on a scroll event, not the resize.
  vv.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", () => setTimeout(measure, 300));
  measure();
}

// Bring a just-focused field into view once the keyboard has settled. iOS does
// this itself for a plain input, but not reliably for one inside a sticky bar,
// which is exactly where the reply box lives.
export function keepInView(el) {
  if (!el) return;
  el.addEventListener("focus", () => {
    setTimeout(() => {
      try { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch { }
    }, 300);
  });
}
