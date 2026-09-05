// Pull down to refresh.
//
// Worth having for one specific reason: inbound texts never touch this device.
// They're written by the function when the carrier delivers them and only
// appear after a cloud pull. The app polls every 20 seconds and syncs whenever
// it comes back to the foreground, so the data is nearly always current — but
// "nearly always" is not what someone waiting on a reply wants. Pulling is how
// every phone app answers "is there anything new", and without it the only
// honest answer available to a salesperson is to wait and see.
//
// It has to be built rather than inherited: the app sets `overscroll-behavior:
// none` to stop the page sliding around, which also switches off the browser's
// own pull-to-refresh.

import * as sync from "./sync.js";

const THRESHOLD = 70;   // how far down before it fires
const MAX = 110;        // how far the indicator will travel
let el = null;

function indicator() {
  if (el) return el;
  el = document.createElement("div");
  el.className = "ptr";
  el.innerHTML = `<div class="ptr-spinner"></div>`;
  document.body.appendChild(el);
  return el;
}

export function initPullToRefresh() {
  let startY = 0;
  let pulling = false;
  let dist = 0;
  let busy = false;

  const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

  const set = (d, spin) => {
    const bar = indicator();
    bar.style.transform = `translate(-50%, ${d}px)`;
    bar.style.opacity = d > 8 ? "1" : "0";
    bar.classList.toggle("ptr-ready", d >= THRESHOLD);
    bar.classList.toggle("ptr-spin", !!spin);
  };

  document.addEventListener("touchstart", (e) => {
    if (busy || e.touches.length !== 1 || !atTop()) return;
    // Not while a sheet is open, and not on a horizontally swipeable row —
    // stealing the gesture from either would be worse than not having this.
    if (document.querySelector(".modal-backdrop")) return;
    startY = e.touches[0].clientY;
    pulling = true;
    dist = 0;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    // The page moved off the top mid-gesture: this is a scroll, not a pull.
    if (!atTop()) { pulling = false; dist = 0; set(0); return; }
    // Moving up, or not yet moving at all. Don't abandon the gesture for it —
    // the first touchmove often reports the same coordinate as the touchstart,
    // and treating that as "cancelled" meant a pull that started with any
    // jitter simply never fired.
    if (dy <= 0) { dist = 0; set(0); return; }
    // Resistance, so it feels like pulling against something rather than
    // dragging a free object.
    dist = Math.min(MAX, dy * 0.45);
    set(dist);
  }, { passive: true });

  const end = async () => {
    if (!pulling) return;
    pulling = false;
    if (dist < THRESHOLD) { set(0); return; }
    busy = true;
    set(THRESHOLD, true);
    let ok = true;
    try {
      await sync.syncNow();
    } catch { ok = false; /* the status line reports sync errors; a pull shouldn't throw */ }
    // Announce it. A view that wants to redraw on a manual refresh can listen,
    // and it makes "did the pull actually do anything" answerable from outside
    // this module rather than by reading it.
    window.dispatchEvent(new CustomEvent("entoa-refresh", { detail: { ok } }));
    // Hold the spinner briefly even on an instant sync. A refresh that vanishes
    // before it registers reads as "nothing happened".
    setTimeout(() => { set(0); busy = false; }, 350);
  };

  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", () => { pulling = false; set(0); }, { passive: true });
}
