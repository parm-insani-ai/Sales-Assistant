// The manager's read of a customer: who a rep should reach out to, and why.
//
// The rep's radar reads a book against that rep's inventory and settings,
// on that rep's phone. A manager looks across every rep's book at once,
// from an account with no inventory of its own — so this is the same
// reading of the same signals, done from the customer's row alone:
// equity, years in the vehicle, when the contract or lease runs out, the
// warranty, the rate they carry, kilometres against a lease allowance,
// what AutoAlert flagged, a service visit coming, whether they've been
// touched lately, and whether they can be texted at all. Pure functions
// over plain rows, so node can test them and every screen agrees.

import { paymentsLeftOf } from "./contract.js";

const DAY = 86400000;
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const money = (n) => "$" + Math.round(Number(n)).toLocaleString("en-CA");
const yearsSince = (iso, now) => { const t = iso ? new Date(iso).getTime() : NaN; return isFinite(t) ? (now - t) / (365.25 * DAY) : null; };
const daysSince = (iso, now) => { const t = iso ? new Date(iso).getTime() : NaN; return isFinite(t) ? (now - t) / DAY : null; };
const daysUntil = (iso, now) => { const t = iso ? new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso).getTime() : NaN; return isFinite(t) ? (t - now) / DAY : null; };

function warrantyFor(vehicle) {
  const s = String(vehicle || "").toLowerCase();
  if (/hyundai|kia|genesis/.test(s)) return [5, 100000, 5, 100000];
  if (/mitsubishi/.test(s)) return [5, 100000, 10, 160000];
  if (/volkswagen|\bvw\b|audi/.test(s)) return [4, 80000, 4, 80000];
  if (/mazda/.test(s)) return [3, Infinity, 5, Infinity];
  return [3, 60000, 5, 100000];
}

// Equity from what's on file: value against payoff, the payoff worked out
// from payment × payments left when it isn't stated. Null when unknowable.
export function equityOf(l, now = Date.now()) {
  const value = num(l.currentValue);
  if (value == null) return { v: null, src: null };
  let payoff = num(l.payoff), src = "known";
  if (payoff == null) {
    const pl = paymentsLeftOf(l, new Date(now)), pmt = num(l.currentPayment);
    if (pl && pmt != null) { payoff = pmt * pl.left; src = "est"; }
    else if (pmt == null && l.purchaseDate && yearsSince(l.purchaseDate, now) >= 4) { payoff = 0; src = "est"; }
    else return { v: null, src: null };
  }
  return { v: Math.round(value - payoff), src };
}

/**
 * One customer, read. `opts`: { now, defaultApr = 7.9, kmAllowance = 20000 }.
 * Returns { score, reasons: [chip], why: [sentence], next: { label, kind },
 *           excluded, inPlay, contactable, signals: {...} }
 */
export function readCustomer(l, opts = {}) {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now || Date.now());
  const defaultApr = num(opts.defaultApr) ?? 7.9;
  const allowance = num(opts.kmAllowance) ?? 20000;
  let score = 0;
  const found = [];
  const why = [];
  const add = (pts, chip, sentence) => { score += pts; found.push({ pts, chip, sentence }); };
  let excluded = false, inPlay = false, next = null;
  const contactable = !!(l.phone || l.email);

  if (l.smsOptOut || (l.consent && l.consent.basis === "withdrawn")) why.push("Opted out of texts.");
  if (l.doNotContact) { excluded = true; why.push("Do not contact."); }
  if (l.stage === "lost") { excluded = true; why.push("Marked lost."); }
  if (l.stage === "sold" || (l.stage === "delivered" && daysSince(l.purchaseDate, now) != null && daysSince(l.purchaseDate, now) < 60)) { excluded = true; why.push("Just bought — leave them to enjoy it."); }
  if (["appointment", "negotiating"].includes(l.stage)) { inPlay = true; why.push(`Already in play (${l.stage}).`); }

  // Equity.
  const eq = equityOf(l, now);
  const est = eq.src === "est" ? " (estimated)" : "";
  if (eq.v != null && eq.v >= 8000) add(26, `${eq.src === "est" ? "~" : ""}${money(eq.v)} equity`, `About ${money(eq.v)} of equity in their ${l.vehicleInterest || "vehicle"}${est} — real money toward the next one.`);
  else if (eq.v != null && eq.v >= 3000) add(20, `${eq.src === "est" ? "~" : ""}${money(eq.v)} equity`, `About ${money(eq.v)} of equity in their ${l.vehicleInterest || "vehicle"}${est}.`);
  else if (eq.v != null && eq.v > 0) add(10, "Positive equity", `A little equity in their ${l.vehicleInterest || "vehicle"}${est}.`);
  else if (eq.v != null && eq.v < -2000) add(-8, `${money(-eq.v)} upside down`, `They owe about ${money(-eq.v)} more than the car is worth${est} — go gently.`);
  const paidOff = num(l.currentPayment) == null && (num(l.payoff) == null || num(l.payoff) === 0) && l.purchaseDate;
  const yrs = yearsSince(l.purchaseDate, now);
  if (paidOff && yrs != null && yrs >= 4) add(10, "Paid off", "No payment on file and years in — likely paid off, cash in hand toward the next one.");

  // Years in the vehicle.
  if (yrs != null && yrs >= 5) add(15, `Owned ${Math.floor(yrs)} yrs`, `${Math.floor(yrs)} years in the ${l.vehicleInterest || "vehicle"} — well past a normal trade cycle.`);
  else if (yrs != null && yrs >= 3) add(12, `Owned ${Math.floor(yrs)} yrs`, `${Math.floor(yrs)} years in — right in the window most people trade.`);
  else if (yrs != null && yrs >= 2) add(5, null, null);

  // The contract or lease.
  const pl = paymentsLeftOf(l, new Date(now));
  const months = pl && pl.left > 0 ? pl.left : null;
  const lease = /lease/i.test(String(l.dealType || "")) || /deal type:\s*lease/i.test(String(l.notes || "")) || /lease/i.test(String(l.alertType || "")) || !!l.leaseEnd;
  const what = lease ? "lease" : "contract";
  if (months != null) {
    if (months <= 3) add(26, `${lease ? "Lease" : "Contract"} ends in ${months} mo`, `Their ${what} is up in about ${months} month${months === 1 ? "" : "s"} — decision time.`);
    else if (months <= 6) add(16, `${lease ? "Lease" : "Contract"} ends in ${months} mo`, `Their ${what} runs out in about ${months} months — the right time to look at options.`);
    else if (months <= 12) add(8, null, `About ${months} months left on their ${what}.`);
  }

  // Warranty running out.
  const [bYrs, bKm, pYrs, pKm] = warrantyFor(l.vehicleInterest);
  const km = num(l.odometer);
  const modelYear = Number((String(l.vehicleInterest || "").match(/\b(19|20)\d{2}\b/) || [])[0]) || null;
  const age = yrs != null ? yrs : (modelYear ? (new Date(now).getFullYear() - modelYear + 0.5) : null);
  const nearBasic = (age != null && age >= bYrs - 0.35 && age <= bYrs + 0.6) || (km != null && isFinite(bKm) && km >= bKm * 0.87 && km <= bKm * 1.1);
  const nearPower = (age != null && age >= pYrs - 0.35 && age <= pYrs + 0.6) || (km != null && isFinite(pKm) && km >= pKm * 0.9 && km <= pKm * 1.08);
  if (nearBasic) add(10, "Warranty ending", `Basic warranty is running out.`);
  else if (nearPower) add(10, "Powertrain warranty ending", `Powertrain warranty is running out.`);

  // Kilometres.
  if (km != null && yrs != null && yrs >= 0.5) {
    const perYear = km / yrs;
    if (lease && perYear > allowance * 1.1) add(12, "Over km on lease", `About ${Math.round(perYear / 1000)}k km/yr against a ${Math.round(allowance / 1000)}k allowance — trading early avoids the excess charge.`);
    else if (perYear >= 30000) add(6, "High km", `About ${Math.round(perYear / 1000)}k km a year — the car is aging fast.`);
  }

  // Their rate.
  const apr = num(l.currentApr);
  if (apr != null && apr > defaultApr + 1) add(8, `Rate ${apr}%`, `Carrying ${apr}% — above today's typical ${defaultApr}%.`);

  // Flags and the service drive.
  const notes = String(l.notes || "");
  const fromNotes = (label) => ((notes.match(new RegExp(label + ":\\s*([^\\n]+)", "i")) || [])[1] || "").split(" · ")[0].trim();
  const alert = String(l.alertType || "").trim() || fromNotes("AutoAlert");
  if (alert) add(15, `AutoAlert: ${alert.slice(0, 28)}`, `AutoAlert flagged them: ${alert}.`);
  const pri = String(l.priority || "").trim() || fromNotes("Priority");
  if (/high|hot|1\b|a\b/i.test(pri)) add(8, "High priority", `Priority: ${pri}.`);
  const svc = (l.serviceAppt && /^\d{4}-\d{2}-\d{2}/.test(String(l.serviceAppt)) ? String(l.serviceAppt).slice(0, 10) : null) || (notes.match(/Service appt\s*(\d{4}-\d{2}-\d{2})/i) || [])[1] || null;
  const svcDays = svc ? Math.floor(daysUntil(svc, now)) : null;
  if (svcDays != null && svcDays >= 0 && svcDays <= 14) { add(14, `In service ${svcDays === 0 ? "today" : "in " + svcDays + "d"}`, `They're in the service drive on ${svc} — meet them there.`); next = { label: `Meet them in the service drive ${svcDays === 0 ? "today" : "on " + svc}`, kind: "service" }; }

  // A live shopper, and one nobody has touched.
  const live = ["new", "working"].includes(l.stage) && !l.purchaseDate && num(l.currentPayment) == null;
  if (live) add(20, "Live lead", "A live enquiry, not an owner — work the plan.");
  const cDays = daysSince(l.lastContacted, now);
  const ageDays = daysSince(l.createdAt, now);
  if (live && cDays == null && ageDays != null && ageDays > 1) { add(15, "Never touched", `A live lead nobody has contacted in ${Math.floor(ageDays)} days.`); if (!next) next = { label: "Call them today — first contact", kind: "call" }; }

  // Recency: leave people alone after they've been reached.
  if (cDays != null && cDays <= 14) add(-15, null, `Contacted ${Math.round(cDays)} day${Math.round(cDays) === 1 ? "" : "s"} ago — give it a moment.`);
  else if (cDays != null && cDays >= 120 && score >= 20) add(6, "Gone quiet", `Nobody has spoken to them in ${Math.round(cDays / 30)} months.`);
  const kDays = daysSince(l.lastCampaignAt, now);
  if (kDays != null && kDays <= 30) add(-10, null, `In a campaign ${Math.round(kDays)} days ago.`);
  if (!contactable) add(-20, "No phone or email", "No way to reach them on file.");
  const noConsent = !!l.phone && (l.smsOptOut || (l.consent && l.consent.basis === "withdrawn"));
  if (noConsent) add(-6, "Texts withdrawn", "They've opted out of texts — a call, not a text.");

  if (excluded) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));
  found.sort((a, b) => b.pts - a.pts);
  const chips = found.filter((f) => f.chip);
  const cautions = chips.filter((f) => f.pts < 0).sort((a, b) => a.pts - b.pts).slice(0, 2);
  const reasons = [...chips.filter((f) => f.pts >= 0).slice(0, 4 - cautions.length), ...cautions].map((f) => f.chip);
  const whyAll = [...found.filter((f) => f.sentence).map((f) => f.sentence), ...why];
  if (!next) {
    if (excluded) next = null;
    else if (inPlay) next = { label: "Keep the deal moving", kind: "inplay" };
    else if (noConsent && score >= 20) next = { label: "Call — texts withdrawn", kind: "call" };
    else if (months != null && months <= 6 && lease) next = { label: "Lease-end conversation — their three options", kind: "opener" };
    else if (eq.v != null && eq.v >= 3000 && score >= 20) next = { label: "Equity opener — what their trade is worth toward the next one", kind: "opener" };
    else if (score >= 20) next = { label: "Reach out — an opener", kind: "opener" };
    else if (!contactable) next = { label: "Add a phone number", kind: "fix" };
    else next = { label: "Nothing pressing — keep on file", kind: "none" };
  }
  return { score, reasons, why: whyAll, next, excluded, inPlay, contactable, months, equity: eq.v, lease };
}

// Tiers relative to the book: Hot is the top tenth, Strong the top third,
// each with a floor so a thin book doesn't promote people with little
// going for them.
const FLOORS = { hot: 60, strong: 45, worth: 30 };
export const TIERS = [
  { key: "hot", label: "Hot", badge: "badge-due" },
  { key: "strong", label: "Strong", badge: "badge-sold" },
  { key: "worth", label: "Worth a call", badge: "badge-soon" },
];
export function cutsFor(scores) {
  const s = scores.filter((x) => x > 0).sort((a, b) => b - a);
  const at = (frac) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * frac))] : 0);
  return { hot: Math.max(FLOORS.hot, at(0.1)), strong: Math.max(FLOORS.strong, at(0.33)), worth: FLOORS.worth };
}
export function tierOf(score, cuts) {
  return TIERS.find((t) => score >= cuts[t.key]) || null;
}

/**
 * Read a whole store: `rows` are { lead, rep } pairs. Returns every row
 * read and ranked, best first, with tier, plus the cuts used.
 */
export function rankBook(rows, opts = {}) {
  const read = rows.map((r) => ({ ...r, read: readCustomer(r.lead, opts) }));
  const cuts = cutsFor(read.map((r) => r.read.score));
  read.forEach((r) => { r.tier = tierOf(r.read.score, cuts); });
  read.sort((a, b) => b.read.score - a.read.score || String(a.lead.name || "").localeCompare(String(b.lead.name || "")));
  return { rows: read, cuts };
}

// The reach-outs: everyone worth a call who isn't excluded or already in
// play, best first. `limit` caps it.
export function reachOuts(ranked, { limit = 50, minScore = 30 } = {}) {
  return ranked.rows.filter((r) => !r.read.excluded && !r.read.inPlay && r.read.score >= minScore && r.read.contactable).slice(0, limit);
}

// The task a manager hands a rep for one reach-out.
export function taskFor(row, { by = "your manager", now = new Date() } = {}) {
  const l = row.lead, r = row.read;
  const why = r.reasons.filter((x) => !/^No |^Texts withdrawn|upside down/.test(x)).slice(0, 2).join(", ");
  const due = new Date(now); due.setHours(0, 0, 0, 0);
  const call = r.next && (r.next.kind === "call" || r.next.kind === "service");
  return {
    leadId: l.id,
    title: `Reach out to ${l.name || "customer"}${why ? " — " + why : ""} (from ${by})`,
    due: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`,
    channel: call ? "call" : "message",
    note: r.next ? r.next.label : "",
    fromManager: true,
  };
}
