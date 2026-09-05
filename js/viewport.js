// Keeping the app pinned to the part of the screen you can actually see.
//
// The problem: tap the reply box on an iPhone and the tab bar ends up floating
// in the middle of the screen with the rest of the page drawn underneath it.
//
// There are two different iOS behaviours behind that, and they need different
// answers, which is why this file does the job twice over:
//
//   In Safari, the layout viewport does NOT shrink when the keyboard opens.
//   The page slides up and `position: fixed` keeps measuring against a
//   viewport taller than the window. `100dvh` describes the same wrong thing.
//
//   In a home-screen PWA, iOS may shrink the layout viewport instead — so
//   `window.innerHeight` changes underneath you. Measuring the keyboard as
//   `innerHeight - visualViewport.height` then yields roughly zero, the app
//   concludes no keyboard is open, and nothing moves. That is very likely what
//   was still happening after the first attempt at this.
//
// So: the keyboard's size is measured against the tallest viewport seen for
// this orientation, never against a live `innerHeight` that may already have
// moved. And, more importantly, whether the keyboard is UP is not inferred
// from geometry at all — a focused text field on a touch device means the
// keyboard is up, full stop. Geometry only decides how far to move things.
//
// Published for the CSS:
//   --vvh        height of what's actually visible
//   --kb         how much of the window the keyboard covers (0 if unknowable)
//   --topbar-h   the sticky top bar's real height
//   body.typing  a text field is focused — the keyboard is up
//   body.kb-open the geometry agrees the keyboard is up

const root = document.documentElement;
// Below this, a viewport change is browser chrome — Safari's collapsing
// address bar — not a keyboard.
const KEYBOARD_MIN = 90;

let raf = 0;
// Tallest viewport seen since the last orientation change. The keyboard can
// only ever make the viewport smaller, so this is the "no keyboard" baseline
// even on a platform that shrinks innerHeight out from under us.
let baseline = 0;

function viewportHeight() {
  const vv = window.visualViewport;
  return vv ? vv.height : window.innerHeight;
}

function measure() {
  raf = 0;
  const h = viewportHeight();
  const offset = window.visualViewport ? window.visualViewport.offsetTop : 0;
  baseline = Math.max(baseline, Math.round(h + offset), window.innerHeight);
  const covered = Math.max(0, Math.round(baseline - h - offset));
  root.style.setProperty("--vvh", `${Math.round(h)}px`);
  root.style.setProperty("--vvtop", `${Math.round(offset)}px`);
  root.style.setProperty("--kb", `${covered}px`);
  document.body.classList.toggle("kb-open", covered > KEYBOARD_MIN);
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(measure);
}

// The top bar is sticky and translucent. Anything else that sticks to top: 0 —
// the conversation header, for one — parks itself behind the bar and ghosts
// through the blur permanently. Publishing the bar's real height lets those
// stick just below it instead of behind it.
function measureTopbar() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  root.style.setProperty("--topbar-h", `${Math.round(bar.getBoundingClientRect().height)}px`);
}

// Is this a device with an on-screen keyboard? A focused field on a laptop
// must not hide the navigation.
function touchDevice() {
  return matchMedia("(hover: none) and (pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  // Pickers and checkboxes don't raise a keyboard.
  return !["checkbox", "radio", "button", "submit", "reset", "file", "color", "range"].includes(el.type);
}

function watchFocus() {
  document.addEventListener("focusin", (e) => {
    if (!touchDevice() || !isTextField(e.target)) return;
    document.body.classList.add("typing");
    schedule();
  });
  document.addEventListener("focusout", () => {
    // Tabbing between two fields fires focusout before the next focusin, so
    // check where focus actually landed rather than flickering the tab bar
    // back in for one frame.
    setTimeout(() => {
      if (!isTextField(document.activeElement)) {
        document.body.classList.remove("typing");
        schedule();
      }
    }, 0);
  });
}

export function initViewport() {
  measureTopbar();
  if (window.ResizeObserver) {
    const bar = document.querySelector(".topbar");
    if (bar) new ResizeObserver(measureTopbar).observe(bar);
  }
  watchFocus();

  baseline = window.innerHeight;
  root.style.setProperty("--vvh", `${Math.round(window.innerHeight)}px`);
  root.style.setProperty("--vvtop", "0px");
  root.style.setProperty("--kb", "0px");

  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener("resize", schedule);
  // The keyboard animates in, and iOS reports the geometry as it goes — so the
  // final value arrives on a scroll event, not the resize.
  vv.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", () => {
    // The baseline belongs to one orientation; carrying it across makes the
    // app think a permanent keyboard appeared.
    baseline = 0;
    setTimeout(measure, 300);
  });
  measure();
}

// What the app currently believes about the screen. Rendered by the Settings
// diagnostics panel: when the layout is wrong on a device that can't be
// attached to a debugger, these six numbers are the difference between fixing
// it and guessing at it again.
export function viewportReport() {
  const vv = window.visualViewport;
  return {
    innerHeight: window.innerHeight,
    visualHeight: vv ? Math.round(vv.height) : null,
    visualOffsetTop: vv ? Math.round(vv.offsetTop) : null,
    baseline,
    kb: root.style.getPropertyValue("--kb").trim() || "0px",
    vvtop: root.style.getPropertyValue("--vvtop").trim() || "0px",
    typing: document.body.classList.contains("typing"),
    kbOpen: document.body.classList.contains("kb-open"),
    standalone: !!(window.navigator.standalone || matchMedia("(display-mode: standalone)").matches),
    hasVisualViewport: !!vv,
  };
}
