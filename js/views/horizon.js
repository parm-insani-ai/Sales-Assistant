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
import { leasePipeline, toCall, pipelineLine, STAGES, stageLabel as leaseStageLabel, SOON_DAYS, WINDOW_DAYS, GRACE_DAYS } from "../leasepipe.js";
import { reachIndex } from "../coverage.js";
import { startSession } from "../session.js";

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
    if (tab === "timing") drawTiming(leads, s); else if (tab === "leases") drawLeasePipeline(leads, s); else drawEnds(leads, "finance");
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

  // The lease maturity pipeline: every lease by the month it ends, and where
  // each stands — not touched, tried, spoken with, booked, retained, lost —
  // red inside ninety days with no conversation. A month's unspoken can be
  // called as a session from its row; the whole pipeline's from the head.
  function drawLeasePipeline(leads, s) {
    const c = counts(leads);
    const o = opts();
    const pipe = leasePipeline(leads, { now: now.getTime(), idx: reachIndex(now.getTime()), sales: store.all("sales"), appointments: store.all("appointments"), matcher: o.match, months: 12 });
    const money = (n) => "$" + Math.round(Number(n)).toLocaleString("en-CA");
    const OUTCOME = { interested: "interested", callback: "call back", appointment: "booked", not_now: "not now", not_interested: "not interested", bought_elsewhere: "bought elsewhere", replied: "replied by text", bought: "bought", logged: "came in", showed: "showed", sold: "sold" };
    const stageBadgeHTML = (k) => `<span class="badge lp-badge" style="--lp:${(STAGES.find((x) => x.key === k) || {}).color || "var(--muted)"}">${esc(leaseStageLabel(k))}</span>`;
    const bar = (counts, total) => total ? `<div class="lp-bar">${STAGES.map((st) => counts[st.key] ? `<span style="width:${(counts[st.key] / total) * 100}%;background:${st.color}" title="${esc(st.label)} ${counts[st.key]}"></span>` : "").join("")}</div>` : "";
    const row = (r) => {
      const l = r.lead;
      const when = r.past ? `ended ${formatDate(ymd(r.end))}` : `ends ${formatDate(ymd(r.end))}${r.days <= SOON_DAYS ? ` · ${r.days} day${r.days === 1 ? "" : "s"}` : ""}`;
      const conv = r.conversation ? `Last: ${OUTCOME[r.conversation.outcome] || "spoke"} · ${formatDate(new Date(r.conversation.at).toISOString())}` : "";
      const rep = r.replacement ? `→ ${esc(r.replacement.name)} ≈ ${money(r.replacement.monthly)}/mo${r.replacement.delta != null ? ` <span style="color:${r.replacement.delta <= 0 ? "var(--success)" : "var(--muted)"}">(${r.replacement.delta <= 0 ? "−" : "+"}${money(Math.abs(r.replacement.delta))})</span>` : ""}` : "";
      return `<div class="row lp-row${r.red ? " lp-red" : ""}" style="padding:8px 0;border-bottom:1px solid var(--border);align-items:center">
        <div class="row-main" data-open="${esc(l.id)}" style="cursor:pointer;min-width:0">
          <div class="row-title" style="font-size:0.96rem">${esc(l.name || "Customer")} ${stageBadgeHTML(r.stage)}${r.red ? ` <span class="badge badge-due">No conversation</span>` : ""}</div>
          <div class="row-sub">${esc(l.vehicleInterest || "No vehicle noted")}${r.payment != null ? ` · ${money(r.payment)}/mo` : ""} · ${esc(when)}</div>
          ${rep ? `<div class="row-reasons">${rep}</div>` : ""}
          ${conv ? `<div class="row-reasons muted">${esc(conv)}</div>` : ""}
        </div>
      </div>`;
    };
    const group = (g) => {
      const calls = toCall(g.rows);
      const decided = g.counts.retained + g.counts.lost;
      return `<div class="section-title">${esc(g.label)} <span class="muted" style="font-weight:500;font-size:0.78rem">· ${g.total}</span>${g.red ? ` <span class="badge badge-due" style="margin-left:6px">${g.red} with no conversation</span>` : ""}${decided ? ` <span class="muted" style="font-weight:500;font-size:0.78rem">· kept ${g.counts.retained} of ${decided}</span>` : ""}</div>
        ${g.total ? `<div class="card lp-month" style="padding:10px 16px 0">
          ${bar(g.counts, g.total)}
          <div class="lp-counts small muted">${STAGES.filter((st) => g.counts[st.key]).map((st) => `<span><i style="background:${st.color}"></i>${esc(st.label)} ${g.counts[st.key]}</span>`).join("")}</div>
          ${g.rows.map(row).join("")}
          ${calls.length ? `<div class="btn-row" style="padding:10px 0"><button class="btn btn-primary btn-sm btn-block" data-call-month="${esc(g.key)}">${icon("phone")} Call the ${calls.length} not spoken with</button></div>` : `<div style="height:8px"></div>`}
        </div>` : `<div class="card lp-month lp-empty small muted" style="padding:8px 16px">No lease ends this month.</div>`}`;
    };
    const all = toCall(pipe);
    el.innerHTML = `
      ${chips(c)}
      <div class="card mg-plan lp-head" style="margin-bottom:12px">
        <div class="strong">${esc(pipelineLine(pipe))}.</div>
        <div class="lp-stages small">${STAGES.map((st) => `<span><i style="background:${st.color}"></i>${esc(st.label)} <b>${pipe.totals.counts[st.key]}</b></span>`).join("")}</div>
        <div class="small muted" style="margin-top:6px">The conversation window opens ${WINDOW_DAYS} days before the end. A lease inside ${SOON_DAYS} days with no conversation is red. A lease ended ${GRACE_DAYS} days with nothing sold is lost; one we sold into is retained.${pipe.later ? ` ${pipe.later} more end beyond the year.` : ""}</div>
        ${all.length ? `<div class="btn-row" style="margin-top:8px"><button class="btn btn-primary btn-sm btn-block" data-act="lp-call-all">${icon("phone")} Call the ${all.length} not spoken with — soonest first</button></div>` : ""}
      </div>
      ${pipe.ended.total ? group(pipe.ended) : ""}
      ${pipe.months.map(group).join("")}
      ${!pipe.totals.total && !pipe.unknown ? `<div class="card muted small">No leases on the book. A customer counts as a lease when their deal type says so or a lease end is on file — both come in with the owner book, or on the customer's page.</div>` : ""}
      ${pipe.unknown ? `<div class="hint" style="margin:0 2px">${pipe.unknown} lease${pipe.unknown === 1 ? "" : "s"} with no end date on file — add it on the customer's page (Contract maturity date) and they join their month.</div>` : ""}`;
    const call = (rows, name) => {
      const ids = toCall(rows).map((r) => r.lead.id);
      if (!ids.length) { toast("Everyone here has been spoken with", ""); return; }
      startSession(ids, { name }); navigate("/session");
    };
    const allBtn = el.querySelector('[data-act="lp-call-all"]');
    if (allBtn) allBtn.addEventListener("click", () => call([...pipe.ended.rows, ...pipe.months.flatMap((m) => m.rows)], "Lease ends"));
    el.querySelectorAll("[data-call-month]").forEach((b) => b.addEventListener("click", () => {
      const g = b.dataset.callMonth === "ended" ? pipe.ended : pipe.months.find((m) => m.key === b.dataset.callMonth);
      if (g) call(g.rows, `Lease ends · ${g.label}`);
    }));
  }

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
