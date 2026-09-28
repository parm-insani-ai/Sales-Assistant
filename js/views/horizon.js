// Timing — when it makes sense, and when every lease ends.
//
// Two lists over the rep's own book. The first puts every owner in the
// month their window opens: now, or the month their equity clears the
// line, a like-for-like lands at their payment, the contract runs out, or
// the lease-end conversation should start. The second is every lease on
// the book in order of ending, by month, with the finance contracts a tap
// away. Either way the move is the same: a follow-up in the right month,
// set one at a time or all at once.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { toast, confirmDialog } from "../components.js";
import { esc, formatDate } from "../utils.js";
import { makeMatcher } from "../match.js";
import { contractSummary } from "../contract.js";
import { horizonBook, contractsEnding, byMonth, bucketOf, BUCKETS, followUpFor, monthLabel, ymd } from "../horizon.js";

const stageLabel = (s) => (store.stageMeta(s) || { label: s }).label;
const stageBadge = (s) => (store.stageMeta(s) || { badge: "" }).badge;

export function renderHorizon(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  let tab = "timing"; // timing | leases | finance
  try { const h = sessionStorage.getItem("horizon-tab"); sessionStorage.removeItem("horizon-tab"); if (h) tab = h; } catch { /* timing */ }
  const now = new Date();

  const opts = () => { const s = store.getSettings(); const lot = store.all("vehicles"); return { now, defaultApr: s.defaultApr, dealMatchBand: s.dealMatchBand, match: lot.length ? makeMatcher(lot, s, now.getTime()) : null }; };

  function draw() {
    const leads = store.all("leads");
    const s = store.getSettings();
    if (tab === "timing") drawTiming(leads, s); else drawEnds(leads, tab === "leases" ? "lease" : "finance");
    el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; draw(); }));
    el.querySelectorAll("[data-open]").forEach((n) => n.addEventListener("click", () => navigate(`/leads/${n.dataset.open}`)));
  }
  const chips = (counts) => `<div class="lead-chips" style="margin-bottom:10px">
    <button class="btn btn-sm ${tab === "timing" ? "btn-primary" : "btn-ghost"}" data-tab="timing">${icon("sparkles")} When it makes sense${counts.timing != null ? " " + counts.timing : ""}</button>
    <button class="btn btn-sm ${tab === "leases" ? "btn-primary" : "btn-ghost"}" data-tab="leases">Lease ends${counts.leases != null ? " " + counts.leases : ""}</button>
    <button class="btn btn-sm ${tab === "finance" ? "btn-primary" : "btn-ghost"}" data-tab="finance">Contract ends${counts.finance != null ? " " + counts.finance : ""}</button>
  </div>`;
  const counts = (leads) => ({ timing: horizonBook(leads, { now }).filter((r) => r.hz.m != null).length, leases: contractsEnding(leads, { now, type: "lease" }).length, finance: contractsEnding(leads, { now, type: "finance" }).length });

  function drawTiming(leads, s) {
    const rows = horizonBook(leads, opts());
    const c = counts(leads);
    const groups = BUCKETS.map((b) => ({ ...b, rows: rows.filter((r) => bucketOf(r.hz) === b.key) })).filter((g) => g.rows.length);
    const within6 = rows.filter((r) => r.hz.m != null && r.hz.m > 0 && r.hz.m <= 6).length;
    const needFu = rows.filter((r) => r.hz.m != null && r.hz.m > 0 && !fuSet(r));
    const row = (r) => {
      const l = r.lead, hz = r.hz, fu = followUpFor(hz, now);
      const cs = contractSummary(l, now);
      return `<div class="row hz-row" data-lead="${esc(l.id)}" style="padding:9px 0;border-bottom:1px solid var(--border);align-items:center">
        <div class="row-main" data-open="${esc(l.id)}" style="cursor:pointer">
          <div class="row-title" style="font-size:0.96rem">${esc(l.name || "Customer")}${hz.m != null && hz.m > 0 ? ` <span class="badge badge-soon" style="margin-left:4px">${esc(monthLabel(hz.at))}</span>` : hz.m === 0 ? ` <span class="badge badge-due" style="margin-left:4px">Now</span>` : ""}</div>
          <div class="row-sub">${esc(l.vehicleInterest || "No vehicle noted")}${cs ? " · " + esc(cs.line) : ""}</div>
          <div class="row-reasons">${esc(hz.why)}${hz.equityNow != null && hz.m ? ` · equity today ${hz.equityNow < 0 ? "−" : ""}$${Math.abs(Math.round(hz.equityNow)).toLocaleString("en-CA")}` : ""}</div>
        </div>
        ${hz.m != null && hz.m > 0 ? `<button class="btn ${fuSet(r) ? "btn-ghost" : "btn-primary"} btn-sm" data-fu="${esc(l.id)}" data-date="${fu}" style="flex:0 0 auto;margin-left:8px" ${fuSet(r) ? "disabled" : ""}>${fuSet(r) ? "Follow-up set" : "Follow up " + esc(monthLabel(hz.at))}</button>` : hz.m === 0 ? `<button class="btn btn-ghost btn-sm" data-open="${esc(l.id)}" style="flex:0 0 auto;margin-left:8px">Open</button>` : ""}
      </div>`;
    };
    el.innerHTML = `
      ${chips(c)}
      <div class="card mg-plan" style="margin-bottom:12px">
        <div class="strong">${rows.filter((r) => r.hz.m === 0).length} ready now · ${within6} open up in the next six months.</div>
        <div class="small muted" style="margin-top:4px">Every owner on your book, in the month it starts to make sense: equity clears $${Number(s.horizonMinEquity || 3000).toLocaleString("en-CA")}, a like-for-like lands at their payment, the contract runs out, or a lease is six months from its end. Values drift down about 12% a year; payoffs come down at their rate.</div>
        ${needFu.length ? `<div class="btn-row" style="margin-top:8px"><button class="btn btn-primary btn-sm btn-block" data-act="fu-all">${icon("calendar")} Set follow-ups for the ${needFu.length} without one</button></div>` : ""}
      </div>
      ${groups.map((g) => `<div class="section-title">${g.label} <span class="muted" style="font-weight:500;font-size:0.78rem">· ${g.rows.length}</span></div><div class="card" style="padding:0 16px">${g.rows.slice(0, 80).map(row).join("")}${g.rows.length > 80 ? `<div class="muted small" style="padding:10px 0">${g.rows.length - 80} more.</div>` : ""}</div>`).join("")}
      ${!rows.length ? `<div class="card muted small">No owners on the book yet — import your customers with their payment, payoff and trade value, or log a sale, and their month shows here.</div>` : ""}
      <div class="hint" style="margin:0 2px">A follow-up lands on Home in that month. The month is an estimate from what's on file — a fresh trade value or payoff moves it.</div>`;
    el.querySelectorAll("[data-fu]").forEach((b) => b.addEventListener("click", () => { setFu(b.dataset.fu, b.dataset.date); toast(`Follow-up set for ${monthLabel(b.dataset.date + "T12:00:00")}`, "success"); draw(); }));
    const all = el.querySelector('[data-act="fu-all"]');
    if (all) all.addEventListener("click", async () => {
      if (!(await confirmDialog(`Set a follow-up for ${needFu.length} customer${needFu.length === 1 ? "" : "s"}, each in the month their window opens?`, { confirmLabel: "Set them", danger: false }))) return;
      needFu.forEach((r) => setFu(r.lead.id, followUpFor(r.hz, now)));
      toast(`${needFu.length} follow-ups set`, "success"); draw();
    });
  }
  // A follow-up already on or after the window counts as set.
  const fuSet = (r) => !!(r.lead.followUp && String(r.lead.followUp).slice(0, 10) >= (followUpFor(r.hz, now) || "").slice(0, 7));
  const setFu = (id, date) => { store.update("leads", id, { followUp: date, followUpWhy: "timing" }); };

  function drawEnds(leads, type) {
    const list = contractsEnding(leads, { now, type });
    const c = counts(leads);
    const groups = byMonth(list);
    const next12 = list.filter((r) => r.end && !r.past && r.end.getTime() - now.getTime() < 365 * 86400000).length;
    const row = (r) => {
      const l = r.lead;
      const days = r.end ? Math.round((r.end.getTime() - now.getTime()) / 86400000) : null;
      const when = !r.end ? "no end date" : r.past ? `ended ${formatDate(ymd(r.end))}` : days <= 45 ? `ends ${formatDate(ymd(r.end))} · ${days} days` : `ends ${formatDate(ymd(r.end))}`;
      return `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border);align-items:center">
        <div class="row-main" data-open="${esc(l.id)}" style="cursor:pointer">
          <div class="row-title" style="font-size:0.96rem">${esc(l.name || "Customer")}${r.past ? ' <span class="badge badge-due" style="margin-left:4px">Past end</span>' : days != null && days <= 90 ? ' <span class="badge badge-soon" style="margin-left:4px">Soon</span>' : ""}</div>
          <div class="row-sub">${esc(l.vehicleInterest || "No vehicle noted")}${r.payment != null ? ` · $${Math.round(r.payment).toLocaleString("en-CA")}/mo` : ""} · ${esc(when)}${l.followUp ? " · follow-up " + esc(formatDate(l.followUp)) : ""}</div>
        </div>
        <span class="badge ${stageBadge(l.stage)}">${esc(stageLabel(l.stage))}</span>
      </div>`;
    };
    el.innerHTML = `
      ${chips(c)}
      <div class="card mg-plan" style="margin-bottom:12px">
        <div class="strong">${list.length} ${type === "lease" ? "lease" : "finance contract"}${list.length === 1 ? "" : "s"} on the book · ${next12} end${next12 === 1 ? "s" : ""} in the next year${list.filter((r) => r.past).length ? ` · ${list.filter((r) => r.past).length} already past the end` : ""}.</div>
        <div class="small muted" style="margin-top:4px">${type === "lease" ? "Every lease, by the month it ends. Six months out is when the conversation starts; the Timing tab sets the follow-up there." : "Every finance contract, by the month the last payment lands."}</div>
      </div>
      ${groups.map((g) => `<div class="section-title">${esc(g.label)} <span class="muted" style="font-weight:500;font-size:0.78rem">· ${g.rows.length}</span></div><div class="card" style="padding:0 16px">${g.rows.map(row).join("")}</div>`).join("")}
      ${!list.length ? `<div class="card muted small">${type === "lease" ? "No leases on the book. A customer counts as a lease when their deal type says so or a lease end is on file." : "No finance contracts with a known end on the book."}</div>` : ""}`;
  }

  draw();
}
