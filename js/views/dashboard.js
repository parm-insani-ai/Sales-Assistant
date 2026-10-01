// Home dashboard: the day at a glance — what is happening right now, the
// calendar, the numbers, what is coming up. The day's work (the queue and
// the to-dos) is the Today tab.

import * as store from "../store.js";
import { stageMeta, apptType } from "../store.js";
import { navigate } from "../router.js";
import { esc, currency, relativeDay, daysFromToday, telHref, smsHref } from "../utils.js";
import { monthSummary } from "./goals.js";
import { salesTarget, openTargetForm } from "../target.js";
import { fold } from "../fold.js";
import { icon } from "../icons.js";
import { getExternalEvents, refreshIfStale, feedsConfigured } from "../calfeeds.js";
import { getNudges } from "../nudges.js";
import { reviewTouch } from "../touches.js";
import { ensurePlans } from "../apptplan.js";

export function renderDashboard(view) {
  const leads = store.all("leads");
  const deliveries = store.all("deliveries");
  const s = store.getSettings();

  const activeLeads = leads.filter((l) => !["delivered", "lost"].includes(l.stage));
  const dueFollowUps = activeLeads
    .filter((l) => l.followUp && daysFromToday(l.followUp) <= 0)
    .sort((a, b) => daysFromToday(a.followUp) - daysFromToday(b.followUp));
  const upcomingFollowUps = activeLeads
    .filter((l) => l.followUp && daysFromToday(l.followUp) > 0 && daysFromToday(l.followUp) <= 3)
    .sort((a, b) => daysFromToday(a.followUp) - daysFromToday(b.followUp));
  const activeDeliveries = deliveries.filter((d) => d.status !== "delivered");

  // Every appointment gets its presets (confirmation text, reminders) — the
  // ones booked before that existed, and the ones that arrived by sync.
  try { ensurePlans(); } catch { /* the list still draws */ }
  // Appointments still ahead — the tile counts them, the list has them all.
  const nowLocal = new Date();
  const nowKey = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, "0")}-${String(nowLocal.getDate()).padStart(2, "0")}T${String(nowLocal.getHours()).padStart(2, "0")}:${String(nowLocal.getMinutes()).padStart(2, "0")}`;
  const upcomingAppts = store.all("appointments").filter((a) => a.status === "scheduled" && !a.outcome && String(a.when) >= nowKey);

  // Today's appointments (not completed/canceled).
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaysAppts = store.all("appointments")
    .filter((a) => a.status === "scheduled" && String(a.when).slice(0, 10) === todayKey)
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));

  // External calendar events (Apple/Outlook/Google) happening today.
  const dkLocal = (iso) => { const d = new Date(iso); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const todayLocalKey = dkLocal(new Date());
  const externalToday = getExternalEvents()
    .filter((e) => dkLocal(e.when) === todayLocalKey)
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));
  const todayCount = todaysAppts.length + externalToday.length;

  // Month-to-date sales vs goal.
  const mtd = monthSummary();

  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // The day sits in the top bar, in line with the "+", in the greeting's
  // place and its type: the date, with how much is on, and a tap opens the
  // calendar. The page starts with the day rather than a hello.
  const titleEl = document.getElementById("page-title");
  if (titleEl) {
    titleEl.innerHTML = `<span class="day-date">${esc(todayLabel)}</span>${todayCount ? `<span class="day-count"> · ${todayCount} today</span>` : ""}`;
    titleEl.classList.add("greeting", "day-link");
    titleEl.setAttribute("role", "link");
    titleEl.title = "Open the calendar";
    titleEl.onclick = () => navigate("/calendar");
  }

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="appt-list"></div>

    <div class="target-slot"></div>

    <div class="stat-grid">
      <div class="stat card-tap" data-goto="/leads" data-lead-filter="due"><div class="stat-value" style="color:${dueFollowUps.length ? "var(--danger)" : "var(--text)"}">${dueFollowUps.length}</div><div class="stat-label">Follow-ups due ›</div></div>
      <div class="stat card-tap" data-goto="/appts"><div class="stat-value">${upcomingAppts.length}</div><div class="stat-label">Appointments ›</div></div>
    </div>

    <div class="nudge-slot"></div>

    ${upcomingFollowUps.length ? `<div class="section-title">Coming up</div><div class="upcoming-list"></div>` : ""}

    ${activeDeliveries.length ? `<div class="section-title">Deliveries in prep</div><div class="deliv-list"></div>` : ""}
  `;
  view.appendChild(el);

  // Above everything: the handful of things that stop being true if you
  // wait. The queue (on Today) is what to work today; this is what is
  // happening now, and mixing them into one ranked list buried the urgent
  // under the merely due.
  const nudgeSlot = el.querySelector(".nudge-slot");
  function paintNudges() {
    const list = getNudges({ limit: 4 });
    nudgeSlot.innerHTML = "";
    if (!list.length) return;
    nudgeSlot.innerHTML = `<div class="section-title">Right now <span class="muted">\u00b7 ${list.length}</span></div>`;
    const box = document.createElement("div");
    box.className = "card nudge-card";
    let nextUnlock = 0;
    list.forEach((n) => {
      const row = document.createElement("div");
      row.className = `row nudge-row${n.urgency >= 85 ? " nudge-hot" : ""}${n.locked ? " nudge-locked" : ""}`;
      row.innerHTML = `<div class="row-main" style="min-width:0">
          <div class="row-title">${esc(n.title)}</div>
          ${n.sub ? `<div class="row-sub">${esc(n.sub)}</div>` : ""}
        </div><div class="row-meta">${n.locked ? icon("clock") : "\u203a"}</div>`;
      if (n.locked && n.unlockAt) { const t = new Date(n.unlockAt).getTime(); if (t > Date.now() && (!nextUnlock || t < nextUnlock)) nextUnlock = t; }
      row.addEventListener("click", async () => {
        if (n.taskId && !n.route) {
          row.style.opacity = "0.6";
          try { await reviewTouch(n.taskId); } finally { row.style.opacity = ""; }
          return;
        }
        if (n.href) { window.location.href = n.href; return; }
        if (n.route) navigate(n.route);
      });
      box.appendChild(row);
    });
    nudgeSlot.appendChild(box);
    // A locked text flips to "ready" at its minute, not at the next tick.
    if (nextUnlock) setTimeout(() => { if (document.body.contains(nudgeSlot)) paintNudges(); }, nextUnlock - Date.now() + 500);
  }
  paintNudges();
  // Time passes while the screen is open: an appointment slides into its
  // confirm window, a reply crosses from "just arrived" into "waiting".
  const nudgeTimer = setInterval(() => {
    if (!document.body.contains(nudgeSlot)) return clearInterval(nudgeTimer);
    paintNudges();
  }, 60000);
  // And things happen while it's open: a customer added from the voice sheet
  // over this screen has a welcome text ready the moment the sheet closes,
  // not a minute later. One repaint per burst of writes.
  let nudgePending = 0;
  const unsub = store.subscribe(() => {
    if (!document.body.contains(nudgeSlot)) return unsub();
    if (nudgePending) return;
    nudgePending = setTimeout(() => { nudgePending = 0; if (document.body.contains(nudgeSlot)) paintNudges(); }, 50);
  });

  // The month's sales target, worked like the store's target sheet.
  const mountTarget = () => {
    const slot = el.querySelector(".target-slot");
    if (!slot) return;
    slot.replaceChildren(targetSection(mtd, store.getSettings(), mountTarget));
  };
  mountTarget();

  // Upcoming
  const up = el.querySelector(".upcoming-list");
  if (up) upcomingFollowUps.forEach((l) => up.appendChild(followUpCard(l, true)));

  // Appointments today (own + external calendars)
  const al = el.querySelector(".appt-list");
  if (al) {
    todaysAppts.forEach((a) => al.appendChild(apptMini(a)));
    externalToday.forEach((e) => al.appendChild(externalMini(e)));
  }

  // Deliveries
  const dl = el.querySelector(".deliv-list");
  if (dl) {
    activeDeliveries
      .sort((a, b) => (a.deliveryDate || "9999").localeCompare(b.deliveryDate || "9999"))
      .forEach((d) => dl.appendChild(deliveryMini(d)));
  }

  // Tappable stat cards. A stat can preset the leads filter (e.g. "due").
  el.querySelectorAll("[data-goto]").forEach((n) =>
    n.addEventListener("click", () => {
      if (n.dataset.leadFilter) sessionStorage.setItem("leads-filter", n.dataset.leadFilter);
      navigate(n.dataset.goto);
    }));

  // Pull fresh external calendar events in the background; re-render once when
  // they land so today's count/list reflect them.
  if (feedsConfigured()) {
    const onFeeds = () => { window.removeEventListener("viniva-calfeeds", onFeeds); window.dispatchEvent(new HashChangeEvent("hashchange")); };
    window.addEventListener("viniva-calfeeds", onFeeds);
    refreshIfStale();
  }
}

function externalMini(e) {
  const el = document.createElement("div");
  el.className = "card";
  const time = e.allDay ? "All day" : (e.when ? new Date(e.when).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${icon("calendar")} ${esc(e.title)}</div>
        <div class="row-sub"><span class="badge">${esc(e.source)}</span></div>
      </div>
      <div class="row-meta strong mono">${esc(time)}</div>
    </div>
  `;
  return el;
}

// The store's monthly target sheet, on Home: the target by category, the
// closing ratio, the customers that calls for, and — counted from the
// book as the month goes — spoken to, sold, closing, what's left, and
// this week's share. Its customer log is the app: Leads, contacts, sales.
function targetSection(mtd, s, redraw) {
  const t = salesTarget();
  const p = t.plan;
  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const share = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const month = new Date().toLocaleDateString("en-US", { month: "long" });
  const hit = p.target > 0 && t.sold >= p.target;
  const behind = t.expectedByNow - t.spoke;
  const commPct = share(mtd.commission, s.goalCommission);
  // Two big numbers — sold against the target, spoken with against what
  // the target calls for — then the same by new and used as thin bars,
  // then the read: closing ratio, pace, this week. No grid to decode.
  const tile = (label, have, want, cls) => `
    <div class="tg-tile ${cls}">
      <div class="tg-big">${have}<span class="tg-of">/${want}</span></div>
      <div class="tg-label">${label}</div>
      <div class="progress tg-bar"><span style="width:${share(have, want)}%"></span></div>
      <div class="tg-left">${Math.max(0, want - have)} to go</div>
    </div>`;
  const cat = (label, sold, target, spoke, need) => `
    <div class="tg-cat">
      <div class="tg-cat-head"><span class="strong">${label}</span><span class="small muted">${sold}/${target} sold · ${spoke}/${need} spoken with</span></div>
      <div class="tg-cat-bars"><div class="progress tg-thin tg-sold"><span style="width:${share(sold, target)}%"></span></div><div class="progress tg-thin tg-spoke"><span style="width:${share(spoke, need)}%"></span></div></div>
    </div>`;
  const chip = (cls, text) => `<span class="tg-chip ${cls}">${text}</span>`;
  const read = !p.need ? "" : [
    hit ? chip("tg-good", `${icon("check")} Target reached`) : behind > 0 ? chip("tg-warn", `${behind} behind pace`) : chip("tg-good", "On pace"),
    t.closing != null ? chip(t.closing >= p.closingNew ? "tg-good" : "", `Closing ${pct(t.closing)} <span class="muted">· expect ${pct(p.closingNew)}</span>`) : chip("", `Expect ${pct(p.closingNew)} closing`),
    chip(t.spokeWeek >= t.perWeek ? "tg-good" : "", `This week ${t.spokeWeek}/${t.perWeek}`),
    chip("", `${t.appts} appt${t.appts === 1 ? "" : "s"} set${s.goalAppointments ? ` <span class="muted">of ${s.goalAppointments}</span>` : ""}`),
  ].join("");
  const body = document.createElement("div");
  body.className = "card target-card";
  body.innerHTML = `
    <div class="row">
      <div class="row-main"><div class="strong">${esc(month)}${p.target ? ` · ${p.target} unit${p.target === 1 ? "" : "s"}` : ""}</div><div class="small muted">${p.target ? `Speak with ${p.need} customers to get there.` : "How many will you sell this month?"}</div></div>
      <button class="btn btn-sm ${p.target ? "btn-ghost" : "btn-primary"}" data-act="set-target" style="flex:none">${p.target ? "Set target" : "Set your target"}</button>
    </div>
    ${p.target ? `
    <div class="tg-tiles">${tile("Sold", t.sold, p.target, hit ? "tg-hit" : "")}${tile("Spoken with", t.spoke, p.need, "")}</div>
    ${p.split ? `<div class="tg-cats">${cat("New", t.soldNew, p.targetNew, t.spokeNew, p.needNew)}${cat("Used", t.soldUsed, p.targetUsed, t.spokeUsed, p.needUsed)}</div>` : ""}
    <div class="tg-chips">${read}</div>
    ${t.spokeUnsplit || t.soldUnsplit ? `<div class="small muted" style="margin-top:8px">${[t.spokeUnsplit ? `${t.spokeUnsplit} spoken with aren't marked new or used yet` : "", t.soldUnsplit ? `${t.soldUnsplit} sale${t.soldUnsplit === 1 ? "" : "s"} not marked new or used` : ""].filter(Boolean).join(" · ")} — say it when you add them, or set Shopping on their page.</div>` : ""}
    ${s.targetSetBy === "manager" ? `<div class="small muted" style="margin-top:6px">${icon("check")} Target set by your manager for this month${s.goalUnits && s.goalUnits !== p.target ? ` — ${s.goalUnits} units` : ""}.</div>` : ""}
    ` : `<div class="small muted" style="margin-top:10px">Set your new and used units and the closing ratio you expect, and this works out how many customers to speak with — then counts them as you add customers, log contacts and log sales.</div>`}
    <div class="row small" style="margin-top:12px"><span class="muted">Commission</span><span class="mono">${currency(mtd.commission)} / ${currency(s.goalCommission || 0)}</span></div>
    <div class="progress" style="margin-top:6px"><span style="width:${commPct}%;background:var(--accent)"></span></div>`;
  body.querySelector('[data-act="set-target"]').addEventListener("click", () => openTargetForm(redraw));
  return fold({ key: "home:target", title: "Sales target", open: true, body });
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
