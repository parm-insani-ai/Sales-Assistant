// The follow-up plan.
//
// A customer who is added gets worked, from that moment, without the
// salesperson setting anything up. The plan is a dated series of touches —
// texts and calls — shaped to the customer's situation, and every text in it
// is drafted from what we know about them and held for a tap of approval
// before it goes anywhere. The salesperson's job is to say yes.
//
// What the pattern is built on. A new lead's odds fall off a cliff with time:
// the first hour matters more than the rest of the week, and most of the
// deals that happen at all are worked six or more times before they book.
// Then it thins out — weekly through the first month, monthly to ninety days —
// because a customer who hasn't moved in a month isn't dead, they're early.
//
// And a plan is not a machine gun. A customer who replies is in a
// conversation, so the scheduled touches step back and let it happen; an
// appointment on the books pauses them until it's been and gone; a sale or a
// loss retires them (connections.js).

import * as store from "./store.js";

function firstName(name) {
  return String(name || "there").trim().split(/\s+/)[0];
}
function addDaysISO(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- The patterns ----
// intent is what the text is *for*; the drafter turns it into words for this
// customer. Calls carry a one-line purpose for the salesperson instead.
export const INTEREST_PLAN = [
  { day: 0,  channel: "text", intent: "intro",    label: "Intro text — thanks, and what you'll do for them" },
  { day: 0,  channel: "call", intent: "intro",    label: "Intro call — confirm what they want and when" },
  { day: 1,  channel: "text", intent: "value",    label: "Value text — something specific to what they asked for" },
  { day: 2,  channel: "call", intent: "check",    label: "Check-in call — answer questions, offer a time" },
  { day: 4,  channel: "text", intent: "options",  label: "Options text — two ways to get them there" },
  { day: 7,  channel: "call", intent: "week",     label: "One-week call — where are they at" },
  { day: 10, channel: "text", intent: "nudge",    label: "Light nudge — anything changed?" },
  { day: 14, channel: "call", intent: "twoweek",  label: "Two-week call" },
  { day: 21, channel: "text", intent: "fresh",    label: "Something new — fresh stock, a program, a reason to look again" },
  { day: 30, channel: "text", intent: "month",    label: "30-day check-in" },
  { day: 45, channel: "text", intent: "nurture",  label: "Six-week touch — keep the door open" },
  { day: 60, channel: "call", intent: "nurture",  label: "60-day call" },
  { day: 90, channel: "text", intent: "nurture",  label: "90-day check-in" },
];

// Which plan fits this customer. An owner already in a car is worked with the
// salesperson's own sequence from Settings (softer, longer); anyone who came
// in wanting a vehicle gets the interest pattern.
export function planFor(lead) {
  if (!lead) return [];
  const owner = ["sold", "delivered"].includes(lead.stage) || lead.currentPayment != null || lead.payoff != null || lead.purchaseDate;
  if (owner) return (store.getSettings().cadence || []).map((s) => ({ ...s, intent: s.intent || "nurture" }));
  return INTEREST_PLAN;
}

// True if this lead already has plan tasks (so we don't duplicate them).
export function hasCadence(leadId) {
  return store.all("tasks").some((t) => t.leadId === leadId && t.cadence && !t.done);
}

// Open plan steps for a customer, soonest first.
export function planSteps(leadId) {
  return store.all("tasks")
    .filter((t) => t.leadId === leadId && t.cadence && !t.done)
    .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")) || (a.step || 0) - (b.step || 0));
}

// Create the plan's reminder tasks for a lead. Returns the number created.
export function startCadence(leadId) {
  const lead = store.get("leads", leadId);
  if (!lead) return 0;
  const steps = planFor(lead);
  const fn = firstName(lead.name);
  let created = 0;
  store.bulk(() => {
    steps.forEach((step, i) => {
      const verb = step.channel === "text" ? "Text" : step.channel === "email" ? "Email" : "Call";
      store.create("tasks", {
        title: `${verb} ${fn} — ${step.label}`,
        due: addDaysISO(step.day || 0),
        priority: (step.day || 0) <= 2 ? "high" : "normal",
        done: false,
        leadId,
        cadence: true,
        channel: step.channel,
        intent: step.intent || "",
        step: i + 1,
        of: steps.length,
      });
      created++;
    });
  });
  return created;
}

// Called after a lead is created; starts the plan if auto-cadence is on and
// the lead doesn't already have one.
export function maybeStartCadence(leadId) {
  if (!store.getSettings().autoCadence) return 0;
  if (hasCadence(leadId)) return 0;
  return startCadence(leadId);
}

// ---- Standing back ----

// Push every open step due on or before `untilISO` to the day after it. An
// appointment on the books: the texts before it would only compete with the
// confirmation, and the ones after it should wait for the outcome.
export function deferPlan(leadId, untilISO) {
  const until = String(untilISO || "").slice(0, 10);
  if (!until) return 0;
  const after = addDaysISO(1, new Date(until + "T12:00:00"));
  let moved = 0;
  store.bulk(() => {
    planSteps(leadId).forEach((t) => {
      if (t.due && t.due <= until) { store.update("tasks", t.id, { due: after, deferredFor: "appointment" }); moved++; }
    });
  });
  return moved;
}

// A reply from the customer puts the plan on hold for a few days. The
// conversation is the follow-up now; the next scheduled touch should land
// only if that conversation goes quiet again. Idempotent: each reply moves a
// step at most once, so a re-run after a sync changes nothing.
const REPLY_HOLD_DAYS = 3;
export function adaptToReplies() {
  let moved = 0;
  const latestIn = new Map();
  store.all("texts").forEach((t) => {
    if (t.dir !== "in" || !t.leadId) return;
    const at = String(t.at || t.createdAt || "");
    if (!latestIn.has(t.leadId) || at > latestIn.get(t.leadId)) latestIn.set(t.leadId, at);
  });
  if (!latestIn.size) return 0;
  store.bulk(() => {
    store.all("tasks").forEach((t) => {
      if (!t.cadence || t.done || !t.leadId || t.channel !== "text") return;
      const at = latestIn.get(t.leadId);
      if (!at || (t.adaptedFor && t.adaptedFor >= at)) return;
      const hold = addDaysISO(REPLY_HOLD_DAYS, new Date(at));
      if (t.due && t.due <= hold) { store.update("tasks", t.id, { due: hold, adaptedFor: at }); moved++; }
      else store.update("tasks", t.id, { adaptedFor: at });
    });
  });
  return moved;
}

// The plan, in a sentence, for the customer's page and the voice reply.
export function planSummary(leadId) {
  const steps = planSteps(leadId);
  if (!steps.length) return "";
  const next = steps[0];
  const total = next.of || steps.length;
  const texts = steps.filter((t) => t.channel === "text").length;
  const calls = steps.filter((t) => t.channel === "call").length;
  return `${steps.length} of ${total} steps to go — ${texts} text${texts === 1 ? "" : "s"}, ${calls} call${calls === 1 ? "" : "s"}. Next: ${next.title.replace(/^\w+ \S+ — /, "")} on ${next.due}.`;
}
