// Today — the day's work in one place: the queue (every reason to contact
// someone today, ranked, each with its own one-tap action) and the to-dos.
// This was the lower half of Home. Home is the day at a glance — what's
// happening right now, the calendar, the numbers — and this tab is what to
// do about it.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";
import { taskListEl, openTaskForm } from "./tasks.js";
import { icon } from "../icons.js";
import { getPlays, dismissPlay } from "../plays.js";
import { bookCheap, warmBook } from "../assess.js";
import { reviewTouch, reviewProspect } from "../touches.js";

export function renderToday(view) {
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="plays-slot"></div>

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>To-dos</span>
      <button class="btn btn-sm btn-ghost" data-act="add-task">+ Add</button>
    </div>
    <div class="tasks-slot"></div>
  `;
  view.appendChild(el);
  mountQueue(el.querySelector(".plays-slot"));
  // A screenful of to-dos, the rest behind a button — see taskListEl.
  el.querySelector(".tasks-slot").appendChild(taskListEl({ limit: 12 }));
  el.querySelector('[data-act="add-task"]').addEventListener("click", () => openTaskForm());
}

// How many are on the queue right now, or null while the book is still
// being read (Home's card says so and fills in when it's ready).
export function queueCount() {
  return bookCheap() ? getPlays(40).length : null;
}

// The work queue — every reason to contact someone today, ranked, each with
// its own one-tap action. This is the single list; Comms and the old call
// list used to render their own versions of the same signals.
//
// The play sheet is the expensive part — it runs the Deal Radar over every
// customer. The slot paints its heading first and fills in on the next
// tick, so the screen shows at once. When the radar's answer isn't current
// (first launch, a lot that changed overnight) it runs a slice at a time in
// the background, and the queue says so instead of the screen going stiff.
export function mountQueue(playsSlot) {
  playsSlot.innerHTML = `<div class="section-title">Today's queue</div>`;
  const readyPlays = () => { if (document.body.contains(playsSlot)) paintPlays(); };
  if (bookCheap()) setTimeout(readyPlays, 0);
  else {
    playsSlot.innerHTML = `<div class="section-title">Today's queue</div>
      <div class="card"><div class="muted small" style="text-align:center"><span class="radar-progress">Reading the book…</span></div></div>`;
    const prog = playsSlot.querySelector(".radar-progress");
    warmBook((done, total, phase) => { if (prog && prog.isConnected && total > 200) prog.textContent = `Reading the book… ${phase === "book" ? 50 + Math.round(done / total * 50) : Math.round(done / total * 50)}%`; })
      .then(readyPlays, readyPlays);
  }
  function paintPlays() {
    const plays = getPlays(40);
    if (!plays.length) {
      playsSlot.innerHTML = `<div class="section-title">Today's queue</div>
        <div class="card"><div class="muted small" style="text-align:center">All caught up — nothing to chase right now.</div></div>`;
      return;
    }
    playsSlot.innerHTML = `<div class="section-title">Today's queue <span class="muted">· ${plays.length}</span></div>`;
    const box = document.createElement("div");
    box.className = "card";
    plays.forEach((p) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.cssText = "align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)";
      row.innerHTML = `
        <span style="color:var(--brand);display:inline-flex;flex:none">${icon(p.icon)}</span>
        <div class="row-main" style="min-width:0">
          <div class="strong" style="font-size:0.92rem">${esc(p.title)}</div>
          <div class="small muted">${esc(p.sub)}</div>
        </div>
        ${p.taskId
          ? `<button class="btn btn-primary btn-sm" style="flex:none" data-play-draft="${p.taskId}">Review</button>`
          : p.prospectId && !p.route
          ? `<button class="btn btn-primary btn-sm" style="flex:none" data-play-prospect="${p.prospectId}">Review</button>`
          : p.href
          ? `<a class="btn btn-primary btn-sm" style="flex:none" href="${p.href}">${/^tel:/.test(p.href) ? "Call" : "Text"}</a>`
          : `<button class="btn btn-ghost btn-sm" style="flex:none" data-play-go="${p.route || "/comms"}">Open</button>`}
        <button class="modal-close" data-play-x aria-label="Dismiss" style="font-size:1.1rem;flex:none">&times;</button>`;
      const act = row.querySelector("a");
      if (act) act.addEventListener("click", () => {
        store.logActivity("touch");
        row.style.opacity = "0.45";
      });
      // A plan text: written for this customer now, from their context and
      // the conversation so far, then put in front of the salesperson. The
      // thread opens with the draft in the box; sending is their tap.
      const draft = row.querySelector("[data-play-draft]");
      if (draft) draft.addEventListener("click", async () => {
        draft.disabled = true; draft.textContent = "Drafting…";
        try { await reviewTouch(p.taskId); }
        finally { draft.disabled = false; draft.textContent = "Review"; }
      });
      const pro = row.querySelector("[data-play-prospect]");
      if (pro) pro.addEventListener("click", async () => {
        pro.disabled = true; pro.textContent = "Drafting…";
        try { await reviewProspect(p.prospectId); }
        finally { pro.disabled = false; pro.textContent = "Review"; }
      });
      const go = row.querySelector("[data-play-go]");
      if (go) go.addEventListener("click", () => navigate(go.dataset.playGo));
      row.querySelector("[data-play-x]").addEventListener("click", () => {
        dismissPlay(p);
        row.remove();
        box.dispatchEvent(new CustomEvent("viniva:played"));
      });
      box.appendChild(row);
    });
    if (box.lastChild) box.lastChild.style.borderBottom = "none";
    playsSlot.appendChild(box);
    // Emptying the queue by dismissal should read as "done", not as a blank.
    box.addEventListener("viniva:played", () => {
      if (!box.querySelector(".row")) {
        playsSlot.innerHTML = `<div class="section-title">Today's queue</div>
          <div class="card"><div class="muted small" style="text-align:center">Queue cleared — nice work.</div></div>`;
      }
    });
  }
}
