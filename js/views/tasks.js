// To-dos and reminders. Rendered on Today (and per customer), with shared
// add forms. A reminder is a to-do with a time: at that moment it becomes
// a notification (reminders.js) and a line under Right now on Home.

import * as store from "../store.js";
import { openModal, buildForm, toast, undoToast, swipeable } from "../components.js";
import { esc, relativeDay, daysFromToday } from "../utils.js";
import { icon } from "../icons.js";
import { isReminder, reminderWhen, wallClock, askNotifyPermission } from "../reminders.js";

const pad = (n) => String(n).padStart(2, "0");
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

    const card = document.createElement("div");
    card.className = "card";
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
    open.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "check-item";
      if (i === open.length - 1) row.style.borderBottom = "none";
      const rem = isReminder(t);
      const overdue = rem ? wallClock(t.remindAt) <= now : t.due && daysFromToday(t.due) < 0;
      const soon = !rem && t.due && daysFromToday(t.due) === 0;
      if (rem && overdue) row.classList.add("rem-due");
      const lead = t.leadId ? store.get("leads", t.leadId) : null;
      const ask = doItFor(t, lead);
      row.innerHTML = `
        <input type="checkbox" />
        <label>
          ${t.priority === "high" ? `<span style="color:var(--danger)">${icon("alert")}</span> ` : ""}${esc(t.title)}
          ${rem
            ? `<div class="small rem-when ${overdue ? "" : "muted"}">${icon(overdue ? "bell" : "clock")} ${esc(reminderWhen(t, now))}${overdue ? " · now" : ""}</div>`
            : t.due ? `<div class="small ${overdue ? "" : "muted"}" style="${overdue ? "color:var(--danger)" : ""}">${overdue ? icon("alert") + " " : soon ? icon("clock") + " " : ""}${esc(relativeDay(t.due))}${t.at ? " · " + esc(new Date(t.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })) : ""}</div>` : ""}
        </label>
        ${ask ? `<button type="button" class="btn btn-primary btn-sm do-it" data-do-it aria-label="Have the assistant do this">Do it</button>` : ""}
      `;
      // "Do it": the assistant runs the lookup or writes the draft behind
      // this to-do, now, and puts the result on screen. The to-do stays
      // until you tick it — the assistant did its half.
      const doBtn = row.querySelector("[data-do-it]");
      if (doBtn) doBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        doBtn.disabled = true; doBtn.textContent = "Working…";
        try {
          const a = await import("../agent.js");
          if (!a.agentConfigured()) { toast("Set up the voice agent under Settings first", "warn"); return; }
          const res = await a.createAgentSession().send(ask, (step) => { if (step && !/^⚠/.test(step)) doBtn.textContent = step.length > 18 ? step.slice(0, 16) + "…" : step; });
          toast(res.say || "Done — it's on screen.", "success");
        } catch (err) {
          toast(`Couldn't do it: ${err && err.message ? err.message : err}`, "danger");
        } finally {
          doBtn.disabled = false; doBtn.textContent = "Do it";
        }
      });
      row.querySelector("input").addEventListener("change", () => {
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
      row.querySelector("label").addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;
        openTaskForm(t);
      });
      card.appendChild(swipeable(row, {
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
    container.appendChild(card);
    if (more) container.appendChild(more);
  }

  draw();
  return container;
}
