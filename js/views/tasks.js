// To-dos and reminders. Rendered on Today (and per customer), with shared
// add forms. A reminder is a to-do with a time: at that moment it becomes
// a notification (reminders.js) and a line under Right now on Home.

import * as store from "../store.js";
import { openModal, buildForm, toast, undoToast, swipeable } from "../components.js";
import { esc, relativeDay, daysFromToday } from "../utils.js";
import { icon } from "../icons.js";
import { isReminder, reminderWhen, wallClock, askNotifyPermission } from "../reminders.js";

export function openTaskForm(existing, defaults = {}) {
  const isEdit = !!existing;
  const t = existing || defaults;
  if (isEdit && isReminder(existing)) return openReminderForm(existing);
  openModal(isEdit ? "Edit task" : "New task", (close) => {
    const { element } = buildForm(
      [
        { name: "title", label: "Task", value: t.title, required: true, placeholder: "Call Jane about financing" },
        { name: "due", label: "Due date", value: t.due || "", type: "date" },
        { name: "priority", label: "Priority", value: t.priority || "normal", type: "select",
          options: [{ value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }] },
      ],
      {
        submitLabel: isEdit ? "Save" : "Add task",
        onSubmit: (data) => {
          if (isEdit) { store.update("tasks", existing.id, data); toast("Task updated", "success"); }
          else { store.create("tasks", { ...data, done: false, leadId: t.leadId || null }); toast("Task added", "success"); }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

const pad = (n) => String(n).padStart(2, "0");
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// The next round hour, so a new reminder defaults to something sensible.
const nextHour = () => { const d = new Date(Date.now() + 3600000); return `${pad(d.getHours())}:00`; };

// A reminder: what, which day, what time. Stored as a task with remindAt
// in local wall-clock time (like appointments), so the phone and the cloud
// agree on the moment.
export function openReminderForm(existing, defaults = {}) {
  const isEdit = !!existing;
  const t = existing || defaults;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(t.remindAt || ""));
  openModal(isEdit ? "Edit reminder" : "New reminder", (close) => {
    const { element } = buildForm(
      [
        { name: "title", label: "Remind me to", value: t.title || "", required: true, placeholder: "Call Dana back about the SV" },
        { name: "date", label: "Day", value: m ? m[1] : todayKey(), type: "date", required: true },
        { name: "time", label: "Time", value: m ? m[2] : nextHour(), type: "time", required: true },
      ],
      {
        submitLabel: isEdit ? "Save" : "Set reminder",
        onSubmit: (data) => {
          const remindAt = `${data.date}T${data.time}`;
          const rec = { title: data.title, due: data.date, remindAt, channel: "reminder", notifiedAt: null };
          if (isEdit) { store.update("tasks", existing.id, rec); toast("Reminder updated", "success"); }
          else { store.create("tasks", { ...rec, done: false, priority: "normal", leadId: t.leadId || null }); toast(`Reminder set for ${reminderWhen(rec)}`, "success"); }
          close();
          askNotifyPermission();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

// Returns a DOM element listing open tasks.
// opts.kind:  "todo" (default) — everything but reminders, due date first;
//             "reminder" — reminders only, soonest first;
//             "all" — both (a customer's own list).
// opts.limit: how many open tasks to draw before a "show the rest" row. An
// imported book with a follow-up cadence on every customer is six hundred open
// tasks, and Home drew every one of them — the day's screen was mostly a task
// list nobody scrolls, and it was most of what made Home slow to open.
export function taskListEl({ onChange, limit = Infinity, leadId = null, kind = "todo", empty = "No open tasks. Tap + Add to create one." } = {}) {
  const container = document.createElement("div");
  let cap = limit;

  function draw() {
    const tasks = store.all("tasks");
    const all = tasks
      .filter((t) => !t.done && (!leadId || t.leadId === leadId) && (kind === "all" || (kind === "reminder") === isReminder(t)))
      .sort((a, b) => {
        if (kind === "reminder") return String(a.remindAt).localeCompare(String(b.remindAt));
        const da = a.due ? daysFromToday(a.due) : Infinity;
        const db = b.due ? daysFromToday(b.due) : Infinity;
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
      row.innerHTML = `
        <input type="checkbox" />
        <label>
          ${t.priority === "high" ? `<span style="color:var(--danger)">${icon("alert")}</span> ` : ""}${esc(t.title)}
          ${rem
            ? `<div class="small rem-when ${overdue ? "" : "muted"}">${icon(overdue ? "bell" : "clock")} ${esc(reminderWhen(t, now))}${overdue ? " · now" : ""}</div>`
            : t.due ? `<div class="small ${overdue ? "" : "muted"}" style="${overdue ? "color:var(--danger)" : ""}">${overdue ? icon("alert") + " " : soon ? icon("clock") + " " : ""}${esc(relativeDay(t.due))}${t.at ? " · " + esc(new Date(t.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })) : ""}</div>` : ""}
        </label>
      `;
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
        if (rem) openReminderForm(t); else openTaskForm(t);
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
