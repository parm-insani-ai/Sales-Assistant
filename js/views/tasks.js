// To-do / reminders. Rendered inline on the dashboard, with a shared add form.

import * as store from "../store.js";
import { openModal, buildForm, toast } from "../components.js";
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
export function taskListEl({ onChange } = {}) {
  const container = document.createElement("div");

  function draw() {
    const tasks = store.all("tasks");
    const open = tasks
      .filter((t) => !t.done)
      .sort((a, b) => {
        const da = a.due ? daysFromToday(a.due) : Infinity;
        const db = b.due ? daysFromToday(b.due) : Infinity;
        if (da !== db) return da - db;
        const pr = { high: 0, normal: 1, low: 2 };
        return (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1);
      });

    if (!open.length) {
      container.innerHTML = `<div class="card"><div class="muted small" style="text-align:center">No open tasks. Tap + Add to create one.</div></div>`;
      return;
    }

    const card = document.createElement("div");
    card.className = "card";
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
        toast("Nice — task done", "success");
        draw();
        if (onChange) onChange();
      });
      row.querySelector("label").addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;
        openTaskForm(t);
      });
      card.appendChild(row);
    });
    container.innerHTML = "";
    container.appendChild(card);
  }

  draw();
  return container;
}
