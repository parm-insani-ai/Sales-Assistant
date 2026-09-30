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
