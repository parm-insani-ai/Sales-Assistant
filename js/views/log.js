// Log — the customers you're working, and the day's work on them. Four
// drop-downs: the queue (every reason to contact someone today, ranked,
// each with its one-tap action), the month's log (every customer logged
// this month — added by hand or by voice, or moved over from Outreach
// once they showed promise), the reminders, and the to-dos. Each
// remembers whether you left it open. Home is the day at a glance; this
// is the doing.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc, formatDateTime, relativeDay, daysFromToday } from "../utils.js";
import { stageMeta } from "../store.js";
import { taskListEl, openTaskForm, openReminderForm } from "./tasks.js";
import { openLeadForm } from "./leads.js";
import { icon } from "../icons.js";
import { getPlays, dismissPlay } from "../plays.js";
import { bookCheap, warmBook } from "../assess.js";
import { reviewTouch, reviewProspect } from "../touches.js";
import { fold, foldCount } from "../fold.js";
import { reminders } from "../reminders.js";
import { pushEnabled } from "../push.js";
import { loggedInMonth, loggedAtOf, monthKeyOf } from "../logbook.js";
import { shoppingOf } from "../target.js";

export function renderLog(view) {
  const el = document.createElement("div");
  view.appendChild(el);

  // 1. The queue.
  const playsSlot = document.createElement("div");
  playsSlot.className = "plays-slot";
  const queue = fold({ key: "today:queue", title: "Today's queue", open: true, body: playsSlot });
  el.appendChild(queue);
  mountQueue(playsSlot, { onCount: (n) => foldCount(queue, n), heading: false });

  // 2. The month's log.
  const month = new Date().toLocaleDateString("en-US", { month: "long" });
  const logBody = document.createElement("div");
  logBody.className = "log-slot";
  const logged = loggedInMonth(monthKeyOf());
  const logFold = fold({ key: "log:month", title: `Logged in ${esc(month)}`, count: logged.length, open: true, body: logBody, action: `<button class="btn btn-sm btn-ghost" data-act="add-customer">+ Add</button>` });
  el.appendChild(logFold);
  paintLog(logBody, logged);
  logFold.querySelector('[data-act="add-customer"]').addEventListener("click", () => openLeadForm());

  // 3. Reminders — with the note on where they land when the app is closed.
  const remCount = () => reminders().length;
  const remBody = document.createElement("div");
  const rem = fold({ key: "today:reminders", title: "Reminders", count: remCount(), open: true, body: remBody, action: `<button class="btn btn-sm btn-ghost" data-act="add-reminder">+ Add</button>` });
  remBody.appendChild(taskListEl({ kind: "reminder", limit: 20, empty: "No reminders. Tap + Add and pick a time — it'll notify you then, and sit under Right now on Home until you tick it off.", onChange: () => foldCount(rem, remCount()) }));
  const note = document.createElement("div");
  note.className = "hint";
  note.style.margin = "6px 2px 0";
  remBody.appendChild(note);
  el.appendChild(rem);
  rem.querySelector('[data-act="add-reminder"]').addEventListener("click", () => openReminderForm());
  pushEnabled().then((on) => {
    if (!note.isConnected) return;
    note.textContent = on
      ? "A reminder notifies this phone at its time, app open or closed."
      : "With the app open a reminder shows here at its time. To get it when the app is closed, turn on notifications under Settings → Notifications.";
  }).catch(() => {});

  // 4. To-dos.
  const todoBody = document.createElement("div");
  todoBody.className = "tasks-slot";
  const todoCount = () => store.all("tasks").filter((t) => !t.done && !(t.remindAt && t.channel === "reminder")).length;
  const todos = fold({ key: "today:todos", title: "To-dos", count: todoCount(), open: true, body: todoBody, action: `<button class="btn btn-sm btn-ghost" data-act="add-task">+ Add</button>` });
  // A screenful of to-dos, the rest behind a button — see taskListEl.
  todoBody.appendChild(taskListEl({ limit: 12, onChange: () => foldCount(todos, todoCount()) }));
  el.appendChild(todos);
  todos.querySelector('[data-act="add-task"]').addEventListener("click", () => openTaskForm());
}

// The month's log: who, what they're after, where the deal is, when they
// were last spoken with. Newest first; tap for the customer.
function paintLog(slot, logged) {
  slot.innerHTML = "";
  if (!logged.length) {
    slot.innerHTML = `<div class="card"><div class="muted small" style="text-align:center">Nobody logged yet this month. Add a customer (or tell the assistant about one), log a conversation with someone in Outreach, and they land here.</div></div>`;
    return;
  }
  const card = document.createElement("div");
  card.className = "card";
  card.style.padding = "0 16px";
  logged.slice(0, 60).forEach((l) => {
    const st = stageMeta(l.stage);
    const shop = shoppingOf(l);
    const fu = l.followUp && !["delivered", "lost", "sold"].includes(l.stage) ? daysFromToday(l.followUp) : null;
    const row = document.createElement("div");
    row.className = "row log-row";
    row.style.cssText = "padding:10px 0;border-bottom:1px solid var(--border);align-items:center;cursor:pointer";
    row.innerHTML = `
      <div class="row-main" style="min-width:0">
        <div class="row-title">${esc(l.name || "Customer")}${shop ? ` <span class="badge ${shop === "New" ? "badge-soon" : ""}" style="margin-left:4px">${shop}</span>` : ""}</div>
        <div class="row-sub">${esc(l.vehicleInterest || "No vehicle noted")}${l.lastContacted ? ` · ${esc(formatDateTime(l.lastContacted))}` : ""}</div>
        ${fu != null ? `<div class="small ${fu <= 0 ? "" : "muted"}" style="${fu < 0 ? "color:var(--danger)" : ""}">${icon("clock")} Follow up ${esc(relativeDay(l.followUp))}</div>` : ""}
      </div>
      <div class="row-meta"><span class="badge ${st.badge}">${esc(st.label)}</span><div class="small muted" style="margin-top:4px">${esc(new Date(loggedAtOf(l)).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</div></div>`;
    row.addEventListener("click", () => navigate(`/leads/${l.id}`));
    card.appendChild(row);
  });
  if (card.lastChild) card.lastChild.style.borderBottom = "none";
  slot.appendChild(card);
  if (logged.length > 60) {
    const more = document.createElement("div");
    more.className = "muted small";
    more.style.padding = "8px 2px";
    more.textContent = `${logged.length - 60} more this month.`;
    slot.appendChild(more);
  }
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
