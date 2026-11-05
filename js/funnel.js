// The funnel, with numbers on it.
//
// Booking appointments every day from an owner book is arithmetic before
// it is anything else: of the people attempted, some are reached; of those
// reached, some book; of those booked, some show; of those who show, some
// buy. The industry's benchmarks for an owner book give the shape (average,
// strong, top — equity-mining and BDC figures, vendor-published, so they're
// the shape and not gospel), and this rep's own calls replace them stage by
// stage as soon as there's enough behind them.
//
// From that, the day: the goal in appointments, what's booked so far, and
// how many conversations and dials that still needs at these rates — so the
// batch is sized from the goal, not from a setting.

import * as store from "./store.js";

const DAY = 86400000;

// Average · strong · top, of the stage before. Sources in the README.
export const BENCH = {
  reach: { label: "Reached", of: "attempted", avg: 0.50, strong: 0.65, top: 0.75 },
  set: { label: "Appointment set", of: "reached", avg: 0.15, strong: 0.215, top: 0.25 },
  show: { label: "Showed", of: "set", avg: 0.55, strong: 0.64, top: 0.70 },
  sold: { label: "Sold", of: "shown", avg: 0.275, strong: 0.355, top: 0.40 },
};
// Enough of this rep's own before their rate stands in for the benchmark.
export const MIN = { reach: 30, set: 20, show: 10, sold: 8 };
const WEEKS = 8;

const REACHED = new Set(["reached"]);
const TRIED = new Set(["reached", "voicemail", "no_answer", "wrong_number"]);
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

/**
 * This rep's funnel over the last eight weeks: for each stage the count,
 * the rate, whether it's their own or the benchmark standing in, and where
 * it sits against average / strong / top.
 */
export function funnel({ now = Date.now(), weeks = WEEKS } = {}) {
  const since = now - weeks * 7 * DAY;
  const calls = store.all("calls").filter((c) => c && c.dir !== "in" && (c.via || "call") === "call" && TRIED.has(c.outcome) && new Date(c.at).getTime() >= since);
  const attempted = new Set(), reached = new Set();
  calls.forEach((c) => { if (!c.leadId) return; attempted.add(c.leadId); if (REACHED.has(c.outcome)) reached.add(c.leadId); });
  // Set: an appointment made within two weeks of a reach, for that person.
  const appts = store.all("appointments").filter((a) => a.leadId && a.status !== "canceled" && new Date(a.createdAt || a.when || 0).getTime() >= since);
  const reachAt = new Map();
  calls.forEach((c) => { if (c.leadId && REACHED.has(c.outcome)) reachAt.set(c.leadId, [...(reachAt.get(c.leadId) || []), new Date(c.at).getTime()]); });
  const set = appts.filter((a) => (reachAt.get(a.leadId) || []).some((t) => { const at = new Date(a.createdAt || a.when).getTime(); return at >= t && at - t <= 14 * DAY; }));
  const setLeads = new Set(set.map((a) => a.leadId));
  // Show and sold are read on every appointment booked in the window whose
  // time has passed — the rep's show rate is the rep's show rate, whether
  // the booking came from a call or a walk-in.
  const past = appts.filter((a) => new Date(a.when).getTime() < now);
  const showed = past.filter((a) => a.outcome === "showed" || a.outcome === "sold");
  const sold = showed.filter((a) => a.outcome === "sold");
  const stage = (key, n, of) => {
    const b = BENCH[key];
    const own = of >= MIN[key];
    const rate = own ? n / of : b.avg;
    return { key, label: b.label, ofLabel: b.of, n, of, rate, own, bench: b, tier: rate >= b.top ? "top" : rate >= b.strong ? "strong" : rate >= b.avg ? "average" : "below" };
  };
  return {
    weeks,
    reach: stage("reach", reached.size, attempted.size),
    set: stage("set", setLeads.size, reached.size),
    show: stage("show", showed.length, past.length),
    sold: stage("sold", sold.length, showed.length),
    dials: calls.length,
    appointments: appts.length,
  };
}

/**
 * The day: the goal, what's booked, and what that still needs at these
 * rates — conversations and dials — against what's been done today.
 */
export function dayPlan(now = new Date()) {
  const s = store.getSettings();
  const goal = Number(s.goalDaily) > 0 ? Number(s.goalDaily) : 2;
  const f = funnel({ now: now.getTime() });
  const today = dayKey(now);
  const booked = store.all("appointments").filter((a) => a.status !== "canceled" && dayKey(a.createdAt || a.when) === today).length;
  const callsToday = store.all("calls").filter((c) => c && c.dir !== "in" && (c.via || "call") === "call" && TRIED.has(c.outcome) && dayKey(c.at) === today);
  const dialsDone = callsToday.length;
  const reachedToday = callsToday.filter((c) => REACHED.has(c.outcome)).length;
  const left = Math.max(0, goal - booked);
  const conversations = Math.ceil(left / f.set.rate);
  const dials = Math.ceil(conversations / f.reach.rate);
  return {
    goal, booked, left, done: left === 0,
    conversations, dials, dialsDone, reachedToday,
    dialsLeft: Math.max(0, dials - Math.max(0, dialsDone - 0)),
    reachRate: f.reach.rate, setRate: f.set.rate, own: f.reach.own && f.set.own,
    funnel: f,
  };
}

/** One line for the session's head and the batch block. */
export function dayLine(p = dayPlan()) {
  if (p.done) return `${p.goal} to book today · ${p.booked} booked — done for the day`;
  return `${p.goal} to book today · ${p.booked} booked · about ${p.dials} dial${p.dials === 1 ? "" : "s"} at ${p.own ? "your" : "average"} rates`;
}

/** Appointments and dials by week for the scoreboard: [{ start, dials, reached, set }]. */
export function weekly({ now = Date.now(), weeks = 6 } = {}) {
  const weekOf = (t) => { const d = new Date(t); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return dayKey(d); };
  const out = new Map();
  for (let i = weeks - 1; i >= 0; i--) out.set(weekOf(now - i * 7 * DAY), { dials: 0, reached: 0, set: 0 });
  const since = now - weeks * 7 * DAY;
  store.all("calls").forEach((c) => {
    if (!c || c.dir === "in" || (c.via || "call") !== "call" || !TRIED.has(c.outcome)) return;
    const t = new Date(c.at).getTime(); if (!(t >= since)) return;
    const w = out.get(weekOf(t)); if (!w) return;
    w.dials++; if (REACHED.has(c.outcome)) w.reached++;
  });
  store.all("appointments").forEach((a) => {
    if (!a.leadId || a.status === "canceled") return;
    const t = new Date(a.createdAt || a.when || 0).getTime(); if (!(t >= since)) return;
    const w = out.get(weekOf(t)); if (w) w.set++;
  });
  return [...out.entries()].map(([start, w]) => ({ start, ...w, per100: w.dials ? Math.round((w.set / w.dials) * 100) : 0 }));
}

// ---- The call windows ----
//
// The 4–6 pm hour connects best, about double the worst; early morning
// and 10–11 are next; Wednesday and Thursday beat the other days. The day
// plans two blocks around that, inside this rep's hours.
export const WINDOWS = [{ key: "morning", name: "morning", from: 8, to: 11 }, { key: "afternoon", name: "late-afternoon", from: 16, to: 18 }];
const clock = (h) => (h === 12 ? "12" : h > 12 ? String(h - 12) : String(h));
export function callWindow(now = new Date()) {
  const s = store.getSettings();
  const from = Number(s.hoursFrom ?? 9), to = Number(s.hoursTo ?? 18);
  const h = now.getHours() + now.getMinutes() / 60;
  const ws = WINDOWS.map((w) => ({ ...w, from: Math.max(w.from, from), to: Math.min(w.to, to) })).filter((w) => w.to > w.from);
  const cur = ws.find((w) => h >= w.from && h < w.to) || null;
  const next = ws.find((w) => w.from > h) || null;
  const strong = [3, 4].includes(now.getDay());
  const span = (w) => `${clock(w.from)}–${clock(w.to)}`;
  const day = strong ? " · Wednesdays and Thursdays connect best" : "";
  const line = cur ? `In the ${cur.name} window (${span(cur)}) — the best time to dial${day}`
    : next ? `Next window ${span(next)}${ws[0] && next !== ws[0] ? "" : ""} — calls connect best then${day}`
    : `Today's windows are done — tomorrow ${ws.map(span).join(" and ")}`;
  return { inWindow: !!cur, window: cur, next, windows: ws, strongDay: strong, line };
}
