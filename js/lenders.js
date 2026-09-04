// Credit tiers and the lender matrix — the difference between a payment and a
// deal.
//
// Every payment the app quoted before this file existed used one program rate,
// which is the rate Tier 1 gets. That's the quiet way a salesperson loses a
// customer: quote 4.99% to someone who books at 13.99%, send them home happy,
// and let the desk deliver the news two days later. Worse, rate isn't even the
// usual killer — advance is. A lender that will happily lend at that rate still
// won't advance more than a set percentage of the car's value, so a deal with
// too little down doesn't get a worse payment, it gets declined.
//
// So this answers the two questions a desk actually asks:
//   1. At this customer's tier, what does the money really cost?
//   2. Will anybody buy this structure — and if not, what fixes it?
//
// The rate sheet is the user's. The seeded numbers below are starting points so
// the feature works out of the box, and every lender carries `seeded: true`
// until it's edited, so the app can say plainly that these aren't your store's
// numbers yet.

import * as store from "./store.js";
import { uid } from "./utils.js";

// Tiers as a Canadian desk uses them. The score bands are the common shape;
// individual lenders slide the lines around, which is what the per-lender
// `tiers` map is for.
export const TIERS = [
  { id: "1", label: "Tier 1", range: "750+", blurb: "Prime. Books anywhere." },
  { id: "2", label: "Tier 2", range: "700–749", blurb: "Prime. Full bank menu." },
  { id: "3", label: "Tier 3", range: "660–699", blurb: "Near prime. Most banks, some pricing." },
  { id: "4", label: "Tier 4", range: "620–659", blurb: "Bruised. Captive or alt lenders." },
  { id: "5", label: "Tier 5", range: "575–619", blurb: "Subprime. Advance caps bite." },
  { id: "6", label: "Tier 6", range: "under 575", blurb: "Deep subprime. Money down matters most." },
];

export function tierMeta(id) {
  return TIERS.find((t) => t.id === String(id)) || null;
}

// A starting sheet for a Nissan store. Names are the lenders such a store
// actually books through; the numbers are plausible placeholders, not anyone's
// published rates — they exist so the matching works on day one and so there's
// something concrete to correct. `seeded` marks them as not-yet-yours.
const SEEDED = [
  { name: "Nissan Canada Finance", kind: "captive",
    tiers: { 1: 5.99, 2: 6.99, 3: 8.49, 4: 10.99 },
    longTermAdd: 0.5, maxTerm: 84, maxAdvance: 140, minAmount: 5000, maxAmount: 120000,
    feePct: 0, newOnly: false, maxAgeYears: 8, maxKm: 160000 },
  { name: "Scotiabank", kind: "bank",
    tiers: { 1: 7.49, 2: 8.29, 3: 9.99 },
    longTermAdd: 0.5, maxTerm: 84, maxAdvance: 130, minAmount: 7500, maxAmount: 150000,
    feePct: 0, newOnly: false, maxAgeYears: 8, maxKm: 160000 },
  { name: "TD Auto Finance", kind: "bank",
    tiers: { 1: 7.79, 2: 8.49, 3: 10.29, 4: 12.99 },
    longTermAdd: 0.5, maxTerm: 84, maxAdvance: 130, minAmount: 7500, maxAmount: 150000,
    feePct: 0, newOnly: false, maxAgeYears: 8, maxKm: 180000 },
  { name: "RBC", kind: "bank",
    tiers: { 1: 7.59, 2: 8.39, 3: 10.49 },
    longTermAdd: 0.5, maxTerm: 84, maxAdvance: 125, minAmount: 7500, maxAmount: 150000,
    feePct: 0, newOnly: false, maxAgeYears: 7, maxKm: 160000 },
  { name: "iA Auto Finance", kind: "subprime",
    tiers: { 3: 12.99, 4: 15.99, 5: 18.99, 6: 22.99 },
    longTermAdd: 0, maxTerm: 84, maxAdvance: 125, minAmount: 7500, maxAmount: 65000,
    feePct: 4, newOnly: false, maxAgeYears: 8, maxKm: 180000 },
  { name: "Rifco", kind: "subprime",
    tiers: { 4: 16.99, 5: 19.99, 6: 24.99 },
    longTermAdd: 0, maxTerm: 72, maxAdvance: 120, minAmount: 7500, maxAmount: 55000,
    feePct: 6, newOnly: false, maxAgeYears: 8, maxKm: 180000 },
  { name: "Eden Park", kind: "subprime",
    tiers: { 5: 21.99, 6: 27.99 },
    longTermAdd: 0, maxTerm: 72, maxAdvance: 115, minAmount: 7500, maxAmount: 45000,
    feePct: 8, newOnly: false, maxAgeYears: 10, maxKm: 200000 },
];

function seedSheet() {
  return SEEDED.map((l, i) => ({
    id: "lnd_" + i + "_" + l.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8),
    active: true, seeded: true, order: i, notes: "", ...l,
  }));
}

// The sheet lives in settings, so it syncs and backs up with everything else.
export function getLenders() {
  const s = store.getSettings();
  const rows = Array.isArray(s.lenders) ? s.lenders : null;
  if (!rows || !rows.length) return seedSheet();
  return rows.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function saveLenders(rows) {
  store.updateSettings({ lenders: rows.map((r, i) => ({ ...r, order: i })) });
}

export function newLender() {
  return {
    id: uid("lnd"), name: "", kind: "bank", tiers: {}, longTermAdd: 0.5,
    maxTerm: 84, maxAdvance: 130, minAmount: 7500, maxAmount: 100000,
    feePct: 0, newOnly: false, maxAgeYears: 0, maxKm: 0,
    active: true, seeded: false, notes: "",
  };
}

// True while the user is still looking at placeholder rates. Worth saying out
// loud wherever a rate from this sheet is shown.
export function sheetIsSeeded() {
  return getLenders().every((l) => l.seeded);
}

export function tierApr(lender, tier, term) {
  const base = lender.tiers?.[String(tier)] ?? lender.tiers?.[tier];
  if (base == null || base === "") return null;
  const n = Number(base);
  if (isNaN(n)) return null;
  return Number(term) > 72 ? n + (Number(lender.longTermAdd) || 0) : n;
}

function payment(amount, apr, term) {
  const r = (Number(apr) || 0) / 100 / 12;
  const t = Math.max(1, Math.round(Number(term) || 0));
  if (!r) return amount / t;
  return (amount * r) / (1 - Math.pow(1 + r, -t));
}

// How much cash down brings the amount financed under an advance cap. Down
// money reduces the financed amount dollar for dollar, so the shortfall IS the
// down payment needed — no algebra, but worth naming because it's the single
// most useful sentence the desk says: "it works with $2,300 down."
function downToFit(amountFinanced, cap) {
  return Math.max(0, Math.ceil((amountFinanced - cap) / 50) * 50);
}

/**
 * Run a structure past the whole sheet.
 *
 * deal: { amountFinanced, value, term, tier, isNew, ageYears, km }
 *   value — what the lender advances against: MSRP on a new car, book on a
 *   used one. Defaults to the amount financed, which makes every LTV 100% and
 *   is the safe direction to be wrong in (it under-reports the problem rather
 *   than inventing one).
 *
 * Returns { approved[], declined[], best, tier } — each row carries the APR,
 * the real payment at that rate, the LTV, and for a decline the specific fix.
 */
export function matchLenders(deal) {
  const amount = Math.max(0, Number(deal.amountFinanced) || 0);
  const value = Math.max(0, Number(deal.value) || 0) || amount;
  const term = Math.max(1, Math.round(Number(deal.term) || 0));
  const tier = String(deal.tier || "");
  const approved = [];
  const declined = [];

  for (const l of getLenders()) {
    if (!l.active) continue;
    const apr = tierApr(l, tier, term);
    const cap = value * (Number(l.maxAdvance) || 0) / 100;
    const blocks = [];
    let fix = "";

    if (apr == null) {
      blocks.push(`Doesn't buy ${tierMeta(tier)?.label || "this tier"}`);
    }
    if (term > (Number(l.maxTerm) || 0)) {
      blocks.push(`Caps at ${l.maxTerm} months`);
      fix = fix || `Re-run at ${l.maxTerm} months`;
    }
    if (amount > cap && cap > 0) {
      const need = downToFit(amount, cap);
      blocks.push(`Over their ${l.maxAdvance}% advance`);
      fix = fix || `${need ? `$${need.toLocaleString()} down` : "More down"} brings it inside`;
    }
    if (Number(l.maxAmount) && amount > Number(l.maxAmount)) {
      blocks.push(`Above their $${Number(l.maxAmount).toLocaleString()} ceiling`);
    }
    if (Number(l.minAmount) && amount && amount < Number(l.minAmount)) {
      blocks.push(`Below their $${Number(l.minAmount).toLocaleString()} floor`);
    }
    if (l.newOnly && deal.isNew === false) blocks.push("New vehicles only");
    if (Number(l.maxAgeYears) && Number(deal.ageYears) > Number(l.maxAgeYears)) {
      blocks.push(`Vehicle older than ${l.maxAgeYears} years`);
    }
    if (Number(l.maxKm) && Number(deal.km) > Number(l.maxKm)) {
      blocks.push(`Over ${Number(l.maxKm).toLocaleString()} km`);
    }

    const row = {
      lender: l,
      name: l.name,
      kind: l.kind,
      apr,
      seeded: !!l.seeded,
      monthly: apr == null ? null : payment(amount, apr, term),
      ltv: value ? (amount / value) * 100 : null,
      // Subprime paper is bought at a discount — the lender keeps a slice of the
      // amount financed. It never touches the customer's payment, so it isn't a
      // reason to decline a lender; it's the cost of using them, and it comes
      // out of the store's gross.
      fee: (Number(l.feePct) || 0) ? amount * (Number(l.feePct) || 0) / 100 : 0,
      blocks,
      fix,
    };
    if (blocks.length) declined.push(row);
    else approved.push(row);
  }

  approved.sort((a, b) => (a.monthly || 0) - (b.monthly || 0));
  // A lender one fix away is more useful than one that will never buy this
  // customer, so sort the declines by how close they are.
  declined.sort((a, b) => (a.fix ? 0 : 1) - (b.fix ? 0 : 1) || a.blocks.length - b.blocks.length);

  return { approved, declined, best: approved[0] || null, tier };
}

/**
 * The honest headline: what this customer's tier does to the payment the
 * calculator is showing. Returns null when there's nothing to compare — no
 * tier chosen, or nobody will buy it.
 */
export function tierGap(quotedMonthly, match) {
  if (!match?.best || quotedMonthly == null) return null;
  const delta = match.best.monthly - quotedMonthly;
  return { delta, real: match.best.monthly, lender: match.best.name, apr: match.best.apr };
}
