// The appointment engine: the arithmetic a store runs on.
//
// Sales come from appointments, appointments come from contact. So every
// number here points at one question — how many appointments does each rep
// still need to set to hit goal, and what moves that number: how fast
// leads are touched, which sources set, when they get set, and what makes
// a set appointment actually show. Pure functions over plain rows, so node
// can test them and every screen adds the same way.
//
// Rows:
//   appointment: { id, leadId, createdAt (when it was SET), when (the visit),
//                  confirmed, outcome: "showed"|"sold"|"no_show"|"", status }
//   lead:        { id, source, createdAt, firstContacted, lastContacted, stage }

const DAY = 86400000;
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? 0 : Number(v));
const t = (iso) => { const x = new Date(iso).getTime(); return isNaN(x) ? null : x; };
const live = (a) => a && a.status !== "canceled";
// When it was set: the record's creation, or — for rows imported without
// one — no later than the visit itself.
const setAt = (a) => t(a.createdAt) ?? t(a.when);
const shown = (a) => a.outcome === "showed" || a.outcome === "sold";
const past = (a, now) => { const x = t(a.when); return x != null && x < now; };
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

// Set → confirmed → shown → sold, over the appointments given.
export function funnel(appts, now = Date.now()) {
  const A = appts.filter(live);
  const p = A.filter((a) => past(a, now));
  const sh = p.filter(shown).length, so = p.filter((a) => a.outcome === "sold").length;
  return {
    set: A.length, confirmed: A.filter((a) => a.confirmed).length, past: p.length,
    shown: sh, sold: so, noShow: p.filter((a) => a.outcome === "no_show").length,
    upcoming: A.length - p.length,
    showRate: pct(sh, p.length), closeRate: pct(so, sh), setToSold: pct(so, p.length),
  };
}

// Typical rates to plan on until a rep has enough history of their own.
export const ASSUMED = { showRate: 60, closeRate: 40, minPast: 8 };

/**
 * What it takes to hit goal from here.
 *   goal, sold: units; futureSet: appointments already on the calendar from
 *   now to month end; showRate/closeRate in percent (null → assumed);
 *   now: Date.
 * Returns { unitsLeft, pipeline, apptsNeeded, perDay, daysLeft, perAppt,
 *           showRate, closeRate, assumed, onTrack }.
 */
export function needs({ goal, sold, futureSet = 0, showRate = null, closeRate = null, now = new Date() }) {
  const assumed = showRate == null || closeRate == null;
  const s = (showRate == null ? ASSUMED.showRate : showRate) / 100;
  const c = (closeRate == null ? ASSUMED.closeRate : closeRate) / 100;
  // Units per appointment set. Floored: a store that shows 40% and closes
  // 20% is as bad as the plan will assume — below that the arithmetic says
  // "hundreds of appointments", which is a data problem, not a plan.
  const perAppt = Math.max(0.08, s * c);
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysIn - now.getDate() + 1);
  const pipeline = Math.round(futureSet * perAppt * 10) / 10;
  const unitsLeft = Math.max(0, num(goal) - num(sold) - pipeline);
  const apptsNeeded = num(goal) ? Math.ceil(unitsLeft / perAppt) : 0;
  return {
    goal: num(goal), sold: num(sold), unitsLeft: Math.round(unitsLeft * 10) / 10, pipeline, futureSet,
    apptsNeeded, perDay: Math.round((apptsNeeded / daysLeft) * 10) / 10, daysLeft,
    perAppt: Math.round(perAppt * 100) / 100, showRate: Math.round(s * 100), closeRate: Math.round(c * 100), assumed,
    onTrack: !num(goal) || apptsNeeded === 0,
  };
}

// Touches it takes this rep to set one appointment (their own ratio).
export function touchesPerAppt(touches, set) {
  return set ? Math.round((touches / set) * 10) / 10 : null;
}

// How fast a lead is first touched, and what that does to setting an
// appointment. Buckets by minutes from the lead's arrival to first contact.
export function speedToLead(leads, appts) {
  const withAppt = new Set(appts.filter(live).map((a) => a.leadId).filter(Boolean));
  const B = [
    { key: "1h", label: "Within an hour", max: 60 },
    { key: "24h", label: "Same day", max: 1440 },
    { key: "later", label: "After a day", max: Infinity },
    { key: "never", label: "Never touched", max: null },
  ].map((b) => ({ ...b, leads: 0, appts: 0 }));
  const mins = [];
  for (const l of leads) {
    const c = t(l.createdAt), f = t(l.firstContacted || l.lastContacted);
    let b;
    if (c == null) continue;
    if (f == null) b = B[3];
    else { const m = Math.max(0, (f - c) / 60000); mins.push(m); b = m <= 60 ? B[0] : m <= 1440 ? B[1] : B[2]; }
    b.leads++; if (withAppt.has(l.id)) b.appts++;
  }
  mins.sort((a, b) => a - b);
  const median = mins.length ? mins[Math.floor(mins.length / 2)] : null;
  return { buckets: B.map((b) => ({ ...b, setRate: pct(b.appts, b.leads) })), medianMinutes: median == null ? null : Math.round(median), leads: leads.length };
}

// Which sources set appointments: leads, appointments, set rate, by source.
export function bySource(leads, appts) {
  const src = new Map();
  const of = (l) => String(l.source || "Unknown").trim() || "Unknown";
  const leadSrc = new Map(leads.map((l) => [l.id, of(l)]));
  const withAppt = new Set(appts.filter(live).map((a) => a.leadId).filter(Boolean));
  for (const l of leads) { const s = of(l); const r = src.get(s) || { source: s, leads: 0, withAppt: 0, appts: 0 }; r.leads++; if (withAppt.has(l.id)) r.withAppt++; src.set(s, r); }
  for (const a of appts.filter(live)) { const s = leadSrc.get(a.leadId); if (!s) continue; const r = src.get(s); if (r) r.appts++; }
  return [...src.values()].map((r) => ({ ...r, setRate: pct(r.withAppt, r.leads) })).sort((a, b) => b.appts - a.appts || b.leads - a.leads);
}

// When appointments get set: by weekday and by hour of the day (local).
export function bestTimes(appts) {
  const day = new Array(7).fill(0), hour = new Array(24).fill(0);
  for (const a of appts.filter(live)) { const s = setAt(a); if (s == null) continue; const d = new Date(s); day[d.getDay()]++; hour[d.getHours()]++; }
  const top = (arr) => arr.reduce((b, v, i) => (v > arr[b] ? i : b), 0);
  return { day, hour, bestDay: day.some(Boolean) ? top(day) : null, bestHour: hour.some(Boolean) ? top(hour) : null };
}

// Appointments set (by the day they were set) and shown (by the visit), per
// week for the last `weeks` weeks, oldest first. Weeks start on Monday.
export function weekly(appts, { weeks = 8, now = Date.now(), touchesByDay = null } = {}) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * (weeks - 1));
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const from = new Date(start); from.setDate(start.getDate() + 7 * i);
    const to = new Date(from); to.setDate(from.getDate() + 7);
    const inWeek = (iso) => { const x = t(iso); return x != null && x >= from.getTime() && x < to.getTime(); };
    const set = appts.filter((a) => live(a) && setAt(a) != null && inWeek(new Date(setAt(a)).toISOString())).length;
    const sh = appts.filter((a) => live(a) && shown(a) && inWeek(a.when)).length;
    let touches = 0;
    if (touchesByDay) for (const [d, n] of Object.entries(touchesByDay)) if (inWeek(d + "T12:00:00")) touches += n;
    out.push({ weekStart: from.toISOString().slice(0, 10), set, shown: sh, touches });
  }
  return out;
}

// Does confirming an appointment change whether it shows?
export function confirmEffect(appts, now = Date.now()) {
  const p = appts.filter((a) => live(a) && past(a, now));
  const g = (f) => { const xs = p.filter(f); const s = xs.filter(shown).length; return { past: xs.length, shown: s, showRate: pct(s, xs.length) }; };
  return { confirmed: g((a) => a.confirmed), unconfirmed: g((a) => !a.confirmed) };
}

// Does the gap between setting and the visit change whether it shows?
export function leadTimeEffect(appts, now = Date.now()) {
  const B = [["Same day", 0, 0], ["1–2 days out", 1, 2], ["3–6 days out", 3, 6], ["A week or more", 7, Infinity]].map(([label, lo, hi]) => ({ label, lo, hi, past: 0, shown: 0 }));
  for (const a of appts) {
    if (!live(a) || !past(a, now)) continue;
    const c = setAt(a), w = t(a.when); if (c == null || w == null) continue;
    const days = Math.max(0, Math.floor((w - c) / DAY));
    const b = B.find((x) => days >= x.lo && days <= x.hi); if (!b) continue;
    b.past++; if (shown(a)) b.shown++;
  }
  return B.map((b) => ({ label: b.label, past: b.past, shown: b.shown, showRate: pct(b.shown, b.past) }));
}

// One rep's whole picture from their rows. `touches` is the month's count,
// `touchesByDay` { "YYYY-MM-DD": n } for the trend.
export function repInsight({ appts, leads, touches, touchesByDay, goalUnits, sold, now = new Date() }) {
  const ms = now.getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const thisMonth = appts.filter((a) => { const w = t(a.when); return w != null && w >= monthStart && w < monthEnd; });
  const setThisMonth = appts.filter((a) => live(a) && (setAt(a) || 0) >= monthStart && (setAt(a) || 0) < monthEnd).length;
  const f = funnel(thisMonth, ms);
  // Rates from as much history as there is; the month alone is too thin.
  // Close rate: from appointment outcomes when enough are marked sold;
  // otherwise from units sold against appointments shown (reps log the
  // sale far more reliably than they mark the appointment); else typical.
  const all = funnel(appts, ms);
  const enough = all.past >= ASSUMED.minPast;
  const outcomeClose = all.shown >= 8 && all.sold >= 3 ? all.closeRate : null;
  const unitClose = outcomeClose == null && f.shown >= 4 && num(sold) > 0 ? Math.min(100, Math.round((num(sold) / f.shown) * 100)) : null;
  const n = needs({ goal: goalUnits, sold, futureSet: thisMonth.filter((a) => live(a) && !past(a, ms)).length, showRate: enough ? all.showRate : null, closeRate: outcomeClose ?? unitClose, now });
  n.closeFrom = outcomeClose != null ? "outcomes" : unitClose != null ? "units" : "typical";
  const tpa = touchesPerAppt(touches, setThisMonth);
  return {
    funnel: f, history: all, needs: n, setThisMonth, touchesPerAppt: tpa,
    touchesPerDay: tpa && n.perDay ? Math.ceil(tpa * n.perDay) : null,
    speed: speedToLead(leads, appts), sources: bySource(leads, appts), times: bestTimes(appts),
    weekly: weekly(appts, { now: ms, touchesByDay }), confirm: confirmEffect(appts, ms), leadTime: leadTimeEffect(appts, ms),
  };
}

// The store: the same picture over everyone's rows put together.
export function storeInsight(reps, { now = new Date() } = {}) {
  const appts = reps.flatMap((r) => r.appts || []), leads = reps.flatMap((r) => r.leads || []);
  const touches = reps.reduce((a, r) => a + num(r.touches), 0);
  const touchesByDay = {};
  for (const r of reps) for (const [d, n] of Object.entries(r.touchesByDay || {})) touchesByDay[d] = (touchesByDay[d] || 0) + n;
  return repInsight({ appts, leads, touches, touchesByDay, goalUnits: reps.reduce((a, r) => a + num(r.goalUnits), 0), sold: reps.reduce((a, r) => a + num(r.sold), 0), now });
}

// Plain-English findings a manager can act on, from a store or rep insight.
export function findings(ins) {
  const out = [];
  const sp = ins.speed.buckets;
  const fast = sp[0], slow = sp[2], never = sp[3];
  if (fast.leads >= 5 && slow.leads >= 5 && fast.setRate != null && slow.setRate != null && fast.setRate > slow.setRate)
    out.push({ kind: "speed", text: `Leads touched within an hour set appointments ${fast.setRate}% of the time; after a day, ${slow.setRate}%. Speed to lead is the biggest lever on the board.` });
  if (never.leads >= 3) out.push({ kind: "untouched", text: `${never.leads} lead${never.leads === 1 ? "" : "s"} in the last 90 days ${never.leads === 1 ? "was" : "were"} never touched — at the store's set rate that's about ${Math.round(never.leads * ((ins.speed.buckets[1].setRate || fast.setRate || 20) / 100))} appointments left on the table.` });
  const c = ins.confirm;
  if (c.confirmed.past >= 5 && c.unconfirmed.past >= 5 && c.confirmed.showRate != null && c.unconfirmed.showRate != null && c.confirmed.showRate - c.unconfirmed.showRate >= 10)
    out.push({ kind: "confirm", text: `Confirmed appointments show ${c.confirmed.showRate}% of the time, unconfirmed ${c.unconfirmed.showRate}%. Confirming every appointment the day before is worth ${c.confirmed.showRate - c.unconfirmed.showRate} points of show rate.` });
  const lt = ins.leadTime.filter((b) => b.past >= 5 && b.showRate != null);
  if (lt.length >= 2) { const best = lt.reduce((a, b) => (b.showRate > a.showRate ? b : a)); const worst = lt.reduce((a, b) => (b.showRate < a.showRate ? b : a)); if (best.showRate - worst.showRate >= 15) out.push({ kind: "leadtime", text: `Appointments set ${best.label.toLowerCase()} show ${best.showRate}%; ${worst.label.toLowerCase()}, ${worst.showRate}%. Book closer in.` }); }
  const srcs = ins.sources.filter((s) => s.leads >= 5 && s.setRate != null);
  if (srcs.length >= 2) { const best = srcs.reduce((a, b) => (b.setRate > a.setRate ? b : a)); const worst = srcs.reduce((a, b) => (b.setRate < a.setRate ? b : a)); if (best.source !== worst.source) out.push({ kind: "source", text: `${best.source} leads set at ${best.setRate}%, ${worst.source} at ${worst.setRate}%. Work ${best.source} first when the list is long.` }); }
  const tm = ins.times;
  if (tm.bestHour != null && ins.history.set >= 10) out.push({ kind: "time", text: `Most appointments get set ${DAYS[tm.bestDay]}s around ${hourLabel(tm.bestHour)}. Put the calling hour there.` });
  if (!ins.needs.onTrack) out.push({ kind: "needs", text: `To hit ${ins.needs.goal} units: ${ins.needs.apptsNeeded} more appointments set by month end, ${ins.needs.perDay} a day${ins.touchesPerDay ? `, about ${ins.touchesPerDay} touches a day at the current ratio` : ""}.${ins.needs.assumed ? " (Planned on typical show and close rates until there's more history.)" : ""}` });
  return out;
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function hourLabel(h) { return h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`; }
