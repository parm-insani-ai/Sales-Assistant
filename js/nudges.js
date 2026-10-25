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
import { lateTasks, daysLate } from "./reminders.js";
import { todayPlan } from "./plan.js";
import { matchedWatches, closeWatch, describeWant } from "./watch.js";
import { stale, noteOverdue, ASK_AFTER } from "./ledger.js";

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
// Swiping a nudge away. A text or a reminder is ticked off for real (the
// task is done); a reply is marked read; anything else — a shaky
// appointment, a cold deal — is hidden until tomorrow, on this phone.
const DISMISS_KEY = "viniva:nudges:hidden";
function dismissedToday() {
  try {
    const d = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
    const today = new Date().toISOString().slice(0, 10);
    return new Set(Object.keys(d).filter((k) => d[k] === today));
  } catch { return new Set(); }
}
export function dismissNudge(n) {
  if (!n) return "";
  if (n.kind === "touch" || n.kind === "reminder") {
    const t = n.taskId ? store.get("tasks", n.taskId) : null;
    if (!t || t.done) return "";
    const now = new Date().toISOString();
    store.update("tasks", t.id, { done: true, doneBy: "swipe", doneAt: now });
    if (t.cadence) { store.logActivity("touch"); if (t.leadId) store.update("leads", t.leadId, { lastContacted: now }); }
    return n.kind === "touch" ? "Marked sent" : "Reminder done";
  }
  if (n.kind === "reply") {
    const leadId = String(n.key || "").split(":")[1];
    if (leadId) store.markThreadRead(leadId);
    return "Marked read";
  }
  if (n.kind === "watch") {
    if (n.watchId) closeWatch(n.watchId, "swipe");
    return "Watch closed";
  }
  try {
    const d = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
    const today = new Date().toISOString().slice(0, 10);
    Object.keys(d).forEach((k) => { if (d[k] !== today) delete d[k]; });
    d[n.key] = today;
    localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
  } catch { /* no storage: it comes back on the next paint */ }
  return "Hidden for today";
}
// Put a swiped nudge back (the Undo on the toast).
export function restoreNudge(n, snapshot) {
  if (!n) return;
  if ((n.kind === "touch" || n.kind === "reminder") && snapshot) { store.update("tasks", snapshot.id, { done: false, doneBy: null, doneAt: null }); if (snapshot.lastContacted !== undefined && snapshot.leadId) store.update("leads", snapshot.leadId, { lastContacted: snapshot.lastContacted }); return; }
  if (n.kind === "watch" && n.watchId) { store.update("watches", n.watchId, { done: false, doneAt: null, doneBy: null }); return; }
  try { const d = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}"); delete d[n.key]; localStorage.setItem(DISMISS_KEY, JSON.stringify(d)); } catch { /* fine */ }
}

// Why a customer added in the last quarter hour has no welcome text on the
// list, said plainly under it — so a missing one is never a mystery. Null
// when every fresh customer's welcome is accounted for.
export function missingWelcomes({ now = Date.now() } = {}) {
  const out = [];
  const shown = new Set(getNudges({ now, limit: 50 }).filter((n) => n.kind === "touch").map((n) => n.taskId));
  store.all("leads").forEach((l) => {
    const made = new Date(l.createdAt || 0).getTime();
    if (!(now - made >= 0 && now - made <= 15 * MIN)) return;
    // Someone you just met — not a row from an import, a sale logged
    // after the fact, or a lost lead.
    if (/import/i.test(String(l.source || "")) || l.demo || !["new", "working", "appointment"].includes(l.stage || "new")) return;
    const steps = store.all("tasks").filter((t) => t.leadId === l.id && t.cadence);
    const welcome = steps.find((t) => t.intent === "intro" && t.channel === "text");
    if (welcome && shown.has(welcome.id)) return;
    const mins = Math.max(1, Math.round((now - made) / MIN));
    const s = store.getSettings();
    let why;
    if (!steps.length) {
      const owner = ["sold", "delivered"].includes(l.stage) || l.currentPayment != null || l.payoff != null || l.purchaseDate;
      why = !s.autoCadence ? "follow-up plans are off in Settings" : owner ? "added as an owner (sold, delivered, or with a payment on file), and an owner's plan has no welcome text" : "no plan was started for them";
    } else if (!welcome) why = "their plan has no welcome text step";
    else if (welcome.done) why = "the welcome text was marked done";
    else if (!welcome.readyAt) why = "the welcome text has no send time";
    else { const at = new Date(welcome.readyAt).getTime(); why = at > now ? `the welcome text is set for ${new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : `the welcome text was ready at ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} but isn't listed`; }
    out.push({ leadId: l.id, name: l.name, mins, why });
  });
  return out.length ? out : null;
}

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
      // The customer just added comes before every other welcome text —
      // the ones from earlier today, ready and unsent, score higher as
      // they age and were taking the top of the list from the newest.
      urgency: t.intent === "intro" ? 99 : 92,
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
  // Today) makes it go away — all three tests, by construction. One the
  // ledger is already asking about (below) isn't also nagged here.
  try { noteOverdue(now); } catch { /* the pokes are a convenience */ }
  const asking = stale(now);
  const askingKeys = new Set(asking.map((c) => c.key));
  store.all("tasks")
    .filter((t) => !t.done && t.remindAt && t.channel === "reminder" && !askingKeys.has(`task:${t.id}`))
    .forEach((t) => {
      const at = apptTime(t.remindAt);
      if (!isFinite(at) || at > now || now - at > 24 * HOUR) return;
      const mins = Math.round((now - at) / MIN);
      out.push({
        key: `rem:${t.id}`,
        urgency: Math.min(97, 90 + Math.floor(mins / 30)),
        kind: "reminder",
        taskId: t.id,
        title: `⏰ ${t.title}`,
        sub: t.source === "wrapup"
          ? "Today's conversation with the assistant is forgotten at 4am. Tap to go through it together."
          : `Reminder for ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${mins >= 2 ? ` · ${human(mins)} ago` : ""} — tick it off on Today.`,
        // The end-of-day check opens the sheet, where the assistant asks.
        route: t.source === "wrapup" ? null : "/today",
        open: t.source === "wrapup" ? "voice" : null,
        at: new Date(at).toISOString(),
      });
    });

  // --- 0c. To-dos past their day. The list on Log is newest first, so an
  // old one sinks; this is the line that keeps it from being forgotten: how
  // many, and the oldest. It clears itself as they're ticked off, and a
  // swipe hides it for the day. Tapping it opens the list on just those.
  {
    const late = lateTasks(now);
    if (late.length) {
      const oldest = late[0], days = daysLate(oldest, now);
      out.push({
        key: `late:${late.length}:${oldest.id}`,
        urgency: 72,
        kind: "late",
        title: late.length === 1 ? `1 to-do overdue: ${oldest.title}` : `${late.length} to-dos overdue`,
        sub: late.length === 1 ? `${days} day${days === 1 ? "" : "s"} past its day — tick it off, or move it.` : `Oldest: “${oldest.title}”, ${days} day${days === 1 ? "" : "s"} ago. Tap to see just these.`,
        route: "/log",
        prep: () => { try { sessionStorage.setItem("viniva:log:open", "todos"); sessionStorage.setItem("viniva:log:overdue", "1"); } catch { /* the list, then */ } },
        at: new Date(now).toISOString(),
      });
    }
  }

  // --- 0d. The day's plan, when the afternoon gets away. Two hours after
  // the plan was made, with calls still to make and the appointments not
  // yet set, one line says what's left. Gone when it's done; a swipe hides
  // it for the day.
  {
    const plan = todayPlan(new Date(now));
    if (plan && plan.callsToday && !plan.done && now - new Date(plan.madeAt).getTime() >= 2 * HOUR) {
      const callsLeft = Math.max(0, plan.callsToday - plan.callsMade);
      out.push({
        key: `plan:${plan.day}`,
        urgency: 74,
        kind: "plan",
        title: `${callsLeft} call${callsLeft === 1 ? "" : "s"} left on today's plan`,
        sub: `${plan.callsMade} made, ${plan.apptsSet} of ${plan.apptsToday} appointment${plan.apptsToday === 1 ? "" : "s"} set. ${plan.left.length ? `${plan.left.length} still to call — they're on Log.` : "Everyone on it has been called — log a few more."}`,
        route: "/log",
        prep: () => { try { sessionStorage.setItem("viniva:log:open", "queue"); } catch { /* the list, then */ } },
        at: new Date(now).toISOString(),
      });
    }
  }

  // --- 0e. A vehicle a customer was waiting for has landed on the lot.
  // The watch was set when they asked for something we didn't have; the
  // unit is here now, and they're the first call. Swiping it away closes
  // the watch (the customer has been told, or it wasn't the one).
  matchedWatches().forEach(({ watch, vehicle, lead }) => {
    if (!lead) return;
    const m = watch.matched || {};
    const label = (vehicle && [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")) || m.label || "the vehicle";
    const price = (vehicle && vehicle.price != null ? vehicle.price : m.price);
    const stock = (vehicle && vehicle.stock) || m.stock || "";
    out.push({
      key: `watch:${watch.id}`,
      urgency: 88,
      kind: "watch",
      watchId: watch.id,
      title: `${firstName(lead.name)}'s ${describeWant(watch.want)} is in`,
      sub: `${label}${stock ? ` · stock ${stock}` : ""}${price != null ? ` · $${Number(price).toLocaleString()}` : ""} — they asked for one${watch.createdAt ? ` on ${new Date(watch.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}. Text or call them first.`,
      route: lead.phone ? `/inbox/${lead.id}` : `/leads/${lead.id}`,
      at: watch.matchedAt || new Date(now).toISOString(),
    });
  });

  // --- 0f. Still open after three reminders (ledger.js). The app stops
  // reminding and asks instead: tomorrow, next week, or let it go. Nothing
  // stays overdue quietly, and nothing nags forever either.
  asking.forEach((c) => {
    const times = c.pokes ? Number(c.pokes.count) || 0 : 0;
    const since = new Date(c.due).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    out.push({
      key: `stale:${c.key}`,
      urgency: 82,
      kind: "stale",
      ledgerKey: c.key,
      title: `Still open: ${c.title}`,
      sub: `${times >= ASK_AFTER ? `Reminded ${times} times` : "Overdue"} since ${since} — move it, or let it go.`,
      route: c.route,
      choices: [{ label: "Tomorrow", act: "tomorrow" }, { label: "Next week", act: "nextweek" }, { label: "Drop", act: "drop" }],
      at: new Date(c.due).toISOString(),
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
        sub: `In ${human(mins)} · not confirmed`,
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
        sub: `${String(a.when).slice(11, 16)} appointment · showed or no-show?`,
        route: `/calendar/${a.id}`,
        at: new Date(t).toISOString(),
      });
    });

  // --- 4. A delivery tomorrow with prep still outstanding.
  // The one kind of problem that is genuinely unrecoverable the morning of.
  const tomorrow = new Date(now + 24 * HOUR);
  const tomorrowK = localDayKey(tomorrow);
  store.all("deliveries")
    .filter((d) => !d.done && d.status !== "delivered" && String(d.deliveryDate || d.when || d.date || "").slice(0, 10) === tomorrowK)
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
        sub: `${days} days quiet · ${l.stage === "negotiating" ? "negotiating" : "appointment stage"}`,
        route: l.phone ? `/inbox/${l.id}` : `/leads/${l.id}`,
        at: new Date(t).toISOString(),
      });
    });

  // Most urgent first — with the pinned ones (a new customer's welcome
  // text) ahead of the cut, so a short list never loses them to older,
  // higher-scoring follow-ups.
  // Swiped away: hidden for the rest of the day (the ones with nothing to
  // tick — a shaky appointment, a cold deal). The rest clear themselves.
  const hidden = dismissedToday();
  const kept = out.filter((n) => !hidden.has(n.key));
  kept.sort((a, b) => b.urgency - a.urgency);
  const pinned = kept.filter((n) => n.pin), rest = kept.filter((n) => !n.pin);
  // Pinned ones are never cut, even by each other: five customers added
  // today is five welcome texts on the list, the newest first.
  return [...pinned, ...rest.slice(0, Math.max(0, limit - pinned.length))];
}

// The one-line version, for the agent and for anywhere that wants a summary
// rather than a list.
export function nudgeSummary(list) {
  if (!list || !list.length) return "Nothing needs you this minute.";
  if (list.length === 1) return list[0].title;
  return `${list[0].title} — and ${list.length - 1} other thing${list.length === 2 ? "" : "s"}.`;
}
