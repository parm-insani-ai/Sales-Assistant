// Home dashboard: the day at a glance — follow-ups due, tasks, deliveries, stats.

import * as store from "../store.js";
import { stageMeta } from "../store.js";
import { navigate } from "../router.js";
import { esc, relativeDay, daysFromToday, phoneDisplay, telHref, smsHref } from "../utils.js";
import { taskListEl, openTaskForm } from "./tasks.js";
import { emptyState } from "../components.js";

export function renderDashboard(view) {
  const leads = store.all("leads");
  const tasks = store.all("tasks");
  const deliveries = store.all("deliveries");
  const s = store.getSettings();

  const activeLeads = leads.filter((l) => !["delivered", "lost"].includes(l.stage));
  const dueFollowUps = activeLeads
    .filter((l) => l.followUp && daysFromToday(l.followUp) <= 0)
    .sort((a, b) => daysFromToday(a.followUp) - daysFromToday(b.followUp));
  const upcomingFollowUps = activeLeads
    .filter((l) => l.followUp && daysFromToday(l.followUp) > 0 && daysFromToday(l.followUp) <= 3)
    .sort((a, b) => daysFromToday(a.followUp) - daysFromToday(b.followUp));
  const openTasks = tasks.filter((t) => !t.done);
  const activeDeliveries = deliveries.filter((d) => d.status !== "delivered");
  const soldThisMonth = leads.filter((l) => {
    if (!["sold", "delivered"].includes(l.stage)) return false;
    const d = new Date(l.updatedAt || l.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = s.salesperson ? `, ${s.salesperson.split(" ")[0]}` : "";

  const el = document.createElement("div");
  el.innerHTML = `
    <div style="margin:2px 4px 16px">
      <div class="muted small">${greeting}${esc(name)} 👋</div>
      <div class="strong" style="font-size:1.1rem">Here's your day</div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="stat-value" style="color:${dueFollowUps.length ? "var(--danger)" : "var(--text)"}">${dueFollowUps.length}</div><div class="stat-label">Follow-ups due</div></div>
      <div class="stat"><div class="stat-value">${activeLeads.length}</div><div class="stat-label">Active leads</div></div>
      <div class="stat"><div class="stat-value">${activeDeliveries.length}</div><div class="stat-label">Deliveries in prep</div></div>
      <div class="stat"><div class="stat-value" style="color:var(--success)">${soldThisMonth}</div><div class="stat-label">Sold this month</div></div>
    </div>

    <div class="section-title">📞 Follow up today ${dueFollowUps.length ? `(${dueFollowUps.length})` : ""}</div>
    <div class="due-list"></div>

    ${upcomingFollowUps.length ? `<div class="section-title">Coming up</div><div class="upcoming-list"></div>` : ""}

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>✅ To-do</span>
      <button class="btn btn-sm btn-ghost" data-act="add-task">+ To-do</button>
    </div>
    <div class="tasks-slot"></div>

    ${activeDeliveries.length ? `<div class="section-title">🚗 Deliveries in prep</div><div class="deliv-list"></div>` : ""}
  `;
  view.appendChild(el);

  // Due follow-ups
  const dueList = el.querySelector(".due-list");
  if (!dueFollowUps.length) {
    dueList.innerHTML = `<div class="card"><div class="muted small" style="text-align:center">All caught up — no follow-ups due. 🙌</div></div>`;
  } else {
    dueFollowUps.forEach((l) => dueList.appendChild(followUpCard(l)));
  }

  // Upcoming
  const up = el.querySelector(".upcoming-list");
  if (up) upcomingFollowUps.forEach((l) => up.appendChild(followUpCard(l, true)));

  // Tasks
  el.querySelector(".tasks-slot").appendChild(taskListEl());
  el.querySelector('[data-act="add-task"]').addEventListener("click", () => openTaskForm());

  // Deliveries
  const dl = el.querySelector(".deliv-list");
  if (dl) {
    activeDeliveries
      .sort((a, b) => (a.deliveryDate || "9999").localeCompare(b.deliveryDate || "9999"))
      .forEach((d) => dl.appendChild(deliveryMini(d)));
  }
}

function followUpCard(l, upcoming = false) {
  const el = document.createElement("div");
  el.className = "card";
  const st = stageMeta(l.stage);
  const overdue = daysFromToday(l.followUp) < 0;
  el.innerHTML = `
    <div class="row card-tap" data-open>
      <div class="row-main">
        <div class="row-title">${esc(l.name)}</div>
        <div class="row-sub">${l.vehicleInterest ? esc(l.vehicleInterest) : "No vehicle noted"}</div>
      </div>
      <div class="row-meta">
        <span class="badge ${st.badge}">${esc(st.label)}</span>
        <div class="small ${overdue ? "" : "muted"}" style="margin-top:4px;${overdue ? "color:var(--danger)" : ""}">${esc(relativeDay(l.followUp))}</div>
      </div>
    </div>
    ${l.phone ? `<div class="btn-row" style="margin-top:12px">
      <a class="btn btn-success btn-sm" style="flex:1" href="${telHref(l.phone)}">📞 Call</a>
      <a class="btn btn-primary btn-sm" style="flex:1" href="${smsHref(l.phone)}">💬 Text</a>
      <button class="btn btn-ghost btn-sm" data-act="done" style="flex:1">✓ Done</button>
    </div>` : `<div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost btn-sm btn-block" data-act="done">✓ Mark followed up</button></div>`}
  `;
  el.querySelector("[data-open]").addEventListener("click", () => navigate(`/leads/${l.id}`));
  const doneBtn = el.querySelector('[data-act="done"]');
  if (doneBtn) doneBtn.addEventListener("click", () => {
    // Clear the follow-up (mark as handled for now).
    store.update("leads", l.id, { followUp: null });
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  return el;
}

function deliveryMini(d) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  const items = d.checklist || [];
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(d.customerName || "Customer")}</div>
        <div class="row-sub">${esc(d.vehicle || "Vehicle TBD")}${d.deliveryDate ? " · " + esc(relativeDay(d.deliveryDate)) : ""}</div>
      </div>
      <div class="row-meta small strong mono">${pct}%</div>
    </div>
    <div class="progress"><span style="width:${pct}%"></span></div>
  `;
  el.addEventListener("click", () => navigate(`/deliveries/${d.id}`));
  return el;
}
