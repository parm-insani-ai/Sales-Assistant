// The brain of the Leads page: who is worth reaching out to, and why.
//
// Every customer on file gets read the way a good salesperson reads a book
// of business — not "do they have equity" but everything at once: what a
// move would cost them per month, what their car is worth against what's
// owing, how long they've had it, when the contract or the warranty runs
// out, how they're driving it against a lease allowance, what rate they're
// carrying, what AutoAlert flagged, whether they're in the service drive next
// week, and whether they've touched anything we sent them lately. Then it
// says so, in the order that matters, and names the next move.
//
// One assessment feeds everything: the Leads list is sorted by it, each card
// shows its top reasons, the customer's page explains it in full, Home's
// daily prospects are drawn from it, and the voice agent reads it back.
// Computed once per change to what it reads, like the radar.

import * as store from "./store.js";
import { topOpportunities, equityDetail, monthsRemaining, inferApr, closestDeal } from "./views/dealbuilder.js";
import { daysFromToday, currency } from "./utils.js";
import { isLikelyPrefetch } from "./plays.js";
import { consentStatus } from "./consent.js";

const DAY = 86400000;
const num = (v) => (v == null || v === "" ? null : Number(v));
const yearsSince = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return isFinite(t) ? (Date.now() - t) / (365.25 * DAY) : null; };
const daysSince = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return isFinite(t) ? (Date.now() - t) / DAY : null; };
const vehName = (v) => (v ? [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") : "");

// Factory warranty by make: basic years/km, powertrain years/km. The
// question is only "is it about to run out", so approximate is fine.
function warrantyFor(vehicle) {
  const s = String(vehicle || "").toLowerCase();
  if (/hyundai|kia|genesis/.test(s)) return [5, 100000, 5, 100000];
  if (/mitsubishi/.test(s)) return [5, 100000, 10, 160000];
  if (/volkswagen|\bvw\b|audi/.test(s)) return [4, 80000, 4, 80000];
  if (/mazda/.test(s)) return [3, Infinity, 5, Infinity];
  return [3, 60000, 5, 100000]; // Nissan and most of the market
}

// Tiers are relative to the book. An equity export is, by construction, a
// list of people with a deal on offer, and on such a list a fixed bar makes
// a third of everyone "Hot" — which tells the salesperson nothing. So Hot is
// the top tenth of the book and Strong the top third, each with a floor so a
// thin book doesn't promote people with little going for them.
const FLOORS = { hot: 60, strong: 45, worth: 30 };
const DEFAULT_CUTS = { hot: 70, strong: 55, worth: 30 };
export const TIERS = [
  { key: "hot", label: "Hot", badge: "badge-due" },
  { key: "strong", label: "Strong", badge: "badge-sold" },
  { key: "worth", label: "Worth a call", badge: "badge-soon" },
];
export function tierOf(score, cuts = (cache.cuts || DEFAULT_CUTS)) {
  return TIERS.find((t) => score >= cuts[t.key]) || null;
}
function cutsFor(sorted) {
  const scores = sorted.map((a) => a.score).filter((x) => x > 0); // already descending
  const n = scores.length;
  // The score at the boundary — then, because scores tie in bands (an export
  // has many near-identical rows), raised until the tier holds about its
  // share and not every tied row on the boundary.
  const cutAt = (frac, floor) => {
    if (!n) return Infinity;
    let cut = Math.max(floor, scores[Math.min(n - 1, Math.floor(n * frac))]);
    const cap = Math.max(3, Math.ceil(n * frac * 1.1));
    while (scores.filter((s) => s >= cut).length > cap && cut < scores[0]) cut++;
    return cut;
  };
  return { hot: cutAt(0.10, FLOORS.hot), strong: cutAt(0.35, FLOORS.strong), worth: FLOORS.worth };
}

// The whole book, read once. Returns a Map leadId -> assessment.
let cache = { key: "", byId: null, sorted: null, cuts: null };
function cacheKey() {
  return ["leads", "vehicles", "specials", "settings", "texts", "links", "sales", "tasks"].map((n) => store.generation(n)).join("|");
}

function readBook() {
  const s = store.getSettings();
  const band = s.dealMatchBand != null ? s.dealMatchBand : 50;
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Signals gathered once for everyone, not per customer.
  const radar = new Map();
  topOpportunities(Infinity).forEach((r) => radar.set(r.lead.id, r));
  const lastIn = new Map(), lastOpen = new Map(), opens = new Map();
  store.all("texts").forEach((t) => {
    if (t.dir !== "in" || !t.leadId) return;
    const at = String(t.at || t.createdAt || "");
    if (at > (lastIn.get(t.leadId) || "")) lastIn.set(t.leadId, at);
  });
  store.all("links").forEach((lk) => {
    const id = lk.meta && lk.meta.leadId;
    if (!id || !lk.lastOpenAt || isLikelyPrefetch(lk)) return;
    if (lk.lastOpenAt > (lastOpen.get(id) || "")) lastOpen.set(id, lk.lastOpenAt);
    opens.set(id, (opens.get(id) || 0) + (Number(lk.opens) || 0));
  });
  const salesByLead = new Map();
  store.all("sales").forEach((x) => { if (x.leadId) salesByLead.set(x.leadId, [...(salesByLead.get(x.leadId) || []), x]); });
  const planned = new Set();
  store.all("tasks").forEach((t) => { if (t.cadence && !t.done && t.leadId) planned.add(t.leadId); });

  const byId = new Map();
  store.all("leads").forEach((l) => {
    const sales = salesByLead.get(l.id) || [];
    const lastSale = sales.map((x) => String(x.saleDate || x.createdAt || "")).sort().pop() || null;
    const a = assessOne(l, { s, band, now, today, radar: radar.get(l.id) || null, lastIn: lastIn.get(l.id), lastOpen: lastOpen.get(l.id), opens: opens.get(l.id) || 0, sales, lastSale, planned: planned.has(l.id) });
    byId.set(l.id, a);
  });
  const sorted = [...byId.values()].sort((a, b) => b.score - a.score || String(b.lead.createdAt || "").localeCompare(String(a.lead.createdAt || "")));
  const cuts = cutsFor(sorted);
  sorted.forEach((a) => { a.tier = tierOf(a.score, cuts); });
  return { byId, sorted, cuts };
}

function assessOne(l, ctx) {
  const { s, band, today, radar } = ctx;
  let score = 0;
  // Each finding carries its weight, so the card shows the reasons that
  // matter most, not the ones that happen to be checked first.
  const found = [];       // { pts, chip, sentence, safe }
  let next = null;        // { label, kind }
  const flags = { inPlay: false, excluded: false, contactable: !!(l.phone || l.email), planned: ctx.planned };
  const why = [];         // sentences with no weight of their own (status notes)
  const add = (pts, chip, sentence, safe) => { score += pts; found.push({ pts, chip, sentence, safe }); };

  // --- Out of scope: gone, or just bought.
  if (store.optedOut(l)) { flags.excluded = true; why.push("Opted out of texts."); }
  if (l.stage === "lost") { flags.excluded = true; why.push("Marked lost."); }
  if (l.stage === "sold" || (l.stage === "delivered" && daysSince(l.updatedAt) != null && daysSince(l.updatedAt) < 60 && ctx.sales.some((x) => daysSince(x.saleDate) < 60))) {
    flags.excluded = true; why.push("Just bought — leave them to enjoy it.");
  }
  if (["appointment", "negotiating"].includes(l.stage)) { flags.inPlay = true; why.push(`Already ${l.stage === "negotiating" ? "at the negotiating table" : "at appointment stage"} — in play.`); }

  // --- 1. The deal: a newer vehicle at what they pay now (radar). The radar's
  // row is the closest payment, which is the right test of "can they move"
  // — but the thing to PITCH is a replacement for what they drive. A
  // Pathfinder owner offered a Kicks reads it as a demotion however well it
  // prices, so when the replacement also fits their payment, that's the one.
  let best = radar ? radar.best : null;
  let alt = null; // the like-for-like replacement when it doesn't fit the payment
  if (radar) {
    const rep = radar.replacement || null;
    if (rep && (rep.delta == null || rep.delta <= band)) best = rep;
    else if (rep && best && String(rep.vehicle.model || "") !== String(best.vehicle.model || "")) alt = rep;
  }
  if (best && best.delta != null) {
    if (best.delta <= -20) add(32, `${currency(Math.round(-best.delta))}/mo less`, `A ${vehName(best.vehicle)} would run about ${currency(Math.round(-best.delta))}/mo LESS than they pay now.`, "they could move into a newer vehicle for less per month than they pay now");
    else if (best.delta <= band) add(26, "Same payment", `A ${vehName(best.vehicle)} lands within ${currency(band)}/mo of what they pay now.`, "they could move into a newer vehicle for about what they pay now");
    else if (best.delta <= 100) add(12, `+${currency(Math.round(best.delta))}/mo`, `A ${vehName(best.vehicle)} would be about ${currency(Math.round(best.delta))}/mo more.`, "a newer vehicle is within reach of their current payment");
  } else if (best) {
    add(8, null, `The natural next vehicle is a ${vehName(best.vehicle)}.`, `the natural next vehicle for them is a ${vehName(best.vehicle)}`);
  } else {
    // Not on the radar, but priced: say what the closest deal is and why it
    // missed, rather than going quiet. (The payment includes any negative
    // equity rolled in — which is usually the reason.)
    const miss = closestDeal(l.id);
    if (miss && miss.best) {
      best = miss.best;
      if (miss.why === "cap") add(0, null, `The closest deal, a ${vehName(miss.best.vehicle)}, is about ${currency(Math.round(miss.best.monthly))}/mo — over the payment ceiling.`, null);
      else add(0, null, `The closest deal, a ${vehName(miss.best.vehicle)}, would be about ${currency(Math.round(miss.best.delta))}/mo MORE than they pay now — over the band.`, null);
    }
  }
  if (best && best.special) add(8, `🏷 ${best.special}`, `Nissan has ${best.special} on it right now.`, `there's a manufacturer program on the ${best.vehicle.model || "next vehicle"} right now (don't quote its terms)`);
  // Say what the like-for-like costs too, so nobody pitches a Kicks to a
  // Pathfinder owner without knowing what the Pathfinder would be.
  if (alt && alt.delta != null) add(0, null, `A like-for-like ${vehName(alt.vehicle)} would be about ${currency(Math.round(alt.delta))}/mo more than they pay now.`, null);

  // --- 2. Equity.
  const eqD = equityDetail(l);
  const eq = eqD.v;
  const est = eqD.src === "est" ? " (estimated)" : "";
  if (eq != null && eq >= 8000) add(26, `${eqD.src === "est" ? "~" : ""}${currency(eq)} equity`, `About ${currency(eq)} of equity in their ${l.vehicleInterest || "vehicle"}${est} — real money toward the next one.`, "their current vehicle is worth a good deal more than what's left owing on it");
  else if (eq != null && eq >= 3000) add(20, `${eqD.src === "est" ? "~" : ""}${currency(eq)} equity`, `About ${currency(eq)} of equity in their ${l.vehicleInterest || "vehicle"}${est}.`, "their current vehicle is worth a good deal more than what's left owing on it");
  else if (eq != null && eq > 0) add(10, "Positive equity", `A little equity in their ${l.vehicleInterest || "vehicle"}${est}.`, "their current vehicle is worth more than what's left owing");
  else if (eq != null && eq < -2000) add(-8, `${currency(-eq)} upside down`, `They owe about ${currency(-eq)} more than the car is worth${est} — go gently, promise nothing.`, "they owe more than their vehicle is worth — go gently and promise nothing");
  else if (eq != null && eq < 0) add(-3, "Slightly upside down", `They owe a little more than the car is worth${est} — about ${currency(-eq)}.`, "they owe a little more than their vehicle is worth");
  // Say where the payoff came from when it was worked out rather than read.
  if (eq != null && eqD.payoffSrc === "calc") why.push(`Payoff worked out as payment × ${monthsRemaining(l) || "?"} payments left.`);
  const paidOff = num(l.currentPayment) == null && (num(l.payoff) == null || num(l.payoff) === 0) && l.purchaseDate;
  if (paidOff && yearsSince(l.purchaseDate) >= 4) add(10, "Paid off", "No payment on file and years in — their car is likely paid off, which is cash in hand toward the next one.", "their current vehicle is likely paid off");

  // --- 3. Time in the vehicle.
  const yrs = yearsSince(l.purchaseDate);
  if (yrs != null && yrs >= 5) add(15, `Owned ${Math.floor(yrs)} yrs`, `${Math.floor(yrs)} years in the ${l.vehicleInterest || "vehicle"} — well past a normal trade cycle.`, `they've had their ${l.vehicleInterest || "vehicle"} about ${Math.floor(yrs)} years`);
  else if (yrs != null && yrs >= 3) add(12, `Owned ${Math.floor(yrs)} yrs`, `${Math.floor(yrs)} years in — right in the window most people trade.`, `they've had their ${l.vehicleInterest || "vehicle"} about ${Math.floor(yrs)} years`);
  else if (yrs != null && yrs >= 2) add(5, null, null, null);

  // --- 4. The contract: lease maturity or months left to run.
  const months = monthsRemaining(l);
  const leaseDeal = /lease/i.test(String(l.dealType || "")) || /deal type:\s*lease/i.test(String(l.notes || "")) || /lease/i.test(String(l.alertType || "")) || !!l.leaseEnd;
  if (months != null) {
    const what = leaseDeal ? "lease" : "contract";
    if (months <= 3) add(26, `${what === "lease" ? "Lease" : "Contract"} ends in ${months} mo`, `Their ${what} is up in about ${months} month${months === 1 ? "" : "s"} — decision time.`, `their ${what} is up within about ${months === 1 ? "a month" : months + " months"}`);
    else if (months <= 6) add(16, `${what === "lease" ? "Lease" : "Contract"} ends in ${months} mo`, `Their ${what} runs out in about ${months} months — the right time to look at options.`, `their ${what} is up in about ${months} months`);
    else if (months <= 12) add(8, null, `About ${months} months left on their ${what}.`, null);
  }

  // --- 5. Warranty running out — the moment a repair bill becomes a reason.
  const [bYrs, bKm, pYrs, pKm] = warrantyFor(l.vehicleInterest);
  const km = num(l.odometer);
  const modelYear = Number((String(l.vehicleInterest || "").match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
  const age = yrs != null ? yrs : (modelYear ? (new Date().getFullYear() - modelYear + 0.5) : null);
  const nearBasic = (age != null && age >= bYrs - 0.35 && age <= bYrs + 0.6) || (km != null && isFinite(bKm) && km >= bKm * 0.87 && km <= bKm * 1.1);
  const nearPower = (age != null && age >= pYrs - 0.35 && age <= pYrs + 0.6) || (km != null && isFinite(pKm) && km >= pKm * 0.9 && km <= pKm * 1.08);
  if (nearBasic) add(10, "Warranty ending", `Basic warranty (${bYrs} yr/${isFinite(bKm) ? bKm.toLocaleString() + " km" : "unlimited"}) is running out.`, "their factory warranty is about to run out");
  else if (nearPower) add(10, "Powertrain warranty ending", `Powertrain warranty (${pYrs} yr/${isFinite(pKm) ? pKm.toLocaleString() + " km" : "unlimited"}) is running out.`, "their powertrain warranty is about to run out");

  // --- 6. Mileage against a lease allowance, or just a lot of driving.
  if (km != null && yrs != null && yrs >= 0.5) {
    const perYear = km / yrs;
    const allow = Number(s.tradeKmPerYear) || 20000;
    if (leaseDeal && perYear > allow * 1.1) add(12, "Over km on lease", `Driving about ${Math.round(perYear / 1000)}k km/yr against a ${Math.round(allow / 1000)}k allowance — trading early avoids the excess-km charge.`, "they're running ahead of their lease's kilometre allowance, so an early move can save them the excess charge");
    else if (perYear >= 30000) add(6, "High km", `About ${Math.round(perYear / 1000)}k km a year — the car is aging fast.`, "they drive a lot, so the car is aging quickly");
  }

  // --- 7. Their rate against today's.
  const theirs = num(l.currentApr) ?? inferApr(l);
  const prog = best && best.apr != null ? best.apr : null;
  if (theirs != null && prog != null && theirs - prog >= 1.5) add(12, `${theirs}% → ${prog}%`, `Carrying ${theirs}% against a ${prog}% program rate on the ${vehName(best.vehicle)}.`, "their current rate is well above what's available now");
  else if (theirs != null && theirs > (Number(s.defaultApr) || 0) + 1) add(8, `Rate ${theirs}%`, `Carrying ${theirs}% — above today's typical ${s.defaultApr}%.`, "their current rate is above what's typical now");

  // --- 8. What the export flagged, and the service drive.
  // From the fields when the import stored them, else from the notes line the
  // older importer wrote ("AutoAlert: Flex · Priority: High · Deal type: …").
  const notes = String(l.notes || "");
  const fromNotes = (label) => ((notes.match(new RegExp(label + ":\\s*([^\\n]+)", "i")) || [])[1] || "").split(" · ")[0].trim();
  const alert = String(l.alertType || "").trim() || fromNotes("AutoAlert");
  if (alert) add(15, `AutoAlert: ${alert.slice(0, 28)}`, `AutoAlert flagged them: ${alert}.`, "the dealership's own system flagged them as a good time to talk");
  const pri = String(l.priority || "").trim() || fromNotes("Priority");
  if (/high|hot|1\b|a\b/i.test(pri)) add(8, "High priority", `Priority: ${pri}.`, null);
  const svc = (l.serviceAppt && /^\d{4}-\d{2}-\d{2}/.test(String(l.serviceAppt)) ? String(l.serviceAppt).slice(0, 10) : null)
    || (notes.match(/Service appt\s*(\d{4}-\d{2}-\d{2})/i) || [])[1] || null;
  const svcDays = svc ? daysFromToday(svc) : null;
  if (svcDays != null && svcDays >= 0 && svcDays <= 14) { add(14, `In service ${svcDays === 0 ? "today" : "in " + svcDays + "d"}`, `They're in the service drive on ${svc} — meet them there.`, "they'll be in for service shortly"); next = { label: `Meet them in the service drive ${svcDays === 0 ? "today" : "on " + svc}`, kind: "service" }; }

  // --- 9. Engagement: they've touched something.
  const openDays = daysSince(ctx.lastOpen);
  if (openDays != null && openDays <= 7) { add(25, "Opened your link", `Opened something you sent ${openDays < 1 ? "today" : Math.round(openDays) + " day" + (Math.round(openDays) === 1 ? "" : "s") + " ago"}${ctx.opens > 1 ? ` (${ctx.opens}×)` : ""} — they're looking.`, "they recently opened something you sent them"); if (!next) next = { label: "Text now — they're looking", kind: "hot" }; }
  // (A hot next-move that needs a text still yields to consent below.)
  const inDays = daysSince(ctx.lastIn);
  if (inDays != null && inDays <= 14) { add(20, "Texted you", `Texted you ${inDays < 1 ? "today" : Math.round(inDays) + " days ago"}.`, "they've been in touch by text recently"); if (!next) next = { label: "Reply in the conversation", kind: "reply" }; }

  // --- 10. A live shopper.
  const p = l.profile || {};
  if (["new", "working"].includes(l.stage) && !l.purchaseDate && num(l.currentPayment) == null) {
    add(20, "Live lead", "A live enquiry, not an owner — work the plan.", "they're actively looking");
    if (p.timeline || p.budget != null) add(10, "Shopping now", `They've given a timeline${p.timeline ? ` (${p.timeline})` : ""} or a budget — they mean it.`, "they've said when they want to buy");
    if (ctx.planned && !next) next = { label: "Follow the plan — next text is drafted for you", kind: "plan" };
  }

  // --- 11. Recency: leave people alone for a while after they've been reached.
  const cDays = daysSince(l.lastContacted);
  if (cDays != null && cDays <= 14) add(-15, null, `Contacted ${Math.round(cDays)} day${Math.round(cDays) === 1 ? "" : "s"} ago — give it a moment.`, null);
  const kDays = daysSince(l.lastCampaignAt);
  if (kDays != null && kDays <= 30) add(-10, null, `In a campaign ${Math.round(kDays)} days ago.`, null);
  if (!flags.contactable) add(-20, "No phone or email", "No way to reach them on file.", null);

  // --- 12. Permission to text. Without it the app won't draft an opener,
  // so the move is a call — and the card says so.
  const consent = consentStatus(l, { lastIn: ctx.lastIn || null, lastSale: ctx.lastSale || null }, ctx.now);
  flags.consent = consent;
  if (!flags.excluded && !consent.ok && l.phone) {
    add(-12, "No texting consent", consent.until
      ? `No consent to text — implied consent from ${consent.source} ran out ${consent.until}. Call, or record consent.`
      : "No consent on file to text them. Call, or record consent on their page.", null);
    // A next move that was going to be a text becomes a call.
    if (next && ["hot", "opener", "plan"].includes(next.kind)) next = { label: `Call — ${next.label.replace(/^Text( now)?\s*—?\s*/i, "").replace(/^the opener — /, "")} (no texting consent)`, kind: "call" };
  }

  if (flags.excluded) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = null; // set once the whole book is scored — see readBook

  // Heaviest reasons first; the cautions (negative weight) come last — but a
  // caution always keeps a place on the card. "Upside down" is the one thing
  // the salesperson must not learn at the desk.
  found.sort((a, b) => b.pts - a.pts);
  const chips = found.filter((f) => f.chip);
  const cautions = chips.filter((f) => f.pts < 0).sort((a, b) => a.pts - b.pts).slice(0, 2);
  const reasons = [...chips.filter((f) => f.pts >= 0).slice(0, 4 - cautions.length), ...cautions].map((f) => f.chip);
  const whyAll = [...found.filter((f) => f.sentence).map((f) => f.sentence), ...why];
  const whySafe = found.filter((f) => f.safe && f.pts > 0).map((f) => f.safe);

  if (!next) {
    if (flags.excluded) next = null;
    else if (flags.inPlay) next = { label: "Keep the deal moving", kind: "inplay" };
    else if (!consent.ok && l.phone && score >= 20) next = { label: "Call — no texting consent on file", kind: "call" };
    else if (months != null && months <= 6 && leaseDeal) next = { label: "Text the lease-end opener", kind: "opener" };
    else if (best && score >= 20) next = { label: `Text the opener — pitch a ${vehName(best.vehicle)}`, kind: "opener" };
    else if (score >= 20) next = { label: "Text an opener", kind: "opener" };
    else if (!flags.contactable) next = { label: "Add a phone number", kind: "fix" };
    else next = { label: "Nothing pressing — keep on file", kind: "none" };
  }

  return { lead: l, score, tier, reasons, why: whyAll, whySafe, next, best, flags };
}

// The read of the whole book, cached until something it reads changes.
export function assessAll() {
  const key = cacheKey();
  if (cache.byId && cache.key === key) return cache;
  const r = readBook();
  cache = { key, byId: r.byId, sorted: r.sorted, cuts: r.cuts };
  return cache;
}

export function assessment(leadId) {
  return assessAll().byId.get(leadId) || null;
}

// The book in order, best first.
export function ranked() {
  return assessAll().sorted;
}

// Counts for the top of the Leads page.
export function bookSummary() {
  const rows = ranked();
  return {
    total: rows.length,
    hot: rows.filter((a) => a.tier && a.tier.label === "Hot").length,
    strong: rows.filter((a) => a.tier && a.tier.label === "Strong").length,
    worth: rows.filter((a) => a.tier && a.tier.label === "Worth a call").length,
  };
}
