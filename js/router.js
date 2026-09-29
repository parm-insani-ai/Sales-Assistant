// Minimal hash-based router for the single-page app — with a memory.
//
// Going back should land where you were. Every screen's scroll position is
// kept by its address while the app is open; a step back through history
// (the phone's back, a swipe, a "← Leads" button) puts it back once the
// screen has drawn, and keeps putting it back for a moment while a lazy
// screen fills in. A tap on a tab does the same for that tab, the way a
// phone's own apps do; a tap on the tab you're already on goes to the top.
// Only a fresh step forward — a stat card, the assistant, a link — starts
// at the top, because that's a jump to something, not a return.

const routes = new Map();
let notFound = null;

export function route(path, handler) {
  routes.set(path, handler);
}

export function setNotFound(handler) {
  notFound = handler;
}

// Parse "#/leads/abc123" -> { path: "/leads", param: "abc123" }
function parse() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean); // ["leads","abc123"]
  const base = "/" + (parts[0] || "");
  return { base: base === "/" ? "/" : base, param: parts[1] || null, parts };
}

export function currentBase() {
  return parse().base;
}

// What to scroll to once the next screen has rendered. Landing on a screen
// isn't landing on the thing you asked for: the play sheet is most of a page
// below the top of Home, so "show me who I can pitch" that merely opened Home
// left the answer off screen.
let reveal = null;

// ---- Where you were ----
const viewEl = () => document.getElementById("view");
const positions = new Map();   // address -> scrollTop, while the app is open
const trail = [];              // address by history index, for goBack
let idx = 0;                   // this screen's index in the browser's history
let lastHash = null;           // the screen on show
let tabTap = false;            // the next change came from the tab bar
let restoring = null;          // the restore in flight, cancelled by a touch
const hashNow = () => location.hash.replace(/^#/, "") || "/";
let lastMove = { dir: "new", fromTab: false };

// Is the screen being drawn a return to where you were — a step back or
// forward, or its tab tapped from elsewhere — rather than a fresh jump? A
// screen that keeps its own place (Leads keeps how much of its list was
// built) puts it back only on a return.
export function isReturn() {
  return lastMove.dir === "back" || lastMove.dir === "forward" || (lastMove.fromTab && lastMove.dir !== "same");
}

function remember() {
  const v = viewEl();
  if (lastHash != null && v) positions.set(lastHash, v.scrollTop);
}

// Put a screen back where it was. Set now, before paint, then keep setting
// for a moment as late content arrives (a lazy screen, a chunked list) —
// until it fits, or the person scrolls, or the moment passes.
function restoreScroll(top) {
  const v = viewEl();
  if (!v || !(top > 0)) return;
  if (restoring) restoring();
  let on = true;
  const stop = () => { on = false; restoring = null; };
  restoring = stop;
  ["touchstart", "wheel", "keydown"].forEach((ev) => v.addEventListener(ev, stop, { once: true, passive: true }));
  const t0 = performance.now();
  let settled = 0;
  const tick = () => {
    if (!on) return;
    const max = Math.max(0, v.scrollHeight - v.clientHeight);
    if (max >= top) {
      if (Math.abs(v.scrollTop - top) > 1) v.scrollTop = top;
      // Hold for a few frames once it fits, in case the height still moves.
      if (++settled > 12) return stop();
    } else {
      // As far as it goes for now; a windowed list fills in below and the
      // next frame gets the rest.
      if (v.scrollTop !== max) v.scrollTop = max;
      settled = 0;
    }
    if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else stop();
  };
  v.scrollTop = Math.min(top, Math.max(0, v.scrollHeight - v.clientHeight));
  requestAnimationFrame(tick);
}

/**
 * Go to a screen, optionally scrolling something on it into view.
 *
 * Re-navigating to the screen you're already on re-renders it rather than
 * doing nothing. Setting location.hash to its current value fires no
 * hashchange, so asking for your plays while already on Home used to be a
 * silent no-op — no repaint, no scroll, and the voice panel never docked.
 */
export function navigate(path, revealSelector = null) {
  reveal = revealSelector;
  const target = String(path || "/");
  if (hashNow() === target) render();
  else location.hash = target;
}

/**
 * Back to the screen you came from — through the browser's history when
 * that screen is the one before this (so it lands where you were), and by
 * a plain navigation to `fallback` when it isn't (a link opened straight
 * onto a customer has nowhere to go back to).
 */
export function goBack(fallback = "/") {
  const prev = trail[idx - 1];
  const want = String(fallback || "/");
  const sameScreen = (a, b) => (a || "").split("/").filter(Boolean)[0] === (b || "").split("/").filter(Boolean)[0];
  if (idx > 0 && prev && sameScreen(prev, want)) history.back();
  else navigate(want);
}

function render() {
  const hash = hashNow();
  // The screen on show is about to go: let it save what it wants (Leads
  // keeps how much of its list was built), then keep its scroll.
  if (lastHash != null) {
    window.dispatchEvent(new CustomEvent("viniva-leaving", { detail: { hash: lastHash } }));
    remember();
  }
  if (restoring) restoring();
  // Which way this move went, from the index stamped on each history entry:
  // lower is back, higher is forward, none is a fresh step.
  const st = history.state && typeof history.state.idx === "number" ? history.state.idx : null;
  let dir = "new";
  if (st != null && st < idx) dir = "back";
  else if (st != null && st > idx) dir = "forward";
  else if (st != null && st === idx && hash === lastHash) dir = "same";
  if (st == null) {
    idx = lastHash == null ? 0 : idx + 1;
    trail.length = idx;
    trail[idx] = hash;
    try { history.replaceState({ idx }, ""); } catch { /* a browser that won't: no memory, no harm */ }
  } else {
    idx = st;
    trail[idx] = hash;
  }
  const fromTab = tabTap; tabTap = false;
  lastMove = { dir, fromTab };

  const { base, param, parts } = parse();
  const handler = routes.get(base) || notFound;
  if (handler) handler({ param, parts });
  lastHash = hash;
  // Anything that moves the app announces itself here, including a re-entry
  // that hashchange wouldn't report. The voice panel docks on this.
  window.dispatchEvent(new CustomEvent("viniva-navigated", { detail: { base, param, dir } }));

  // Back where you were: a step back or forward through history, or a tab
  // tapped again from elsewhere. Not a jump to something on the screen.
  if (!reveal) {
    if ((dir === "back" || dir === "forward" || (fromTab && dir !== "same")) && positions.has(hash)) restoreScroll(positions.get(hash));
  }
  if (reveal) {
    const sel = reveal;
    reveal = null;
    // A frame, so the view has been laid out and has somewhere to scroll to —
    // and then again a little later. Some screens fill their heavier sections
    // after first paint (Home defers the play sheet), and a scroll issued
    // before that content exists stops short: there is nothing below the
    // target to scroll it up against yet. scrollIntoView is idempotent, so
    // re-issuing it once the content has arrived costs nothing when the first
    // attempt was already right.
    const go = () => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); };
    requestAnimationFrame(go);
    setTimeout(go, 80);
    setTimeout(go, 350);
  }
}

// Where the screen on show is scrolled to, kept as it moves — so a return
// after the app was backgrounded, or a tab tap, has the latest.
function watchScroll() {
  const v = viewEl();
  if (!v) return;
  let t = null;
  v.addEventListener("scroll", () => {
    if (t) return;
    t = setTimeout(() => { t = null; if (lastHash != null) positions.set(lastHash, v.scrollTop); }, 120);
  }, { passive: true });
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  // A tab tap is a return to that tab, not a jump: it goes back where the
  // tab was. Noted in the capture phase, before the hash changes.
  document.addEventListener("click", (e) => {
    const tab = e.target && e.target.closest ? e.target.closest(".tabbar a.tab[data-route]") : null;
    if (!tab) return;
    // The tab you're already on: to the top, and no navigation follows, so
    // nothing to note — a note left here would make the next move a "return".
    const v = viewEl();
    if (tab.dataset.route === hashNow()) { if (v) v.scrollTo({ top: 0, behavior: "smooth" }); return; }
    tabTap = true;
    setTimeout(() => { tabTap = false; }, 400); // in case no move follows after all
  }, true);
  watchScroll();
  render();
}
