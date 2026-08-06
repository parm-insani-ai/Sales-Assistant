// Prospecting hub — the lead-generation engine. Surfaces a prioritized daily
// "call list" mined from the salesperson's own contacts (due follow-ups, cold
// leads, past-customer equity/anniversaries, birthdays, lease-ends), plus a
// daily activity scoreboard (touches + appointments set vs. goal).

import * as store from "../store.js";
import { toast, emptyState } from "../components.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { openTemplatePicker } from "./messages.js";
import { openAppointmentForm } from "./calendar.js";
import {
  esc, phoneDisplay, telHref, smsHref, relativeDay, daysFromToday,
  formatDate, parseDate,
} from "../utils.js";

const ACTIVE = (l) => !["delivered", "lost"].includes(l.stage);
const daysSince = (iso) => (iso ? -daysFromToday(iso) : Infinity);
const hoursSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : Infinity);
const RESPOND_NOW_HRS = 48;

function equityReason(dateISO) {
  const info = anniversaryInfo(dateISO);
  if (!info || info.years < 1) return null;
  if (info.daysToAnn <= 14) return `${info.years}-yr anniversary ${info.daysToAnn === 0 ? "today" : "in " + info.daysToAnn + "d"}`;
  if (info.years >= 3) return `Owned ${info.years} yrs — likely in equity`;
  return null;
}

function anniversaryInfo(saleDate) {
  const d = parseDate(saleDate);
  if (!d) return null;
  const now = new Date();
  const before = now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  const years = now.getFullYear() - d.getFullYear() - (before ? 1 : 0);
  const annStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let ann = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (ann < annStart) ann = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  const daysToAnn = Math.round((ann - annStart) / 86400000);
  return { years, daysToAnn };
}

// Month/day proximity for birthdays (dob stored as YYYY-MM-DD; year ignored).
function daysToAnnual(mmdd) {
  const d = parseDate(mmdd);
  if (!d) return null;
  const now = new Date();
  const annStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < annStart) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return Math.round((next - annStart) / 86400000);
}

// Build the prioritized opportunity list. Each row: {leadId, name, phone,
// vehicle, reason, kind, badge}.
function buildCallList() {
  const leads = store.all("leads");
  const sales = store.all("sales");
  const seen = new Set();
  const rows = [];
  const push = (r) => {
    const key = (r.leadId || r.name) + "|" + r.kind;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(r);
  };

  // 0) Speed-to-lead — brand-new leads not yet contacted. Reach these first.
  leads.filter((l) => ACTIVE(l) && !l.lastContacted && hoursSince(l.createdAt) <= RESPOND_NOW_HRS)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach((l) => push({
      leadId: l.id, name: l.name, phone: l.phone, vehicle: l.vehicleInterest,
      kind: "hot", reason: "Respond now", badge: "badge-due",
    }));

  // 1) Due / overdue follow-ups
  leads.filter((l) => ACTIVE(l) && l.followUp && daysFromToday(l.followUp) <= 0)
    .sort((a, b) => daysFromToday(a.followUp) - daysFromToday(b.followUp))
    .forEach((l) => push({
      leadId: l.id, name: l.name, phone: l.phone, vehicle: l.vehicleInterest,
      kind: "due", reason: daysFromToday(l.followUp) < 0 ? relativeDay(l.followUp) : "Follow-up due today", badge: "badge-due",
    }));

  // 2) Cold leads — active, not contacted in 7+ days, no upcoming follow-up
  leads.filter((l) => ACTIVE(l) && (!l.followUp || daysFromToday(l.followUp) > 0))
    .map((l) => ({ l, cold: daysSince(l.lastContacted || l.createdAt) }))
    .filter((x) => x.cold >= 7)
    .sort((a, b) => b.cold - a.cold)
    .forEach(({ l, cold }) => push({
      leadId: l.id, name: l.name, phone: l.phone, vehicle: l.vehicleInterest,
      kind: "cold", reason: `No contact in ${cold === Infinity ? "a while" : cold + " days"}`, badge: "badge-soon",
    }));

  // 3) Birthdays (within 7 days) — needs dob on the lead
  leads.filter((l) => l.dob).forEach((l) => {
    const d = daysToAnnual(l.dob);
    if (d != null && d <= 7) push({
      leadId: l.id, name: l.name, phone: l.phone, vehicle: l.vehicleInterest,
      kind: "bday", reason: d === 0 ? "Birthday today" : `Birthday in ${d} day${d === 1 ? "" : "s"}`, badge: "badge-appt",
    });
  });

  // 4) Lease ending soon (within 60 days) — needs leaseEnd on the lead
  leads.filter((l) => l.leaseEnd).forEach((l) => {
    const d = daysFromToday(l.leaseEnd);
    if (d != null && d >= 0 && d <= 60) push({
      leadId: l.id, name: l.name, phone: l.phone, vehicle: l.vehicleInterest,
      kind: "lease", reason: `Lease ends ${formatDate(l.leaseEnd)}`, badge: "badge-negotiating",
    });
  });

  // 5) Win-backs / equity from imported past customers (leads with a purchase date)
  leads.filter((l) => l.purchaseDate).forEach((l) => {
    const reason = equityReason(l.purchaseDate);
    if (!reason) return;
    push({ leadId: l.id, name: l.name, phone: l.phone, vehicle: l.vehicleInterest, kind: "equity", reason, badge: "badge-sold" });
  });

  // 6) Win-backs / equity from logged sales (anniversary or 3+ years owned)
  sales.forEach((s) => {
    const reason = equityReason(s.saleDate);
    if (!reason) return;
    let name = s.customerName, phone = "", leadId = null, vehicle = s.vehicle;
    if (s.leadId) {
      const l = store.get("leads", s.leadId);
      if (l) { name = l.name; phone = l.phone; leadId = l.id; vehicle = vehicle || l.vehicleInterest; }
    }
    push({ leadId, name, phone, vehicle, kind: "equity", reason, badge: "badge-sold" });
  });

  return rows;
}

// Prospecting summary for the dashboard badge: total opportunities + how many
// are brand-new leads that need an immediate response.
export function prospectSummary() {
  const rows = buildCallList();
  return { total: rows.length, hot: rows.filter((r) => r.kind === "hot").length };
}

export function renderProspecting(view) {
  const s = store.getSettings();

  const el = document.createElement("div");
  view.appendChild(el);

  function draw() {
    const touches = store.activityCountToday("touch");
    const goal = s.dailyTouchGoal || 20;
    const pct = goal ? Math.min(100, Math.round((touches / goal) * 100)) : 0;
    const apptsToday = store.all("appointments").filter((a) => (a.createdAt || "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
    const rows = buildCallList();

    el.innerHTML = `
      <div class="hero">
        <div class="hero-greeting">Prospecting</div>
        <div class="hero-title">Today's call list</div>
      </div>

      <div class="stat-grid" style="margin-bottom:6px">
        <div class="stat">
          <div class="stat-value">${touches}<span class="muted" style="font-size:1rem">/${goal}</span></div>
          <div class="stat-label">Touches today</div>
          <div class="progress"><span style="width:${pct}%"></span></div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color:var(--accent)">${apptsToday}</div>
          <div class="stat-label">Appointments set today</div>
        </div>
      </div>
      <div class="fab-note" style="margin-top:2px;margin-bottom:6px">${touches >= goal ? "Daily goal hit — keep the momentum!" : `${goal - touches} more touches to hit your goal. Every call is a chance at an appointment.`}</div>

      <div class="section-title">${rows.length} ${rows.length === 1 ? "opportunity" : "opportunities"} to reach today</div>
      <div class="call-list"></div>
    `;

    const list = el.querySelector(".call-list");
    if (!rows.length) {
      list.innerHTML = emptyState("check", "Nobody to chase right now", "New leads auto-populate here, and past customers resurface as they hit equity and anniversaries.");
    } else {
      rows.forEach((r) => list.appendChild(rowCard(r, draw)));
    }
  }

  draw();
}

function rowCard(r, refresh) {
  const el = document.createElement("div");
  el.className = "card";
  const hasPhone = !!r.phone;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(r.name || "Customer")}</div>
        <div class="row-sub">${r.vehicle ? esc(r.vehicle) : "No vehicle noted"}${hasPhone ? " · " + esc(phoneDisplay(r.phone)) : ""}</div>
      </div>
      <span class="badge ${r.badge}">${esc(r.reason)}</span>
    </div>
    <div class="btn-row" style="margin-top:12px">
      ${hasPhone ? `<a class="btn btn-success btn-sm" data-act="call" style="flex:1" href="${telHref(r.phone)}">${icon("phone")} Call</a>
      <button class="btn btn-primary btn-sm" data-act="text" style="flex:1">${icon("message")} Text</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-act="appt" style="flex:1">${icon("calendar")} Book</button>
      <button class="btn btn-ghost btn-sm" data-act="done" style="flex:0 0 auto" aria-label="Mark contacted">${icon("checkline")}</button>
    </div>
  `;

  const markTouched = () => {
    store.logActivity("touch");
    if (r.leadId) store.update("leads", r.leadId, { lastContacted: new Date().toISOString() });
  };

  const callBtn = el.querySelector('[data-act="call"]');
  if (callBtn) callBtn.addEventListener("click", () => { markTouched(); });

  const textBtn = el.querySelector('[data-act="text"]');
  if (textBtn) textBtn.addEventListener("click", () => {
    markTouched();
    const lead = r.leadId ? store.get("leads", r.leadId) : null;
    if (lead) openTemplatePicker(lead);
    else window.location.href = smsHref(r.phone);
  });

  el.querySelector('[data-act="appt"]').addEventListener("click", () =>
    openAppointmentForm(null, { leadId: r.leadId || null, customerName: r.name, vehicle: r.vehicle, type: "appointment" }));

  el.querySelector('[data-act="done"]').addEventListener("click", () => {
    markTouched();
    toast("Nice — logged a touch", "success");
    refresh();
  });

  return el;
}
