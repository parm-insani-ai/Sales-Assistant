// Payment matching without a phone's store: what a customer could drive for
// the money they pay now, priced against the store's shared inventory.
//
// The rep's deal builder does this with the rep's own settings and lot. The
// manager's read needs the same answer for every customer in every rep's
// book, from an account that may hold no inventory at all — so this is the
// deal arithmetic reduced to what changes per customer, precomputed per
// unit, and pure. Nova Scotia rules: tax on the price less the trade
// allowance; new-vehicle fees taxable, plate registration not.
//
// `settings`: taxRate (%), docFee, avpRogue, avpOther, feeFreight,
// feeAirTax, feeTireLevy, feePlateReg, defaultApr (%), defaultTerm (months),
// dealMatchBand ($/mo).

import { classify, classifyUnit, fitScore } from "./segments.js";
import { paymentsLeftOf } from "./contract.js";

const num = (v, d = 0) => (v == null || v === "" || !isFinite(Number(v)) ? d : Number(v));
const isNew = (v) => /new/i.test(String(v.condition || "")) || (v.mileage != null && Number(v.mileage) < 500 && !/used|pre-owned/i.test(String(v.condition || "")));

// Monthly payment per dollar financed.
export function perDollar(apr, term) {
  const n = Math.max(1, num(term, 72)), r = num(apr, 0) / 1200;
  return r ? r / (1 - Math.pow(1 + r, -n)) : 1 / n;
}

// The fees on a unit, the way the desk charges them.
export function feesFor(v, s = {}) {
  const doc = num(s.docFee, 699);
  if (!isNew(v)) return { taxable: doc, nonTaxable: 0 };
  const avp = /rogue/i.test(String(v.model || "")) ? num(s.avpRogue, 699) : num(s.avpOther, 599);
  return { taxable: avp + num(s.feeFreight, 2100) + num(s.feeAirTax, 100) + num(s.feeTireLevy, 22.5) + doc, nonTaxable: num(s.feePlateReg, 13.2) };
}

/**
 * Precompute the store's units once: class, fixed costs, and the factor
 * that turns an amount financed into a monthly. Units with no price, or
 * not available, are left out.
 */
export function prepareUnits(vehicles, s = {}) {
  const t = num(s.taxRate, 15) / 100;
  const k = perDollar(s.defaultApr ?? 7.9, s.defaultTerm ?? 72);
  return (vehicles || []).filter((v) => v && num(v.price) > 0 && (v.status || "available") === "available").map((v) => {
    const fees = feesFor(v, s);
    const price = num(v.price);
    return { v, cls: classifyUnit(v), price, fixed: fees.taxable * (1 + t) + fees.nonTaxable, k, t, name: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") };
  });
}

// What the customer brings to the desk: trade value and what's owing.
export function tradeOf(l, now = Date.now()) {
  const value = num(l.currentValue, null);
  if (value == null) return { value: 0, payoff: 0, known: false };
  let payoff = num(l.payoff, null);
  if (payoff == null) {
    const pl = paymentsLeftOf(l, new Date(now)), pmt = num(l.currentPayment, null);
    payoff = pl && pmt != null ? pmt * pl.left : 0;
  }
  return { value, payoff, known: true };
}

// The monthly on one unit for one customer.
export function monthlyFor(unit, trade) {
  const taxable = Math.max(0, unit.price - trade.value);
  const total = unit.price + taxable * unit.t + unit.fixed - (trade.value - trade.payoff);
  return Math.round(Math.max(0, total) * unit.k);
}

/**
 * The match for one customer: the unit closest to what they pay, and the
 * like-for-like replacement, the way the rep's radar picks them.
 * Returns null when there's nothing to price against; otherwise
 * { best: { unit, monthly, delta }, replacement: { unit, monthly, delta, fit } | null, pitch }
 * where `pitch` is the one to talk about (the replacement when it fits the
 * payment, else the closest payment) and delta = monthly − current (null
 * when the customer has no payment on file).
 */
export function matchFor(l, units, s = {}, now = Date.now()) {
  if (!units || !units.length) return null;
  const cur = num(l.currentPayment, null);
  const trade = tradeOf(l, now);
  const owned = classify(String(l.vehicleInterest || ""));
  const band = num(s.dealMatchBand, 50);
  let best = null, rep = null, pitch = null;
  for (const u of units) {
    const monthly = monthlyFor(u, trade);
    const delta = cur != null ? monthly - cur : null;
    if (cur != null && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { unit: u, monthly, delta };
    const fit = fitScore(owned, u.cls, { trim: u.v.trim, year: u.v.year, make: u.v.make, condition: u.v.condition });
    // The like-for-like replacement: the best-fitting unit, whatever it costs.
    if (!rep || fit > rep.fit) rep = { unit: u, monthly, delta, fit };
    // The pitch: among units that genuinely fit what they drive (the right
    // kind of vehicle) and are within reach of their payment, the one that
    // weighs fit against how far the payment moves — a Rogue at $80/mo over
    // beats a truck at the same payment for a Murano owner. With nothing
    // that fits within reach, the closest payment is what there is.
    const over = delta != null && delta > band ? delta - band : 0;
    const within = delta == null || delta <= band + 100;
    if (fit >= 40 && within) {
      const pick = fit - over * 0.25 + (delta != null && delta < -20 ? 5 : 0);
      if (!pitch || pick > pitch.pick) pitch = { unit: u, monthly, delta, fit, pick };
    }
  }
  if (!best && !rep) return null;
  if (!pitch && best) pitch = { ...best, fit: 0, pick: 0 };
  if (!pitch && rep) pitch = { ...rep, pick: 0 };
  if (pitch) pitch.fitsPay = cur == null || pitch.delta <= band;
  if (rep) rep.fitsPay = cur == null || rep.delta <= band;
  return { best, replacement: rep, pitch, current: cur, trade };
}

// A matcher over the store's units for a batch of reads.
export function makeMatcher(vehicles, s = {}, now = Date.now()) {
  const units = prepareUnits(vehicles, s);
  if (!units.length) return null;
  return (l) => matchFor(l, units, s, now);
}

export const unitName = (u) => (u ? u.name || [u.v.year, u.v.make, u.v.model, u.v.trim].filter(Boolean).join(" ") : "");
