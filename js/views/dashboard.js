// Home dashboard: the day at a glance — follow-ups due, tasks, deliveries, stats.

import * as store from "../store.js";
import { stageMeta, apptType } from "../store.js";
import { navigate } from "../router.js";
import { esc, currency, relativeDay, daysFromToday, phoneDisplay, telHref, smsHref } from "../utils.js";
import { taskListEl, openTaskForm } from "./tasks.js";
import { monthSummary } from "./goals.js";
import { prospectSummary } from "./prospecting.js";
import { emptyState } from "../components.js";
import { icon } from "../icons.js";

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

  // Today's appointments (not completed/canceled).
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaysAppts = store.all("appointments")
    .filter((a) => a.status === "scheduled" && String(a.when).slice(0, 10) === todayKey)
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));

  // Month-to-date sales vs goal.
  const mtd = monthSummary();
  const soldThisMonth = mtd.units;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = s.salesperson ? `, ${s.salesperson.split(" ")[0]}` : "";

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="hero">
      <div class="hero-greeting">${greeting}${esc(name)}</div>
      <div class="hero-title">Here's your day</div>
    </div>

    ${(() => { const ps = prospectSummary(); return `
    <div class="card card-tap prospect-card" data-goto="/prospecting">
      <div class="row">
        <div class="row-main">
          <div class="row-title" style="color:var(--brand-ink)">${icon("target")} Today's call list</div>
          <div class="row-sub" style="color:var(--brand-ink);opacity:.9">${ps.hot ? `${ps.hot} new — respond now · ${ps.total} to reach` : ps.total ? `${ps.total} ${ps.total === 1 ? "person" : "people"} to reach — book more appointments` : "You're all caught up on outreach"}</div>
        </div>
        <div class="row-meta strong" style="color:var(--brand-ink);font-size:1.6rem">${ps.total || ""} ›</div>
      </div>
    </div>`; })()}

    <div class="card card-tap" data-goto="/tools" style="margin-top:12px">
      <div class="row">
        <div class="row-main">
          <div class="row-title">${icon("grid")} Sales tools</div>
          <div class="row-sub">Calculator · Compare · SPIFs · Specials · Deal Radar</div>
        </div>
        <div class="row-meta strong">›</div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="stat-value" style="color:${dueFollowUps.length ? "var(--danger)" : "var(--text)"}">${dueFollowUps.length}</div><div class="stat-label">Follow-ups due</div></div>
      <div class="stat"><div class="stat-value">${activeLeads.length}</div><div class="stat-label">Active leads</div></div>
      <div class="stat"><div class="stat-value">${activeDeliveries.length}</div><div class="stat-label">Deliveries in prep</div></div>
      <div class="stat card-tap" data-goto="/goals"><div class="stat-value" style="color:var(--success)">${soldThisMonth}</div><div class="stat-label">Sold this month ›</div></div>
    </div>

    ${goalCard(mtd, s)}

    ${todaysAppts.length ? `<div class="section-title" style="display:flex;justify-content:space-between;align-items:center"><span>Today's schedule</span><a class="link small" href="#/calendar">All ›</a></div><div class="appt-list"></div>` : ""}

    <div class="section-title">Follow up today ${dueFollowUps.length ? `<span class="muted">· ${dueFollowUps.length}</span>` : ""}</div>
    <div class="due-list"></div>

    ${upcomingFollowUps.length ? `<div class="section-title">Coming up</div><div class="upcoming-list"></div>` : ""}

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>To-dos</span>
      <button class="btn btn-sm btn-ghost" data-act="add-task">+ Add</button>
    </div>
    <div class="tasks-slot"></div>

    ${activeDeliveries.length ? `<div class="section-title">Deliveries in prep</div><div class="deliv-list"></div>` : ""}
  `;
  view.appendChild(el);

  // Due follow-ups
  const dueList = el.querySelector(".due-list");
  if (!dueFollowUps.length) {
    dueList.innerHTML = `<div class="card"><div class="muted small" style="text-align:center">All caught up — no follow-ups due.</div></div>`;
  } else {
    dueFollowUps.forEach((l) => dueList.appendChild(followUpCard(l)));
  }

  // Upcoming
  const up = el.querySelector(".upcoming-list");
  if (up) upcomingFollowUps.forEach((l) => up.appendChild(followUpCard(l, true)));

  // Tasks
  el.querySelector(".tasks-slot").appendChild(taskListEl());
  el.querySelector('[data-act="add-task"]').addEventListener("click", () => openTaskForm());

  // Appointments today
  const al = el.querySelector(".appt-list");
  if (al) todaysAppts.forEach((a) => al.appendChild(apptMini(a)));

  // Deliveries
  const dl = el.querySelector(".deliv-list");
  if (dl) {
    activeDeliveries
      .sort((a, b) => (a.deliveryDate || "9999").localeCompare(b.deliveryDate || "9999"))
      .forEach((d) => dl.appendChild(deliveryMini(d)));
  }

  // Tappable stat cards.
  el.querySelectorAll("[data-goto]").forEach((n) =>
    n.addEventListener("click", () => navigate(n.dataset.goto)));
}

function goalCard(mtd, s) {
  const unitPct = s.goalUnits > 0 ? Math.min(100, Math.round((mtd.units / s.goalUnits) * 100)) : 0;
  const commPct = s.goalCommission > 0 ? Math.min(100, Math.round((mtd.commission / s.goalCommission) * 100)) : 0;
  return `
    <div class="card card-tap" data-goto="/goals" style="margin-top:12px">
      <div class="row"><div class="strong">Monthly goal</div><div class="small muted">Details ›</div></div>
      <div style="margin-top:10px">
        <div class="row small"><span class="muted">Units</span><span class="mono">${mtd.units} / ${s.goalUnits || 0}</span></div>
        <div class="progress"><span style="width:${unitPct}%"></span></div>
      </div>
      <div style="margin-top:10px">
        <div class="row small"><span class="muted">Commission</span><span class="mono">${currency(mtd.commission)} / ${currency(s.goalCommission || 0)}</span></div>
        <div class="progress"><span style="width:${commPct}%;background:var(--accent)"></span></div>
      </div>
    </div>`;
}

function apptMini(a) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  const t = apptType(a.type);
  const time = a.when ? new Date(a.when).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${icon(t.icon)} ${esc(a.title || t.label)}</div>
        <div class="row-sub">${esc(a.customerName || "")}${a.vehicle ? " · " + esc(a.vehicle) : ""}</div>
      </div>
      <div class="row-meta strong mono">${esc(time)}</div>
    </div>
  `;
  el.addEventListener("click", () => navigate(`/calendar/${a.id}`));
  return el;
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
      <a class="btn btn-success btn-sm" style="flex:1" href="${telHref(l.phone)}">${icon("phone")} Call</a>
      <a class="btn btn-primary btn-sm" style="flex:1" href="${smsHref(l.phone)}">${icon("message")} Text</a>
      <button class="btn btn-ghost btn-sm" data-act="done" style="flex:1">${icon("checkline")} Done</button>
    </div>` : `<div class="btn-row" style="margin-top:12px"><button class="btn btn-ghost btn-sm btn-block" data-act="done">${icon("checkline")} Mark followed up</button></div>`}
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
