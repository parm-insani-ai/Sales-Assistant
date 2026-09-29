// Today — the day's work in one place, in three drop-downs: the queue
// (every reason to contact someone today, ranked, each with its own
// one-tap action), the reminders (a time that taps you on the shoulder),
// and the to-dos. This was the lower half of Home. Home is the day at a
// glance — what's happening right now, the calendar, the numbers — and
// this tab is what to do about it. Each section remembers whether you
// left it open.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc } from "../utils.js";
import { taskListEl, openTaskForm, openReminderForm } from "./tasks.js";
import { icon } from "../icons.js";
import { getPlays, dismissPlay } from "../plays.js";
import { bookCheap, warmBook } from "../assess.js";
import { reviewTouch, reviewProspect } from "../touches.js";
import { fold, foldCount } from "../fold.js";
import { reminders } from "../reminders.js";
import { pushEnabled } from "../push.js";

export function renderToday(view) {
  const el = document.createElement("div");
  view.appendChild(el);

  // 1. The queue.
  const playsSlot = document.createElement("div");
  playsSlot.className = "plays-slot";
  const queue = fold({ key: "today:queue", title: "Today's queue", open: true, body: playsSlot });
  el.appendChild(queue);
  mountQueue(playsSlot, { onCount: (n) => foldCount(queue, n), heading: false });

  // 2. Reminders — with the note on where they land when the app is closed.
  const remCount = () => reminders().length;
  const remBody = document.createElement("div");
  const remList = () => taskListEl({ kind: "reminder", limit: 20, empty: "No reminders. Tap + Add and pick a time — it'll notify you then, and sit under Right now on Home until you tick it off.", onChange: () => foldCount(rem, remCount()) });
  remBody.appendChild(remList());
  const note = document.createElement("div");
  note.className = "hint";
  note.style.margin = "6px 2px 0";
  remBody.appendChild(note);
  const rem = fold({ key: "today:reminders", title: "Reminders", count: remCount(), open: true, body: remBody, action: `<button class="btn btn-sm btn-ghost" data-act="add-reminder">+ Add</button>` });
  el.appendChild(rem);
  rem.querySelector('[data-act="add-reminder"]').addEventListener("click", () => openReminderForm());
  pushEnabled().then((on) => {
    if (!note.isConnected) return;
    note.textContent = on
      ? "A reminder notifies this phone at its time, app open or closed."
      : "With the app open a reminder shows here at its time. To get it when the app is closed, turn on notifications under Settings → Notifications.";
  }).catch(() => {});

  // 3. To-dos.
  const todoBody = document.createElement("div");
  const todoCount = () => store.all("tasks").filter((t) => !t.done && !(t.remindAt && t.channel === "reminder")).length;
  // A screenful of to-dos, the rest behind a button — see taskListEl.
  const todos = fold({ key: "today:todos", title: "To-dos", count: todoCount(), open: true, body: todoBody, action: `<button class="btn btn-sm btn-ghost" data-act="add-task">+ Add</button>` });
  todoBody.appendChild(taskListEl({ limit: 12, onChange: () => foldCount(todos, todoCount()) }));
  el.appendChild(todos);
  todos.querySelector('[data-act="add-task"]').addEventListener("click", () => openTaskForm());
  // A "tasks-slot" the assistant can scroll to ("what's on my plate").
  todoBody.classList.add("tasks-slot");
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
export function mountQueue(playsSlot, { onCount = null, heading = true } = {}) {
  const head = (extra = "") => (heading ? `<div class="section-title">Today's queue${extra}</div>` : "");
  const say = (n) => { if (onCount) { try { onCount(n); } catch { /* optional */ } } };
  playsSlot.innerHTML = head();
  const readyPlays = () => { if (document.body.contains(playsSlot)) paintPlays(); };
  if (bookCheap()) setTimeout(readyPlays, 0);
  else {
    playsSlot.innerHTML = `${head()}
      <div class="card"><div class="muted small" style="text-align:center"><span class="radar-progress">Reading the book…</span></div></div>`;
    const prog = playsSlot.querySelector(".radar-progress");
    warmBook((done, total, phase) => { if (prog && prog.isConnected && total > 200) prog.textContent = `Reading the book… ${phase === "book" ? 50 + Math.round(done / total * 50) : Math.round(done / total * 50)}%`; })
      .then(readyPlays, readyPlays);
  }
  function paintPlays() {
    const plays = getPlays(40);
    say(plays.length);
    if (!plays.length) {
      playsSlot.innerHTML = `${head()}
        <div class="card"><div class="muted small" style="text-align:center">All caught up — nothing to chase right now.</div></div>`;
      return;
    }
    playsSlot.innerHTML = head(` <span class="muted">· ${plays.length}</span>`);
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
        say(box.querySelectorAll(".row").length);
        box.dispatchEvent(new CustomEvent("viniva:played"));
      });
      box.appendChild(row);
    });
    if (box.lastChild) box.lastChild.style.borderBottom = "none";
    playsSlot.appendChild(box);
    // Emptying the queue by dismissal should read as "done", not as a blank.
    box.addEventListener("viniva:played", () => {
      if (!box.querySelector(".row")) {
        playsSlot.innerHTML = `${head()}
          <div class="card"><div class="muted small" style="text-align:center">Queue cleared — nice work.</div></div>`;
      }
    });
  }
}
