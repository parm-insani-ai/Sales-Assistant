// Performance — everything the target sheet and the "Vehicles Sold Track"
// sheet track, on one screen, a month at a time. Tapping the Sales target
// on Home lands here. The target sheet's math (target.js), the appointment
// funnel (goals.js), the deal panels (dealstats.js) and the week-by-week
// read (coach.js) are the same numbers the rest of the app shows; this
// is where they sit together, with the sheet itself one tap away.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { currency, esc, todayISO } from "../utils.js";
import { icon } from "../icons.js";
import { salesTarget, openTargetForm } from "../target.js";
import { monthSummary, apptFunnel } from "./goals.js";
import { dealSummary } from "../dealstats.js";
import { weekStart, weekStats } from "./coach.js";
import { exportTracker } from "./soldlog.js";

const pad = (n) => String(n).padStart(2, "0");
function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
const pct = (v, digits = 0) => (v == null || !isFinite(v) ? "—" : `${(Math.round(v * 100 * 10 ** digits) / 10 ** digits)}%`);
const money = (v) => currency(Math.round(Number(v) || 0));

export function renderPerformance(view) {
  let ym = todayISO().slice(0, 7);
  let yearMode = false;
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="row" style="margin:2px 0 12px;gap:8px">
      <button class="btn btn-ghost btn-sm" data-nav="-1" aria-label="Previous month">‹</button>
      <div class="strong" id="pf-month" style="flex:1;text-align:center"></div>
      <button class="btn btn-ghost btn-sm" data-nav="1" aria-label="Next month">›</button>
      <button class="btn btn-ghost btn-sm" data-nav="year">Year</button>
    </div>
    <div id="pf-body"></div>
    <div class="btn-row" style="margin:14px 0 4px;gap:8px">
      <button class="btn btn-primary" data-act="target">${icon("target")} Set target</button>
      <button class="btn btn-ghost" data-act="tracker">${icon("checkline")} Sold Tracker</button>
      <button class="btn btn-ghost" data-act="export">${icon("download")} Export sheet</button>
    </div>
    <div class="small muted" style="margin-top:8px">The export is the "Vehicles Sold Track" sheet, filled in for this ${yearMode ? "year" : "month"}: every column in the sheet's order and the summary panels down the right.</div>
  `;
  view.appendChild(el);

  const inScope = (d) => String(d || "").slice(0, yearMode ? 4 : 7) === (yearMode ? ym.slice(0, 4) : ym);
  const deals = () => store.all("sales").filter((s) => inScope(s.saleDate || s.createdAt)).sort((a, b) => String(a.saleDate || "").localeCompare(String(b.saleDate || "")));

  // A table: header row, then rows; the first cell is the label.
  const table = (head, rows, { strongLast = true } = {}) => `
    <div class="card">
      ${head ? `<div class="row pf-row pf-head">${head.map((h, i) => `<div class="small strong${i ? " pf-num" : " pf-lbl"}">${esc(h)}</div>`).join("")}</div>` : ""}
      ${rows.map((r) => `<div class="row pf-row">${r.map((c, i) => `<div class="small${i ? " mono pf-num" : " pf-lbl"}${strongLast && i === r.length - 1 ? " strong" : ""}">${esc(String(c))}</div>`).join("")}</div>`).join("")}
    </div>`;
  const section = (title, body) => `<div class="section-title">${esc(title)}</div>${body}`;

  const draw = () => {
    el.querySelector("#pf-month").textContent = yearMode ? ym.slice(0, 4) : monthLabel(ym);
    el.querySelector('[data-nav="year"]').classList.toggle("btn-primary", yearMode);
    const s = store.getSettings();
    const ds = deals();
    const sm = dealSummary(ds);
    const parts = [];

    if (!yearMode) {
      // The target sheet, for this month — today's reading for the current
      // month, the month's end for a past one.
      const [y, m] = ym.split("-").map(Number);
      const now = new Date();
      const at = ym === todayISO().slice(0, 7) ? now : new Date(y, m, 0, 12);
      const t = salesTarget(at);
      const p = t.plan;
      const behind = t.expectedByNow - t.spoke;
      parts.push(section("Target sheet", p.target ? table(["", "New", "Used", "Total"], [
        ["Target", p.split ? p.targetNew : "—", p.split ? p.targetUsed : "—", p.target],
        ["Closing expected", pct(p.closingNew), pct(p.closingUsed), pct(p.closingNew)],
        ["Customers to speak with", p.split ? p.needNew : "—", p.split ? p.needUsed : "—", p.need],
        ["Spoken with", t.spokeNew, t.spokeUsed, t.spoke],
        ["Sold", t.soldNew, t.soldUsed, t.sold],
        ["Closing so far", pct(t.closingNew), pct(t.closingUsed), pct(t.closing)],
        ["Units remaining", p.split ? Math.max(0, p.targetNew - t.soldNew) : "—", p.split ? Math.max(0, p.targetUsed - t.soldUsed) : "—", t.remainingUnits],
        ["Conversations remaining", p.split ? Math.max(0, p.needNew - t.spokeNew) : "—", p.split ? Math.max(0, p.needUsed - t.spokeUsed) : "—", t.remainingTalks],
        ["Target attainment", pct(p.targetNew ? t.soldNew / p.targetNew : null), pct(p.targetUsed ? t.soldUsed / p.targetUsed : null), pct(t.attainment)],
      ]) + `
        <div class="tg-chips" style="margin-top:8px">
          <span class="tg-chip ${t.sold >= p.target ? "tg-good" : behind > 0 ? "tg-warn" : "tg-good"}">${t.sold >= p.target ? "Target reached" : behind > 0 ? `${behind} conversations behind pace` : "On pace"}</span>
          <span class="tg-chip">Day ${t.day} of ${t.daysIn} · ${t.expectedByNow} expected by now</span>
          <span class="tg-chip ${t.spokeWeek >= t.perWeek ? "tg-good" : ""}">Week ${t.week} of ${t.weeks}: ${t.spokeWeek}/${t.perWeek} spoken with</span>
          ${t.spokeUnsplit || t.soldUnsplit ? `<span class="tg-chip">${t.spokeUnsplit ? `${t.spokeUnsplit} spoken with unsplit` : ""}${t.spokeUnsplit && t.soldUnsplit ? " · " : ""}${t.soldUnsplit ? `${t.soldUnsplit} sold unsplit` : ""}</span>` : ""}
        </div>` : `<div class="card"><div class="small muted">No target set for this month. Set your new and used units and the closing ratio you expect, and the sheet works out the conversations.</div></div>`));

      // Appointments: the funnel, and the month's commission against the goal.
      const f = apptFunnel(ym);
      parts.push(section("Appointments", table(null, [
        ["Set", f.set], ["Confirmed", f.confirmed], ["Showed", f.showed], ["Sold from appointments", f.sold],
        ["Show rate (of those past)", f.past ? `${f.showRate}%` : "—"], ["Close rate (of those shown)", f.showed ? `${f.closeRate}%` : "—"],
      ], { strongLast: false })));
    }

    const ms = yearMode ? null : monthSummary(ym);
    parts.push(section("Commission", table(null, [
      ["Total commission", money(sm.total)],
      ["Front", money(sm.front)], ["Business office", money(sm.bo)], ["Business gross", money(sm.gross)],
      ["Average per deal", money(sm.avgDeal)],
      ...(!yearMode && s.goalCommission ? [["Goal", money(s.goalCommission)], ["To goal", money(Math.max(0, s.goalCommission - (ms ? ms.commission : sm.total)))]] : []),
    ], { strongLast: false })));

    // The sheet's panels.
    const pctS = (v) => `${Math.round(v * 10) / 10}%`;
    parts.push(section("New vs used", table(["", "New", "Used", "Total"], [
      ["Deals", sm.news, sm.useds, sm.count],
      ["Share", pctS(sm.share.New), pctS(sm.share.Used), sm.count ? "100%" : "0%"],
      ["Avg front", money(sm.avgFront.New), money(sm.avgFront.Used), money(sm.avgFront.Total)],
      ["Front total", money(sm.frontTotal.New), money(sm.frontTotal.Used), money(sm.frontTotal.Total)],
      ["Avg B.O.", money(sm.avgBO.New), money(sm.avgBO.Used), money(sm.avgBO.Total)],
      ["Avg total", money(sm.avgTotal.New), money(sm.avgTotal.Used), money(sm.avgTotal.Total)],
    ])));
    parts.push(section("Type of lead", table(["", "Sales", "Total", "Average", "%"],
      sm.byLead.filter((l) => l.deals).map((l) => [l.type, l.deals, money(l.total), money(l.avg), pctS(l.pct)])
        .concat(sm.untyped ? [["Untracked", sm.untyped, "—", "—", pctS((sm.untyped / sm.count) * 100)]] : [])
        .concat([["All", sm.count, money(sm.total), money(sm.avgDeal), sm.count ? "100%" : "0%"]]), { strongLast: false })));
    if (sm.byBM.length) parts.push(section("Business managers", table(["", "Deals", "B.O. total", "Average"], sm.byBM.map((b) => [b.bm, b.deals, money(b.total), money(b.avg)]), { strongLast: false })));
    const brands = sm.byBrand.filter((b) => b.deals);
    if (brands.length) parts.push(section("Manufacturers", `<div class="card"><div class="btn-row" style="gap:8px">${brands.map((b) => `<span class="badge">${esc(b.brand)} · ${b.deals}</span>`).join("")}</div></div>`));
    const models = sm.byModel.filter((m) => m.deals);
    if (models.length) parts.push(section("Models", table(["", "Total", "New", "Used"], models.map((m) => [m.model, m.deals, m.news, m.useds]), { strongLast: false })));

    // Week by week, inside the month: units, commission, appointments set,
    // show rate, touches — the coach's numbers, lined up.
    if (!yearMode) {
      const [y, m] = ym.split("-").map(Number);
      const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
      const rows = [];
      for (let d = weekStart(first); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
        const w = weekStats(d);
        rows.push([`${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, w.units, money(w.total), w.apptsSet, w.showRate == null ? "—" : `${w.showRate}%`, w.touches]);
      }
      parts.push(section("Week by week", table(["Week of", "Units", "Comm", "Appts set", "Show", "Touches"], rows, { strongLast: false })));
      // The month's activity.
      const touches = store.all("activity").filter((x) => x.type === "touch" && inScope(x.createdAt)).length;
      const added = store.all("leads").filter((l) => inScope(l.createdAt)).length;
      parts.push(section("Activity", table(null, [["Customers added", added], ["Touches logged", touches], ["Daily touch goal", s.dailyTouchGoal || "—"]], { strongLast: false })));
    }

    el.querySelector("#pf-body").innerHTML = parts.join("");
  };

  el.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.nav === "year") { yearMode = !yearMode; draw(); return; }
    yearMode = false;
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + Number(b.dataset.nav), 1);
    ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    draw();
  }));
  el.querySelector('[data-act="target"]').addEventListener("click", () => openTargetForm(draw));
  el.querySelector('[data-act="tracker"]').addEventListener("click", () => navigate("/soldlog"));
  el.querySelector('[data-act="export"]').addEventListener("click", () => exportTracker(deals(), yearMode ? ym.slice(0, 4) : ym));
  const off = store.subscribe(() => { if (document.body.contains(el)) draw(); });
  window.addEventListener("hashchange", () => off && off(), { once: true });
  draw();
}
