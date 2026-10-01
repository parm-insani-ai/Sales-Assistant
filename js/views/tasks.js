// To-dos and reminders. Rendered on Today (and per customer), with shared
// add forms. A reminder is a to-do with a time: at that moment it becomes
// a notification (reminders.js) and a line under Right now on Home.

import * as store from "../store.js";
import { openModal, buildForm, toast, undoToast, swipeable } from "../components.js";
import { esc, relativeDay, daysFromToday } from "../utils.js";
import { icon } from "../icons.js";
import { navigate } from "../router.js";
import { isReminder, reminderWhen, wallClock, askNotifyPermission } from "../reminders.js";

const pad = (n) => String(n).padStart(2, "0");
// The to-dos the assistant is running right now (ids). Module-wide, so a
// card drawn again after a trip to another screen still says Working….
const running = new Set();
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// The next round hour, so a to-do given a time defaults to something sensible.
const nextHour = () => { const d = new Date(Date.now() + 3600000); return `${pad(d.getHours())}:00`; };

// One form for a to-do. A time is optional: with one, the to-do is a
// reminder — it notifies you at that moment (reminders.js) and sits under
// Right now on Home until it's ticked off. Without one it's just on the
// list. Stored as a task; a time is `remindAt` in local wall-clock time
// (like appointments), so the phone and the cloud agree on the moment.
export function openTaskForm(existing, defaults = {}) {
  const isEdit = !!existing;
  const t = existing || defaults;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(t.remindAt || ""));
  const wantsTime = !!defaults.needsTime;
  openModal(isEdit ? "Edit to-do" : "New to-do", (close) => {
    const { element } = buildForm(
      [
        { name: "title", label: "To-do", value: t.title || "", required: true, placeholder: "Call Dana back about the SV" },
        { name: "due", label: "Day", value: m ? m[1] : t.due || todayKey(), type: "date", half: true },
        { name: "time", label: "Remind me at (optional)", value: m ? m[2] : wantsTime ? nextHour() : "", type: "time", half: true },
        { name: "priority", label: "Priority", value: t.priority || "normal", type: "select",
          options: [{ value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }] },
      ],
      {
        submitLabel: isEdit ? "Save" : "Add",
        onSubmit: (data) => {
          const timed = !!(data.time && data.due);
          const rec = { title: data.title, due: data.due || "", priority: data.priority || "normal",
            remindAt: timed ? `${data.due}T${data.time}` : null, channel: timed ? "reminder" : (existing && existing.channel !== "reminder" ? existing.channel : null), notifiedAt: null };
          if (isEdit) { store.update("tasks", existing.id, rec); toast(timed ? "Reminder updated" : "To-do updated", "success"); }
          else { store.create("tasks", { ...rec, done: false, leadId: t.leadId || null }); toast(timed ? `Reminder set for ${reminderWhen(rec)}` : "To-do added", "success"); }
          close();
          if (timed) askNotifyPermission();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

// The same form, opening with a time filled in — for "remind me".
export function openReminderForm(existing, defaults = {}) {
  return openTaskForm(existing, { ...defaults, needsTime: true });
}

// A to-do the assistant can take on. The app files a next move from what
// you said about a customer — "57 in stock under their budget", "their
// wife decides too" — and the lookup or the draft behind it is something
// the assistant can run right now, with today's lot and prices, and put on
// screen. The part only you can do (show the car, appraise the trade, be
// in the room) stays yours; those get no button. Returns the sentence to
// hand the assistant, or null.
export function doItFor(t, lead) {
  if (!t || t.done || t.source !== "context" || !lead) return null;
  const name = lead.name || "the customer";
  const car = lead.vehicleInterest ? `the ${lead.vehicleInterest}` : "what they're after";
  const title = String(t.title || "");
  switch (t.kind) {
    case "stock": return `For ${name}, who's after ${car}: put the matching units on our lot on screen (lot_lookup) and tell me how many there are and the two best. This is for the to-do "${title}".`;
    case "budget": return `What could I put ${name} in? Run deal_options for ${name} and name the two best fits. This is for the to-do "${title}".`;
    case "objection": return `Prepare a second option for ${name}: run deal_options for ${name} and name a lower-payment, a step-down-in-trim, or a used alternative to ${car}. This is for the to-do "${title}".`;
    case "people": { const who = (/^Their (.+?) decides/.exec(title) || [])[1] || "the other decision-maker"; return `Draft a text to ${name} for me to send, inviting their ${who} along to the next visit — warm, short, no figures. Put it in the box; I'll send it.`; }
    case "referral": { const who = (/the (.+?)'s number/.exec(title) || [])[1] || "friend"; return `Draft a text to ${name} for me to send, asking for their ${who}'s number so I can help them too — easy and short. Put it in the box; I'll send it.`; }
    default: return null;
  }
}

// What a tool call left behind, in the shape the work page draws and the
// to-do keeps: the payment-matched options, the units on the lot, a text
// drafted for you to send, a comparison, or a line saying what was done.
// Lookups the assistant made for itself (reading the customer, the
// calendar) leave nothing — their findings are in the reply. Null when
// there's nothing to draw.
const LOOKUPS = /^(get_|find_|search_|list_|lot|read_|recent_|deal_radar|work_the_book|payment_quote|get_plays|get_coach)/;
export function compactResult(name, input = {}, out) {
  const o = out && typeof out === "object" ? out : null;
  switch (name) {
    case "deal_options": case "match_deals":
      if (!o || !Array.isArray(o.options)) return null;
      return { kind: "options", now: o.currentPayment ?? null, rows: o.options.slice(0, 5).map((r) => ({ vehicle: r.vehicle, monthly: r.monthly, delta: r.delta, method: r.method, inStock: !!r.inStock })) };
    case "lot_lookup": case "lot": case "inventory_lookup":
      if (!o) return null;
      if (!Array.isArray(o.units)) return o.answer ? { kind: "note", text: String(o.answer) } : null;
      return { kind: "lot", count: o.count || 0, answer: o.answer || "", more: o.more || 0, units: o.units.slice(0, 8).map((u) => ({ vehicle: u.vehicle, price: u.price ?? null, km: u.km ?? null, stock: u.stock || "", color: u.color || "", condition: u.condition || "" })) };
    case "text_customer": case "text":
      if (typeof out === "string" && /^drafted/.test(out)) return { kind: "draft", to: String(input.customer || input.name || ""), message: String(input.message || ""), sent: null };
      return typeof out === "string" ? { kind: "note", text: out } : null;
    case "compare_vehicles": case "compare":
      if (o && Array.isArray(o.compared)) return { kind: "compare", rows: o.compared.slice(0, 3) };
      return typeof out === "string" ? { kind: "note", text: out } : null;
    default:
      if (typeof out !== "string" || LOOKUPS.test(name)) return null;
      return { kind: /^(not found|need |which |error)/i.test(out) ? "note" : "did", text: out.slice(0, 400) };
  }
}

// Returns a DOM element listing open tasks.
// opts.kind:  "todo" (default) — the to-dos, timed or not, soonest first;
//             the follow-up plan's own steps are left out (they're the
//             queue's, with their one-tap action);
//             "reminder" — timed ones only, soonest first;
//             "all" — everything, plan steps included (a customer's own list).
// opts.limit: how many open tasks to draw before a "show the rest" row. An
// imported book with a follow-up cadence on every customer is six hundred open
// tasks, and Home drew every one of them — the day's screen was mostly a task
// list nobody scrolls, and it was most of what made Home slow to open.
export function taskListEl({ onChange, limit = Infinity, leadId = null, kind = "todo", empty = "No open tasks. Tap + Add to create one." } = {}) {
  const container = document.createElement("div");
  let cap = limit;

  function draw() {
    const tasks = store.all("tasks");
    // When it's due: a timed to-do at its minute, a dated one at the end of
    // its day, an undated one last.
    const at = (t) => {
      if (isReminder(t)) return wallClock(t.remindAt);
      if (t.due) { const d = new Date(String(t.due).slice(0, 10) + "T23:59:00"); return isNaN(d) ? Infinity : d.getTime(); }
      return Infinity;
    };
    const all = tasks
      .filter((t) => !t.done && (!leadId || t.leadId === leadId) && (kind === "all" || (kind === "reminder" ? isReminder(t) : !t.cadence)))
      .sort((a, b) => {
        const da = at(a), db = at(b);
        if (da !== db) return da - db;
        const pr = { high: 0, normal: 1, low: 2 };
        return (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1);
      });
    const open = all.slice(0, cap);
    const hidden = all.length - open.length;

    if (!open.length) {
      container.innerHTML = `<div class="card"><div class="muted small" style="text-align:center">${empty}</div></div>`;
      return;
    }

    let more = null;
    if (hidden > 0) {
      more = document.createElement("button");
      more.type = "button";
      more.className = "list-more";
      more.dataset.act = "more-tasks";
      more.textContent = `Show ${hidden.toLocaleString()} more`;
      // A hundred at a time past a couple of hundred; otherwise the rest.
      more.addEventListener("click", () => { cap = Math.min(all.length, cap + (hidden > 200 ? 100 : hidden)); draw(); });
    }
    const now = Date.now();
    const frag = document.createDocumentFragment();
    open.forEach((t) => {
      // Each to-do is its own card, laid out like a customer on Outreach:
      // the title, who and when underneath, a badge on the right, and a
      // banner across the bottom where the customer card shows the
      // contract — here it's the assistant's half: Do it, Working…, or
      // Done — check it out.
      const card = document.createElement("div");
      card.className = "card todo-card";
      card.dataset.taskId = t.id;
      const rem = isReminder(t);
      const overdue = rem ? wallClock(t.remindAt) <= now : t.due && daysFromToday(t.due) < 0;
      const soon = !rem && t.due && daysFromToday(t.due) === 0;
      if (rem && overdue) card.classList.add("rem-due");
      const lead = t.leadId ? store.get("leads", t.leadId) : null;
      const ask = doItFor(t, lead);
      const when = rem
        ? `${icon(overdue ? "bell" : "clock")} ${esc(reminderWhen(t, now))}`
        : t.due ? `${esc(relativeDay(t.due))}${t.at ? " · " + esc(new Date(t.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })) : ""}` : "";
      const sub = [lead ? esc(lead.name) : "", when].filter(Boolean).join(" · ");
      const badge = rem && overdue ? `<span class="badge badge-due">Now</span>`
        : overdue ? `<span class="badge badge-due">Overdue</span>`
        : soon ? `<span class="badge badge-soon">Today</span>`
        : t.priority === "high" ? `<span class="badge badge-due">High</span>` : "";
      card.innerHTML = `
        <div class="row">
          <input type="checkbox" class="todo-tick" aria-label="Done" />
          <div class="row-main">
            <div class="row-title">${t.priority === "high" ? `<span style="color:var(--danger)">${icon("alert")}</span> ` : ""}${esc(t.title)}</div>
            ${sub ? `<div class="row-sub ${overdue ? "todo-overdue" : ""}">${sub}</div>` : ""}
          </div>
          ${badge ? `<div class="row-meta">${badge}</div>` : ""}
        </div>
        ${ask ? `<div class="todo-banner"></div>` : ""}
      `;
      const banner = card.querySelector(".todo-banner");
      // The banner's three states. "Working…" survives a trip to the screen
      // the assistant opens (the run keeps going; the card redraws from the
      // set of running ones), and "Done" is on the to-do itself, so it's
      // still there tomorrow until you tick it.
      const paint = () => {
        if (!banner) return;
        const a = t.assist;
        if (running.has(t.id)) {
          banner.className = "todo-banner todo-banner-working";
          banner.innerHTML = `<span class="tb-label" data-step>Working…</span><button type="button" class="btn btn-primary btn-sm do-it" data-do-it disabled>Working…</button>`;
        } else if (a && a.at) {
          banner.className = "todo-banner todo-banner-done";
          banner.innerHTML = `<button type="button" class="tb-done" data-check-it>${icon("checkline")} Done — check it out <span class="tb-arrow">›</span></button>`;
          // The work, on its own page: what it did, what it put on screen,
          // and the next things it can do from there (views/todo.js).
          banner.querySelector("[data-check-it]").addEventListener("click", (e) => { e.stopPropagation(); navigate(`/todo/${t.id}`); });
        } else {
          banner.className = "todo-banner";
          banner.innerHTML = `<span class="tb-label">The assistant can run this</span><button type="button" class="btn btn-primary btn-sm do-it" data-do-it aria-label="Have the assistant do this">Do it</button>`;
          banner.querySelector("[data-do-it]").addEventListener("click", (e) => { e.stopPropagation(); run(); });
        }
      };
      // "Do it": the assistant runs the lookup or writes the draft behind
      // this to-do, now, and puts the result on screen. The to-do stays
      // until you tick it — the assistant did its half. Where it went is
      // kept on the to-do, so "check it out" takes you back there.
      const run = async () => {
        running.add(t.id); paint();
        const steps = [], results = []; // what it did, in order, for the work page
        try {
          const a = await import("../agent.js");
          if (!a.agentConfigured()) { toast("Set up the voice agent under Settings first", "warn"); return; }
          // Nothing opens elsewhere: the lookups, the draft, the booking all
          // come back as results, kept on the to-do for its work page.
          const res = await a.createAgentSession({ stay: true, onTool: (name, input, out) => { const r = compactResult(name, input, out); if (r) results.push(r); } }).send(ask, (step) => {
            if (!step || /^⚠/.test(step)) return;
            if (steps[steps.length - 1] !== step) steps.push(step);
            const s = banner.querySelector("[data-step]");
            if (s) s.textContent = step;
          });
          if (res.done === false) { toast(`It needs more from you: ${res.say}`, "warn"); return; }
          // The reply isn't shouted here — it's on the work page, behind
          // "check it out", with what it can do next.
          const turn = { ask: "Do it", say: res.say || "Done.", at: new Date().toISOString(), steps: steps.slice(0, 8), results };
          t.assist = { at: turn.at, say: turn.say, steps: turn.steps, turns: [turn] };
          store.update("tasks", t.id, { assist: t.assist });
        } catch (err) {
          toast(`Couldn't do it: ${err && err.message ? err.message : err}`, "danger");
        } finally {
          running.delete(t.id); paint();
        }
      };
      paint();
      card.querySelector(".todo-tick").addEventListener("change", () => {
        store.update("tasks", t.id, { done: true });
        // A completed follow-up counts as a prospecting touch.
        if (t.cadence) {
          store.logActivity("touch");
          if (t.leadId) store.update("leads", t.leadId, { lastContacted: new Date().toISOString() });
        }
        toast(rem ? "Reminder done" : "Nice — task done", "success");
        draw();
        if (onChange) onChange();
      });
      card.querySelector(".row-main").addEventListener("click", () => openTaskForm(t));
      frag.appendChild(swipeable(card, {
        onDelete: () => {
          const snapshot = { ...t };
          store.remove("tasks", t.id);
          undoToast(rem ? "Reminder deleted" : "Task deleted", () => {
            store.restore("tasks", snapshot);
            draw();
            if (onChange) onChange();
          });
          draw();
          if (onChange) onChange();
        },
      }));
    });
    container.innerHTML = "";
    container.appendChild(frag);
    if (more) container.appendChild(more);
  }

  draw();
  return container;
}
