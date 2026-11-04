// Working the book.
//
// Three thousand imported customers is not a list anyone reads. So every day
// the app reads it: everyone on file is scored on whether a car can be sold
// to them now — a payment-matched deal, equity in what they drive, a lease
// coming due, years in the same vehicle, a program on the natural next
// vehicle — and the handful most worth a call today are brought to Home,
// each with the reason and a drafted opener waiting for an OK.
//
// The book is worked, not blasted. Someone surfaced today isn't surfaced
// again for three weeks; someone contacted in the last two weeks, or sent a
// campaign in the last month, or already being worked through a plan, or in
// the middle of a deal, is left alone. Dismissing a prospect snoozes them for
// a month. Sending them a text takes them off the day's list. Tomorrow brings
// the next handful, so over the weeks the whole book gets its turn, best
// first.

import * as store from "./store.js";
import { ranked } from "./assess.js";
import { hasCadence } from "./cadence.js";

const COOLDOWN_DAYS = 21;   // surfaced → not again for this long
const CONTACT_DAYS = 14;    // contacted this recently → someone's on it
const CAMPAIGN_DAYS = 30;   // campaigned this recently → don't pile on
const SNOOZE_DAYS = 30;     // dismissed → this long
const KEY = "viniva:prospects";

const todayK = () => new Date().toISOString().slice(0, 10);
const within = (iso, days) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return isFinite(t) && Date.now() - t < days * 86400000;
};
// Is this someone the app should bring up today?
export function eligible(lead) {
  if (!lead || store.optedOut(lead)) return false;
  // Just bought, gone, or already at the table.
  if (["sold", "lost", "appointment", "negotiating"].includes(lead.stage)) return false;
  // A number that turned out wrong (a calling session said so) is no number.
  if ((!lead.phone || lead.badPhone) && !lead.email) return false;
  if (within(lead.lastContacted, CONTACT_DAYS)) return false;
  if (within(lead.lastCampaignAt, CAMPAIGN_DAYS)) return false;
  if (lead.prospectSnoozedUntil && lead.prospectSnoozedUntil > todayK()) return false;
  if (within(lead.lastProspectedAt, COOLDOWN_DAYS)) return false;
  if (hasCadence(lead.id)) return false; // a plan is already working them
  return true;
}

// Everyone with a reason, best first — the same read of the book the Leads
// page is sorted by (assess.js), so Home and Leads never disagree about who
// is worth a call. `why` is the message-writer's version: never a figure.
export function candidates() {
  return ranked()
    .filter((a) => a.score > 0 && !a.flags.excluded)
    .map((a) => ({ lead: a.lead, score: a.score, tier: a.tier ? a.tier.label : "", reasons: a.reasons, why: a.whySafe, best: a.best, next: a.next, consent: a.flags.consent }));
}

export function candidateFor(leadId) {
  return candidates().find((c) => c.lead.id === leadId) || null;
}

function readPicks() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
function writePicks(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} }

// Still worth showing today? Not if they've been reached since the pick.
function stillOpen(lead, day) {
  if (!lead || store.optedOut(lead)) return false;
  if (["sold", "lost", "appointment", "negotiating"].includes(lead.stage)) return false;
  if (lead.prospectSnoozedUntil && lead.prospectSnoozedUntil > day) return false;
  if (lead.lastContacted && String(lead.lastContacted).slice(0, 10) >= day) return false;
  if (lead.badPhone && !lead.email) return false;
  return true;
}

/**
 * Today's prospects: the day's picks, chosen once and held for the day so the
 * list doesn't shuffle under the salesperson, minus anyone reached since.
 * Each: { lead, score, reasons, why, best, occasion }.
 */
export function getProspects() {
  const day = todayK();
  const all = candidates();
  const saved = readPicks();
  if (saved && saved.day === day) {
    return saved.ids
      .map((id) => all.find((c) => c.lead.id === id))
      .filter((c) => c && stillOpen(c.lead, day))
      .map((c) => ({ ...c, fresh: isFresh(c.lead, day) }));
  }
  const n = Math.max(0, Number(store.getSettings().dailyProspects ?? 10));
  const picks = all.filter((c) => eligible(c.lead)).slice(0, n);
  writePicks({ day, ids: picks.map((c) => c.lead.id) });
  stampSurfaced(picks);
  return picks.map((c) => ({ ...c, fresh: !c.lead.firstProspectedAt }));
}

// Never brought up before today: the first time this customer has had a turn.
const isFresh = (l, day) => !l.firstProspectedAt || String(l.firstProspectedAt).slice(0, 10) === day;

// Stamp them as surfaced, so tomorrow moves on to the next handful — and the
// first time ever, so "new to you" can be said. After the current paint:
// this runs inside a render, and a store write there would re-enter it.
function stampSurfaced(picks) {
  const now = new Date().toISOString();
  setTimeout(() => {
    store.bulk(() => picks.forEach((c) => {
      const l = store.get("leads", c.lead.id);
      if (!l || l.lastProspectedAt === now) return;
      store.update("leads", l.id, { lastProspectedAt: now, ...(l.firstProspectedAt ? {} : { firstProspectedAt: now }) });
    }));
  }, 0);
}

// The day's batch, worked through: the next handful, added to today's picks
// and stamped like the rest. Returns the ones added.
export function morePicks(n = Number(store.getSettings().dailyProspects ?? 10)) {
  const day = todayK();
  const saved = readPicks() && readPicks().day === day ? readPicks() : { day, ids: [] };
  const have = new Set(saved.ids);
  const next = candidates().filter((c) => !have.has(c.lead.id) && eligible(c.lead)).slice(0, Math.max(0, n));
  if (!next.length) return [];
  writePicks({ day, ids: [...saved.ids, ...next.map((c) => c.lead.id)] });
  stampSurfaced(next);
  return next.map((c) => ({ ...c, fresh: !c.lead.firstProspectedAt }));
}

// Today's batch against the day: how many were picked, how many have been
// reached or put off since, how many are still to do — and how many more
// the book has ready behind them.
export function pickProgress() {
  const day = todayK();
  const saved = readPicks();
  const ids = saved && saved.day === day ? saved.ids : [];
  let reached = 0;
  ids.forEach((id) => { const l = store.get("leads", id); if (!l || !stillOpen(l, day)) reached++; });
  const have = new Set(ids);
  const behind = candidates().filter((c) => !have.has(c.lead.id) && eligible(c.lead)).length;
  return { total: ids.length, reached, left: ids.length - reached, behind };
}

// "Not now." A month off the list, and off today's.
export function snoozeProspect(leadId, days = SNOOZE_DAYS) {
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  store.update("leads", leadId, { prospectSnoozedUntil: until });
  const saved = readPicks();
  if (saved) writePicks({ ...saved, ids: saved.ids.filter((id) => id !== leadId) });
  return until;
}

// How much of the book is still ahead — for the voice reply and the page.
export function prospectStats() {
  const all = candidates();
  return { withReason: all.length, eligibleNow: all.filter((c) => eligible(c.lead)).length };
}
