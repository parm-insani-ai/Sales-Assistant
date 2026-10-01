// The things that are true *right now* and stop being true if you're slow.
//
// The play sheet already answers "what should I work today" — it's a ranked
// day's queue, and it thinks in days. Nothing in the app watched the clock.
// A customer who replied eleven minutes ago, an appointment at four that
// nobody has confirmed and it's ten past three, a delivery tomorrow with the
// plates not ordered: each of those has a window, and the value of knowing
// about it collapses once the window shuts.
//
// So this is deliberately not a second to-do list. Every rule here has to pass
// three tests, or it doesn't belong:
//
//   1. It is time-critical — waiting makes it worse, not just later.
//   2. There is one obvious action.
//   3. It goes away on its own when the thing is handled.
//
// Rule 3 is what keeps this from becoming noise. Anything that would still be
// sitting there tomorrow is a play, not a nudge.

import * as store from "./store.js";
import { telHref } from "./utils.js";
import { readyTouches, heldTouches } from "./cadence.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// How long a customer's reply can sit before it's a problem. Speed of reply is
// the single biggest lever on whether a text becomes an appointment, and it
// decays fast — this is the point where it's worth interrupting for.
const REPLY_GRACE = 12 * MIN;
// An appointment inside this window that nobody has confirmed.
const CONFIRM_WINDOW = 3 * HOUR;
// After an appointment's start time, how long before "did they show?" is worth
// asking. Long enough not to interrupt the appointment itself.
const OUTCOME_AFTER = 90 * MIN;
// A customer mid-deal who has heard nothing. Not a hard rule — a stage the
// customer is actively in, with silence measured in days.
const COLD_DAYS = 3;

function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || ""; }

function minutesAgo(iso) {
  const t = new Date(iso).getTime();
  return isFinite(t) ? Math.round((Date.now() - t) / MIN) : null;
}

function human(mins) {
  if (mins == null) return "";
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

function localDayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Appointment times are stored as local "YYYY-MM-DDTHH:MM" with no zone, so
// they have to be read as local rather than handed to Date() as UTC.
function apptTime(when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(when || ""));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

/**
 * Everything that needs attention in the next little while, most urgent first.
 *
 * Each nudge: { key, urgency, title, sub, kind, href?, route?, at }
 *   key     stable per underlying thing, so a notifier can avoid repeating it
 *   urgency 0-100, for ordering and for deciding what's worth a push
 *   href    a one-tap action (dial / open a thread) where there is one
 */
export function getNudges({ now = Date.now(), limit = 8 } = {}) {
  const out = [];
  const leads = store.all("leads");
  const leadById = (id) => leads.find((l) => l.id === id) || null;

  // --- 0. A welcome text whose moment has come.
  // Five minutes after a customer is added, their first text is drafted and
  // waiting. It passes all three tests: the value of a welcome text decays by
  // the hour, the action is one tap, and it vanishes once it's sent.
  readyTouches(now).forEach((t) => {
    const lead = leadById(t.leadId);
    if (!lead) return;
    const mins = Math.round((now - new Date(t.readyAt).getTime()) / MIN);
    // Someone just added outranks the day's other texts: the first minutes
    // after a visit are the ones that convert, so the welcome sits at the top
    // of the list even when the list is full.
    const intro = t.intent === "intro";
    out.push({
      key: `touch:${t.id}`,
      urgency: Math.min(98, (intro ? 93 : 86) + Math.floor(mins / 15)),
      // A welcome text never falls off the list: with a book full of
      // follow-ups aging past it, the one for the customer just added is
      // still the one that converts. Pinned ahead of the cut (below).
      pin: intro,
      kind: "touch",
      taskId: t.id,
      title: `${firstName(lead.name)}'s ${t.intent === "intro" ? "welcome" : "follow-up"} text is ready`,
      // The title says it all; a tap opens the draft. Only a missing
      // number earns a second line.
      sub: lead.phone ? "" : "No phone number on file yet — add one to send it.",
      route: lead.phone ? null : `/leads/${lead.id}`,
      at: t.readyAt,
    });
  });
  // And the same text in the minutes before: on the list from the moment
  // the customer is added, so the salesperson sees it's done, with sending
  // locked until its minute so it doesn't land on the customer's heels.
  heldTouches(now).forEach((t) => {
    const lead = leadById(t.leadId);
    if (!lead) return;
    const left = Math.max(1, Math.ceil((new Date(t.readyAt).getTime() - now) / MIN));
    const when = new Date(t.readyAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    out.push({
      key: `touch:${t.id}`,
      urgency: 92,
      pin: t.intent === "intro",
      kind: "touch",
      taskId: t.id,
      locked: true,
      unlockAt: t.readyAt,
      title: `${firstName(lead.name)}'s ${t.intent === "intro" ? "welcome" : "follow-up"} text is drafted`,
      sub: lead.phone
        ? `Locked ${left} more min (sends from ${when}) so it doesn't land on their heels — read it now, send it then.`
        : `Locked ${left} more min — and it needs their phone number to send.`,
      route: lead.phone ? null : `/leads/${lead.id}`,
      at: t.readyAt,
    });
  });

  // --- 0b. A reminder whose time has come. The salesperson set the moment
  // themselves, the action is whatever they wrote, and ticking it off (on
  // Today) makes it go away — all three tests, by construction.
  store.all("tasks")
    .filter((t) => !t.done && t.remindAt && t.channel === "reminder")
    .forEach((t) => {
      const at = apptTime(t.remindAt);
      if (!isFinite(at) || at > now || now - at > 24 * HOUR) return;
      const mins = Math.round((now - at) / MIN);
      out.push({
        key: `rem:${t.id}`,
        urgency: Math.min(97, 90 + Math.floor(mins / 30)),
        kind: "reminder",
        title: `⏰ ${t.title}`,
        sub: `Reminder for ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${mins >= 2 ? ` · ${human(mins)} ago` : ""} — tick it off on Today.`,
        route: "/today",
        at: new Date(at).toISOString(),
      });
    });

  // --- 1. A customer replied and is waiting on you.
  // The most perishable thing in the app, and until now nothing surfaced it
  // outside the Comms tab — you had to go and look.
  const byLead = new Map();
  store.unreadTexts().forEach((t) => {
    const at = new Date(t.at || t.createdAt).getTime();
    const cur = byLead.get(t.leadId);
    if (!cur || at < cur.at) byLead.set(t.leadId, { at, text: t, count: (cur?.count || 0) + 1 });
    else cur.count += 1;
  });
  byLead.forEach((v, leadId) => {
    const waited = Math.round((now - v.at) / MIN);
    if (waited < REPLY_GRACE / MIN) return;      // still inside a normal reply time
    const lead = leadById(leadId);
    const who = lead ? lead.name : (v.text.phone || "Someone");
    out.push({
      key: `reply:${leadId}:${v.text.id}`,
      // Climbs with the wait: ten minutes is a nudge, an hour is a problem.
      urgency: Math.min(100, 70 + Math.floor(waited / 10)),
      kind: "reply",
      title: `${firstName(who) || who} is waiting on you`,
      sub: `Replied ${human(waited)} ago${v.count > 1 ? ` · ${v.count} messages` : ""} — “${String(v.text.body || "").slice(0, 60)}”`,
      route: `/inbox/${leadId}`,
      at: new Date(v.at).toISOString(),
    });
  });

  // --- 2. An appointment coming up that nobody has confirmed.
  // The play sheet lists today's unconfirmed appointments all day at one rank.
  // The hour before is not the same as the morning of, and a confirmation sent
  // after they've already decided not to come is worth nothing.
  store.all("appointments")
    .filter((a) => a.status === "scheduled" && !a.confirmed && !a.outcome)
    .forEach((a) => {
      const t = apptTime(a.when);
      if (!isFinite(t)) return;
      const until = t - now;
      if (until <= 0 || until > CONFIRM_WINDOW) return;
      const mins = Math.round(until / MIN);
      const lead = a.leadId ? leadById(a.leadId) : null;
      const phone = a.phone || (lead && lead.phone) || "";
      out.push({
        key: `confirm:${a.id}`,
        // Tighter window, higher urgency — 30 minutes out is nearly too late.
        urgency: Math.min(99, 100 - Math.floor(mins / 3)),
        kind: "confirm",
        title: `${a.customerName || "An appointment"} at ${String(a.when).slice(11, 16)} isn't confirmed`,
        sub: `In ${human(mins)}. A confirmation now is the difference between a show and a no-show.`,
        route: lead ? `/inbox/${lead.id}` : "/calendar",
        href: !lead && phone ? telHref(phone) : null,
        at: new Date(t).toISOString(),
      });
    });

  // --- 3. An appointment that has been and gone with no outcome recorded.
  // Nobody ever asks this, so the funnel quietly fills with appointments that
  // are neither shows nor no-shows, and the show rate on the coach screen
  // becomes fiction.
  store.all("appointments")
    .filter((a) => a.status === "scheduled" && !a.outcome)
    .forEach((a) => {
      const t = apptTime(a.when);
      if (!isFinite(t)) return;
      const since = now - t;
      if (since < OUTCOME_AFTER || since > 36 * HOUR) return;
      out.push({
        key: `outcome:${a.id}`,
        urgency: 55,
        kind: "outcome",
        title: `Did ${a.customerName || "they"} show?`,
        sub: `${String(a.when).slice(11, 16)} appointment — logging it keeps your show rate honest.`,
        route: "/calendar",
        at: new Date(t).toISOString(),
      });
    });

  // --- 4. A delivery tomorrow with prep still outstanding.
  // The one kind of problem that is genuinely unrecoverable the morning of.
  const tomorrow = new Date(now + 24 * HOUR);
  const tomorrowK = localDayKey(tomorrow);
  store.all("deliveries")
    .filter((d) => !d.done && String(d.when || d.date || "").slice(0, 10) === tomorrowK)
    .forEach((d) => {
      const items = Array.isArray(d.checklist) ? d.checklist : [];
      const left = items.filter((i) => !i.done);
      if (!left.length) return;
      out.push({
        key: `prep:${d.id}:${left.length}`,
        urgency: 75,
        kind: "prep",
        title: `${d.customerName || "A delivery"} tomorrow — ${left.length} thing${left.length === 1 ? "" : "s"} left`,
        sub: left.slice(0, 2).map((i) => i.label || i.text || "").filter(Boolean).join(" · ") || "Prep isn't finished.",
        route: `/deliveries/${d.id}`,
        at: new Date(now).toISOString(),
      });
    });

  // --- 5. Someone mid-deal who has gone quiet.
  // Only the stages where silence actually costs something: a new lead nobody
  // has called, or a deal in negotiation that's cooling.
  const coldMs = COLD_DAYS * 24 * HOUR;
  leads
    .filter((l) => ["appointment", "negotiating"].includes(l.stage))
    .forEach((l) => {
      const last = l.lastContacted || l.updatedAt;
      const t = new Date(last).getTime();
      if (!isFinite(t) || now - t < coldMs) return;
      const days = Math.floor((now - t) / (24 * HOUR));
      out.push({
        key: `cold:${l.id}:${days}`,
        urgency: 50,
        kind: "cold",
        title: `${l.name} has gone quiet`,
        sub: `${days} days with no contact, and they're at ${l.stage === "negotiating" ? "the negotiating table" : "appointment stage"}.`,
        route: l.phone ? `/inbox/${l.id}` : `/leads/${l.id}`,
        at: new Date(t).toISOString(),
      });
    });

  // Most urgent first — with the pinned ones (a new customer's welcome
  // text) ahead of the cut, so a short list never loses them to older,
  // higher-scoring follow-ups.
  out.sort((a, b) => b.urgency - a.urgency);
  const pinned = out.filter((n) => n.pin), rest = out.filter((n) => !n.pin);
  return [...pinned, ...rest].slice(0, limit);
}

// The one-line version, for the agent and for anywhere that wants a summary
// rather than a list.
export function nudgeSummary(list) {
  if (!list || !list.length) return "Nothing needs you this minute.";
  if (list.length === 1) return list[0].title;
  return `${list[0].title} — and ${list.length - 1} other thing${list.length === 2 ? "" : "s"}.`;
}
