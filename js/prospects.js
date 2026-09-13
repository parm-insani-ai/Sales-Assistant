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
import { topOpportunities, equityDetail } from "./views/dealbuilder.js";
import { getOccasions } from "./occasions.js";
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
const vehName = (v) => (v ? [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") : "");

// Is this someone the app should bring up today?
export function eligible(lead) {
  if (!lead || store.optedOut(lead)) return false;
  // Just bought, gone, or already at the table.
  if (["sold", "lost", "appointment", "negotiating"].includes(lead.stage)) return false;
  if (!lead.phone && !lead.email) return false;
  if (within(lead.lastContacted, CONTACT_DAYS)) return false;
  if (within(lead.lastCampaignAt, CAMPAIGN_DAYS)) return false;
  if (lead.prospectSnoozedUntil && lead.prospectSnoozedUntil > todayK()) return false;
  if (within(lead.lastProspectedAt, COOLDOWN_DAYS)) return false;
  if (hasCadence(lead.id)) return false; // a plan is already working them
  return true;
}

function yearsOwned(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isFinite(t) ? (Date.now() - t) / (365.25 * 86400000) : null;
}

// The reasons in words a message-writer can use — true, and never a figure.
// The chips the salesperson sees carry the numbers; these don't.
function whyRadar(r) {
  const why = [];
  const l = r.lead, b = r.best;
  if (b && b.delta != null) {
    if (b.delta <= -20) why.push("they could move into a newer vehicle for less per month than they pay now");
    else if (b.delta <= 50) why.push("they could move into a newer vehicle for about what they pay now");
  }
  const eq = equityDetail(l).v;
  if (eq != null && eq >= 3000) why.push("their current vehicle is worth a good deal more than what's left owing on it");
  else if (eq != null && eq > 0) why.push("their current vehicle is worth more than what's left owing");
  else if (eq != null && eq < -2000) why.push("they owe more than their vehicle is worth — go gently and promise nothing");
  const yrs = yearsOwned(l.purchaseDate);
  if (yrs != null && yrs >= 3) why.push(`they've had their ${l.vehicleInterest || "vehicle"} about ${Math.floor(yrs)} years`);
  if (b && b.special) why.push(`there's a manufacturer program on the ${b.vehicle.model || "next vehicle"} right now (don't quote its terms)`);
  if (b && b.vehicle) why.push(`the natural next vehicle for them is a ${vehName(b.vehicle)}`);
  return why;
}
function whyOccasion(o) {
  if (o.kind === "lease1") return "their lease is up within about a month";
  if (o.kind === "lease3") return "their lease is up in about three months — the right time to look at options";
  if (o.kind === "lease6") return "their lease comes due in about six months";
  if (o.kind === "anniv") return "it's around the anniversary of their purchase";
  return o.label;
}

// Everyone with a reason, best first. Radar rows (a payment-matched deal)
// first, with occasions layered on top — a lease coming due is a reason on
// its own, and a stronger one when there's a deal to go with it.
export function candidates() {
  const byId = new Map();
  topOpportunities(Infinity).forEach((r) => {
    byId.set(r.lead.id, { lead: r.lead, score: r.score, reasons: r.reasons.slice(), best: r.best, why: whyRadar(r), occasion: null });
  });
  getOccasions().forEach((o) => {
    if (o.kind === "bday") return; // a relationship touch, not a sale
    const bonus = o.kind === "lease1" ? 30 : o.kind === "lease3" ? 22 : o.kind === "lease6" ? 12 : 15;
    const c = byId.get(o.lead.id) || { lead: o.lead, score: 0, reasons: [], best: null, why: [], occasion: null };
    c.score += bonus;
    c.reasons.unshift(o.label);
    c.why.unshift(whyOccasion(o));
    c.occasion = o;
    byId.set(o.lead.id, c);
  });
  return [...byId.values()].filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
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
      .filter((c) => c && stillOpen(c.lead, day));
  }
  const n = Math.max(0, Number(store.getSettings().dailyProspects ?? 10));
  const picks = all.filter((c) => eligible(c.lead)).slice(0, n);
  writePicks({ day, ids: picks.map((c) => c.lead.id) });
  // Stamp them as surfaced, so tomorrow moves on to the next handful. After
  // the current paint: this runs inside Home's render, and a store write
  // there would re-enter it.
  const now = new Date().toISOString();
  setTimeout(() => {
    store.bulk(() => picks.forEach((c) => {
      const l = store.get("leads", c.lead.id);
      if (l && l.lastProspectedAt !== now) store.update("leads", l.id, { lastProspectedAt: now });
    }));
  }, 0);
  return picks;
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
