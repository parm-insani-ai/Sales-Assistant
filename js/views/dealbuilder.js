// Deal Builder — the AutoAlert-style payment-match engine. For a customer with a
// known current payment and equity (value − payoff), it prices every available
// inventory vehicle as a trade-in deal and surfaces the ones they could get into
// for close to what they pay now. Turns equity data into ready-to-pitch offers.

import * as store from "../store.js";
import { computeDeal, computeLease } from "./calculator.js";
// Re-exported so callers keep importing the deal math from one place.
export { computeLease };
import { openModal, toast, closeAllModals } from "../components.js";
import { navigate } from "../router.js";
import { openAppointmentForm } from "./calendar.js";
import { icon } from "../icons.js";
import { fillTemplate } from "./messages.js";
import { currency, currency2, esc, smsHref, telHref, parseDate, daysFromToday } from "../utils.js";
import { SPEC_LIBRARY } from "../specs.js";
import { findSpec, queueCompare } from "./compare.js";

function num(v) { return Number(v) || 0; }

// ---- The accuracy ladder: known → calculated → book estimate → assumption ----
// AutoAlert exports rarely carry everything the math needs. Instead of silently
// assuming, each input is resolved with a provenance tag so every deal can say
// exactly what it stands on — and the profile can ask for the missing piece.

// Trade-in estimate built the way an appraisal actually works:
//   1. guide base    — the TRIM's MSRP (not the model base) on an age curve
//                      (-25% year one, -13%/yr after: wholesale side)
//   2. km adjustment — over/under expected km (settings: km/yr, $/km),
//                      capped at ±20% of the base so bad data can't run away
//   3. condition     — clean +5% / average 0 / rough −15% (graded on the lead)
//   4. market check  — a comparable used unit on OUR lot is a real local
//                      price: retail − margin% − recon ≈ wholesale; blend 50/50
// Floored at 10% of MSRP, rounded to $100. Returns the number plus the lines
// of the workup so the deal can show exactly how it got there.
export function estimateTradeDetail(lead) {
  const s = store.getSettings();
  const vi = String(lead.vehicleInterest || "");
  const year = Number((vi.match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
  if (!year) return null;
  // "2023 Nissan Rogue SV" — findSpec needs every token to hit, so drop
  // trailing words (the trim) until the model matches.
  let spec = null;
  const qWords = vi.replace(/^\d{4}\s*/, "").trim().split(/\s+/).filter(Boolean);
  for (let k = qWords.length; k >= 1 && !spec; k--) {
    try { spec = findSpec(qWords.slice(0, k).join(" ")); } catch { spec = null; }
  }
  if (!spec || !spec.msrp) return null;
  const lines = [];

  // Trim-aware base: if their vehicle string names a trim we know, price THAT.
  let msrp = spec.msrp, trimName = "";
  if (Array.isArray(spec.trims)) {
    const viLow = " " + vi.toLowerCase() + " ";
    let best = null;
    spec.trims.forEach((t) => {
      const first = String(t.name).toLowerCase().split(/[\s/]+/)[0];
      if (first && viLow.includes(" " + first + " ") && (!best || first.length > best.first.length)) best = { t, first };
    });
    if (best && best.t.msrp) { msrp = best.t.msrp; trimName = best.t.name; }
  }
  const age = Math.max(0, new Date().getFullYear() - year);
  const curve = age === 0 ? 0.85 : 0.75 * Math.pow(0.87, age - 1);
  let value = msrp * curve;
  lines.push(`${trimName ? trimName + " " : ""}base ${currency(msrp)} × ${Math.round(curve * 100)}% (${age} yr)`);

  if (lead.odometer != null && lead.odometer !== "") {
    const expected = (Number(s.tradeKmPerYear) || 20000) * Math.max(age, 0.5);
    const delta = Number(lead.odometer) - expected;
    let adj = -delta * (Number(s.tradeKmRate) || 0.05);
    const cap = value * 0.2;
    adj = Math.max(-cap, Math.min(cap, adj));
    if (Math.abs(adj) >= 100) {
      value += adj;
      lines.push(`${delta > 0 ? "high" : "low"} km (${Math.round(Number(lead.odometer) / 1000)}k vs ~${Math.round(expected / 1000)}k) ${adj > 0 ? "+" : "−"}${currency(Math.abs(Math.round(adj)))}`);
    }
  }

  const cond = String(lead.tradeCondition || "").toLowerCase();
  if (cond === "clean") { value *= 1.05; lines.push("clean condition +5%"); }
  else if (cond === "rough") { value *= 0.85; lines.push("rough condition −15%"); }

  // Market check against our own used inventory (vAuto-style retail-minus).
  let basis = "book";
  const ml = String(spec.label).toLowerCase();
  const comp = store.all("vehicles").find((v) =>
    v.price != null && /used/i.test(String(v.condition || "")) &&
    String(v.model || "").trim() && ml.includes(String(v.model).toLowerCase().trim()) &&
    Number(v.year) && Math.abs(Number(v.year) - year) <= 1);
  if (comp) {
    const wholesale = comp.price * (1 - (Number(s.tradeMarginPct) || 9) / 100) - (Number(s.tradeRecon) || 1500);
    if (wholesale > 0) {
      value = (value + wholesale) / 2;
      basis = "market";
      lines.push(`market check: ${comp.year} ${comp.model} on lot at ${currency(comp.price)} → wholesale ≈ ${currency(Math.round(wholesale))}`);
    }
  }

  value = Math.max(Math.round(value / 100) * 100, Math.round(spec.msrp * 0.1));
  return { value, basis, lines };
}

export function estimateTradeValue(lead) {
  const d = estimateTradeDetail(lead);
  return d ? d.value : null;
}

// Months left on their contract — from the maturity date, or purchase date +
// term when that's all we have.
export function monthsRemaining(lead) {
  let end = lead.leaseEnd ? new Date(lead.leaseEnd) : null;
  if ((!end || isNaN(end)) && lead.purchaseDate && Number(lead.currentTerm)) {
    const p = new Date(lead.purchaseDate);
    if (!isNaN(p)) end = new Date(p.getFullYear(), p.getMonth() + Number(lead.currentTerm), p.getDate());
  }
  if (!end || isNaN(end)) return null;
  const m = Math.round((end - new Date()) / (30.44 * 86400000));
  return m > 0 ? m : null;
}

// Their actual APR, solved from what we do know: the payoff is the present
// value of the remaining payments, so payment + payoff + months remaining
// pins the rate. Bisection on the annuity formula.
export function inferApr(lead) {
  if (lead.currentApr != null && lead.currentApr !== "") return null; // already known
  const pmt = num(lead.currentPayment), pv = num(lead.payoff);
  const n = monthsRemaining(lead);
  if (!pmt || !pv || !n || n < 3) return null;
  if (pmt * n <= pv) return null; // payments don't cover principal — bad data
  let lo = 0, hi = 30;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2, r = mid / 1200;
    const pvAt = r ? (pmt * (1 - Math.pow(1 + r, -n))) / r : pmt * n;
    if (pvAt > pv) lo = mid; else hi = mid;
  }
  const apr = Math.round(((lo + hi) / 2) * 10) / 10;
  return apr >= 0.5 && apr <= 25 ? apr : null;
}

// No payoff column? Calculate what they still have to pay: current payment ×
// payments left to maturity. (Deliberately simple per the desk's preference —
// it includes remaining interest, so it runs a touch conservative on equity.)
export function inferPayoff(lead) {
  if (lead.payoff != null && lead.payoff !== "") return null; // already known
  const pmt = num(lead.currentPayment);
  const n = monthsRemaining(lead);
  if (!pmt || !n) return null;
  return Math.round((pmt * n) / 10) * 10;
}

// Every input the deal math uses, with where it came from:
// "known" (on file) · "calc" (solved) · "book" (estimated) · "wash" (assumed
// trade = payoff) · "default" (store setting) · "missing".
export function dealInputs(lead) {
  const s = store.getSettings();
  const est = lead.currentValue == null ? estimateTradeValue(lead) : null;
  const calcApr = inferApr(lead);
  const calcPayoff = inferPayoff(lead);
  const payoff = lead.payoff != null ? { v: lead.payoff, src: "known" }
    : calcPayoff != null ? { v: calcPayoff, src: "calc" } : { src: "missing" };
  return {
    payment: lead.currentPayment != null ? { v: lead.currentPayment, src: "known" } : { src: "missing" },
    payoff,
    value: lead.currentValue != null ? { v: lead.currentValue, src: "known" }
      : est != null ? { v: est, src: "book" }
      : payoff.v != null ? { v: payoff.v, src: "wash" } : { src: "missing" },
    apr: lead.currentApr != null && lead.currentApr !== "" ? { v: Number(lead.currentApr), src: "known" }
      : calcApr != null ? { v: calcApr, src: "calc" } : { v: s.defaultApr, src: "default" },
    maturity: monthsRemaining(lead) != null ? { v: monthsRemaining(lead), src: "known" } : { src: "missing" },
  };
}

function financeBase(lead, down) {
  const s = store.getSettings();
  const inp = dealInputs(lead);
  return {
    down: down != null ? down : 0,
    tradeAllowance: inp.value.v || 0,
    tradePayoff: inp.payoff.v || 0,
    fees: s.docFee,
    taxRate: s.taxRate,
    // NEW money is priced at the store's standard rate (a program rate from the
    // bulletin overrides it per vehicle). Never at the customer's existing
    // contract rate — someone carrying 14.9% from an old subprime deal would
    // get every new car quoted at 14.9%, which buries the payment and kills
    // the rate-reduction pitch. Their rate belongs on their side of the deal.
    apr: num(s.defaultApr),
  };
}

function availableVehicles() {
  return store.all("vehicles").filter((v) => (v.status || "available") === "available" && v.price != null);
}

// ---- Incentives: the Monthly Specials feed the deal math ----
const todayISO = () => new Date().toISOString().slice(0, 10);
function activeSpecials() {
  return store.all("specials").filter((sp) => !sp.expiry || sp.expiry >= todayISO());
}

// The active special that applies to a vehicle. The special's model keyword
// must be contained in the vehicle's model, and the most specific match wins —
// so "Rogue Plug-in Hybrid" takes its own program while a plain Rogue never
// inherits the PHEV's cash.
export function specialFor(v) {
  const model = String(v.model || v.label || "").toLowerCase().trim();
  if (!model) return null;
  const vy = Number(v.year) || null;
  // Rank: most specific model match first, then exact model-year match, then
  // yearless programs, then the oldest program year (the mainstream MY).
  const rank = (sp, m) => {
    const sy = Number(sp.year) || null;
    return [m.length, sy && vy && sy === vy ? 2 : sy ? 0 : 1, sy ? -sy : 0];
  };
  let best = null, bestR = null;
  activeSpecials().forEach((sp) => {
    const m = String(sp.model || "").toLowerCase().trim();
    if (!m || !model.includes(m)) return;
    const sy = Number(sp.year) || null;
    // A program scoped to a model year never applies to a different year —
    // a used 2022 Rogue doesn't get the 2026 program.
    if (sy && vy && sy !== vy) return;
    const r = rank(sp, m);
    if (!bestR || r[0] > bestR[0] || (r[0] === bestR[0] && (r[1] > bestR[1] || (r[1] === bestR[1] && r[2] > bestR[2])))) {
      best = sp; bestR = r;
    }
  });
  return best;
}

// ---- Trim-scoped program rows (finance trimRates / lease leaseRates) ----
// A row names bulletin trims; the vehicle's trim is matched token-by-token
// (first token must hit, most matching tokens wins) so "SR AWD" finds the SR
// row and "SL+ e-4ORCE" never falls into plain SL.
function trimTokens(s) { return String(s || "").toLowerCase().split(/[\s/,]+/).filter(Boolean); }
function trimRowScore(row, vTrim) {
  const have = trimTokens(vTrim);
  if (!have.length) return 0;
  let best = 0;
  (Array.isArray(row.trims) ? row.trims : [row.trims]).forEach((name) => {
    const want = trimTokens(name);
    if (!want.length || !have.includes(want[0])) return;
    const hits = want.filter((w) => have.includes(w)).length;
    if (hits + 1 > best) best = hits + 1;
  });
  return best;
}
export function trimProgram(rows, v) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let best = null, bs = 0;
  rows.forEach((r) => {
    const sc = trimRowScore(r, v.trim);
    if (sc > bs) { bs = sc; best = r; }
  });
  return best;
}

function specialLabel(sp, method) {
  if (method === "finance") {
    const bits = [];
    if (sp.financeApr != null && sp.financeApr !== "") bits.push(`${sp.financeApr}% APR${sp.financeTerm ? ` / ${sp.financeTerm} mo` : ""}`);
    if (Number(sp.cash)) bits.push(`${currency(Number(sp.cash))} cash`);
    return bits.join(" + ") || null;
  }
  return `advertised lease${sp.leaseTerm ? ` ${sp.leaseTerm} mo` : ""}${Number(sp.leaseDown) ? `, ${currency(Number(sp.leaseDown))} down` : ""}`;
}

// The new Nissan lineup is always in the candidate pool — a Nissan store can
// pitch a new Rogue whether or not one is on the lot right now. A model drops
// out only when a matching real unit is in stock (the real unit wins), and an
// active special rides along automatically via specialFor().
function lineupCandidates() {
  const inv = availableVehicles();
  const out = [];
  SPEC_LIBRARY.filter((x) => x.make === "Nissan").forEach((x) => {
    const model = String(x.label).replace(/^\d{4}\s+/, "").replace(/^Nissan\s+/i, "").trim();
    const ml = model.toLowerCase();
    // Only a NEW unit on the lot replaces the catalogue entry — a used
    // trade-in Rogue in inventory shouldn't stop us pitching a new Rogue.
    const inStock = inv.some((v) => {
      if (/used|trade|pre-?owned/i.test(String(v.condition || ""))) return false;
      const vm = String(v.model || "").toLowerCase().trim();
      return vm && (vm.includes(ml) || ml.includes(vm));
    });
    if (inStock) return; // a real unit always beats a catalogue entry
    const year = Number(String(x.label).slice(0, 4)) || 2026;
    // Every trim is its own candidate, priced at its real MSRP + freight/PDI —
    // an SV AWD and a Platinum are very different payments.
    const push1 = (trim, msrp) => out.push({
      year, make: "Nissan", model, trim: trim || "", price: msrp,
      lineup: true, status: "available",
    });
    if (Array.isArray(x.trims) && x.trims.length) x.trims.forEach((t) => push1(t.name, t.msrp));
    else push1("", x.msrp);
  });
  return out;
}

function candidateVehicles() {
  return [...availableVehicles(), ...lineupCandidates()];
}

// New-vehicle add-ons, exactly as the store charges them: Atlantic Value
// Package + freight + air tax + tire levy are taxable; plate registration is
// a government fee with no tax. Used vehicles use the doc fee instead.
function isNewUnit(v) {
  return !!v.lineup || /new/i.test(String(v.condition || ""));
}
export function newAddons(v) {
  if (!isNewUnit(v)) return null;
  const s = store.getSettings();
  const avp = /rogue/i.test(String(v.model || "")) ? Number(s.avpRogue ?? 699) : Number(s.avpOther ?? 599);
  const freight = Number(s.feeFreight ?? 2100);
  const air = Number(s.feeAirTax ?? 100);
  const tire = Number(s.feeTireLevy ?? 22.5);
  const plate = Number(s.feePlateReg ?? 13.2);
  return { avp, freight, air, tire, plate, taxable: avp + freight + air + tire, nonTaxable: plate };
}

// Both financing and leasing options for one vehicle, honoring the method
// filter. An active special reshapes the math: its APR/term/cash replace the
// defaults for financing, and an advertised lease program is used as-is.
// Money left over when the trade covers the whole deal (taxed price + fees
// minus equity and cash down goes below zero) — that surplus is cash back.
function cashBack(base, price, feeFor, s) {
  const taxable = Math.max(0, price - num(base.tradeAllowance));
  const total = price + taxable * (num(s.taxRate) / 100) + num(feeFor)
    - num(base.down) - (num(base.tradeAllowance) - num(base.tradePayoff));
  return total < 0 ? Math.round(-total) : 0;
}

function optionsForVehicle(lead, v, opts = {}) {
  const s = store.getSettings();
  const method = opts.method || s.dealMethod || "both";
  // "No cash down entered" is not the same as "$0 down": the first shows an
  // advertised lease as advertised, the second reprices it to zero down.
  const downGiven = opts.down != null && opts.down !== "";
  const base = financeBase(lead, opts.down);
  const sp = specialFor(v);
  // New units carry the taxable add-ons (AVP, freight, air tax, tire levy) in
  // the price and plate registration as the untaxed fee; used units keep the
  // doc fee.
  const add = newAddons(v);
  // New units: plate registration rides untaxed (the taxable add-ons are in
  // the price). Used units: the doc fee is HST-taxable in NS, so tax it here.
  const feeFor = add ? add.nonTaxable : num(s.docFee) * (1 + num(s.taxRate) / 100);
  const addTaxable = add ? add.taxable : 0;
  const out = [];
  if (method !== "lease") {
    // A trim-scoped rate row (Ariya SL+, LEAF Platinum+…) overrides the
    // model-level table and cash from the same bulletin.
    const ft = sp ? trimProgram(sp.trimRates, v) : null;
    const cash = ft && ft.cash != null ? Number(ft.cash) || 0
      : sp && Number(sp.cash) ? Number(sp.cash) : 0;
    const price = Math.max(0, v.price - cash) + addTaxable;
    const table = ft && ft.aprByTerm && typeof ft.aprByTerm === "object" ? ft.aprByTerm
      : sp && sp.aprByTerm && typeof sp.aprByTerm === "object" ? sp.aprByTerm : null;
    if (table) {
      // Program sheets publish a rate PER TERM (e.g. 0% to 60, 2.9% at 72/84).
      // Do what the desk does: run every term and keep the one whose payment
      // lands closest to what the customer pays now (lowest payment if their
      // payment is unknown).
      //
      // The term is chosen from the NO-CASH-DOWN scenario and then held. Scoring
      // with the cash down folded in would re-pick a shorter term every time
      // more money went down — so the payment would jump around (or rise) as
      // the salesperson dials cash up, instead of falling the way it should.
      const cur = lead.currentPayment;
      const scoreBase = { ...base, down: 0 };
      let bestT = null;
      Object.entries(table).forEach(([t, a]) => {
        const term = Number(t), apr = Number(a);
        if (!term || isNaN(apr)) return;
        const f = computeDeal({ ...scoreBase, fees: feeFor, apr, term, price });
        const score = cur != null ? Math.abs(f.monthly - cur) : f.monthly;
        if (!bestT || score < bestT.score) bestT = { term, apr, score };
      });
      if (bestT) {
        // Term settled; now price it with whatever cash is actually down.
        const f = computeDeal({ ...base, fees: feeFor, apr: bestT.apr, term: bestT.term, price });
        f.surplus = cashBack(base, price, feeFor, s);
        const label = `${bestT.apr}% APR / ${bestT.term} mo${cash ? ` + ${currency(cash)} cash` : ""}`;
        out.push({ vehicle: v, method: "finance", monthly: f.monthly, financed: f.amountFinanced, surplus: f.surplus, term: bestT.term, apr: bestT.apr, cash, down: num(base.down), special: label });
      }
    } else {
      const hasApr = sp && sp.financeApr != null && sp.financeApr !== "";
      const apr = hasApr ? Number(sp.financeApr) : base.apr;
      const term = sp && Number(sp.financeTerm) ? Number(sp.financeTerm) : s.defaultTerm;
      const f = computeDeal({ ...base, fees: feeFor, apr, term, price });
      f.surplus = cashBack(base, price, feeFor, s);
      const label = sp ? specialLabel(sp, "finance") : null;
      out.push({ vehicle: v, method: "finance", monthly: f.monthly, financed: f.amountFinanced, surplus: f.surplus, term, apr, cash, down: num(base.down), special: label });
    }
  }
  if (method !== "finance") {
    // computeLease taxes the payment, so hand it the raw fee — the taxed
    // feeFor would double-tax the doc fee on a used-unit lease.
    const leaseFee = add ? add.nonTaxable : num(s.docFee);
    // An advertised lease is trim-specific — apply it only to the trim the ad
    // names (sp.leaseTrim); other trims get the computed lease instead.
    // Whole-word trim match, so leaseTrim "S" hits "S FWD" but not "SV FWD".
    const trimMatches = () => {
      if (!sp.leaseTrim) return true;
      const want = String(sp.leaseTrim).toLowerCase().split(/\s+/).filter(Boolean);
      const have = String(v.trim || "").toLowerCase().split(/\s+/);
      return want.every((w) => have.includes(w));
    };
    const advOk = sp && Number(sp.leasePayment) && trimMatches();
    const lr = sp ? trimProgram(sp.leaseRates, v) : null;
    if (advOk) {
      // The ad is quoted at ITS OWN down payment (sp.leaseDown). Cash down
      // beyond that is extra cap-cost reduction: it drops the payment by the
      // extra spread over the term, plus the rent it no longer carries, plus
      // tax (NS taxes the lease payment). Less down than the ad raises it.
      const adTerm = Number(sp.leaseTerm) || s.leaseTerm || 36;
      const adDown = Number(sp.leaseDown) || 0;
      // Only reprice once cash down is actually specified. With nothing
      // entered, the ad shows exactly as advertised — at its own down payment.
      const extra = downGiven ? num(base.down) - adDown : 0;
      const lrApr = lr && lr.byTerm && lr.byTerm[adTerm] ? Number(lr.byTerm[adTerm].apr) : null;
      const mf = (lrApr != null && !isNaN(lrApr) ? lrApr : 0) / 2400;
      const adj = extra ? (extra / adTerm + extra * mf) * (1 + num(s.taxRate) / 100) : 0;
      out.push({
        vehicle: v, method: "lease", monthly: Math.max(0, Number(sp.leasePayment) - adj), advertised: true,
        term: adTerm, leaseDown: extra ? num(base.down) : adDown, adDown, adAdjusted: !!extra,
        special: specialLabel(sp, "lease"),
      });
    } else if (lr && lr.byTerm && typeof lr.byTerm === "object") {
      // The bulletin's lease program for this exact trim: a rate AND residual
      // per term. Same play as finance — run every term, keep the payment that
      // lands closest to what they pay now.
      const lcash = Number(lr.cash) || 0;
      const cur = lead.currentPayment;
      const leasePrice = Math.max(0, v.price - lcash) + addTaxable;
      // Term picked from the no-cash-down scenario, then held — same reason as
      // finance: cash down must move the payment, not reshuffle the term.
      let bestL = null;
      Object.entries(lr.byTerm).forEach(([t, row]) => {
        const term = Number(t), apr = Number(row && row.apr), res = Number(row && row.res);
        if (!term || isNaN(apr) || !res) return;
        const l = computeLease({ ...base, down: 0, fees: leaseFee, term, residualPct: res, apr, msrp: v.price, price: leasePrice });
        const score = cur != null ? Math.abs(l.monthly - cur) : l.monthly;
        if (!bestL || score < bestL.score) bestL = { term, apr, res, score };
      });
      if (bestL) {
        const l = computeLease({ ...base, fees: leaseFee, term: bestL.term, residualPct: bestL.res, apr: bestL.apr, msrp: v.price, price: leasePrice });
        const label = `${bestL.apr}% lease / ${bestL.term} mo${lcash ? ` + ${currency(lcash)} lease cash` : ""}`;
        out.push({ vehicle: v, method: "lease", monthly: l.monthly, residual: l.residual, surplus: l.surplus, term: bestL.term, apr: bestL.apr, resPct: bestL.res, leaseCash: lcash, down: num(base.down), special: label });
      }
    } else {
      const l = computeLease({ ...base, fees: leaseFee, term: s.leaseTerm || 36, residualPct: s.leaseResidualPct || 58, price: v.price + addTaxable });
      out.push({ vehicle: v, method: "lease", monthly: l.monthly, residual: l.residual, surplus: l.surplus, down: num(base.down), special: null });
    }
  }
  return out;
}

// How this payment compares to what they pay now. Always states the direction
// AND the amount: "≈ same payment" hid whether a deal was cheaper or dearer,
// which is the first thing a customer asks. `long` gives the sentence form.
export function paymentDelta(delta, opts = {}) {
  if (delta == null || delta === "") return null;
  const d = Math.round(Number(delta));
  const tail = opts.long ? " than they pay now" : "";
  if (d === 0) return { text: opts.long ? "exactly their current payment" : "same payment", color: "var(--success)", dir: "same" };
  if (d < 0) return { text: `${currency(-d)}/mo less${tail}`, color: "var(--success)", dir: "less" };
  return { text: `${currency(d)}/mo more${tail}`, color: "var(--warning)", dir: "more" };
}

// Every finance/lease option across available inventory, closest payment first.
export function dealsForLead(lead, opts = {}) {
  const cur = lead.currentPayment != null ? lead.currentPayment : null;
  const rows = [];
  candidateVehicles().forEach((v) => {
    optionsForVehicle(lead, v, opts).forEach((o) => rows.push({ ...o, delta: cur != null ? o.monthly - cur : null }));
  });
  rows.sort((a, b) => (cur != null ? Math.abs(a.delta) - Math.abs(b.delta) : a.monthly - b.monthly));
  return rows;
}

// Best single option for a customer (used by the radar + dashboard).
export function bestDealForLead(lead, opts = {}) {
  const rows = dealsForLead(lead, opts);
  return rows.length ? rows[0] : null;
}

// Known equity, or null when the trade's value hasn't been appraised yet —
// a missing value must read as "unknown", never as negative-the-payoff.
export function equity(lead) {
  if (lead.currentValue == null) return null;
  return lead.currentValue - (lead.payoff || 0);
}

// Equity the way the deal math sees it: resolved trade value − resolved payoff,
// negative when they're upside down. `src` says how solid it is —
//   "known"  both numbers on file
//   "est"    the trade is a book/market estimate, or the payoff was calculated
//   null     no defensible trade value (only the wash assumption), so unknown
// A missing trade value must never read as "negative the whole payoff".
export function equityDetail(lead) {
  const inp = dealInputs(lead);
  if (inp.value.v == null || inp.value.src === "wash") return { v: null, src: null };
  if (inp.payoff.v == null) return { v: null, src: null };
  const solid = inp.value.src === "known" && inp.payoff.src === "known";
  return { v: Math.round(inp.value.v - inp.payoff.v), src: solid ? "known" : "est" };
}

function yearsOwned(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  return (Date.now() - d.getTime()) / (365.25 * 86400000);
}

// Connect the dots: score how strong an upgrade opportunity this customer is,
// combining payment match, equity, ownership length, lease timing and rate.
// Returns { score (0-100), reasons[] } — the reasons are the "why" chips.
export function scoreOpportunity(lead, best) {
  const s = store.getSettings();
  const reasons = [];
  let score = 0;

  const cur = lead.currentPayment;
  if (cur != null && best) {
    const delta = best.monthly - cur;
    if (delta <= -20) { score += 48; reasons.push(`${currency(Math.round(-delta))}/mo less`); }
    else if (delta <= (s.dealMatchBand || 50)) { score += 40; reasons.push("Same payment"); }
    else if (delta <= 100) { score += 22; reasons.push(`+${currency(Math.round(delta))}/mo`); }
    else { score += 6; }
  } else if (best) {
    score += 10; // can still pitch a fresh vehicle even without their payment
  }

  const eqD = equityDetail(lead);
  const eq = eqD.v;
  const eqTag = eqD.src === "est" ? "~" : "";
  if (eq != null && eq >= 3000) { score += 20; reasons.push(`${eqTag}${currency(eq)} equity`); }
  else if (eq != null && eq > 0) { score += 10; reasons.push("Positive equity"); }
  else if (eq != null && eq < -2000) { reasons.push(`${eqTag}${currency(-eq)} upside down`); }

  const yrs = yearsOwned(lead.purchaseDate);
  if (yrs != null && yrs >= 3) { score += 15; reasons.push(`Owned ${Math.floor(yrs)} yrs`); }
  else if (yrs != null && yrs >= 2) { score += 8; }

  if (lead.leaseEnd) {
    const d = daysFromToday(lead.leaseEnd);
    if (d != null && d >= 0 && d <= 90) { score += 26; reasons.push(`Lease ends in ${d}d`); }
    else if (d != null && d > 90 && d <= 180) { score += 12; reasons.push("Lease ending soon"); }
  }

  // Rate story: their rate (on file, or solved from payment + payoff +
  // maturity) vs the actual program rate on the matched deal.
  const theirs = lead.currentApr != null && lead.currentApr !== "" ? Number(lead.currentApr) : inferApr(lead);
  const progApr = best && best.apr != null ? best.apr : null;
  if (theirs != null && progApr != null && theirs - progApr >= 1.5) {
    score += 14; reasons.push(`~${theirs}% now → ${progApr}% program`);
  } else if (theirs != null && theirs > (s.defaultApr || 0) + 1) {
    score += 12; reasons.push(`Rate ${theirs}% → ~${s.defaultApr}%`);
  }

  // The incentive is pitch material — keep it ahead of the reason cap.
  if (best && best.special) { score += 10; reasons.splice(Math.min(1, reasons.length), 0, `🏷 ${best.special}`); }

  return { score: Math.min(100, Math.round(score)), reasons: reasons.slice(0, 3) };
}

function strength(score) {
  if (score >= 70) return { label: "Hot", badge: "badge-due" };
  if (score >= 45) return { label: "Strong", badge: "badge-sold" };
  return { label: "Worth a call", badge: "badge-soon" };
}

// The proactive radar: every customer who can move into a new vehicle within the
// current payment-tolerance band, via financing or leasing, scored and ranked.
export function topOpportunities(limit = 50) {
  const s = store.getSettings();
  const band = s.dealMatchBand != null ? s.dealMatchBand : 50;
  const method = s.dealMethod || "both";
  if (!candidateVehicles().length) return [];
  const out = [];
  store.all("leads").forEach((l) => {
    const hasData = l.currentPayment != null || l.currentValue != null || l.payoff != null || l.leaseEnd || l.purchaseDate;
    if (!hasData) return;
    const best = bestDealForLead(l, { method });
    if (!best) return;
    // Only surface customers whose new payment stays within their tolerance
    // (or whose current payment is unknown — still a fresh-vehicle pitch).
    if (best.delta != null && best.delta > band) return;
    const { score, reasons } = scoreOpportunity(l, best);
    if (score <= 0) return;
    out.push({ lead: l, best, score, reasons });
  });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function vehName(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
}

// Build the ready-to-send offer text for a matched deal.
export function offerText(lead, match) {
  const s = store.getSettings();
  const v = vehName(match.vehicle);
  const pmt = Math.round(match.monthly);
  const intro = fillTemplate("Hi {firstName}, it's {salesperson} at {dealership}.", lead);
  const curLine = lead.currentPayment
    ? ` right around the $${Math.round(lead.currentPayment)}/mo you're paying now`
    : "";
  const trade = lead.vehicleInterest ? ` out of your ${lead.vehicleInterest}` : "";
  const how = match.method === "lease" ? " on a lease" : "";
  const spBit = match.special ? ` — Nissan's running ${match.special} on it right now` : "";
  return `${intro} Good news — I can likely get you into a new ${v} for about $${pmt}/mo${how},${curLine}${trade ? "," + trade : ""}${spBit}. Worth a quick look? What's your schedule like this week?`;
}

// ---------- Full worked deal for one option ----------
// Tap any match anywhere (profile card, deal sheet) and get the whole money
// story: every line from sticker to monthly, plainly labeled, plus the
// actions — text the offer, compare against their current car, open the
// calculator with everything prefilled.
export function openDealDetail(lead, m) {
  const v = m.vehicle;
  const s = store.getSettings();
  const sp = specialFor(v);
  const cur = lead.currentPayment;
  const inp = dealInputs(lead);
  const valueKnown = inp.value.src === "known";
  const tradeVal = inp.value.v || 0;
  const mDown = num(m.down);
  const payoffVal = inp.payoff.v || 0;
  const payoffTag = inp.payoff.src === "calc" ? " (≈ payment × months left)" : "";
  const estD = inp.value.src === "book" ? estimateTradeDetail(lead) : null;
  const tradeTag = inp.value.src === "book" ? (estD && estD.basis === "market" ? " (market est.)" : " (book est.)") : inp.value.src === "wash" ? " (assumed = payoff)" : "";
  const kv = (k, val, strong) => `<div class="kv"><span class="k">${k}</span><span class="v mono${strong ? " strong" : ""}" style="text-align:right">${val}</span></div>`;

  openModal(vehName(v), (close) => {
    const wrap = document.createElement("div");
    const delta = m.delta != null ? Math.round(m.delta) : (cur != null ? Math.round(m.monthly - cur) : null);
    const dl = paymentDelta(delta, { long: true });

    const add = newAddons(v);
    const addonRows = add ? [
      kv("Atlantic Value Package", "+ " + currency(add.avp)),
      kv("Freight", "+ " + currency(add.freight)),
      kv("Air tax", "+ " + currency(add.air)),
      kv("Tire levy", "+ " + currency2(add.tire)),
    ].join("") : "";
    let breakdown = "";
    if (m.method === "finance") {
      // m.cash is the trim-resolved program cash the option was built with;
      // fall back to the model-level cash for options minted before it existed.
      const cash = m.cash != null ? Number(m.cash) || 0 : (sp && Number(sp.cash) ? Number(sp.cash) : 0);
      const hasAprSp = m.special != null && /%/.test(String(m.special || ""));
      const apr = m.apr != null ? m.apr : (sp && sp.financeApr != null && sp.financeApr !== "" ? Number(sp.financeApr) : num(s.defaultApr));
      const term = m.term || s.defaultTerm;
      // New units: plate registration rides untaxed (the taxable add-ons are in
  // the price). Used units: the doc fee is HST-taxable in NS, so tax it here.
  const feeFor = add ? add.nonTaxable : num(s.docFee) * (1 + num(s.taxRate) / 100);
      const d = computeDeal({ price: v.price - cash + (add ? add.taxable : 0), down: mDown, tradeAllowance: tradeVal, tradePayoff: payoffVal, fees: feeFor, taxRate: s.taxRate, apr, term });
      breakdown = [
        kv(v.lineup ? "MSRP" : "Vehicle price", currency(v.price)),
        addonRows,
        cash ? kv("Nissan cash 🏷", "− " + currency(cash)) : "",
        kv("Trade-in value", currency(tradeVal) + tradeTag),
        estD ? `<div class="small muted" style="margin:2px 0 8px;line-height:1.4">Workup: ${esc(estD.lines.join(" · "))}</div>` : "",
        payoffVal ? kv("Trade payoff", "− " + currency(payoffVal) + payoffTag) : "",
        mDown ? kv("Cash down", "− " + currency(mDown)) : "",
        kv(`Tax (${s.taxRate}%)`, "+ " + currency(Math.round(d.tax))),
        add ? kv("Plate registration (no tax)", "+ " + currency2(add.plate)) : kv("Doc fee + tax", "+ " + currency(Math.round(num(s.docFee) * (1 + num(s.taxRate) / 100)))),
        kv("Amount financed", currency(Math.round(d.amountFinanced)), true),
        kv("Rate · term", `${apr}%${hasAprSp ? " 🏷" : ""} · ${term} mo`),
        kv("Total interest over term", currency(Math.round(d.totalInterest))),
      ].join("");
    } else if (m.advertised) {
      breakdown = [
        kv("Program", `Advertised lease 🏷`),
        kv("Term", `${m.term || Number(sp?.leaseTerm) || "—"} mo`),
        kv("Down payment", currency(num(m.leaseDown != null ? m.leaseDown : sp?.leaseDown))
          + (m.adAdjusted ? ` <span class="muted">(ad quotes ${currency(num(m.adDown))} — payment adjusted)</span>` : "")),
        (valueKnown || payoffVal) ? kv("Their trade", `${currency(tradeVal)}${esc(tradeTag)} — equity can cover the down`) : "",
        sp?.notes ? kv("Fine print", esc(sp.notes)) : "",
      ].join("");
    } else {
      // A bulletin lease program carries its own rate/residual/cash on the
      // option (m.apr/m.resPct/m.leaseCash); otherwise fall back to defaults.
      const isProgram = m.apr != null && m.resPct != null;
      const term = m.term || s.leaseTerm || 36;
      const resPct = isProgram ? m.resPct : (s.leaseResidualPct || 58);
      const apr = isProgram ? m.apr : num(s.defaultApr);
      const lcash = Number(m.leaseCash) || 0;
      const l = m.residual != null ? { residual: m.residual }
        : computeLease({ price: v.price + (add ? add.taxable : 0), fees: add ? add.nonTaxable : s.docFee, down: mDown, tradeAllowance: tradeVal, tradePayoff: payoffVal, term, residualPct: resPct, taxRate: s.taxRate, apr, msrp: v.price });
      breakdown = [
        kv(v.lineup ? "MSRP" : "Vehicle price", currency(v.price)),
        addonRows,
        lcash ? kv("Nissan lease cash 🏷", "− " + currency(lcash)) : "",
        mDown ? kv("Cash down", "− " + currency(mDown)) : "",
        kv("Trade-in value", currency(tradeVal) + tradeTag),
        estD ? `<div class="small muted" style="margin:2px 0 8px;line-height:1.4">Workup: ${esc(estD.lines.join(" · "))}</div>` : "",
        payoffVal ? kv("Trade payoff", "− " + currency(payoffVal) + payoffTag) : "",
        add ? kv("Plate registration (no tax)", "+ " + currency2(add.plate)) : kv("Doc fee", "+ " + currency(s.docFee)),
        kv("Term", `${term} mo`),
        kv(`Residual (${resPct}%${isProgram ? " 🏷" : ""})`, currency(Math.round(l.residual))),
        kv("Rate used", `${apr}%${isProgram ? " 🏷" : ""}`),
        kv(`Tax (${s.taxRate}%)`, "included in payment"),
      ].join("");
    }

    // Compare their current car against this one, feature by feature.
    let canCompare = false, mineSpec = null, newSpec = null;
    try {
      const owned = String(lead.vehicleInterest || "").replace(/^\d{4}\s*/, "");
      mineSpec = owned ? findSpec(owned) : null;
      newSpec = findSpec(String(v.model || v.label || ""));
      canCompare = !!(mineSpec && newSpec && mineSpec.id !== newSpec.id);
    } catch {}

    wrap.innerHTML = `
      <div class="card" style="margin-bottom:14px;text-align:center">
        <div style="font-size:2rem;font-weight:800" class="mono">${currency(Math.round(m.monthly))}<span class="muted" style="font-size:0.9rem">/mo</span></div>
        ${dl ? `<div class="small strong" style="margin-top:2px;color:${dl.color}">${dl.text}</div>` : ""}
        ${num(m.surplus) ? `<div class="small strong" style="margin-top:2px;color:var(--success)">Their equity covers it — about ${currency(m.surplus)} back to them</div>` : ""}
        <div class="small muted" style="margin-top:6px">
          <span class="badge ${m.method === "lease" ? "badge-appt" : "badge-working"}">${m.method === "lease" ? "Lease" : "Finance"}</span>
          ${m.special ? ` <span class="badge badge-sold">🏷 ${esc(m.special)}</span>` : ""}
          ${v.lineup ? ` <span class="badge">new — order/allocate</span>` : v.stock ? ` <span class="badge">#${esc(v.stock)}</span>` : ""}
        </div>
      </div>

      <div class="section-title" style="margin-top:0">How it's built</div>
      <div class="card">${breakdown}</div>

      ${cur != null || lead.vehicleInterest ? `
      <div class="section-title">Their side</div>
      <div class="card">
        ${lead.vehicleInterest ? kv("Driving now", esc(lead.vehicleInterest)) : ""}
        ${cur != null ? kv("Paying now", currency(cur) + "/mo") : ""}
        ${payoffVal || valueKnown ? kv("Est. equity", currency(Math.round(tradeVal - payoffVal)) + (valueKnown ? "" : esc(tradeTag))) : ""}
        ${inp.apr.src === "known" ? kv("Their rate", inp.apr.v + "%") : inp.apr.src === "calc" ? kv("Their rate", "≈ " + inp.apr.v + "% (calculated)") : ""}
      </div>` : ""}

      <div class="btn-row" style="margin-top:4px">
        ${lead.phone ? `<a class="btn btn-primary btn-block" data-act="dd-offer" href="${smsHref(lead.phone, offerText(lead, m))}">${icon("message")} Text this offer</a>` : ""}
      </div>
      <div class="btn-row" style="margin-top:10px">
        ${canCompare ? `<button class="btn btn-ghost btn-sm" data-act="dd-compare" style="flex:1">${icon("compare")} Compare vs theirs</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-act="dd-quote" style="flex:1">${icon("calculator")} Calculator</button>
      </div>
      <div class="fab-note">Estimates — taxes, fees and program details get confirmed with your desk.</div>
    `;

    const offer = wrap.querySelector('[data-act="dd-offer"]');
    if (offer) offer.addEventListener("click", () => {
      store.logActivity("touch");
      store.update("leads", lead.id, { lastContacted: new Date().toISOString() });
    });
    const cmp = wrap.querySelector('[data-act="dd-compare"]');
    if (cmp) cmp.addEventListener("click", () => {
      queueCompare([mineSpec, newSpec]);
      closeAllModals();
      navigate("/compare");
    });
    wrap.querySelector('[data-act="dd-quote"]').addEventListener("click", () => {
      sessionStorage.setItem("calc-prefill", JSON.stringify(calcPrefill(lead, m, inp)));
      closeAllModals();
      navigate("/calculator");
    });
    return wrap;
  });
}

// ---------- Per-customer Deal Builder sheet ----------
export function openDealBuilder(lead) {
  openModal(`Deals for ${(lead.name || "customer").split(" ")[0]}`, (close) => {
    const wrap = document.createElement("div");
    const s = store.getSettings();

    // Sheet state: cash down (null = none entered) and an optional pinned
    // vehicle, so the salesperson can quote a specific car and trim instead of
    // whatever the payment-match ranking surfaced.
    let downState = null;
    let pick = "";

    function draw() {
      const down = downState;
      // The vehicle lineup is fixed by the baseline (no cash down) ranking, then
      // re-priced as cash changes. Re-ranking live would swap a pricier car into
      // the top row every time cash went up — so the payment would look frozen
      // near their current one while the vehicle silently changed underneath.
      const baseRows = dealsForLead(lead, { method: "both" });
      const key = (m) => [m.vehicle.id || "", m.vehicle.model, m.vehicle.trim, m.method].join("|");
      const priced = down == null ? baseRows : dealsForLead(lead, { down, method: "both" });
      const byKey = new Map(priced.map((m) => [key(m), m]));
      const rows = baseRows.map((m) => byKey.get(key(m)) || m);
      const eqD = equityDetail(lead);
      const eq = eqD.v;
      const cur = lead.currentPayment;

      // The fee headline reflects what these rows actually carry: new units
      // take the Atlantic Value Package (a Rogue's is higher), used take the
      // doc fee. Showing one flat "doc fee" was wrong for every new Nissan.
      const anyNew = rows.slice(0, 12).some((m) => !!newAddons(m.vehicle));
      const feeShown = anyNew
        ? (rows.slice(0, 12).some((m) => newAddons(m.vehicle) && /rogue/i.test(String(m.vehicle.model || "")))
            ? num(s.avpRogue ?? 699) : num(s.avpOther ?? 599))
        : num(s.docFee);

      // What actually got applied to the deals on screen — programs, the trade
      // and payoff with their basis, and any cash down. This is the line that
      // survives the "where did that number come from?" question at the desk.
      const appliedNote = (() => {
        const inp = dealInputs(lead);
        const shown = pick ? rows.filter((m) => [m.vehicle.id || "", m.vehicle.model, m.vehicle.trim].join("|") === pick) : rows.slice(0, 6);
        const bits = [];
        const progs = [...new Set(shown.map((m) => m.special).filter(Boolean))];
        if (progs.length) bits.push(progs.slice(0, 3).join(" · ") + (progs.length > 3 ? ` · +${progs.length - 3} more` : ""));
        else if (activeSpecials().length) bits.push("no Monthly Special matched these models — standard rates");
        if (anyNew) {
          const avp = feeShown;
          bits.push(`new-vehicle fees: ${currency(avp)} AVP + ${currency(num(s.feeFreight ?? 2100))} freight + ${currency(num(s.feeAirTax ?? 100))} air tax + ${currency2(num(s.feeTireLevy ?? 22.5))} tire levy + ${currency2(num(s.feePlateReg ?? 13.2))} plate`);
        }
        if (inp.value.v != null) {
          bits.push(`trade ${currency(inp.value.v)}${inp.value.src === "known" ? " (appraised)" : inp.value.src === "book" ? " (book est.)" : " (assumed = payoff)"}`);
        }
        if (inp.payoff.v != null) bits.push(`payoff ${currency(inp.payoff.v)}${inp.payoff.src === "calc" ? " (payment × months left)" : ""}`);
        if (inp.apr.src === "known") bits.push(`their rate ${inp.apr.v}%`);
        if (down != null && down > 0) bits.push(`${currency(down)} cash down`);
        return bits.join(" · ");
      })();

      // Every car we can quote, for the picker: real stock first, then the
      // lineup by trim.
      const vKey = (v) => [v.id || "", v.model, v.trim].join("|");
      const cands = candidateVehicles();
      const inStock = cands.filter((v) => !v.lineup);
      const lineup = cands.filter((v) => v.lineup);
      const optFor = (v) => `<option value="${esc(vKey(v))}"${vKey(v) === pick ? " selected" : ""}>${esc(vehName(v))}${v.stock ? ` · #${esc(v.stock)}` : ""}${v.price != null ? ` — ${currency(v.price)}` : ""}</option>`;

      // A pinned vehicle shows ITS finance and lease offer; otherwise the
      // payment-matched shortlist.
      const picked = pick ? rows.filter((m) => vKey(m.vehicle) === pick) : [];
      const top = pick ? picked : rows.slice(0, 6);

      wrap.innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <div class="row"><span class="k muted">Currently pays</span><span class="v strong mono">${cur != null ? currency(cur) + "/mo" : "unknown"}</span></div>
          <div class="row" style="margin-top:6px"><span class="k muted">On</span><span class="v">${esc(lead.vehicleInterest || "—")}</span></div>
          <div class="row" style="margin-top:6px"><span class="k muted">${eq != null && eq < 0 ? "Negative equity" : "Equity"}</span>${eq != null
            ? `<span class="v strong mono" style="color:${eq >= 0 ? "var(--success)" : "var(--danger)"}">${eq < 0 ? "− " + currency(-eq) : currency(eq)}${eqD.src === "est" ? ` <span class="muted small">est.</span>` : ""}</span>`
            : `<span class="v small muted">unknown — payoff ${lead.payoff != null ? currency(lead.payoff) : "?"}, trade not appraised</span>`}</div>
        </div>

        <div class="field">
          <label>Cash down (tweak to hit their payment)</label>
          <input id="db-down" type="number" inputmode="decimal" placeholder="0" value="${down == null ? "" : down}" />
          <div class="hint">Leave blank to show advertised leases exactly as advertised. Enter an amount and every payment re-prices — the term stays put.</div>
        </div>

        <div class="field">
          <label>Quote a specific vehicle</label>
          <select id="db-veh">
            <option value="">${cur != null ? "Closest matches to their payment" : "Lowest payments"}</option>
            ${inStock.length ? `<optgroup label="In stock">${inStock.map(optFor).join("")}</optgroup>` : ""}
            ${lineup.length ? `<optgroup label="New lineup — every trim">${lineup.map(optFor).join("")}</optgroup>` : ""}
          </select>
        </div>

        ${cur == null ? `<div class="hint" style="margin-bottom:10px">No current payment on file for this customer — showing lowest payments. Add their payment/payoff/value to match.</div>` : ""}

        <div class="section-title" style="margin-top:6px">${pick ? "Their offer on this vehicle" : cur != null ? "Closest matches" : "Lowest payments"}</div>
        <div class="db-list"></div>
        <div class="fab-note">Estimates using ${s.taxRate}% tax, ${currency(feeShown)} fees, ${s.defaultApr}% standard APR (program rates override), options for term, their car as trade${activeSpecials().length ? " — active Monthly Specials (APR/cash/lease programs) applied automatically where a model matches" : ""}.
          ${appliedNote ? `<div style="margin-top:6px"><b>Applied here:</b> ${esc(appliedNote)}</div>` : ""}
          <div style="margin-top:6px">Confirm with your desk.</div></div>
      `;

      const list = wrap.querySelector(".db-list");
      if (!top.length) {
        list.innerHTML = pick
          ? `<div class="muted small">No offer could be priced for that vehicle.</div>`
          : `<div class="muted small">No available inventory with pricing. Add vehicles or import your inventory first.</div>`;
      } else {
        top.forEach((m) => list.appendChild(dealRow(lead, m)));
      }

      const downEl = wrap.querySelector("#db-down");
      downEl.addEventListener("change", () => {
        const raw = downEl.value.trim();
        downState = raw === "" ? null : Number(raw) || 0;
        draw();
      });
      const vehEl = wrap.querySelector("#db-veh");
      vehEl.addEventListener("change", () => { pick = vehEl.value; draw(); });
    }

    draw();
    return wrap;
  });
}

// The calculator prices one all-in number, so give it the taxable price the
// deal actually used (MSRP + AVP/freight/air/tire on a new unit) and the fee
// that goes with it — plate on new, doc fee on used. Seeding bare MSRP and a
// flat doc fee made the calculator disagree with the row by ~$37/mo.
function calcPrefill(lead, m, inp) {
  const s = store.getSettings();
  const v = m.vehicle;
  const add = newAddons(v);
  const isLease = m.method === "lease";
  // A lease is priced off MSRP with lease cash off the cap; a finance deal has
  // the program's finance cash off the price.
  const off = isLease ? num(m.leaseCash) : num(m.cash);
  return {
    method: isLease ? "lease" : "finance",
    price: Math.max(0, v.price - off) + (add ? add.taxable : 0),
    fees: add ? add.nonTaxable : num(s.docFee),
    label: `${vehName(v)} — ${lead.name}`,
    tradeAllowance: inp.value.v || 0,
    tradePayoff: inp.payoff.v || 0,
    apr: m.apr != null ? m.apr : null,
    term: m.term || null,
    resPct: m.resPct != null ? m.resPct : null,
    msrp: isLease ? v.price : null,
    down: num(m.down) || null,
  };
}

function dealRow(lead, m) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  el.addEventListener("click", () => openDealDetail(lead, m));
  const v = m.vehicle;
  const dl = paymentDelta(m.delta);
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(vehName(v))}</div>
        <div class="row-sub"><span class="badge ${m.method === "lease" ? "badge-appt" : "badge-working"}" style="margin-right:6px">${m.method === "lease" ? "Lease" : "Finance"}</span>${v.price != null ? currency(v.price) : ""}${v.stock ? " · #" + esc(v.stock) : ""}${v.lineup ? " · new — order/allocate" : ""}${m.advertised && m.leaseDown ? ` · ${currency(m.leaseDown)} down` : ""}
        ${m.special ? `<div style="margin-top:3px"><span class="badge badge-sold">🏷 ${esc(m.special)}</span></div>` : ""}</div>
      </div>
      <div class="row-meta">
        <div class="strong mono" style="font-size:1.05rem">${currency2(m.monthly)}<span class="muted" style="font-size:.8rem">/mo</span></div>
        ${num(m.surplus) ? `<div class="small strong" style="color:var(--success)">+ ${currency(m.surplus)} back</div>` : ""}
        ${dl ? `<div class="small" style="color:${dl.color};font-weight:700">${dl.text}</div>` : ""}
      </div>
    </div>
    <div class="btn-row" style="margin-top:12px">
      ${lead.phone ? `<a class="btn btn-primary btn-sm" data-act="offer" style="flex:1" href="${smsHref(lead.phone, offerText(lead, m))}">${icon("message")} Text offer</a>` : ""}
      <button class="btn btn-ghost btn-sm" data-act="quote" style="flex:1">${icon("calculator")} Quote</button>
    </div>
  `;
  const offerBtn = el.querySelector('[data-act="offer"]');
  if (offerBtn) offerBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    store.logActivity("touch");
    store.update("leads", lead.id, { lastContacted: new Date().toISOString() });
  });
  el.querySelector('[data-act="quote"]').addEventListener("click", (ev) => {
    ev.stopPropagation();
    const inp = dealInputs(lead);
    sessionStorage.setItem("calc-prefill", JSON.stringify(calcPrefill(lead, m, inp)));
    // This row lives inside the Deal Builder sheet — navigating without
    // dismissing it loads the calculator behind the sheet, so the tap looks
    // like it did nothing.
    closeAllModals();
    navigate("/calculator");
  });
  return el;
}

// ---------- /deals page: the proactive, ranked Deal Radar ----------
export function renderDeals(view) {
  const leadsWithData = store.all("leads").some((l) => l.currentPayment != null || l.currentValue != null || l.payoff != null || l.leaseEnd || l.purchaseDate);
  // The radar can quote the full Nissan lineup whether or not a unit is on the
  // lot, so it only stalls when there is nothing at all to price against.
  const haveInventory = candidateVehicles().length > 0;

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="hero">
      <div class="hero-greeting">Deal Radar</div>
      <div class="hero-title">Deals ready to pitch</div>
    </div>
    <div class="fab-note" style="margin:0 2px 14px;text-align:left">Customers who can move into a new vehicle — financing or leasing — for close to what they pay now. Set your tolerance below.</div>
    <div id="deals-controls"></div>
    <div class="deals-list"></div>
  `;
  view.appendChild(el);
  const list = el.querySelector(".deals-list");
  const controls = el.querySelector("#deals-controls");

  if (!leadsWithData) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon("dollar", "ico-xl")}</div><div class="strong">No customer data yet</div><div class="small">Import an AutoAlert equity export (current payment, payoff, value) and the radar fills with ready-to-pitch deals.</div><button class="btn btn-primary btn-block" data-act="import" style="margin-top:16px">${icon("file")} Import customers</button></div>`;
    list.querySelector('[data-act="import"]').addEventListener("click", () => navigate("/import"));
    return;
  }
  if (!haveInventory) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon("car", "ico-xl")}</div><div class="strong">Nothing to price against</div><div class="small">Import your inventory so the radar can match real stock numbers as well as the new lineup.</div><button class="btn btn-primary btn-block" data-act="inv" style="margin-top:16px">${icon("file")} Import inventory</button></div>`;
    list.querySelector('[data-act="inv"]').addEventListener("click", () => navigate("/import"));
    return;
  }

  const s = store.getSettings();
  const methods = [["both", "Both"], ["finance", "Finance"], ["lease", "Lease"]];
  controls.innerHTML = `
    <div class="card">
      <div class="seg" role="group" aria-label="Deal type">
        ${methods.map(([m, label]) => `<button class="seg-btn ${s.dealMethod === m ? "active" : ""}" data-method="${m}">${label}</button>`).join("")}
      </div>
      <div style="margin-top:16px">
        <div class="row"><label class="small strong">New payment can be up to</label><span class="small mono strong" id="band-val" style="color:var(--brand)">+${currency(s.dealMatchBand)}/mo</span></div>
        <input id="band-slider" type="range" min="0" max="200" step="10" value="${s.dealMatchBand}" style="width:100%;margin-top:6px" />
        <div class="row small muted"><span>Same payment</span><span>+$200/mo</span></div>
      </div>
    </div>`;

  const redraw = () => {
    const opps = topOpportunities(50);
    list.innerHTML = "";
    if (!opps.length) {
      list.innerHTML = `<div class="muted small" style="text-align:center;padding:30px">No customers within +${currency(store.getSettings().dealMatchBand)}/mo right now. Widen the tolerance above, switch Finance/Lease, or add inventory.</div>`;
      return;
    }
    opps.forEach((o) => list.appendChild(opportunityCard(o)));
  };

  controls.querySelectorAll("[data-method]").forEach((b) =>
    b.addEventListener("click", () => {
      store.updateSettings({ dealMethod: b.dataset.method });
      controls.querySelectorAll("[data-method]").forEach((x) => x.classList.toggle("active", x === b));
      redraw();
    }));
  const slider = controls.querySelector("#band-slider");
  const bandVal = controls.querySelector("#band-val");
  slider.addEventListener("input", () => { bandVal.textContent = `+${currency(Number(slider.value))}/mo`; });
  slider.addEventListener("change", () => { store.updateSettings({ dealMatchBand: Number(slider.value) }); redraw(); });

  redraw();
}

function opportunityCard({ lead, best, score, reasons }) {
  const el = document.createElement("div");
  el.className = "card";
  const st = strength(score);
  const v = best.vehicle;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(lead.name)}</div>
        <div class="row-sub">${lead.currentPayment != null ? "Pays " + currency(lead.currentPayment) + "/mo · " : ""}${esc(lead.vehicleInterest || "current vehicle")}</div>
      </div>
      <span class="badge ${st.badge}">${st.label}</span>
    </div>
    <div class="card" style="margin:12px 0 0;background:var(--surface-2);border:none">
      <div class="row">
        <div class="row-main"><div class="small muted">Put them in · ${best.method === "lease" ? "Lease" : "Finance"}</div><div class="strong">${esc(vehName(v))}</div></div>
        <div class="row-meta"><div class="strong mono" style="font-size:1.05rem">${currency2(best.monthly)}<span class="muted" style="font-size:.8rem">/mo</span></div>${(() => { const dl = paymentDelta(best.delta); return dl ? `<div class="small" style="color:${dl.color};font-weight:700">${dl.text}</div>` : ""; })()}</div>
      </div>
    </div>
    ${reasons.length ? `<div class="btn-row" style="gap:6px;margin-top:10px">${reasons.map((r) => `<span class="badge badge-working">${esc(r)}</span>`).join("")}</div>` : ""}
    <button class="btn btn-primary btn-block" data-act="book" style="margin-top:12px">${icon("calendar")} Book appointment</button>
    <div class="btn-row" style="margin-top:8px">
      ${lead.phone ? `<a class="btn btn-ghost btn-sm" data-act="offer" style="flex:1" href="${smsHref(lead.phone, offerText(lead, best))}">${icon("message")} Text offer</a>
      <a class="btn btn-ghost btn-sm" data-act="call" style="flex:0 0 auto" href="${telHref(lead.phone)}">${icon("phone")}</a>` : ""}
      <button class="btn btn-ghost btn-sm" data-act="more" style="flex:1">${icon("dollar")} Options</button>
    </div>
  `;
  const touch = () => { store.logActivity("touch"); store.update("leads", lead.id, { lastContacted: new Date().toISOString() }); };
  const offer = el.querySelector('[data-act="offer"]');
  if (offer) offer.addEventListener("click", touch);
  const call = el.querySelector('[data-act="call"]');
  if (call) call.addEventListener("click", touch);
  el.querySelector('[data-act="book"]').addEventListener("click", () =>
    openAppointmentForm(null, { leadId: lead.id, customerName: lead.name, vehicle: vehName(best.vehicle), type: "appointment" }));
  el.querySelector('[data-act="more"]').addEventListener("click", () => openDealBuilder(lead));
  return el;
}
