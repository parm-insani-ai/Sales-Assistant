// The log: the customers you're actually working. Everyone else on file
// is outreach — the owner book, imported, waiting to be contacted.
//
// A customer enters the log when you log them: add them (by hand or by
// voice), log a conversation with an outcome, book them, sell them, or
// tap "Move to log" on an outreach customer who showed promise. Once in,
// they stay in: `loggedAt` is the day they crossed over, and the month's
// log is everyone who crossed over that month — the customer log the
// store's target sheet is built on.
//
// Customers from before the log existed: anyone in play (not a delivered
// owner, not lost) is in it as of the day they were added.

import * as store from "./store.js";

const pad = (n) => String(n).padStart(2, "0");
export function monthKeyOf(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

export function inLog(l) {
  if (!l) return false;
  if (l.loggedAt) return true;
  // A row from a file is outreach until someone logs them — not a
  // conversation had on the day the export was loaded.
  if (l.importedAt) return false;
  return !["delivered", "lost"].includes(l.stage || "new");
}

// When they entered the log, as an ISO timestamp.
export function loggedAtOf(l) {
  if (!l) return "";
  if (l.loggedAt) return l.loggedAt;
  return inLog(l) ? (l.createdAt || "") : "";
}

function monthOf(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : monthKeyOf(d);
}

// The month's log, newest first.
export function loggedInMonth(mKey = monthKeyOf(), leads = store.all("leads")) {
  return leads
    .filter((l) => inLog(l) && monthOf(loggedAtOf(l)) === mKey)
    .sort((a, b) => String(loggedAtOf(b)).localeCompare(String(loggedAtOf(a))));
}

// Put a customer in the log (once). The moment counts as a conversation
// too: it's what the sales target's "spoken with" is.
export function logCustomer(leadId, { via = "in person", at = null } = {}) {
  const l = store.get("leads", leadId);
  if (!l) return null;
  const when = at || new Date().toISOString();
  const patch = {};
  if (!l.loggedAt) patch.loggedAt = when;
  if (!l.lastContacted || l.lastContacted < when.slice(0, 10)) { patch.lastContacted = when; patch.lastContactVia = via; }
  if (Object.keys(patch).length) store.update("leads", leadId, patch);
  return store.get("leads", leadId);
}

// Everyone in the log, all time, newest first.
export function loggedAll(leads = store.all("leads")) {
  return leads.filter(inLog).sort((a, b) => String(loggedAtOf(b)).localeCompare(String(loggedAtOf(a))));
}

// ---- The outcome on each logged customer ----
//
// A logged customer is a conversation had; the log asks what came of it.
// The outcome is read from the file — a sale, an appointment on the
// calendar, the stage, what the last conversation came to — or set by hand
// on the Log; one that has none yet is the one to go back to.
export const LOG_OUTCOMES = [
  { key: "sold", label: "Sold", badge: "badge-sold", hint: "A sale on the Tracker" },
  { key: "booked", label: "Booked", badge: "badge-appt", hint: "An appointment ahead" },
  { key: "showed", label: "Showed", badge: "badge-appt", hint: "Came in; not sold yet" },
  { key: "working", label: "Working", badge: "badge-working", hint: "In play — numbers, a second look" },
  { key: "not_now", label: "Not now", badge: "badge-new", hint: "Parked; a check-back dated" },
  { key: "not_interested", label: "Not interested", badge: "badge-lost", hint: "Parked six months" },
  { key: "bought_elsewhere", label: "Bought elsewhere", badge: "badge-lost", hint: "Off the lists a year" },
  { key: "lost", label: "Lost", badge: "badge-lost", hint: "Gone" },
  { key: "none", label: "No outcome yet", badge: "badge-due", hint: "" },
];
export const outcomeMeta = (key) => LOG_OUTCOMES.find((o) => o.key === key) || LOG_OUTCOMES[LOG_OUTCOMES.length - 1];

/** What came of a logged customer: { key, label, badge, set } — `set` when it was put on by hand. */
export function logOutcomeOf(l, { appointments = null, sales = null, now = Date.now() } = {}) {
  if (!l) return outcomeMeta("none");
  const appts = appointments || store.all("appointments");
  const sls = sales || store.all("sales");
  const mine = appts.filter((a) => a.leadId === l.id && a.status !== "cancelled" && a.status !== "canceled");
  const nowISO = new Date(now).toISOString();
  if (["sold", "delivered"].includes(l.stage) || sls.some((s) => s.leadId === l.id)) return outcomeMeta("sold");
  if (l.stage === "lost") return outcomeMeta("lost");
  // Set by hand, and nothing since has overtaken it.
  if (l.logOutcome && (!l.logOutcomeAt || !l.lastConversationAt || l.logOutcomeAt >= l.lastConversationAt)) {
    if (["working", "not_now", "not_interested", "bought_elsewhere", "showed"].includes(l.logOutcome)) return { ...outcomeMeta(l.logOutcome), set: true };
  }
  if (l.boughtElsewhereAt || l.lastConversationOutcome === "bought_elsewhere") return outcomeMeta("bought_elsewhere");
  if (l.notInterestedAt || l.lastConversationOutcome === "not_interested") return outcomeMeta("not_interested");
  if (mine.some((a) => !a.outcome && String(a.when || "") >= nowISO.slice(0, 16))) return outcomeMeta("booked");
  if (mine.some((a) => a.outcome === "showed")) return outcomeMeta("showed");
  if (l.lastConversationOutcome === "not_now" || (l.prospectSnoozedUntil && l.prospectSnoozedUntil > nowISO.slice(0, 10))) return outcomeMeta("not_now");
  if (["working", "negotiating"].includes(l.stage) || ["interested", "callback"].includes(l.lastConversationOutcome)) return outcomeMeta("working");
  if (l.stage === "appointment" && mine.length) return outcomeMeta("working");
  return outcomeMeta("none");
}

/**
 * Put an outcome on a logged customer by hand (the Log's sheet). Booked
 * and Sold are the appointment and the deal themselves (the sheet opens
 * those forms); the rest patch the file the way a conversation would.
 */
export function setLogOutcome(leadId, key, { now = new Date(), days = {} } = {}) {
  const l = store.get("leads", leadId);
  if (!l) return null;
  const DAY = 86400000;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const at = now.toISOString();
  const patch = { logOutcome: key, logOutcomeAt: at };
  if (key === "working") { if (!["appointment", "negotiating", "sold", "delivered"].includes(l.stage)) patch.stage = "working"; patch.lastConversationOutcome = "interested"; patch.lastConversationAt = at; }
  else if (key === "showed") { patch.lastConversationAt = at; if (!["negotiating", "sold", "delivered"].includes(l.stage)) patch.stage = "working"; }
  else if (key === "not_now") { const until = ymd(new Date(now.getTime() + (days.notNowDays || 180) * DAY)); patch.prospectSnoozedUntil = until; patch.followUp = until; patch.lastConversationOutcome = "not_now"; patch.lastConversationAt = at; }
  else if (key === "not_interested") { patch.notInterestedAt = at; patch.prospectSnoozedUntil = ymd(new Date(now.getTime() + (days.notInterestedDays || 180) * DAY)); patch.lastConversationOutcome = "not_interested"; patch.lastConversationAt = at; }
  else if (key === "bought_elsewhere") { patch.boughtElsewhereAt = at; patch.prospectSnoozedUntil = ymd(new Date(now.getTime() + (days.boughtElsewhereDays || 365) * DAY)); patch.lastConversationOutcome = "bought_elsewhere"; patch.lastConversationAt = at; }
  else if (key === "lost") { patch.stage = "lost"; }
  else return null;
  store.update("leads", leadId, patch);
  try { store.logEvent("log_outcome", { leadId, meta: { outcome: key } }); } catch { /* fine */ }
  return store.get("leads", leadId);
}
