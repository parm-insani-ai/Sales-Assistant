// Minimal hash-based router for the single-page app.

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
  if ((location.hash.replace(/^#/, "") || "/") === target) render();
  else location.hash = target;
}

function render() {
  const { base, param, parts } = parse();
  const handler = routes.get(base) || notFound;
  if (handler) handler({ param, parts });
  // Anything that moves the app announces itself here, including a re-entry
  // that hashchange wouldn't report. The voice panel docks on this.
  window.dispatchEvent(new CustomEvent("entoa-navigated", { detail: { base, param } }));
  if (reveal) {
    const sel = reveal;
    reveal = null;
    // A frame, so the view has been laid out and has somewhere to scroll to.
    requestAnimationFrame(() => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  render();
}
