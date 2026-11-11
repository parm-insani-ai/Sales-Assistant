// The calling session.
//
// Cold outreach is a volume game, and a list is the wrong shape for it: the
// salesperson reads, scrolls, decides, dials, comes back, finds the card,
// taps, scrolls on. A session is the same work with the shape taken out —
// one customer on the screen at a time: who, the one reason that matters,
// a line to open with in the salesperson's own voice, what to say to the
// three likely objections, and the number. One tap dials. Back from the
// call, the outcomes are already up. Each outcome does its own paperwork
// — the contact logged, the follow-up it implies put on the queue, a wrong
// number retired from every future list — and the next customer is up.
//
// The session is kept on the phone (a call takes you to the Phone app and
// the webview may be reloaded underneath), and the summary at the end is
// the number a rep can move week over week: dials, reached, appointments,
// time on the phone.

import * as store from "./store.js";
import { getProspects } from "./prospects.js";
import { hasCadence, addDaysISO } from "./cadence.js";
import { slotOn, toReadyAt } from "./schedule.js";
import { categoryOf, assessment } from "./assess.js";
import { orderForNow, retrySlot, bestTime, PARTS } from "./reachtime.js";
import { consentStatus } from "./consent.js";
import { attemptsFor } from "./coverage.js";
import { openSlots } from "./slots.js";

// Two open times from the calendar, in words, for a text that offers them.
function twoTimes() { try { return openSlots().map((s) => s.label); } catch { return []; } }

const KEY = "viniva:session";
const DAY = 86400000;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const todayK = () => new Date().toISOString().slice(0, 10);

// ---- The session record ----

function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
function write(s) { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* a convenience */ } }

// Who's up for a session: today's batch, still open, with a number that
// works — the people likely to pick up in this part of the day first
// (reachtime.js), and in the batch's order, best first, among equals.
export function sessionQueue(now = new Date()) {
  const open = getProspects().filter((c) => c.lead.phone && !c.lead.badPhone);
  // Anyone who texted back in the last three days is warm: they go first.
  const since = now.getTime() - 3 * DAY;
  const replied = new Set(store.all("texts").filter((t) => t.dir === "in" && t.leadId && new Date(t.at || t.createdAt || 0).getTime() >= since).map((t) => t.leadId));
  // Then the callbacks due: people already tried, whose next of six is due
  // today — a third attempt at the hour that works for them beats a first
  // attempt on a stranger. In the order they're likely to answer now.
  const have = new Set(open.map((c) => c.lead.id));
  const due = dueCallbacks(now).filter((c) => !have.has(c.lead.id));
  const warm = open.filter((c) => replied.has(c.lead.id)), cold = open.filter((c) => !replied.has(c.lead.id));
  return [...warm, ...orderForNow(due, { now }), ...orderForNow(cold, { now })];
}

/**
 * The sequence's calls due today or overdue, with a number that works,
 * not reached since: [{ lead, task, attempt, reasons, why, callback: true }].
 */
export function dueCallbacks(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const seen = new Set();
  const out = [];
  store.all("tasks").filter((t) => t && t.sequence && !t.done && t.leadId && t.channel === "call" && t.due && t.due <= today)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .forEach((t) => {
      if (seen.has(t.leadId)) return;
      const l = store.get("leads", t.leadId);
      if (!l || !l.phone || l.badPhone || l.doNotContact || ["sold", "lost"].includes(l.stage)) return;
      // Reached since the task was set: the chase is over.
      if (l.lastContactOutcome === "reached" && l.lastContacted && l.lastContacted >= String(t.createdAt || "")) return;
      seen.add(t.leadId);
      const n = t.attempt || attemptCount(l.id, now) + 1;
      const a = (() => { try { return assessment(l.id); } catch { return null; } })();
      out.push({ lead: l, task: t, attempt: n, callback: true, score: a ? a.score : 0, reasons: a ? a.reasons : [], why: a ? a.whySafe : [], whySafe: a ? a.whySafe : [], best: a ? a.best : null, cat: a ? a.cat : "other" });
    });
  return out;
}

/** Start a session over these customers (today's batch by default). */
export function startSession(ids = null, { name = "" } = {}) {
  const list = ids || sessionQueue().map((c) => c.lead.id);
  // A session over a cut or a saved list is its own thing: today's batch
  // doesn't flow into it.
  const s = { day: todayK(), startedAt: new Date().toISOString(), ids: list, idx: 0, done: [], endedAt: null, kind: ids ? "list" : "batch", name };
  write(s);
  store.logEvent("session_start", { meta: { count: list.length, kind: s.kind, name } });
  return s;
}

/** The session under way today, if any: { ids, idx, done, startedAt, left, total }. */
export function currentSession() {
  const s = read();
  if (!s || s.day !== todayK() || s.endedAt) return null;
  return { ...s, total: s.ids.length, left: s.ids.filter((id) => !doneFor(s, id)).length };
}

/**
 * The customer on the screen, with what's been recorded for them in this
 * session, if anything: { lead, i, of, done }. Null when there's nobody at
 * the position (an empty session). A record deleted under the session is
 * stepped over.
 */
export function currentCustomer() {
  const s = currentSession();
  if (!s || !s.ids.length) return null;
  for (let step = 0; step < s.ids.length; step++) {
    const i = (s.idx + step) % s.ids.length;
    const lead = store.get("leads", s.ids[i]);
    if (lead) {
      if (i !== s.idx) write({ ...read(), idx: i });
      return { lead, i, of: s.ids.length, done: doneFor(s, lead.id) };
    }
  }
  return null;
}

/** What's been recorded for a customer in this session, or null. */
export function doneFor(s, leadId) {
  return (s && s.done || []).find((d) => d.id === leadId) || null;
}

/** Everyone in the session, in order, with their state: [{ id, name, outcome, i }]. */
export function roster() {
  const s = currentSession();
  if (!s) return [];
  return s.ids.map((id, i) => { const l = store.get("leads", id); const d = doneFor(s, id); return { id, i, name: l ? l.name : "", outcome: d ? d.outcome : null, current: i === s.idx }; });
}

/** Move to a position, or by a step — back and forth, around the ends. */
export function goTo(i) {
  const s = read();
  if (!s || !s.ids.length) return;
  const n = s.ids.length;
  write({ ...s, idx: ((Number(i) % n) + n) % n });
}
export function goNext() { const s = read(); if (s) goTo(s.idx + 1); }
export function goPrev() { const s = read(); if (s) goTo(s.idx - 1); }

/** The next position after `from` with no outcome yet, or -1 when everyone has one. */
export function nextOpen(from = null) {
  const s = read();
  if (!s || !s.ids.length) return -1;
  const start = from == null ? s.idx : from;
  for (let step = 1; step <= s.ids.length; step++) {
    const i = (start + step) % s.ids.length;
    if (!doneFor(s, s.ids[i])) return i;
  }
  return -1;
}

/** Skip: on to the next one. (Kept for the old name; nothing is reordered.) */
export function skipCurrent() { goNext(); }

/** A session under way picks up anyone the batch has brought up since it started. */
export function extendSession() {
  const s = read();
  if (!s || s.day !== todayK() || s.endedAt || s.kind === "list") return 0;
  const have = new Set(s.ids);
  const more = sessionQueue().map((c) => c.lead.id).filter((id) => !have.has(id));
  if (more.length) write({ ...s, ids: [...s.ids, ...more] });
  return more.length;
}

function recordDone(id, entry) {
  const s = read();
  if (!s) return;
  s.done = s.done.filter((d) => d.id !== id);
  s.done.push({ id, at: new Date().toISOString(), ...entry });
  // On to the next one without an answer; with everyone answered, stay.
  const next = nextOpen(s.ids.indexOf(id) >= 0 ? s.ids.indexOf(id) : s.idx);
  if (next >= 0) s.idx = next;
  write(s);
}

/**
 * Take back what was recorded for a customer in this session — the contact
 * record, the follow-ups it put on the queue, the park, the retired number
 * — so a different answer can be given. An appointment booked stays on the
 * calendar (it's theirs to cancel). Returns true when something was undone.
 */
export function revertOutcome(leadId) {
  const s = read();
  const d = s && doneFor(s, leadId);
  if (!d) return false;
  const prev = d.prev || {};
  store.bulk(() => {
    if (d.recId && store.get("calls", d.recId)) store.remove("calls", d.recId);
    (d.taskIds || []).forEach((tid) => { if (store.get("tasks", tid)) store.remove("tasks", tid); });
    if (store.get("leads", leadId)) {
      const back = {};
      ["lastContacted", "lastContactVia", "lastContactOutcome", "loggedAt", "followUp", "prospectSnoozedUntil", "notInterestedAt", "badPhone", "badPhoneAt", "lastConversationOutcome", "lastConversationAt", "stage"].forEach((k) => { if (k in prev) back[k] = prev[k] == null ? null : prev[k]; });
      if (Object.keys(back).length) store.update("leads", leadId, back);
    }
    // The call stays on the event log, marked undone, so the readout
    // doesn't count it (outcomes.js).
    if (d.eventId && store.get("events", d.eventId)) { const e = store.get("events", d.eventId); store.update("events", d.eventId, { meta: { ...(e.meta || {}), undone: true } }); }
  });
  s.done = s.done.filter((x) => x.id !== leadId);
  write(s);
  return true;
}

/** Close the session. Returns the summary. */
export function endSession() {
  const s = read();
  if (!s) return null;
  const sum = summarize({ ...s, endedAt: new Date().toISOString() });
  write(null);
  store.logEvent("session_end", { meta: { dials: sum.dials, reached: sum.reached, appointments: sum.appointments, minutes: sum.minutes } });
  return sum;
}

/** The numbers: dials, reached, messages, no answers, appointments set, minutes. */
export function summarize(s = read()) {
  if (!s) return null;
  const done = s.done.filter((d) => d.outcome !== "skipped");
  const since = new Date(s.startedAt).getTime();
  const ids = new Set(s.ids);
  const appointments = store.all("appointments").filter((a) => a.leadId && ids.has(a.leadId) && a.status !== "cancelled" && new Date(a.createdAt || a.when || 0).getTime() >= since).length;
  const count = (o) => done.filter((d) => d.outcome === o).length;
  const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
  return {
    dials: done.length,
    reached: done.filter((d) => SPOKE.has(d.outcome)).length,
    voicemail: count("voicemail"), noAnswer: count("no_answer"), wrongNumber: count("wrong_number"), notInterested: count("not_interested"),
    callbacks: count("callback"), interested: count("interested"), notNow: count("not_now"), boughtElsewhere: count("bought_elsewhere"),
    appointments,
    minutes: Math.max(1, Math.round((end - since) / 60000)),
    total: s.ids.length, left: s.ids.filter((id) => !doneFor(s, id)).length,
  };
}

// ---- Outcomes, each with its paperwork ----

export const OUTCOMES = [
  { key: "reached", label: "Spoke", icon: "check", kind: "ok", hint: "A conversation — say how it went, and it goes on their file" },
  { key: "appointment", label: "Appointment", icon: "calendar", kind: "ok", hint: "Book them in now" },
  { key: "voicemail", label: "Left a message", icon: "message", kind: "later", hint: "Counts as a miss — the next of six is queued" },
  { key: "no_answer", label: "No answer", icon: "phone", kind: "later", hint: "The next of six is queued, when they tend to pick up" },
  { key: "not_interested", label: "Not interested", icon: "logout", kind: "off", hint: "A conversation — parked six months" },
  { key: "wrong_number", label: "Wrong number", icon: "alert", kind: "off", hint: "Off every list until a new number" },
];
// What came of a conversation — the outcome that goes on their file once
// they've been spoken with. Each is a "Spoke" with its own paperwork.
export const CONVERSATION_OUTCOMES = [
  { key: "appointment", label: "Booked", icon: "calendar", hint: "Book them in" },
  { key: "callback", label: "Call back", icon: "clock", hint: "They said when — a call is set for then" },
  { key: "interested", label: "Interested", icon: "sparkles", hint: "Wants to see numbers — a text with two times to come in, today" },
  { key: "not_now", label: "Not now", icon: "bell", hint: "Nothing for six months — back then" },
  { key: "not_interested", label: "Not interested", icon: "logout", hint: "Parked six months" },
  { key: "bought_elsewhere", label: "Bought elsewhere", icon: "car", hint: "Off the lists for a year; their new car's dates are worth having" },
];
// How long "call back" means, when they didn't say: pick one.
export const CALLBACK_WHEN = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "week", label: "Next week", days: 7 },
  { key: "month", label: "Next month", days: 30 },
  { key: "quarter", label: "In 3 months", days: 90 },
];
const SPOKE = new Set(["reached", "appointment", "callback", "interested", "not_now", "not_interested", "bought_elsewhere"]);
export const isConversation = (key) => SPOKE.has(key);

// The hour to try someone again who didn't pick up: the part of the day
// that works for them when it's known, else the other half of the day
// from the attempt (reachtime.js).
export function otherHalf(leadId, now = new Date()) {
  return retrySlot(leadId, now);
}

function followUpTask(lead, { days, hh, mm = 0, channel, intent, title, priority = "normal", extra = {} }) {
  const at = slotOn(addDaysISO(days), hh, mm);
  return store.create("tasks", { title, due: at.slice(0, 10), at, readyAt: toReadyAt(at), priority, done: false, leadId: lead.id, channel, intent, from: "session", ...extra });
}

// ---- Six attempts, by rule ----
//
// About 93% of the people who ever convert are reached by the sixth
// attempt, and most reps stop after one or two. The goal is a conversation,
// and only a call or a reply is one — a message left is a miss, a text
// nobody answered is a miss — so the sequence is calls, with two texts
// whose only job is to get a time or a reply: call · a text two hours on
// asking when's good · a call the next day in the other half · a call on
// day three when they tend to pick up · a text on day four with two times
// to catch them · a call on day six in the part of the day not yet tried.
// Then sixty days' rest and another round. Each miss queues the next; a
// reply ends the chase (coverage.js). The card says which attempt this is.
export const ATTEMPTS = 6, ATTEMPT_WINDOW_DAYS = 21, REST_DAYS = 60;
// Attempts on this person in the window: unanswered calls, and texts sent.
export function attemptCount(leadId, now = new Date()) {
  return attemptsFor(leadId, now.getTime());
}
// The next touch after a miss, by how many there have been. `other` is the
// other half of the day (or when they tend to pick up); `untried` the part
// of the day no attempt has landed in yet.
const NEXT = [null,
  { channel: "text", days: 0, hours: 2, intent: "missed" },   // after 1: a text the same day — when's good?
  { channel: "call", days: 1, other: true },                  // after 2: tomorrow, the other half
  { channel: "call", days: 2, other: true },                  // after 3: a call in two days, when they pick up
  { channel: "text", days: 1, intent: "time" },               // after 4: a text with two times to catch them
  { channel: "call", days: 2, untried: true },                // after 5: a call in two days, a part of the day not yet tried
];
// A part of the day with no attempt in it yet, for the last call of the
// round: if mornings and afternoons have missed, the evening is the one
// left to try. Null when every part has been tried.
function untriedPart(leadId, now) {
  const since = now.getTime() - ATTEMPT_WINDOW_DAYS * DAY;
  const tried = new Set(store.all("calls").filter((c) => c && c.leadId === leadId && c.dir !== "in" && (c.via || "call") === "call" && new Date(c.at).getTime() >= since).map((c) => { const h = new Date(c.at).getHours(); return (PARTS.find((p) => h >= p.from && h < p.to) || PARTS[0]).key; }));
  const to = Number(store.getSettings().hoursTo ?? 18);
  const open = PARTS.filter((p) => !tried.has(p.key) && p.from < to);
  if (!open.length) return null;
  // Evenings connect best of the parts people skip; prefer the latest open one.
  return open[open.length - 1];
}
const inPlan = (leadId) => store.all("tasks").some((t) => t.leadId === leadId && t.cadence && !t.sequence && !t.done);
/**
 * A miss just happened: put the next touch on the queue (or rest them after
 * the sixth). Returns { n, task, rested, line }. The open sequence task for
 * them, if any, is replaced.
 */
export function scheduleNextAttempt(leadId, { now = new Date() } = {}) {
  const lead = store.get("leads", leadId);
  if (!lead) return null;
  const fn = firstName(lead.name);
  const n = Math.max(1, attemptCount(leadId, now));
  store.bulk(() => store.all("tasks").filter((t) => t.leadId === leadId && t.sequence && !t.done).forEach((t) => store.remove("tasks", t.id)));
  // A plan already working them has its own touches.
  if (inPlan(leadId)) return { n, task: null, rested: false, line: `attempt ${n} of ${ATTEMPTS} — their plan carries on.` };
  if (n >= ATTEMPTS) {
    const until = new Date(now.getTime() + REST_DAYS * DAY).toISOString().slice(0, 10);
    store.update("leads", leadId, { prospectSnoozedUntil: until, restedAt: now.toISOString(), restedAfter: n });
    return { n, task: null, rested: true, until, line: `attempt ${n} of ${ATTEMPTS} — that's six; resting them until ${until}.` };
  }
  const step = NEXT[n] || NEXT[NEXT.length - 1];
  const canText = !!lead.phone && !lead.badPhone && consentStatus(lead).ok;
  const next = n + 1;
  let task;
  if (step.channel === "text" && canText) {
    const at = step.days === 0 ? localLater(now, step.hours || 2) : slotOn(addDaysISO(step.days), 10, 15);
    const what = step.intent === "time" ? "two times to catch them" : "asking when's good";
    task = store.create("tasks", { title: `Text ${fn} — attempt ${next} of ${ATTEMPTS}, ${what}`, due: at.slice(0, 10), at, readyAt: toReadyAt(at), priority: "normal", done: false, leadId, channel: "text", intent: step.intent || "missed", cadence: true, sequence: true, attempt: next, of: ATTEMPTS, from: "session", ...(step.intent === "time" ? { why: twoTimes() } : {}) });
    return { n, task, rested: false, line: `attempt ${n} of ${ATTEMPTS} — a text ${step.days === 0 ? "in a couple of hours" : `in ${step.days} day${step.days === 1 ? "" : "s"}`}, ${what}.` };
  }
  // A call (or a text they can't be sent): when they tend to pick up, the
  // day's other half, or — for the last call of the round — the part of
  // the day nobody has tried them in.
  const days = step.channel === "text" ? Math.max(1, step.days) : step.days;
  let oh = retrySlot(leadId, now);
  if (step.untried && !bestTime(leadId)) { const u = untriedPart(leadId, now); if (u) oh = { key: u.key, label: u.label, hh: u.hh, mm: u.mm, word: u.label.replace(/^around /, ""), known: false, untried: true }; }
  task = followUpTask(lead, { days, hh: oh.hh, mm: oh.mm, channel: "call", intent: "retry", title: `Call ${fn} again — attempt ${next} of ${ATTEMPTS} · ${oh.known ? "they tend to pick up" : oh.untried ? "not yet tried" : "try the"} ${oh.word}`, extra: { sequence: true, attempt: next, of: ATTEMPTS } });
  return { n, task, rested: false, line: `attempt ${n} of ${ATTEMPTS} — a call ${days === 1 ? "tomorrow" : `in ${days} days`}, ${oh.known ? "when they tend to pick up: " : oh.untried ? "a part of the day not tried yet: " : ""}${oh.word}.` };
}
// A clock time a few hours on, inside the working day (else the next slot).
function localLater(now, hours) {
  const d = new Date(now.getTime() + hours * 3600000);
  const s = store.getSettings();
  const to = Number(s.hoursTo ?? 18);
  if (d.getHours() >= to) return slotOn(addDaysISO(1), 10, 15);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Record what came of the call, do the paperwork it implies, move on.
 * Returns { rec, line, tasks } — `line` is what to tell the salesperson.
 */
export function recordOutcome(leadId, key, { notes = "", now = new Date(), when = null } = {}) {
  const lead = store.get("leads", leadId);
  if (!lead) return null;
  const fn = firstName(lead.name);
  const canText = (() => { try { return !!lead.phone && !store.optedOut(lead); } catch { return false; } })();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // A conversation ends the chase: the open attempts on them come off.
  const stopChase = () => store.all("tasks").filter((t) => t.leadId === leadId && t.sequence && !t.done).forEach((t) => store.remove("tasks", t.id));
  // Why the call was made and which opener it led with — so Coach can say,
  // in a few weeks, which reasons and which phrasings book (outcomes.js).
  const a = (() => { try { return assessment(leadId); } catch { return null; } })();
  const why = a ? callScript(a) : { cat: "other", variant: "a" };
  // A second answer for the same customer takes the first one back first.
  const changed = revertOutcome(leadId);
  const was = store.get("leads", leadId);
  const prev = { lastContacted: was.lastContacted || null, lastContactVia: was.lastContactVia || null, lastContactOutcome: was.lastContactOutcome || null, loggedAt: was.loggedAt || null, followUp: was.followUp || null, prospectSnoozedUntil: was.prospectSnoozedUntil || null, notInterestedAt: was.notInterestedAt || null, badPhone: !!was.badPhone, badPhoneAt: was.badPhoneAt || null, lastConversationOutcome: was.lastConversationOutcome || null, lastConversationAt: was.lastConversationAt || null, stage: was.stage };
  let rec = null, line = "", tasks = [], ev = null;
  store.bulk(() => {
    if (key === "reached" || key === "appointment") {
      rec = store.logContact(leadId, { via: "call", outcome: "reached", notes });
      stopChase();
      store.update("leads", leadId, { lastConversationAt: rec.at, lastConversationOutcome: key === "appointment" ? "appointment" : "spoke" });
      store.update("calls", rec.id, { conversationOutcome: key === "appointment" ? "appointment" : "spoke" });
      line = key === "appointment" ? `Spoke with ${fn} — book them in.` : `Spoke with ${fn} — on their file. How did it go?`;
    } else if (key === "callback" || key === "interested" || key === "not_now" || key === "bought_elsewhere") {
      // A conversation with a next step: the step is the paperwork.
      rec = store.logContact(leadId, { via: "call", outcome: "reached", notes });
      stopChase();
      store.update("calls", rec.id, { conversationOutcome: key, ...(when ? { callbackAt: when } : {}) });
      const patch = { lastConversationAt: rec.at, lastConversationOutcome: key };
      if (key === "callback") {
        // "Call me back Thursday" / next week / next month: a call on the
        // queue for then, at the hour they picked up today.
        const at = when ? String(when) : slotOn(addDaysISO(7), now.getHours() >= 8 && now.getHours() < 21 ? now.getHours() : 10, 0);
        const dueDay = at.slice(0, 10);
        const t = store.create("tasks", { title: `Call ${fn} back — they asked for it`, due: dueDay, at: at.length > 10 ? at : null, readyAt: at.length > 10 ? toReadyAt(at) : null, priority: "high", done: false, leadId, channel: "call", intent: "callback", from: "session" });
        tasks.push(t);
        patch.followUp = dueDay;
        line = `Spoke with ${fn} — calling them back ${relDay(dueDay, now)}.`;
      } else if (key === "interested") {
        // Wants numbers: a text today with two times to come in, and the
        // follow-up plan takes them from here.
        const at = localLater(now, 1);
        const t = store.create("tasks", { title: `Text ${fn} two times to come in — they're interested`, due: at.slice(0, 10), at, readyAt: toReadyAt(at), priority: "high", done: false, leadId, channel: "text", intent: "time", cadence: true, from: "session", why: twoTimes() });
        tasks.push(t);
        patch.followUp = at.slice(0, 10);
        if (!["appointment", "negotiating", "sold", "delivered"].includes(lead.stage)) patch.stage = "working";
        line = `Spoke with ${fn} — interested. A text with two times to come in is queued for this afternoon.`;
      } else if (key === "not_now") {
        const until = ymd(new Date(now.getTime() + 180 * DAY));
        patch.prospectSnoozedUntil = until; patch.followUp = until;
        const t = store.create("tasks", { title: `Check back with ${fn} — said not now in ${now.toLocaleDateString("en-CA", { month: "long" })}`, due: until, priority: "normal", done: false, leadId, channel: "call", intent: "checkback", from: "session" });
        tasks.push(t);
        line = `Spoke with ${fn} — not now. Back to them ${new Date(until + "T12:00:00").toLocaleDateString("en-CA", { month: "long" })}.`;
      } else {
        const until = ymd(new Date(now.getTime() + 365 * DAY));
        patch.prospectSnoozedUntil = until; patch.boughtElsewhereAt = rec.at;
        line = `Spoke with ${fn} — bought elsewhere. Off the lists for a year; note what they bought if they said.`;
      }
      store.update("leads", leadId, patch);
    } else if (key === "voicemail" || key === "no_answer") {
      rec = store.logContact(leadId, { via: "call", outcome: key, notes });
      // The next of six, by rule (or the rest after the sixth).
      const nx = scheduleNextAttempt(leadId, { now });
      if (nx && nx.task) tasks.push(nx.task);
      line = `${key === "voicemail" ? `Left ${fn} a message` : "No answer"} — ${nx ? nx.line : "logged."}`;
    } else if (key === "not_interested") {
      // They spoke, and said no: a contact, not a customer for the log.
      const at = now.toISOString();
      rec = store.create("calls", { leadId, dir: "out", via: "call", at, outcome: "reached", notes: notes || "Not interested", logged: true });
      // Parked six months — but still one of today's batch, worked: the
      // day's count keeps them (snoozeProspect would drop them from it).
      const until = new Date(now.getTime() + 180 * DAY).toISOString().slice(0, 10);
      stopChase();
      store.update("calls", rec.id, { conversationOutcome: "not_interested" });
      store.update("leads", leadId, { lastContacted: at, lastContactVia: "call", lastContactOutcome: "reached", notInterestedAt: at, prospectSnoozedUntil: until, lastConversationAt: at, lastConversationOutcome: "not_interested" });
      store.logActivity("touch");
      line = `${fn} isn't interested — on their file; parked until ${until}.`;
    } else if (key === "wrong_number") {
      const at = now.toISOString();
      rec = store.create("calls", { leadId, dir: "out", via: "call", at, outcome: "wrong_number", notes, logged: true });
      store.update("leads", leadId, { badPhone: true, badPhoneAt: at });
      line = `Wrong number — ${fn} is off the lists until there's a new one.`;
    } else return;
    ev = store.logEvent("session_outcome", { leadId, meta: { outcome: key, reason: why.cat, opener: why.variant } });
  });
  if (!rec) return null;
  recordDone(leadId, { outcome: key, recId: rec.id, taskIds: tasks.map((t) => t.id), eventId: ev ? ev.id : null, prev });
  return { rec, line: changed ? `Changed. ${line}` : line, tasks, changed };
}
// "tomorrow", "Thursday", "in 3 weeks", "March 4".
function relDay(ymdStr, now = new Date()) {
  const d = new Date(ymdStr + "T12:00:00");
  const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return d.toLocaleDateString("en-CA", { weekday: "long" });
  if (days < 28) return `in ${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? "" : "s"}`;
  return d.toLocaleDateString("en-CA", { month: "long", day: "numeric" });
}

// ---- The script ----
//
// What to say, in the salesperson's voice, from the read of the customer:
// an opener that names the one reason for the call without a figure in it,
// a bridge to the ask, and the three objections that reason tends to draw,
// each with a line back. The reasons are the card's; the words are plain.

const OBJECTIONS = {
  any: [
    { say: "Not interested.", back: "Totally fair. Can I ask what you're driving now and how it's treating you? If nothing fits, I'll leave it there." },
    { say: "Not a good time.", back: "No problem — is later today or tomorrow better? I'll call you then." },
    { say: "Just send me something.", back: "Happy to text you. Is this the best number? I'll keep it short." },
  ],
  payment: [{ say: "I can't take on a bigger payment.", back: "That's the point — I only called because this looks like the same payment or less, on something newer." }],
  equity: [{ say: "I still owe on it.", back: "You may be in better shape than you think — in a lot of these the trade covers what's owed and then some. Ten minutes to find out." }],
  ending: [{ say: "It isn't up yet.", back: "Right — and the best time to look is before it is. You've got options now you won't have at the end." }],
  cycle: [{ say: "It's running fine.", back: "Good — that's exactly when it's worth the most. Nobody gets top dollar for a car with a problem." }],
  rate: [{ say: "My rate's fine.", back: "Rates have moved. If we can get you lower on something newer, that's worth ten minutes." }],
  warranty: [{ say: "I'll fix it when it breaks.", back: "Fair — the warranty running out is just the point where repairs become yours. Worth knowing what trading now looks like." }],
  service: [{ say: "I'm just here for service.", back: "Of course — while it's in, I'll have the numbers ready so you can see them or not. No pressure either way." }],
  engaged: [{ say: "I was only looking.", back: "That's all this is too — you looked, I'm following up. What caught your eye?" }],
};

/**
 * callScript(customer, settings) → { opener, bridge, objections[], reason }
 * `customer` is a batch entry ({ lead, reasons, why, best }) or an assessment.
 */
export function callScript(c, settings = store.getSettings()) {
  const l = c.lead || c;
  const fn = firstName(l.name);
  const me = String(settings.salesperson || "").trim().split(/\s+/)[0] || "me";
  const dealer = String(settings.dealership || "").trim() || "the dealership";
  const vehicle = String(l.vehicleInterest || "").replace(/^\d{4}\s+/, "").trim();
  const reasons = (c.reasons || []).filter((r) => r && !/No texting consent|No phone|Upside down/i.test(r));
  const cat = reasons.length ? categoryOf(reasons[0]) : "other";
  const safe = (c.whySafe || c.why || []).find((w) => typeof w === "string" && !/\$|%/.test(w)) || "";
  // Two phrasings of every reason, rotated by customer, so the readout can
  // say which one books (outcomes.js) — and retire the other.
  const variant = variantFor(l.id);
  const phrasings = {
    payment: [`it looks like you could be in something newer for about what you're paying now`, `I think I can get you into a newer ${vehicle || "car"} without moving your payment`],
    equity: [`the market's done well by your ${vehicle || "vehicle"} — you're likely sitting on some equity`, `your ${vehicle || "vehicle"} is worth more right now than most people expect, and that's worth knowing`],
    ending: [`your contract's coming up on its end and you've got options before it does`, `you're getting close to the end of your term, and the best choices are the ones made before it`],
    cycle: [`you've had the ${vehicle || "car"} a few years now and it's at the point where it's worth the most`, `a lot of people with a ${vehicle || "car"} your age are trading right now while it's worth the most`],
    rate: [`rates have moved since you bought and there may be room to do better`, `the rate you're carrying is higher than what we're seeing now, and that's money every month`],
    warranty: [`the warranty on your ${vehicle || "vehicle"} is coming to its end`, `you're coming up on the end of the warranty, and that's the moment repairs become yours`],
    service: [`you're in for service shortly and I'd like to have the numbers ready while it's in`, `you're booked in for service and I'd like to put something together for while you wait`],
    engaged: [`you'd been looking at something I sent`, `I saw you'd had a look at what I sent over and wanted to follow up`],
  };
  const pair = phrasings[cat];
  const because = pair ? pair[variant === "b" ? 1 : 0] : (safe ? safe.replace(/\.$/, "") : `I'm working through the ${vehicle ? vehicle + " owners" : "customers"} I look after and wanted to check in`);
  const opener = `Hi ${fn}, it's ${me} at ${dealer}. I'll be quick — I'm calling because ${because}.`;
  const bridge = cat === "service"
    ? `Would it be all right if I had something put together for when you're in?`
    : `Would ten minutes this week to see what it looks like be worth your while — no pressure either way?`;
  const objections = [...(OBJECTIONS[cat] || []), ...OBJECTIONS.any].slice(0, 4);
  return { opener, bridge, objections, reason: reasons[0] || "", cat, variant };
}
// Which phrasing a customer gets: steady for them, half the book each way.
export function variantFor(id) {
  let h = 0;
  for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 ? "b" : "a";
}

// The day's calling, for Home and Coach: today's sessions' outcomes.
export function todayCalls(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - DAY).toISOString();
  return store.all("events").filter((e) => e.kind === "session_outcome" && String(e.at || "").slice(0, 10) === day && e.at >= since);
}
