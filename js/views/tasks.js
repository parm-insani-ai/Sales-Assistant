// To-do / reminders. Rendered inline on the dashboard, with a shared add form.

import * as store from "../store.js";
import { openModal, buildForm, toast, undoToast, swipeable } from "../components.js";
import { esc, relativeDay, daysFromToday } from "../utils.js";
import { icon } from "../icons.js";

export function openTaskForm(existing, defaults = {}) {
  const isEdit = !!existing;
  const t = existing || defaults;
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
          else { store.create("tasks", { ...data, done: false }); toast("Task added", "success"); }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

// Returns a DOM element listing open + optionally completed tasks.
// opts.limit: how many open tasks to draw before a "show the rest" row. An
// imported book with a follow-up cadence on every customer is six hundred open
// tasks, and Home drew every one of them — the day's screen was mostly a task
// list nobody scrolls, and it was most of what made Home slow to open.
export function taskListEl({ onChange, limit = Infinity, leadId = null, empty = "No open tasks. Tap + Add to create one." } = {}) {
  const container = document.createElement("div");
  let cap = limit;

  function draw() {
    const tasks = store.all("tasks");
    const all = tasks
      .filter((t) => !t.done && (!leadId || t.leadId === leadId))
      .sort((a, b) => {
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
    open.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "check-item";
      if (i === open.length - 1) row.style.borderBottom = "none";
      const overdue = t.due && daysFromToday(t.due) < 0;
      const soon = t.due && daysFromToday(t.due) === 0;
      row.innerHTML = `
        <input type="checkbox" />
        <label>
          ${t.priority === "high" ? `<span style="color:var(--danger)">${icon("alert")}</span> ` : ""}${esc(t.title)}
          ${t.due ? `<div class="small ${overdue ? "" : "muted"}" style="${overdue ? "color:var(--danger)" : ""}">${overdue ? icon("alert") + " " : soon ? icon("clock") + " " : ""}${esc(relativeDay(t.due))}</div>` : ""}
        </label>
      `;
      row.querySelector("input").addEventListener("change", () => {
        store.update("tasks", t.id, { done: true });
        // A completed follow-up counts as a prospecting touch.
        if (t.cadence) {
          store.logActivity("touch");
          if (t.leadId) store.update("leads", t.leadId, { lastContacted: new Date().toISOString() });
        }
        toast("Nice — task done", "success");
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
          undoToast("Task deleted", () => {
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
