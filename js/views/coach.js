// Sales Coach — week-by-week performance readout with opinionated insights.
// Everything is computed from data the app already has (Sold Tracker deals,
// appointments, leads, touches, link opens) — no AI call, so it works offline
// and the numbers are always explainable. Weeks run Monday–Sunday.

import * as store from "../store.js";
import { currency, esc } from "../utils.js";
import { icon } from "../icons.js";
import { emptyState } from "../components.js";
import { dealTotal, dealFront, dealBO } from "./soldlog.js";
import { monthSummary } from "./goals.js";

// ---- Week math ----
export function weekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // back to Monday
  return x;
}
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// One week's numbers. `monday` is a Date at the week's start.
export function weekStats(monday) {
  const a = iso(monday), b = iso(addDays(monday, 7));
  const inWeek = (s) => s && s >= a && s < b;

  const sales = store.all("sales").filter((s) => inWeek(String(s.saleDate || s.createdAt || "").slice(0, 10)));
  const front = sales.reduce((t, s) => t + dealFront(s), 0);
  const bo = sales.reduce((t, s) => t + dealBO(s), 0);
  const total = sales.reduce((t, s) => t + dealTotal(s), 0);

  const appts = store.all("appointments").filter((x) => x.status !== "canceled");
  const happened = appts.filter((x) => inWeek(String(x.when || "").slice(0, 10)));
  const showed = happened.filter((x) => x.outcome === "showed" || x.outcome === "sold").length;
  const decided = happened.filter((x) => x.outcome).length;
  const set = appts.filter((x) => inWeek(String(x.createdAt || "").slice(0, 10))).length;

  const leadsNew = store.all("leads").filter((l) => inWeek(String(l.createdAt || "").slice(0, 10))).length;
  const touches = store.all("activity").filter((x) => x.type === "touch" && inWeek(String(x.createdAt || "").slice(0, 10))).length;
  const links = store.all("links");
  const linksSent = links.filter((l) => inWeek(String(l.createdAt || "").slice(0, 10))).length;
  const linksOpened = links.filter((l) => inWeek(String(l.lastOpenAt || "").slice(0, 10))).length;

  return {
    monday: a, sales, units: sales.length,
    newCount: sales.filter((s) => s.newUsed === "New").length,
    usedCount: sales.filter((s) => s.newUsed === "Used").length,
    front, bo, total, avgTotal: sales.length ? total / sales.length : 0,
    apptsSet: set, apptsHappened: happened.length, showed, decided,
    showRate: decided ? Math.round((showed / decided) * 100) : null,
    leadsNew, touches, linksSent, linksOpened,
  };
}

// ---- The coach's brain: rules that only speak when the data backs them ----
// weeks[0] is the viewed week, weeks[1..] the ones before it (newest first).
// Returns [{tone: "good"|"warn"|"info", text}], best first, max 5.
export function coachInsights(weeks, { current = true } = {}) {
  const out = [];
  const w = weeks[0];
  const prior = weeks.slice(1);
  const withDeals = prior.filter((x) => x.units > 0);
  const s = store.getSettings();
  const money = (v) => currency(Math.round(v));

  // Record week — celebrate before critiquing.
  if (w.total > 0 && prior.length >= 2 && w.total >= Math.max(...prior.map((x) => x.total))) {
    out.push({ tone: "good", text: `Best week in the last ${weeks.length} — ${money(w.total)} across ${w.units} unit${w.units === 1 ? "" : "s"}. Whatever you did, do it again.` });
  }

  // Monthly goal pace (only meaningful for the current week).
  if (current && s.goalUnits > 0) {
    const now = new Date();
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const frac = now.getDate() / dim;
    const m = monthSummary();
    if (frac > 0.15) {
      const pace = m.units / frac;
      const weeksLeft = Math.max(1, (dim - now.getDate()) / 7);
      const need = s.goalUnits - m.units;
      if (pace >= s.goalUnits) out.push({ tone: "good", text: `On pace for ${Math.round(pace)} units this month — ahead of your goal of ${s.goalUnits}.` });
      else if (need > 0) out.push({ tone: "warn", text: `${m.units} unit${m.units === 1 ? "" : "s"} so far this month — pace says ${Math.round(pace)} vs your goal of ${s.goalUnits}. That's ${Math.ceil(need / weeksLeft)} a week from here.` });
    }
  }

  // Show rate vs the recent norm.
  const priorDecided = prior.reduce((t, x) => t + x.decided, 0);
  const priorShowed = prior.reduce((t, x) => t + x.showed, 0);
  if (w.decided >= 3 && priorDecided >= 5) {
    const norm = Math.round((priorShowed / priorDecided) * 100);
    if (w.showRate <= norm - 15) out.push({ tone: "warn", text: `${w.showed} of ${w.decided} appointments showed (${w.showRate}%) — your recent norm is ${norm}%. Day-before confirmation texts recover most of that.` });
    else if (w.showRate >= norm + 10) out.push({ tone: "good", text: `Show rate ${w.showRate}% vs your usual ${norm}% — the confirmations are working.` });
  }

  // New vs used money mix, over the last month of deals.
  const last4 = weeks.slice(0, 4);
  const newDeals = last4.flatMap((x) => x.sales).filter((d) => d.newUsed === "New");
  const usedDeals = last4.flatMap((x) => x.sales).filter((d) => d.newUsed === "Used");
  if (newDeals.length >= 2 && usedDeals.length >= 2) {
    const avgN = newDeals.reduce((t, d) => t + dealTotal(d), 0) / newDeals.length;
    const avgU = usedDeals.reduce((t, d) => t + dealTotal(d), 0) / usedDeals.length;
    const [hi, lo, hiLabel] = avgU > avgN ? [avgU, avgN, "used"] : [avgN, avgU, "new"];
    if (lo > 0 && hi / lo >= 1.4) out.push({ tone: "info", text: `Your ${hiLabel} deals average ${money(hi)} vs ${money(lo)} — one extra ${hiLabel} unit a week is ~${money((hi) * 4)}/month.` });
  }

  // Which lead source is paying.
  const bySource = new Map();
  last4.flatMap((x) => x.sales).forEach((d) => {
    const k = d.leadType; if (!k) return;
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(dealTotal(d));
  });
  const ranked = [...bySource.entries()].filter(([, v]) => v.length >= 2)
    .map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length, v.length])
    .sort((x, y) => y[1] - x[1]);
  if (ranked.length >= 2) {
    const [k, avgV, n] = ranked[0];
    out.push({ tone: "info", text: `${k} deals are your best money — ${money(avgV)} average over ${n} deals this month. Feed that channel.` });
  }

  // Back-end penetration.
  const last4Front = last4.reduce((t, x) => t + x.front, 0);
  const last4BO = last4.reduce((t, x) => t + x.bo, 0);
  const last4Units = last4.reduce((t, x) => t + x.units, 0);
  if (last4Units >= 3 && last4Front + last4BO > 0) {
    const share = Math.round((last4BO / (last4Front + last4BO)) * 100);
    if (share < 20) out.push({ tone: "warn", text: `Back end is only ${share}% of your commission this month. A warmer handoff to the business manager usually moves this the most.` });
    else if (share >= 35) out.push({ tone: "good", text: `Back end is ${share}% of your commission — strong business-office handoffs.` });
  }

  // Activity volume vs the daily touch goal.
  if (current && s.dailyTouchGoal > 0) {
    const now = new Date();
    const daysIn = Math.min(6, (now.getDay() + 6) % 7 + 1);
    const target = s.dailyTouchGoal * daysIn;
    if (w.touches >= target) out.push({ tone: "good", text: `${w.touches} customer touches this week — on top of your ${s.dailyTouchGoal}/day goal.` });
    else if (daysIn >= 2 && w.touches < target * 0.6) out.push({ tone: "warn", text: `${w.touches} touches so far this week vs a ${target} target — Comms has your due list ready.` });
  }

  // Warm links waiting.
  if (current && w.linksOpened > 0) {
    out.push({ tone: "info", text: `${w.linksOpened} link${w.linksOpened === 1 ? "" : "s"} you sent got opened this week — those customers are warm. The Link activity panel in Comms has who.` });
  }

  // Quiet week nudge.
  if (current && w.units === 0 && withDeals.length && new Date().getDay() >= 3) {
    out.push({ tone: "warn", text: `No units yet this week. ${w.apptsSet ? `${w.apptsSet} appointment${w.apptsSet === 1 ? "" : "s"} set — confirm them and get them in the door.` : "Book appointments first — everything downstream follows."}` });
  }

  // Deal size drift.
  if (w.units >= 2 && withDeals.length >= 2) {
    const priorAvg = withDeals.reduce((t, x) => t + x.avgTotal, 0) / withDeals.length;
    if (priorAvg > 0 && w.avgTotal >= priorAvg * 1.25) out.push({ tone: "good", text: `Average deal this week is ${money(w.avgTotal)} — up from your usual ${money(priorAvg)}.` });
    else if (priorAvg > 0 && w.avgTotal <= priorAvg * 0.7) out.push({ tone: "info", text: `Average deal slipped to ${money(w.avgTotal)} from a usual ${money(priorAvg)} — worth a look at what got given away.` });
  }

  return out.slice(0, 5);
}

// ---- The screen ----
export function renderCoach(view) {
  let offset = 0; // 0 = this week, -1 = last week…

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="row" style="margin:2px 0 12px;gap:8px">
      <button class="btn btn-ghost btn-sm" data-nav="-1" aria-label="Previous week">‹</button>
      <div class="strong" id="co-week" style="flex:1;text-align:center"></div>
      <button class="btn btn-ghost btn-sm" data-nav="1" aria-label="Next week">›</button>
    </div>
    <div id="co-body"></div>
  `;
  view.appendChild(el);

  const draw = () => {
    const mon = addDays(weekStart(), offset * 7);
    const end = addDays(mon, 6);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    el.querySelector("#co-week").textContent =
      offset === 0 ? `This week · ${fmt(mon)}–${fmt(end)}` :
      offset === -1 ? `Last week · ${fmt(mon)}–${fmt(end)}` : `${fmt(mon)} – ${fmt(end)}`;
    el.querySelector('[data-nav="1"]').disabled = offset >= 0;

    // The viewed week plus the 7 before it, newest first.
    const weeks = Array.from({ length: 8 }, (_, i) => weekStats(addDays(mon, -7 * i)));
    const w = weeks[0], lw = weeks[1];
    const body = el.querySelector("#co-body");

    if (!store.all("sales").length && !store.all("appointments").length) {
      body.innerHTML = emptyState("sparkles", "The coach needs some game film", "Log sales and appointments and this becomes your week-by-week readout.");
      return;
    }

    const delta = (cur, prev, fmtV = (v) => v) => {
      if (prev == null || cur === prev) return "";
      const up = cur > prev;
      return ` <span class="small" style="color:${up ? "var(--brand)" : "var(--danger)"}">${up ? "▲" : "▼"} ${fmtV(Math.abs(cur - prev))}</span>`;
    };
    const money = (v) => currency(Math.round(v));

    const tile = (label, val, sub = "") => `
      <div class="card" style="padding:12px 14px">
        <div class="small muted">${esc(label)}</div>
        <div class="strong" style="font-size:1.25rem;margin-top:2px">${val}</div>
        ${sub ? `<div class="small muted" style="margin-top:2px">${sub}</div>` : ""}
      </div>`;

    // 8-week trend, oldest → newest; the viewed week is the last bar.
    const series = weeks.slice().reverse();
    const maxT = Math.max(1, ...series.map((x) => x.total));
    const bars = series.map((x, i) => {
      const h = Math.max(3, Math.round((x.total / maxT) * 64));
      const cur = i === series.length - 1;
      const bx = 8 + i * 39;
      return `
        <rect x="${bx}" y="${78 - h}" width="26" height="${h}" rx="4" fill="var(--brand)" opacity="${cur ? 1 : 0.35}"/>
        <text x="${bx + 13}" y="${74 - h}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.75">${x.total ? "$" + (x.total >= 1000 ? (x.total / 1000).toFixed(1) + "k" : Math.round(x.total)) : ""}</text>
        <text x="${bx + 13}" y="92" text-anchor="middle" font-size="10" font-weight="${cur ? 700 : 400}" fill="currentColor" opacity="${cur ? 0.95 : 0.55}">${x.units}</text>`;
    }).join("");

    const insights = coachInsights(weeks, { current: offset === 0 });
    const toneIcon = { good: "check", warn: "alert", info: "sparkles" };
    const toneColor = { good: "var(--brand)", warn: "var(--danger)", info: "var(--muted)" };

    body.innerHTML = `
      ${insights.length ? `
      <div class="section-title" style="margin-top:0">Coach says</div>
      <div class="card">
        ${insights.map((i) => `
          <div class="row" style="align-items:flex-start;gap:10px;padding:7px 0">
            <span style="color:${toneColor[i.tone]};flex:none;display:inline-flex;margin-top:1px">${icon(toneIcon[i.tone])}</span>
            <div class="small" style="flex:1;line-height:1.45">${esc(i.text)}</div>
          </div>`).join("")}
      </div>` : ""}

      <div class="section-title">Scorecard</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${tile("Units", `${w.units}${delta(w.units, lw.units)}`, `${w.newCount} new · ${w.usedCount} used`)}
        ${tile("Commission", `${money(w.total)}${delta(w.total, lw.total, money)}`, `${money(w.front)} front · ${money(w.bo)} back`)}
        ${tile("Appointments set", `${w.apptsSet}${delta(w.apptsSet, lw.apptsSet)}`, `${w.apptsHappened} happened`)}
        ${tile("Show rate", w.showRate == null ? "—" : `${w.showRate}%`, `${w.showed} of ${w.decided} showed`)}
        ${tile("New leads", `${w.leadsNew}${delta(w.leadsNew, lw.leadsNew)}`, "")}
        ${tile("Touches", `${w.touches}${delta(w.touches, lw.touches)}`, w.linksOpened ? `${w.linksOpened} link opens` : "")}
      </div>

      <div class="section-title">Last 8 weeks</div>
      <div class="card">
        <svg viewBox="0 0 320 96" style="width:100%;display:block" aria-label="Weekly commission and units">${bars}</svg>
        <div class="small muted" style="text-align:center;margin-top:4px">bars = commission · numbers = units · right bar is this view</div>
      </div>
    `;
  };

  el.querySelectorAll("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => { offset = Math.min(0, offset + Number(b.dataset.nav)); draw(); }));
  draw();
}
