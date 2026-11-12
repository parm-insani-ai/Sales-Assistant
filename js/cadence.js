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
import { localISO, slotOn, toReadyAt, sameTimeOn } from "./schedule.js";

function firstName(name) {
  return String(name || "there").trim().split(/\s+/)[0];
}
export function addDaysISO(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- The patterns ----
// intent is what the text is *for*; the drafter turns it into words for this
// customer. Calls carry a one-line purpose for the salesperson instead.
// `after` is minutes from the moment the customer was added: the day-zero
// steps are timed, not just dated, because the first hour is where the
// evidence is least ambiguous — a lead reached inside five minutes is many
// times more likely to be contacted at all than one reached after thirty.
// The welcome text is drafted the moment they're added and shown at once, so
// the salesperson knows it's done — but it stays locked for its five minutes
// (heldTouches), because a text that lands on the customer's heels reads as
// a machine, not a person.
// After the first month a lead that hasn't bought is early, not dead: a
// touch a month to a year, call and text alternating, each with a reason
// the drafter finds in their file — the month their timeline named, new
// stock in their model, a program.
export const NURTURE = [
  { day: 60,  channel: "call", intent: "nurture", label: "Two-month call" },
  { day: 90,  channel: "text", intent: "nurture", label: "Three-month check-in" },
  { day: 120, channel: "call", intent: "nurture", label: "Four-month call" },
  { day: 150, channel: "text", intent: "nurture", label: "Five-month check-in" },
  { day: 180, channel: "call", intent: "nurture", label: "Six-month call" },
  { day: 210, channel: "text", intent: "nurture", label: "Seven-month check-in" },
  { day: 240, channel: "call", intent: "nurture", label: "Eight-month call" },
  { day: 270, channel: "text", intent: "nurture", label: "Nine-month check-in" },
  { day: 300, channel: "call", intent: "nurture", label: "Ten-month call" },
  { day: 330, channel: "text", intent: "nurture", label: "Eleven-month check-in" },
  { day: 365, channel: "text", intent: "nurture", label: "One-year check-in" },
];

// Came in, looked, left without buying — added after the visit. The welcome
// text five minutes on; the call the next morning, with the answer to the
// one thing they asked; then the rhythm through the first month.
export const SHOWROOM_PLAN = [
  { day: 0,  after: 5, channel: "text", intent: "intro",    label: "Welcome text — thanks for coming in, and what you noted" },
  { day: 1,  channel: "call", intent: "intro",    label: "Next-morning call — the answer to what they asked, and a time" },
  { day: 2,  channel: "text", intent: "value",    label: "Value text — something specific to what they asked for" },
  { day: 4,  channel: "text", intent: "options",  label: "Options text — two ways to get them there" },
  { day: 7,  channel: "call", intent: "week",     label: "One-week call — where are they at" },
  { day: 10, channel: "text", intent: "nudge",    label: "Light nudge — anything changed?" },
  { day: 14, channel: "call", intent: "twoweek",  label: "Two-week call" },
  { day: 21, channel: "text", intent: "fresh",    label: "Something new — fresh stock, a program, a reason to look again" },
  { day: 30, channel: "text", intent: "month",    label: "30-day check-in" },
  ...NURTURE,
];
// The old name, kept for anything that still asks for it.
export const INTEREST_PLAN = SHOWROOM_PLAN;

// An enquiry that arrived over the internet or the phone is a race, not a
// visit: they are shopping right now, probably at several dealers, and the
// first store to actually reach them usually gets the appointment. So the
// first hour is call, text, call — the sequence with the best contact rate on
// record — then an email with the booking link and what they asked about,
// and a call-and-text day one if nobody has been reached. The welcome text
// says "thanks for reaching out".
export const INBOUND_DAY0 = [
  { day: 0, after: 2,  channel: "call",  intent: "intro", label: "Call now — they're shopping this minute" },
  { day: 0, after: 5,  channel: "text",  intent: "intro", label: "Welcome text — thanks for reaching out, and what you noted" },
  { day: 0, after: 20, channel: "call",  intent: "intro", label: "Second call — most connects happen on the second try" },
  { day: 0, after: 60, channel: "email", intent: "intro", label: "Intro email — what they asked about, and the booking link", needsEmail: true },
];
export const INBOUND_PLAN = [
  ...INBOUND_DAY0,
  { day: 1,  channel: "call", intent: "check",    label: "Day-one call — still shopping? offer a time", hh: 10, mm: 30 },
  { day: 1,  channel: "text", intent: "value",    label: "Day-one text — something specific to what they asked for", hh: 15, mm: 15 },
  { day: 2,  channel: "text", intent: "options",  label: "Options text — two ways to get them there" },
  { day: 3,  channel: "call", intent: "check",    label: "Day-three call — answer questions, offer a time" },
  { day: 5,  channel: "text", intent: "time",     label: "Two times to come in" },
  { day: 7,  channel: "call", intent: "week",     label: "One-week call — where are they at" },
  { day: 10, channel: "text", intent: "nudge",    label: "Light nudge — anything changed?" },
  { day: 14, channel: "call", intent: "twoweek",  label: "Two-week call" },
  { day: 21, channel: "text", intent: "fresh",    label: "Something new — fresh stock, a program, a reason to look again" },
  { day: 30, channel: "text", intent: "month",    label: "30-day check-in" },
  ...NURTURE,
];

// Came in for an appointment and left without buying: the most likely
// person in the book to buy this week. Replaces whatever was queued. The
// thank-you within the hour names the one thing you promised to find out;
// the next day's call brings it, or a second option.
export const VISIT_PLAN = [
  { day: 0,  after: 60, channel: "text", intent: "visit",   label: "Thank-you text — the one thing you promised to find out" },
  { day: 1,  channel: "call", intent: "visit",   label: "Day-after call — the answer, or a second option, and a time", hh: 10, mm: 30 },
  { day: 2,  channel: "text", intent: "time",    label: "Two times to come back" },
  { day: 4,  channel: "call", intent: "check",   label: "Day-four call — what's holding it up" },
  { day: 7,  channel: "text", intent: "options", label: "Options text — two ways to get them there" },
  { day: 10, channel: "call", intent: "week",    label: "Day-ten call" },
  { day: 14, channel: "text", intent: "nudge",   label: "Light nudge — anything changed?" },
  { day: 21, channel: "call", intent: "twoweek", label: "Three-week call" },
  { day: 30, channel: "text", intent: "month",   label: "30-day check-in" },
  ...NURTURE,
];

// Didn't turn up. Half of no-shows rebook if reached the same day: a text
// fifteen minutes after the slot, a call an hour on, two times the next
// morning, then a call and a text. The plan they were on resumes after.
export const NOSHOW_PLAN = [
  { day: 0, after: 15, channel: "text", intent: "noshow", label: "Did I miss you? — an easy way to rebook" },
  { day: 0, after: 60, channel: "call", intent: "noshow", label: "Call — rebook while it's fresh" },
  { day: 1, channel: "text", intent: "time",   label: "Two times to come in", hh: 10, mm: 15 },
  { day: 3, channel: "call", intent: "noshow", label: "Day-three call — rebook" },
  { day: 7, channel: "text", intent: "nudge",  label: "Light nudge — the door's open" },
];

export function isInbound(lead) {
  return /internet|phone|web|online|text|book|email|facebook|bdc|chat/i.test(String((lead && lead.source) || ""));
}

// Which plan fits this customer. An owner already in a car is worked with the
// salesperson's own sequence from Settings (softer, longer); anyone who came
// in wanting a vehicle gets the showroom plan, or the inbound one when they
// enquired rather than visited.
export function planFor(lead) {
  if (!lead) return [];
  const owner = ["sold", "delivered"].includes(lead.stage) || lead.currentPayment != null || lead.payoff != null || lead.purchaseDate;
  if (owner) return (store.getSettings().cadence || []).map((s) => ({ ...s, intent: s.intent || "nurture" }));
  return isInbound(lead) ? INBOUND_PLAN : SHOWROOM_PLAN;
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
  return startPlan(leadId, planFor(lead), { kind: "plan" });
}

/**
 * Create a plan's tasks for a customer from `steps`, as `kind` ("plan",
 * "visit", "noshow"). `from` is the moment day zero counts from (the
 * appointment's time for a no-show, now otherwise). Returns how many.
 */
export function startPlan(leadId, steps, { kind = "plan", from = null } = {}) {
  const lead = store.get("leads", leadId);
  if (!lead || !steps || !steps.length) return 0;
  const fn = firstName(lead.name);
  const now = Date.now();
  const base = from ? new Date(from).getTime() : now;
  const usable = steps.filter((step) => !(step.needsEmail && !String(lead.email || "").trim()));
  let created = 0;
  store.bulk(() => {
    usable.forEach((step, i) => {
      const verb = step.channel === "text" ? "Text" : step.channel === "email" ? "Email" : "Call";
      // Every step has a clock time, not just a day: a timed day-zero step
      // at its minute (never before now); a dated one at the hour its
      // channel works best — texts mid-morning, calls late morning, emails
      // first thing — inside business hours, or the hour the step names.
      const at = step.after != null
        ? localISO(new Date(Math.max(now + 60000, base + step.after * 60000)))
        : slotOn(addDaysISO(step.day || 0, new Date(base)), step.hh != null ? step.hh : step.channel === "call" ? 11 : step.channel === "email" ? 9 : 10, step.mm != null ? step.mm : step.channel === "text" ? 15 : 0);
      store.create("tasks", {
        title: `${verb} ${fn} — ${step.label}`,
        due: at.slice(0, 10),
        at,
        readyAt: toReadyAt(at),
        priority: (step.day || 0) <= 2 ? "high" : "normal",
        done: false,
        leadId,
        cadence: true,
        kind,
        channel: step.channel,
        intent: step.intent || "",
        step: i + 1,
        of: usable.length,
      });
      created++;
    });
  });
  return created;
}

// ---- The plans an appointment's outcome starts ----

const recentPlan = (leadId, kind, hours = 24) => store.all("tasks").some((t) => t.leadId === leadId && t.kind === kind && new Date(t.createdAt || 0).getTime() > Date.now() - hours * 3600000);

/**
 * They came in and didn't buy: the open plan steps are retired and the
 * visit plan takes over from this moment. Once per visit.
 */
export function startVisitPlan(leadId, { at = null } = {}) {
  const lead = store.get("leads", leadId);
  if (!lead || ["sold", "delivered", "lost"].includes(lead.stage)) return 0;
  if (recentPlan(leadId, "visit")) return 0;
  store.bulk(() => {
    store.all("tasks").filter((t) => t.leadId === leadId && t.cadence && !t.postDelivery && !t.done && t.kind !== "noshow")
      .forEach((t) => store.update("tasks", t.id, { done: true, doneBy: "replaced", doneAt: new Date().toISOString() }));
  });
  return startPlan(leadId, VISIT_PLAN, { kind: "visit", from: at });
}

/**
 * They didn't turn up: the recovery sequence starts from the slot's time,
 * and whatever plan they were on steps back a week to let it run.
 */
export function startNoShowPlan(leadId, { at = null } = {}) {
  const lead = store.get("leads", leadId);
  if (!lead || ["sold", "delivered", "lost"].includes(lead.stage)) return 0;
  if (recentPlan(leadId, "noshow")) return 0;
  deferPlan(leadId, addDaysISO(6));
  return startPlan(leadId, NOSHOW_PLAN, { kind: "noshow", from: at });
}

// Has this step's moment arrived? Dated steps are ready on their day; timed
// ones at their minute.
export function isReady(task, now = Date.now()) {
  if (!task || task.done) return false;
  if (task.readyAt) return new Date(task.readyAt).getTime() <= now;
  const today = new Date(now).toISOString().slice(0, 10);
  return !!task.due && task.due <= today;
}

// Timed texts whose moment has come in the last day and that nobody has sent
// — the welcome text five minutes after a customer was added, above all.
// This is what the "right now" list and the server's push both ask for.
const READY_WINDOW_MS = 24 * 3600 * 1000;
export function readyTouches(now = Date.now()) {
  return store.all("tasks").filter((t) => {
    if (!t.cadence || t.done || t.channel !== "text" || !t.readyAt) return false;
    const at = new Date(t.readyAt).getTime();
    return at <= now && now - at < READY_WINDOW_MS;
  }).sort((a, b) => String(a.readyAt).localeCompare(String(b.readyAt)));
}

// Timed texts drafted and waiting out their hold — the welcome text in the
// five minutes after a customer was added. They're on screen from the start
// (the salesperson sees the task is done) with sending locked until their
// minute. Anything further out than the hold is just a scheduled step.
const HELD_WINDOW_MS = 15 * 60 * 1000;
export function heldTouches(now = Date.now()) {
  return store.all("tasks").filter((t) => {
    if (!t.cadence || t.done || t.channel !== "text" || !t.readyAt) return false;
    const at = new Date(t.readyAt).getTime();
    return at > now && at - now <= HELD_WINDOW_MS;
  }).sort((a, b) => String(a.readyAt).localeCompare(String(b.readyAt)));
}

// When this text may be sent, as an ISO instant, or null if it may go now.
export function lockedUntil(task, now = Date.now()) {
  if (!task || !task.readyAt) return null;
  const at = new Date(task.readyAt).getTime();
  return isFinite(at) && at > now ? new Date(at).toISOString() : null;
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
      // The welcome text stays where it is. It's the thank-you for the
      // visit, five minutes after they're added — not a follow-up step —
      // and "coming in Saturday" in the note was pushing it to Sunday,
      // so the customer just added had nothing on Right now.
      if (t.intent === "intro" && t.channel === "text") return;
      if (t.due && t.due <= until) {
        const at = t.at ? sameTimeOn(t.at, after) : null;
        store.update("tasks", t.id, { due: after, at, readyAt: at ? toReadyAt(at) : t.readyAt, deferredFor: "appointment" });
        moved++;
      }
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
      if (t.due && t.due <= hold) {
        const when = t.at ? sameTimeOn(t.at, hold) : null;
        store.update("tasks", t.id, { due: hold, at: when, readyAt: when ? toReadyAt(when) : t.readyAt, adaptedFor: at });
        moved++;
      }
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
