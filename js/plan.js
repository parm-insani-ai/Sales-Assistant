// The day's plan, reasoned from the month.
//
// "Find me some people I can reach out to so I can set some appointments,
// I'm falling behind" has a goal in it, and a list of names doesn't answer
// a goal. This does: where the month stands against where it should be,
// how many appointments today has to produce to catch up by month end,
// what a call is worth to this salesperson (their own calls-to-appointment
// ratio, or a typical one until there's history), how many calls that is,
// and who — today's prospects, best first, topped up from the book.
//
// The plan is kept for the day, so Home shows calls made against it and
// Right now says what's left when the afternoon gets away. Pure arithmetic
// over the store, no model: the assistant reads it out, the screen draws it.

import * as store from "./store.js";
import { salesTarget } from "./target.js";
import { repInsight } from "./insight.js";
import { getProspects, candidates, eligible } from "./prospects.js";

const DAY = 86400000;
const KEY = "viniva:dayplan";
const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (v) => { const x = String(v || ""); if (/^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10); const d = new Date(x); return isNaN(d) ? "" : dayKey(d); };

// Calls it takes this salesperson to set one appointment: dials in the
// last sixty days against the ones followed by an appointment for that
// customer within a day. Typical five-to-one until there's enough history.
export const TYPICAL_CALLS_PER_APPT = 5;
export function callsPerAppt(now = Date.now()) {
  const since = now - 60 * DAY;
  const dials = store.all("calls").filter((c) => c.dir !== "in" && new Date(c.at).getTime() >= since);
  const appts = store.all("appointments").filter((a) => a.status !== "canceled");
  const booked = new Set();
  dials.forEach((c) => {
    if (!c.leadId) return;
    const hit = appts.some((a) => a.leadId === c.leadId && String(a.createdAt || "") > String(c.at || "") && new Date(a.createdAt) - new Date(c.at) <= DAY);
    if (hit) booked.add(`${c.leadId}|${String(c.at).slice(0, 10)}`);
  });
  const enough = dials.length >= 20 && booked.size >= 2;
  return { dials: dials.length, booked: booked.size, ratio: enough ? Math.max(1, Math.round(dials.length / booked.size)) : TYPICAL_CALLS_PER_APPT, assumed: !enough };
}

// Where the month stands, in appointments: set so far, where it should be
// by today, and what today has to produce to catch up by month end — the
// same arithmetic as the daily line on Home and the manager's board.
export function readPace(now = new Date()) {
  const t = salesTarget(now), p = t.plan, s = store.getSettings();
  const appts = store.all("appointments");
  const ins = repInsight({ appts, leads: [], touches: 0, touchesByDay: {}, goalUnits: p.target, sold: t.sold, now });
  const n = ins.needs;
  const today = dayKey(now);
  const setToday = appts.filter((a) => a.status !== "canceled" && dayOf(a.createdAt || a.when) === today).length;
  // The month's appointments: the one set as a goal, else what the units
  // target needs at this rep's show and close rates.
  const monthAppts = Number(s.goalAppointments) || (p.target && n.perAppt ? Math.ceil(p.target / n.perAppt) : 0);
  const expectedByNow = monthAppts ? Math.round((monthAppts * t.day) / t.daysIn) : 0;
  const behind = Math.max(0, expectedByNow - ins.setThisMonth);
  // Today's number: the one set with the target — the same every day —
  // else what the month asks of a day, capped at what a day can carry
  // (insight.needs): the raw division is nonsense late in a slow month.
  const dailyGoal = Number(s.goalDaily) > 0 ? Number(s.goalDaily) : 0;
  const apptsToday = dailyGoal || (p.target && !n.onTrack ? n.ask : 0);
  return {
    target: p.target, sold: t.sold, unitsLeft: n.unitsLeft, monthAppts, setThisMonth: ins.setThisMonth, expectedByNow, behind,
    apptsNeeded: n.apptsNeeded, perDay: n.perDay, daysLeft: n.daysLeft, apptsToday, dailyGoal, setToday, reachable: n.reachable,
    onTrack: !!(p.target && n.onTrack), showRate: n.showRate, closeRate: n.closeRate, assumed: n.assumed, day: t.day, daysIn: t.daysIn,
  };
}

function readPlan() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
function writePlan(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* device memory only */ } }

/**
 * Build (or re-read) today's plan. Fresh each day; `rebuild` starts over.
 * { day, madeAt, pace, calls: { perAppt, assumed }, apptsToday, callsToday,
 *   ids: [leadId], answer }
 */
export function appointmentPlan({ now = new Date(), rebuild = false } = {}) {
  const day = dayKey(now);
  const saved = readPlan();
  const pace = readPace(now);
  const cpa = callsPerAppt(now.getTime());
  // Today's appointments to set: what the month needs per day — with a
  // floor of one when they're behind, because "nothing today" is never the
  // plan for someone who says they're falling behind.
  const apptsToday = Math.max(pace.apptsToday, pace.behind > 0 ? 1 : 0);
  const callsToday = apptsToday * cpa.ratio;
  let ids;
  if (saved && saved.day === day && !rebuild) ids = saved.ids;
  else {
    // Today's prospects first (they're on Log with their reasons), topped
    // up from the rest of the book, best first, to the calls the day needs.
    const picks = getProspects();
    ids = picks.map((c) => c.lead.id);
    if (ids.length < callsToday) {
      const have = new Set(ids);
      for (const c of candidates()) { if (ids.length >= callsToday) break; if (!have.has(c.lead.id) && eligible(c.lead)) { ids.push(c.lead.id); have.add(c.lead.id); } }
    }
    ids = ids.slice(0, Math.max(callsToday, Math.min(ids.length, 5)));
  }
  const plan = { day, madeAt: saved && saved.day === day && !rebuild ? saved.madeAt : now.toISOString(), pace, calls: { perAppt: cpa.ratio, assumed: cpa.assumed, dials: cpa.dials, booked: cpa.booked }, apptsToday, callsToday, ids };
  writePlan({ day: plan.day, madeAt: plan.madeAt, ids, apptsToday, callsToday });
  return plan;
}

// Today's plan if one was made today, with progress: calls made and
// appointments set since. Null when none.
export function todayPlan(now = new Date()) {
  const saved = readPlan();
  if (!saved || saved.day !== dayKey(now)) return null;
  return { ...saved, ...progress(saved, now) };
}
export function progress(plan, now = new Date()) {
  const day = dayKey(now);
  const calls = store.all("calls").filter((c) => c.dir !== "in" && dayOf(c.at) === day && String(c.at || "") >= String(plan.madeAt || ""));
  const called = new Set(calls.map((c) => c.leadId).filter(Boolean));
  const appts = store.all("appointments").filter((a) => a.status !== "canceled" && dayOf(a.createdAt || a.when) === day && String(a.createdAt || "") >= String(plan.madeAt || ""));
  const left = (plan.ids || []).filter((id) => !called.has(id));
  return { callsMade: calls.length, apptsSet: appts.length, left, done: calls.length >= plan.callsToday || appts.length >= plan.apptsToday };
}

// The people on the plan, in order, with the reason — for the reply and the screen.
export function planPeople(plan) {
  const all = candidates();
  return (plan.ids || []).map((id) => all.find((c) => c.lead.id === id)).filter(Boolean)
    .map((c) => ({ id: c.lead.id, name: c.lead.name, drives: c.lead.vehicleInterest || "", phone: c.lead.phone || "", reason: (c.reasons || [])[0] || c.why || "", reasons: c.reasons || [] }));
}

// The plan in one breath — what the assistant says, never a figure a
// customer could overhear as a price.
export function sayPlan(plan, people = planPeople(plan)) {
  const p = plan.pace;
  const bits = [];
  if (!p.target) return `There's no monthly target set yet, so I can't say how far behind you are — set it on Home. Meanwhile ${people.length ? `here are ${people.length} people worth a call today, ${people[0].name} first: ${people[0].reason || "a good reason to talk"}.` : "nobody on file has enough data to pick from yet."}`;
  if (p.behind > 0) bits.push(`You're ${p.behind} appointment${p.behind === 1 ? "" : "s"} behind where the month should be — ${p.setThisMonth} set, ${p.expectedByNow} expected by day ${p.day}.`);
  else if (p.onTrack) bits.push(`You're on pace — ${p.setThisMonth} set this month and the calendar covers the rest.`);
  else bits.push(`You're on pace for appointments — ${p.setThisMonth} set — but the month still needs ${p.apptsNeeded} more to sell ${p.target}.`);
  if (plan.apptsToday) {
    if (p.dailyGoal) bits.push(`Your number is ${p.dailyGoal} appointment${p.dailyGoal === 1 ? "" : "s"} a day${p.setToday ? `, ${p.setToday} set so far today` : ""}${p.behind > 0 ? " — and with the month behind, every one past it counts double" : ""}.`);
    else bits.push(p.reachable
      ? `To catch up by month end that's ${plan.apptsToday} appointment${plan.apptsToday === 1 ? "" : "s"} a day, today included.`
      : `Catching all of it up isn't on with ${p.daysLeft} working day${p.daysLeft === 1 ? "" : "s"} left — it would take ${p.apptsNeeded}. ${plan.apptsToday} today is a strong finish and sets up next month.`);
    bits.push(`${plan.calls.assumed ? "Until there's more call history I'm assuming" : "Your own calls run"} about ${plan.calls.perAppt} to one, so that's ${plan.callsToday} call${plan.callsToday === 1 ? "" : "s"} today.`);
  }
  if (people.length) {
    const top = people.slice(0, 2).map((x) => `${x.name}${x.reason ? ` — ${x.reason}` : ""}`).join("; ");
    bits.push(`Here are ${people.length}, best first: ${top}. The rest are on Log with a Review button each.`);
  } else bits.push("Nobody on file is ready to be called yet — everyone with a reason has been reached recently.");
  bits.push("I'll keep count on Home and nudge you if the afternoon gets away.");
  return bits.join(" ");
}
