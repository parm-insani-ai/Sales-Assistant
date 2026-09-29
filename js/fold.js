// A drop-down section: a heading you tap to open or close, with the body
// under it. Which sections are open is remembered per section, so a screen
// comes back the way you left it — the queue open, the plan closed.
//
// Native <details>, so it works without a script, reads to a screen
// reader as a disclosure, and the browser handles the toggle.

const KEY = "viniva:folds";
function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
}
export function foldOpen(key, dflt) {
  const all = readAll();
  return Object.prototype.hasOwnProperty.call(all, key) ? !!all[key] : !!dflt;
}
export function setFold(key, open) {
  try { const all = readAll(); all[key] = !!open; localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* a convenience */ }
}

/**
 * fold({ key, title, count, sub, open, body })
 *   key    remembers the open/closed state ("today:queue")
 *   title  HTML for the heading (already escaped)
 *   count  a number after the title ("Reminders · 3"), updatable via foldCount
 *   sub    a muted note after the title
 *   open   the default when this section has never been toggled
 *   body   an element or an HTML string
 */
export function fold({ key, title, count = null, sub = "", open = true, body = null, action = "" }) {
  const d = document.createElement("details");
  d.className = "fold";
  d.dataset.fold = key;
  if (foldOpen(key, open)) d.open = true;
  // No whitespace text around the title: the heading's text starts with
  // the title, as a plain section title's does.
  d.innerHTML = `<summary class="fold-head section-title"><span class="fold-title">${title}<span class="muted fold-count">${count != null ? ` · ${Number(count).toLocaleString()}` : ""}</span>${sub ? ` <span class="muted fold-sub">· ${sub}</span>` : ""}</span><span class="fold-right">${action}<span class="fold-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></span></summary><div class="fold-body"></div>`;
  const bodyEl = d.querySelector(".fold-body");
  if (typeof body === "string") bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  d.addEventListener("toggle", () => setFold(key, d.open));
  // A button in the heading (an "+ Add") acts without toggling the section.
  d.querySelector(".fold-right").addEventListener("click", (ev) => { if (ev.target.closest("button, a")) { ev.preventDefault(); ev.stopPropagation(); } });
  return d;
}

// The number after a section's title, once it's known.
export function foldCount(d, n) {
  const c = d.querySelector(".fold-count");
  if (c) c.textContent = n != null ? ` · ${Number(n).toLocaleString()}` : "";
}

// Open a section (and remember it), then bring it on screen.
export function openFold(d) {
  if (!d) return;
  d.open = true;
  setFold(d.dataset.fold, true);
  try { d.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* no smooth scroll */ }
}
