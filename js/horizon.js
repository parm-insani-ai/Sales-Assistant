// When it makes sense — not whether, but when.
//
// The radar and the manager's read say who to call today. Most of the
// book isn't ready today: they owe more than the car is worth, or they're
// a year from the end of a contract. But a customer's position moves every
// month — the payoff comes down with each payment, the trade value drifts
// down more slowly — and there is a month where the two cross, or where a
// like-for-like vehicle on the lot lands at their payment, or the contract
// simply runs out. This finds that month for every customer, so the rep
// reaches them just before it and not two years after.
//
// And the leases: every one the store has out, with its end date, in order.
//
// Pure functions over plain rows, shared by the rep's screen, the manager's
// Customers tab and both assistants; node pins the arithmetic.

import { paymentsLeftOf } from "./contract.js";

const DAY = 86400000;
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const money = (n) => "$" + Math.round(Math.abs(Number(n))).toLocaleString("en-CA");
const parse = (iso) => { if (!iso) return null; const d = new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? null : d; };
const addMonths = (d, n) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth() + n, Math.min(x.getDate(), 28), 12); };
export const monthLabel = (d) => (d ? new Date(d).toLocaleDateString("en-CA", { month: "short", year: "numeric" }) : "");
export const monthKeyOf = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`; };
export const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const daysSince = (iso, now) => { const t = parse(iso); return t ? (now - t.getTime()) / DAY : null; };

export const DEFAULTS = {
  depreciationPct: 12,    // a vehicle loses about this much of its value a year
  minEquity: 3000,        // equity that puts real money toward the next one
  leadMonths: 6,          // start a lease-end conversation this far out
  contractLeadMonths: 3,  // and a finance contract this far from its end
  horizonMonths: 36,      // how far ahead to look
  dealMatchBand: 50,      // a payment within this counts as "the same"
  defaultApr: 7.9,
};

export function isLease(l) {
  return /lease/i.test(String(l.dealType || "")) || /deal type:\s*lease/i.test(String(l.notes || "")) || /lease/i.test(String(l.alertType || "")) || (!!l.leaseEnd && !/retail|finance|loan|purchase/i.test(String(l.dealType || "")));
}

/**
 * The customer's position `m` months from now: trade value, what's owing,
 * payments left, equity. Nulls where the file doesn't say.
 *   value:  today's value, depreciating at `depreciationPct` a year
 *   payoff: the stated payoff amortised at their rate; or, when only the
 *           payment and the count are known, payment × payments left
 */
export function projectAt(l, m, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const now = o.now instanceof Date ? o.now : new Date(o.now || Date.now());
  const value0 = num(l.currentValue);
  const value = value0 == null ? null : Math.round(value0 * Math.pow(1 - o.depreciationPct / 100, m / 12));
  const pl = paymentsLeftOf(l, now);
  const left0 = pl ? pl.left : null;
  const left = left0 == null ? null : Math.max(0, left0 - m);
  const pmt = num(l.currentPayment);
  const stated = num(l.payoff);
  let payoff = null;
  if (stated != null) {
    const apr = num(l.currentApr);
    if (pmt != null && apr != null && apr > 0) {
      // Amortise: interest accrues, the payment comes off, month by month.
      const r = apr / 1200;
      let b = stated;
      for (let i = 0; i < m && b > 0; i++) b = b * (1 + r) - pmt;
      payoff = Math.max(0, Math.round(b));
    } else if (pmt != null && left0 != null && left0 > 0) {
      payoff = Math.max(0, Math.round(stated * (left / left0)));
    } else if (pmt != null) {
      payoff = Math.max(0, Math.round(stated - pmt * m));
    } else payoff = stated;
    if (left != null && left === 0) payoff = 0;
  } else if (pmt != null && left != null) {
    payoff = Math.round(pmt * left);
  } else if (pmt == null && l.purchaseDate && daysSince(l.purchaseDate, now.getTime()) >= 4 * 365) {
    payoff = 0; // no payment on file and years in: paid off
  }
  const equity = value != null && payoff != null ? value - payoff : null;
  return { m, at: addMonths(now, m), value, payoff, left, equity };
}

/**
 * When it makes sense for this customer. Returns null for someone this
 * doesn't apply to (a live lead with no vehicle, lost, do-not-contact,
 * just bought); otherwise
 *   { m, at, why, trigger, lease, left, end, equityNow, equityThen,
 *     valueThen, payoffThen, deal, unknown, never }
 * with m = 0 meaning now, m = null with `unknown` (the file doesn't say)
 * or `never` (not within the horizon).
 */
export function horizonFor(l, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const now = o.now instanceof Date ? o.now : new Date(o.now || Date.now());
  if (l.doNotContact || l.stage === "lost" || l.stage === "sold") return null;
  const bought = daysSince(l.purchaseDate, now.getTime());
  if (l.stage === "delivered" && bought != null && bought < 60) return null;
  const owner = !!(l.purchaseDate || num(l.currentPayment) != null || num(l.currentValue) != null || num(l.payoff) != null || l.leaseEnd || num(l.paymentsLeft) != null);
  if (!owner) return null;

  const pl = paymentsLeftOf(l, now);
  const left = pl ? pl.left : null;
  const end = pl ? (pl.end || addMonths(pl.asOf || now, num(l.paymentsLeft) || 0)) : null;
  const lease = isLease(l);
  const p0 = projectAt(l, 0, o);
  const base = { lease, left, end, equityNow: p0.equity, valueNow: p0.value, payoffNow: p0.payoff };

  if (lease) {
    if (left == null || !end) return { ...base, m: null, at: null, unknown: true, trigger: "lease", why: "A lease, but no end date on file" };
    const m = Math.max(0, left - o.leadMonths);
    const at = addMonths(now, m);
    if (left <= 0) return { ...base, m: 0, at: now, trigger: "lease", why: `Lease ended ${monthLabel(end)} — they're past the end` };
    return { ...base, m, at, trigger: "lease", why: m === 0 ? `Lease ends ${monthLabel(end)}, ${left} month${left === 1 ? "" : "s"} out — the window is open` : `Lease ends ${monthLabel(end)}; the conversation starts ${o.leadMonths} months out, in ${monthLabel(at)}` };
  }

  if (p0.value == null && left == null && p0.payoff == null) return { ...base, m: null, at: null, unknown: true, trigger: "", why: "No trade value or contract on file" };
  const hasMatch = typeof o.match === "function";
  for (let m = 0; m <= o.horizonMonths; m++) {
    const p = m === 0 ? p0 : projectAt(l, m, o);
    const at = p.at;
    const then = { equityThen: p.equity, valueThen: p.value, payoffThen: p.payoff, leftThen: p.left };
    if (p.equity != null && p.equity >= o.minEquity) {
      return { ...base, ...then, m, at, trigger: "equity", why: m === 0 ? `About ${money(p.equity)} of equity now` : `Equity reaches about ${money(p.equity)} by ${monthLabel(at)}` };
    }
    if (p.left != null && p.left === 0 && (left ?? 0) > 0 && m > 0) {
      return { ...base, ...then, m, at, trigger: "paidoff", why: `Paid off in ${monthLabel(at)}${p.value != null ? " — about " + money(p.value) + " in the trade" : ""}` };
    }
    if (p.left != null && p.left > 0 && p.left <= o.contractLeadMonths && end) {
      return { ...base, ...then, m, at, trigger: "contract", why: m === 0 ? `Contract ends ${monthLabel(end)}, ${p.left} month${p.left === 1 ? "" : "s"} out — the window is open` : `Contract ends ${monthLabel(end)}; ${o.contractLeadMonths} months out is ${monthLabel(at)}` };
    }
    if (hasMatch && m % 3 === 0 && p.value != null && p.payoff != null && num(l.currentPayment) != null) {
      const proj = { ...l, currentValue: p.value, payoff: p.payoff, paymentsLeft: p.left, paymentsLeftAsOf: now.toISOString() };
      const mm = o.match(proj);
      const pitch = mm && mm.pitch;
      if (pitch && pitch.delta != null && pitch.delta <= o.dealMatchBand && (pitch.fit == null || pitch.fit >= 40)) {
        const deal = { name: pitch.unit.name, monthly: pitch.monthly, delta: pitch.delta };
        return { ...base, ...then, m, at, trigger: "deal", deal, why: m === 0 ? `A ${deal.name} lands at about their payment now` : `By ${monthLabel(at)} a ${deal.name} lands within ${money(o.dealMatchBand)}/mo of their payment` };
      }
    }
  }
  const p36 = projectAt(l, o.horizonMonths, o);
  if (p0.value == null) return { ...base, m: null, at: null, unknown: true, trigger: "", why: "No trade value on file" };
  if (p0.payoff == null) return { ...base, m: null, at: null, unknown: true, trigger: "", why: "A trade value, but nothing about what they owe" };
  return { ...base, m: null, at: null, never: true, trigger: "", equityThen: p36.equity, why: p36.equity != null && p36.equity < 0 ? `Still about ${money(p36.equity)} upside down three years out` : `Not within three years on what's on file` };
}

// The bucket a horizon falls in, for grouping on a screen.
export const BUCKETS = [
  { key: "now", label: "Now" },
  { key: "soon", label: "In 1–3 months" },
  { key: "next", label: "In 4–6 months" },
  { key: "year", label: "In 7–12 months" },
  { key: "later", label: "More than a year out" },
  { key: "never", label: "Not in three years" },
  { key: "unknown", label: "Can't tell from the file" },
];
export function bucketOf(hz) {
  if (!hz) return "unknown";
  if (hz.unknown) return "unknown";
  if (hz.never || hz.m == null) return "never";
  if (hz.m === 0) return "now";
  if (hz.m <= 3) return "soon";
  if (hz.m <= 6) return "next";
  if (hz.m <= 12) return "year";
  return "later";
}

/**
 * A whole book, read for timing. `rows` are { lead, rep? } (the manager's
 * shape) or plain leads. Returns rows with `hz`, those it applies to,
 * soonest first; the unknowable last.
 */
export function horizonBook(rows, opts = {}) {
  const out = [];
  for (const r of rows) {
    const lead = r && r.lead ? r.lead : r;
    const hz = horizonFor(lead, opts);
    if (!hz) continue;
    out.push({ ...(r && r.lead ? r : { lead }), hz });
  }
  const order = (h) => (h.unknown ? 1e6 + 1 : h.m == null ? 1e6 : h.m);
  out.sort((a, b) => order(a.hz) - order(b.hz) || String(a.lead.name || "").localeCompare(String(b.lead.name || "")));
  return out;
}

/**
 * Every lease (or, with type "finance", every finance contract) on the
 * book with when it ends, soonest first. Rows: { lead, rep?, end, left,
 * past, payment, type }. Ends nobody knows come last.
 */
export function contractsEnding(rows, { now = Date.now(), type = "lease" } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const out = [];
  for (const r of rows) {
    const lead = r && r.lead ? r.lead : r;
    if (lead.stage === "lost" || lead.doNotContact) continue;
    const lease = isLease(lead);
    if (type === "lease" ? !lease : lease) continue;
    if (!lease) {
      const owner = !!(lead.purchaseDate || num(lead.currentPayment) != null || num(lead.paymentsLeft) != null);
      if (!owner) continue;
    }
    const pl = paymentsLeftOf(lead, at);
    const end = pl ? (pl.end || addMonths(pl.asOf || at, num(lead.paymentsLeft) || 0)) : null;
    if (!lease && !end) continue;
    out.push({ ...(r && r.lead ? r : { lead }), end, left: pl ? pl.left : null, past: !!(end && end.getTime() < at.getTime()), payment: num(lead.currentPayment), type: lease ? "Lease" : "Finance" });
  }
  out.sort((a, b) => (a.end ? a.end.getTime() : 8.64e15) - (b.end ? b.end.getTime() : 8.64e15) || String(a.lead.name || "").localeCompare(String(b.lead.name || "")));
  return out;
}

// Ends by month, in order: [{ key, label, rows }], the unknowns last.
export function byMonth(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.end ? monthKeyOf(r.end) : "unknown";
    if (!groups.has(key)) groups.set(key, { key, label: r.end ? new Date(r.end).toLocaleDateString("en-CA", { month: "long", year: "numeric" }) : "No end date on file", rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()];
}

// The follow-up date for a horizon: the month it opens, or today.
export function followUpFor(hz, now = Date.now()) {
  if (!hz || hz.m == null) return null;
  return ymd(hz.m === 0 ? now : hz.at);
}

// The to-do a manager hands a rep for one customer's window.
export function horizonTaskFor(row, { by = "your manager", now = Date.now() } = {}) {
  const l = row.lead, hz = row.hz;
  const due = followUpFor(hz, now) || ymd(now);
  return { leadId: l.id, title: `Reach out to ${l.name || "customer"} — ${hz.why} (from ${by})`, due, channel: "call", note: hz.trigger === "lease" ? "Lease-end conversation — their three options" : hz.trigger === "deal" && hz.deal ? `Pitch a ${hz.deal.name} at about the same payment` : hz.trigger === "equity" ? "Equity opener — what their trade is worth toward the next one" : "", fromManager: true };
}
