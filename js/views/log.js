// Log — the customers you're working, and the day's work on them. Three
// chips across the top — Queue, Logged, To-dos — and one of them on screen
// at a time: the queue (every reason to contact someone today, ranked,
// each with its one-tap action), the month's log (every customer logged
// this month — added by hand or by voice, or moved over from Outreach once
// they showed promise), and the to-dos, timed or not (a timed one is a
// reminder: it notifies you at its moment and sits under Right now on
// Home). The chip you were on is the one you come back to. Home is the
// day at a glance; this is the doing.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc, formatDateTime, relativeDay, daysFromToday } from "../utils.js";
import { stageMeta } from "../store.js";
import { taskListEl, openTaskForm } from "./tasks.js";
import { openLeadForm } from "./leads.js";
import { icon } from "../icons.js";
import { getPlays, dismissPlay } from "../plays.js";
import { bookCheap, warmBook } from "../assess.js";
import { reviewTouch, reviewProspect } from "../touches.js";
import { pushEnabled } from "../push.js";
import { loggedInMonth, loggedAtOf, monthKeyOf } from "../logbook.js";
import { shoppingOf } from "../target.js";

const TAB_KEY = "viniva:log:tab";     // the chip you were on
const OPEN_KEY = "viniva:log:open";   // a chip something else asked for (the assistant)
const TABS = ["queue", "logged", "todos"];

// Something that lands on Log with a section in mind — the assistant
// opening the to-dos — says so here before it navigates.
export function askLogTab(tab) {
  try { sessionStorage.setItem(OPEN_KEY, TABS.includes(tab) ? tab : "queue"); } catch { /* the chip you were on, then */ }
}

export function renderLog(view) {
  const el = document.createElement("div");
  view.appendChild(el);

  // The chips — the same pills as the Comms bar — with their counts.
  const tabs = document.createElement("div");
  tabs.className = "log-tabs";
  tabs.setAttribute("role", "tablist");
  const month = new Date().toLocaleDateString("en-US", { month: "long" });
  const labels = { queue: [icon("target"), "Queue"], logged: [icon("users"), "Logged"], todos: [icon("check"), "To-dos"] };
  tabs.innerHTML = TABS.map((t) => `<button type="button" class="btn btn-sm btn-ghost" role="tab" data-tab="${t}">${labels[t][0]} ${labels[t][1]}<span class="tab-count" data-count="${t}"></span></button>`).join("");
  el.appendChild(tabs);
  const setCount = (tab, n) => { const c = tabs.querySelector(`[data-count="${tab}"]`); if (c) c.textContent = n == null ? "" : String(n); };

  // The panels. All three are built; one is on screen.
  const panels = {};
  const panel = (tab, action) => {
    const p = document.createElement("div");
    p.className = "log-panel";
    p.dataset.panel = tab;
    p.hidden = true;
    if (action) p.innerHTML = `<div class="log-panel-head">${action}</div>`;
    panels[tab] = p;
    el.appendChild(p);
    return p;
  };

  // 1. The queue.
  const queuePanel = panel("queue");
  const playsSlot = document.createElement("div");
  playsSlot.className = "plays-slot";
  queuePanel.appendChild(playsSlot);
  mountQueue(playsSlot, { onCount: (n) => setCount("queue", n), heading: false });

  // 2. The month's log.
  const logPanel = panel("logged", `<span class="small muted">Logged in ${esc(month)}</span><button class="btn btn-sm btn-ghost" data-act="add-customer">+ Add customer</button>`);
  const logBody = document.createElement("div");
  logBody.className = "log-slot";
  logPanel.appendChild(logBody);
  const logged = loggedInMonth(monthKeyOf());
  setCount("logged", logged.length);
  paintLog(logBody, logged);
  logPanel.querySelector('[data-act="add-customer"]').addEventListener("click", () => openLeadForm());

  // 3. To-dos — timed ones are reminders; the plan's own steps stay on the
  // queue. With the note on where a reminder lands when the app is closed.
  const todoPanel = panel("todos", `<span class="small muted">Give one a time and it reminds you</span><button class="btn btn-sm btn-ghost" data-act="add-task">+ Add</button>`);
  const todoBody = document.createElement("div");
  todoBody.className = "tasks-slot";
  const todoCount = () => store.all("tasks").filter((t) => !t.done && !t.cadence).length;
  setCount("todos", todoCount());
  // A screenful of to-dos, the rest behind a button — see taskListEl.
  todoBody.appendChild(taskListEl({ limit: 12, empty: "Nothing on the list. Tap + Add — give it a time and it'll remind you then, and sit under Right now on Home until you tick it off.", onChange: () => setCount("todos", todoCount()) }));
  todoPanel.appendChild(todoBody);
  const note = document.createElement("div");
  note.className = "hint";
  note.style.margin = "6px 2px 0";
  todoPanel.appendChild(note);
  todoPanel.querySelector('[data-act="add-task"]').addEventListener("click", () => openTaskForm());
  pushEnabled().then((on) => {
    if (!note.isConnected) return;
    note.textContent = on
      ? "A to-do with a time notifies this phone at that time, app open or closed."
      : "With the app open a to-do with a time shows here at its time. To get it when the app is closed, turn on notifications under Settings → Notifications.";
  }).catch(() => {});

  // Which chip: the one asked for, else the one you were on, else the queue.
  const show = (tab, remember = true) => {
    const t = TABS.includes(tab) ? tab : "queue";
    TABS.forEach((k) => { panels[k].hidden = k !== t; });
    tabs.querySelectorAll("[data-tab]").forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("btn-primary", on); b.classList.toggle("btn-ghost", !on); b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
    if (remember) { try { localStorage.setItem(TAB_KEY, t); } catch { /* per-device memory only */ } }
  };
  let asked = null;
  try { asked = sessionStorage.getItem(OPEN_KEY); sessionStorage.removeItem(OPEN_KEY); } catch { /* nothing asked */ }
  let was = null;
  try { was = localStorage.getItem(TAB_KEY); } catch { /* the queue, then */ }
  if (was === "reminders") was = "todos"; // the chip that was folded into To-dos
  show(asked || was || "queue", !asked);
  tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); });
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
