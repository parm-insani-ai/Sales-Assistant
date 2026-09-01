// Deal Builder — the AutoAlert-style payment-match engine. For a customer with a
// known current payment and equity (value − payoff), it prices every available
// inventory vehicle as a trade-in deal and surfaces the ones they could get into
// for close to what they pay now. Turns equity data into ready-to-pitch offers.

import * as store from "../store.js";
import { computeDeal } from "./calculator.js";
import { openModal, toast } from "../components.js";
import { navigate } from "../router.js";
import { openAppointmentForm } from "./calendar.js";
import { icon } from "../icons.js";
import { fillTemplate } from "./messages.js";
import { currency, currency2, esc, smsHref, telHref, parseDate, daysFromToday } from "../utils.js";
import { SPEC_LIBRARY } from "../specs.js";
import { findSpec, queueCompare } from "./compare.js";

function num(v) { return Number(v) || 0; }

// Estimate a monthly LEASE payment. Depreciation + rent (money-factor) on the
// adjusted cap cost, with tax applied to the payment (common in CA/NS/HST).
export function computeLease(input) {
  const price = num(input.price);
  const fees = num(input.fees);
  const down = num(input.down);
  const netTradeEquity = num(input.tradeAllowance) - num(input.tradePayoff);
  const term = Math.max(1, Math.round(num(input.term)));
  const residualPct = num(input.residualPct) / 100;
  const taxRate = num(input.taxRate) / 100;
  const mf = num(input.apr) / 2400; // APR% → money factor

  const capCost = price + fees;
  const adjCap = capCost - down - netTradeEquity;
  // Program residuals are a % of MSRP — pass msrp when the cap cost already
  // has lease cash or add-ons folded in, so the residual isn't distorted.
  const residual = num(input.msrp || input.price) * residualPct;
  const depreciation = (adjCap - residual) / term;
  const rent = (adjCap + residual) * mf;
  let base = depreciation + rent;
  if (base < 0) base = 0;
  const tax = base * taxRate;
  return { monthly: base + tax, residual, term };
}

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
    apr: inp.apr.v || s.defaultApr,
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
function optionsForVehicle(lead, v, opts = {}) {
  const s = store.getSettings();
  const method = opts.method || s.dealMethod || "both";
  const base = financeBase(lead, opts.down);
  const sp = specialFor(v);
  // New units carry the taxable add-ons (AVP, freight, air tax, tire levy) in
  // the price and plate registration as the untaxed fee; used units keep the
  // doc fee.
  const add = newAddons(v);
  const feeFor = add ? add.nonTaxable : s.docFee;
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
      const cur = lead.currentPayment;
      let bestT = null;
      Object.entries(table).forEach(([t, a]) => {
        const term = Number(t), apr = Number(a);
        if (!term || isNaN(apr)) return;
        const f = computeDeal({ ...base, fees: feeFor, apr, term, price });
        const score = cur != null ? Math.abs(f.monthly - cur) : f.monthly;
        if (!bestT || score < bestT.score) bestT = { term, apr, f, score };
      });
      if (bestT) {
        const label = `${bestT.apr}% APR / ${bestT.term} mo${cash ? ` + ${currency(cash)} cash` : ""}`;
        out.push({ vehicle: v, method: "finance", monthly: bestT.f.monthly, financed: bestT.f.amountFinanced, term: bestT.term, apr: bestT.apr, cash, special: label });
      }
    } else {
      const hasApr = sp && sp.financeApr != null && sp.financeApr !== "";
      const apr = hasApr ? Number(sp.financeApr) : base.apr;
      const term = sp && Number(sp.financeTerm) ? Number(sp.financeTerm) : s.defaultTerm;
      const f = computeDeal({ ...base, fees: feeFor, apr, term, price });
      const label = sp ? specialLabel(sp, "finance") : null;
      out.push({ vehicle: v, method: "finance", monthly: f.monthly, financed: f.amountFinanced, term, apr, cash, special: label });
    }
  }
  if (method !== "finance") {
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
      out.push({
        vehicle: v, method: "lease", monthly: Number(sp.leasePayment), advertised: true,
        leaseDown: Number(sp.leaseDown) || 0, special: specialLabel(sp, "lease"),
      });
    } else if (lr && lr.byTerm && typeof lr.byTerm === "object") {
      // The bulletin's lease program for this exact trim: a rate AND residual
      // per term. Same play as finance — run every term, keep the payment that
      // lands closest to what they pay now.
      const lcash = Number(lr.cash) || 0;
      const cur = lead.currentPayment;
      let bestL = null;
      Object.entries(lr.byTerm).forEach(([t, row]) => {
        const term = Number(t), apr = Number(row && row.apr), res = Number(row && row.res);
        if (!term || isNaN(apr) || !res) return;
        const l = computeLease({ ...base, fees: feeFor, term, residualPct: res, apr, msrp: v.price, price: Math.max(0, v.price - lcash) + addTaxable });
        const score = cur != null ? Math.abs(l.monthly - cur) : l.monthly;
        if (!bestL || score < bestL.score) bestL = { term, apr, res, l, score };
      });
      if (bestL) {
        const label = `${bestL.apr}% lease / ${bestL.term} mo${lcash ? ` + ${currency(lcash)} lease cash` : ""}`;
        out.push({ vehicle: v, method: "lease", monthly: bestL.l.monthly, residual: bestL.l.residual, term: bestL.term, apr: bestL.apr, resPct: bestL.res, leaseCash: lcash, special: label });
      }
    } else {
      const l = computeLease({ ...base, fees: feeFor, term: s.leaseTerm || 36, residualPct: s.leaseResidualPct || 58, price: v.price + addTaxable });
      out.push({ vehicle: v, method: "lease", monthly: l.monthly, residual: l.residual, special: null });
    }
  }
  return out;
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

  const eq = equity(lead);
  if (eq >= 3000) { score += 20; reasons.push(`${currency(Math.round(eq))} equity`); }
  else if (eq > 0) { score += 10; reasons.push("Positive equity"); }

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
  const payoffVal = inp.payoff.v || 0;
  const payoffTag = inp.payoff.src === "calc" ? " (≈ payment × months left)" : "";
  const estD = inp.value.src === "book" ? estimateTradeDetail(lead) : null;
  const tradeTag = inp.value.src === "book" ? (estD && estD.basis === "market" ? " (market est.)" : " (book est.)") : inp.value.src === "wash" ? " (assumed = payoff)" : "";
  const kv = (k, val, strong) => `<div class="kv"><span class="k">${k}</span><span class="v mono${strong ? " strong" : ""}" style="text-align:right">${val}</span></div>`;

  openModal(vehName(v), (close) => {
    const wrap = document.createElement("div");
    const delta = m.delta != null ? Math.round(m.delta) : (cur != null ? Math.round(m.monthly - cur) : null);
    const band = s.dealMatchBand || 50;
    const deltaTxt = delta == null ? "" :
      Math.abs(delta) <= band ? "≈ same as their current payment" :
      delta < 0 ? `${currency(-delta)}/mo less than they pay now` : `+${currency(delta)}/mo over their current payment`;

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
      const apr = m.apr != null ? m.apr : (sp && sp.financeApr != null && sp.financeApr !== "" ? Number(sp.financeApr) : (lead.currentApr || s.defaultApr));
      const term = m.term || s.defaultTerm;
      const feeFor = add ? add.nonTaxable : s.docFee;
      const d = computeDeal({ price: v.price - cash + (add ? add.taxable : 0), down: 0, tradeAllowance: tradeVal, tradePayoff: payoffVal, fees: feeFor, taxRate: s.taxRate, apr, term });
      breakdown = [
        kv(v.lineup ? "MSRP" : "Vehicle price", currency(v.price)),
        addonRows,
        cash ? kv("Nissan cash 🏷", "− " + currency(cash)) : "",
        kv("Trade-in value", currency(tradeVal) + tradeTag),
        estD ? `<div class="small muted" style="margin:2px 0 8px;line-height:1.4">Workup: ${esc(estD.lines.join(" · "))}</div>` : "",
        payoffVal ? kv("Trade payoff", "− " + currency(payoffVal) + payoffTag) : "",
        kv(`Tax (${s.taxRate}%)`, "+ " + currency(Math.round(d.tax))),
        add ? kv("Plate registration (no tax)", "+ " + currency2(add.plate)) : kv("Doc fees", "+ " + currency(s.docFee)),
        kv("Amount financed", currency(Math.round(d.amountFinanced)), true),
        kv("Rate · term", `${apr}%${hasAprSp ? " 🏷" : ""} · ${term} mo`),
        kv("Total interest over term", currency(Math.round(d.totalInterest))),
      ].join("");
    } else if (m.advertised) {
      breakdown = [
        kv("Program", `Advertised lease 🏷`),
        kv("Term", `${Number(sp?.leaseTerm) || "—"} mo`),
        Number(sp?.leaseDown) ? kv("Down payment", currency(Number(sp.leaseDown))) : "",
        (valueKnown || payoffVal) ? kv("Their trade", `${currency(tradeVal)}${esc(tradeTag)} — equity can cover the down`) : "",
        sp?.notes ? kv("Fine print", esc(sp.notes)) : "",
      ].join("");
    } else {
      // A bulletin lease program carries its own rate/residual/cash on the
      // option (m.apr/m.resPct/m.leaseCash); otherwise fall back to defaults.
      const isProgram = m.apr != null && m.resPct != null;
      const term = m.term || s.leaseTerm || 36;
      const resPct = isProgram ? m.resPct : (s.leaseResidualPct || 58);
      const apr = isProgram ? m.apr : (lead.currentApr || s.defaultApr);
      const lcash = Number(m.leaseCash) || 0;
      const l = m.residual != null ? { residual: m.residual }
        : computeLease({ price: v.price + (add ? add.taxable : 0), fees: add ? add.nonTaxable : s.docFee, down: 0, tradeAllowance: tradeVal, tradePayoff: payoffVal, term, residualPct: resPct, taxRate: s.taxRate, apr, msrp: v.price });
      breakdown = [
        kv(v.lineup ? "MSRP" : "Vehicle price", currency(v.price)),
        addonRows,
        lcash ? kv("Nissan lease cash 🏷", "− " + currency(lcash)) : "",
        kv("Trade-in value", currency(tradeVal) + tradeTag),
        estD ? `<div class="small muted" style="margin:2px 0 8px;line-height:1.4">Workup: ${esc(estD.lines.join(" · "))}</div>` : "",
        payoffVal ? kv("Trade payoff", "− " + currency(payoffVal) + payoffTag) : "",
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
        ${deltaTxt ? `<div class="small strong" style="margin-top:2px;color:${delta != null && delta <= band ? "var(--success)" : "var(--muted)"}">${deltaTxt}</div>` : ""}
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
      close();
      navigate("/compare");
    });
    wrap.querySelector('[data-act="dd-quote"]').addEventListener("click", () => {
      sessionStorage.setItem("calc-prefill", JSON.stringify({
        price: v.price, label: `${vehName(v)} — ${lead.name}`,
        tradeAllowance: tradeVal, tradePayoff: lead.payoff || 0,
        apr: lead.currentApr || null,
      }));
      close();
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

    function draw(down) {
      const rows = dealsForLead(lead, { down, method: "both" });
      const eq = equity(lead);
      const cur = lead.currentPayment;
      const top = rows.slice(0, 6);

      wrap.innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <div class="row"><span class="k muted">Currently pays</span><span class="v strong mono">${cur != null ? currency(cur) + "/mo" : "unknown"}</span></div>
          <div class="row" style="margin-top:6px"><span class="k muted">On</span><span class="v">${esc(lead.vehicleInterest || "—")}</span></div>
          <div class="row" style="margin-top:6px"><span class="k muted">Est. equity</span>${eq != null
            ? `<span class="v strong mono" style="color:${eq >= 0 ? "var(--success)" : "var(--danger)"}">${currency(eq)}</span>`
            : `<span class="v small muted">unknown — payoff ${lead.payoff != null ? currency(lead.payoff) : "?"}, trade assumed to wash it</span>`}</div>
        </div>

        <div class="field">
          <label>Cash down (tweak to hit their payment)</label>
          <input id="db-down" type="number" inputmode="decimal" value="${down}" />
        </div>

        ${cur == null ? `<div class="hint" style="margin-bottom:10px">No current payment on file for this customer — showing lowest payments. Add their payment/payoff/value to match.</div>` : ""}

        <div class="section-title" style="margin-top:6px">${cur != null ? "Closest matches" : "Lowest payments"}</div>
        <div class="db-list"></div>
        <div class="fab-note">Estimates using ${s.taxRate}% tax, ${currency(s.docFee)} fees, ${lead.currentApr || s.defaultApr}% APR, ${s.defaultTerm} mo, their car as trade${activeSpecials().length ? " — active Monthly Specials (APR/cash/lease programs) applied automatically where a model matches" : ""}. Confirm with your desk.</div>
      `;

      const list = wrap.querySelector(".db-list");
      if (!top.length) {
        list.innerHTML = `<div class="muted small">No available inventory with pricing. Add vehicles or import your inventory first.</div>`;
      } else {
        top.forEach((m) => list.appendChild(dealRow(lead, m)));
      }

      const downEl = wrap.querySelector("#db-down");
      downEl.addEventListener("change", () => draw(Number(downEl.value) || 0));
    }

    draw(0);
    return wrap;
  });
}

function dealRow(lead, m) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  el.addEventListener("click", () => openDealDetail(lead, m));
  const v = m.vehicle;
  const near = m.delta != null && Math.abs(m.delta) <= (store.getSettings().dealMatchBand || 50);
  const deltaLabel = m.delta == null ? "" :
    m.delta <= 0 ? `${currency(Math.abs(Math.round(m.delta)))}/mo less` : `+${currency(Math.round(m.delta))}/mo`;
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(vehName(v))}</div>
        <div class="row-sub"><span class="badge ${m.method === "lease" ? "badge-appt" : "badge-working"}" style="margin-right:6px">${m.method === "lease" ? "Lease" : "Finance"}</span>${v.price != null ? currency(v.price) : ""}${v.stock ? " · #" + esc(v.stock) : ""}${v.lineup ? " · new — order/allocate" : ""}${m.advertised && m.leaseDown ? ` · ${currency(m.leaseDown)} down` : ""}
        ${m.special ? `<div style="margin-top:3px"><span class="badge badge-sold">🏷 ${esc(m.special)}</span></div>` : ""}</div>
      </div>
      <div class="row-meta">
        <div class="strong mono" style="font-size:1.05rem">${currency2(m.monthly)}<span class="muted" style="font-size:.8rem">/mo</span></div>
        ${m.delta != null ? `<div class="small ${near ? "" : "muted"}" style="${near ? "color:var(--success);font-weight:700" : ""}">${near ? "≈ same payment" : deltaLabel}</div>` : ""}
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
    sessionStorage.setItem("calc-prefill", JSON.stringify({
      price: v.price, label: `${vehName(v)} — ${lead.name}`,
      tradeAllowance: lead.currentValue || 0, tradePayoff: lead.payoff || 0,
      apr: lead.currentApr || null,
    }));
    navigate("/calculator");
  });
  return el;
}

// ---------- /deals page: the proactive, ranked Deal Radar ----------
export function renderDeals(view) {
  const leadsWithData = store.all("leads").some((l) => l.currentPayment != null || l.currentValue != null || l.payoff != null || l.leaseEnd || l.purchaseDate);
  const haveInventory = availableVehicles().length > 0;

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
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon("car", "ico-xl")}</div><div class="strong">No inventory to match against</div><div class="small">Add vehicles or import your inventory, then the radar builds deals.</div><button class="btn btn-primary btn-block" data-act="inv" style="margin-top:16px">${icon("file")} Import inventory</button></div>`;
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
        <div class="row-meta"><div class="strong mono" style="font-size:1.05rem">${currency2(best.monthly)}<span class="muted" style="font-size:.8rem">/mo</span></div>${best.delta != null ? `<div class="small ${best.delta <= (store.getSettings().dealMatchBand || 50) ? "" : "muted"}" style="${best.delta <= (store.getSettings().dealMatchBand || 50) ? "color:var(--success);font-weight:700" : ""}">${best.delta <= 0 ? currency(Math.abs(Math.round(best.delta))) + "/mo less" : best.delta <= (store.getSettings().dealMatchBand || 50) ? "≈ same" : "+" + currency(Math.round(best.delta)) + "/mo"}</div>` : ""}</div>
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
