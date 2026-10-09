// What a signed deal needs before it can be delivered, read off the
// paperwork. The read (dealread.js, through the function) says what's on
// the deal — the car, the trade, the money, every product and accessory
// sold. This turns that into the list: each item becomes the things to do,
// with who does them and how long they take, so the rep gets a heads-up
// the same day for anything with a lead time, not the morning of.
//
// Pure, so node can test it. The rules are the store's: the defaults below
// are a Nissan store's usual products, and Settings can carry its own
// (settings.prepRules, same shape) once the lead times are known.

// One rule: when a product on the deal matches `match` (against its name
// and kind, case-insensitive), these steps go on the list. `lead` is
// working days before delivery the step has to start — 0 is "day of".
export const DEFAULT_PREP_RULES = [
  { match: /rust|undercoat|corrosion/i, steps: [
    { label: "Book rust protection with service", owner: "service", lead: 3 },
  ] },
  { match: /paint|fabric|interior protection|appearance|ceramic/i, steps: [
    { label: "Book paint and fabric protection with service", owner: "service", lead: 3 },
  ] },
  { match: /etch/i, steps: [
    { label: "Security etch applied and registered", owner: "service", lead: 2 },
  ] },
  { match: /walkaway/i, steps: [
    { label: "Walkaway enrolment signed and submitted", owner: "finance", lead: 1 },
  ] },
  { match: /warranty|platinum plan|gold plan|silver plan|service plan|protection plan|extended/i, steps: [
    { label: "Extended plan contract signed and registered", owner: "finance", lead: 1 },
  ] },
  { match: /tire|rim|wheel/i, steps: [
    { label: "Tire and rim coverage registered", owner: "finance", lead: 1 },
  ] },
  { match: /gap|loan protection|life|disability/i, steps: [
    { label: "Insurance product forms signed", owner: "finance", lead: 1 },
  ] },
  { match: /package|mats|mud ?guards|guards|cargo|hitch|tonneau|rack|remote start|starter|tint|step|running board|visor|spoiler|accessor/i, steps: [
    { label: "Order accessories from parts", owner: "parts", lead: 5 },
    { label: "Book accessory install with service", owner: "service", lead: 2 },
  ] },
  { match: /winter|snow/i, steps: [
    { label: "Winter tires ordered and mounted", owner: "parts", lead: 5 },
  ] },
  { match: /charger|wallbox|level 2/i, steps: [
    { label: "Home charger ordered; installer booked with the customer", owner: "rep", lead: 7 },
  ] },
];

// Steps every deal has, by how it's paid and what's on it.
const BASE = {
  finance: [
    { label: "Lender approval and stips in (ID, income, void cheque)", owner: "finance", lead: 2 },
    { label: "Proof of insurance from the customer", owner: "customer", lead: 1 },
  ],
  lease: [
    { label: "Lease approval and stips in (ID, income, void cheque)", owner: "finance", lead: 2 },
    { label: "Proof of insurance from the customer", owner: "customer", lead: 1 },
  ],
  cash: [
    { label: "Funds confirmed (draft or wire)", owner: "finance", lead: 1 },
    { label: "Proof of insurance from the customer", owner: "customer", lead: 1 },
  ],
  trade: [
    { label: "Trade: ownership, both keys, lien payout letter if any", owner: "customer", lead: 1 },
  ],
  lien: [
    { label: "Trade lien payout confirmed with the lienholder", owner: "finance", lead: 2 },
  ],
  new: [
    { label: "PDI done and MVI on the car", owner: "service", lead: 1 },
  ],
  used: [
    { label: "MVI and safety on the car", owner: "service", lead: 2 },
  ],
  ev: [
    { label: "Charged to 80% and the charge cable in the car", owner: "service", lead: 0 },
    { label: "EV rebate paperwork submitted", owner: "finance", lead: 1 },
  ],
  always: [
    { label: "Plates and registration", owner: "finance", lead: 1 },
    { label: "Detailed, fuelled, second key and manual in the car", owner: "service", lead: 0 },
  ],
};

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// `n` working days back from a date (weekends skipped).
function workDaysBefore(dateISO, n) {
  const d = new Date(String(dateISO).slice(0, 10) + "T12:00:00");
  if (isNaN(d)) return null;
  let left = n;
  while (left > 0) { d.setTime(d.getTime() - DAY); if (d.getDay() !== 0 && d.getDay() !== 6) left--; }
  return ymd(d);
}

/**
 * The prep list for a deal.
 *   read: the paperwork as read — { finance: {type}, trade: [...], vehicle: {newUsed, fuel}, products: [{name, kind}], deliveryDate }
 *   rules: the store's product rules (DEFAULT_PREP_RULES shape)
 *   today: ISO date, for "start by" when there's a delivery date
 * Returns items: [{ label, owner, lead, from, startBy, urgent }], deduplicated,
 * ordered by lead time (the longest first — that's the heads-up).
 */
export function prepFromDeal(read = {}, { rules = DEFAULT_PREP_RULES, today = ymd(new Date()) } = {}) {
  const r = read || {};
  const products = Array.isArray(r.products) ? r.products : [];
  const items = [];
  const add = (step, from) => { if (!items.some((i) => i.label === step.label)) items.push({ ...step, from }); };
  const fin = String((r.finance && r.finance.type) || "").toLowerCase();
  (BASE[fin === "lease" ? "lease" : fin === "cash" ? "cash" : "finance"]).forEach((s) => add(s, fin || "finance"));
  const trades = Array.isArray(r.trade) ? r.trade.filter((t) => t && (t.make || t.model || t.vin)) : [];
  if (trades.length) {
    BASE.trade.forEach((s) => add(s, "trade"));
    if (trades.some((t) => t.lien && !/^(n\/?a|none|0|\$?0(\.00)?)$/i.test(String(t.lien).trim()))) BASE.lien.forEach((s) => add(s, "trade"));
  }
  const v = r.vehicle || {};
  (String(v.newUsed || "").toLowerCase() === "used" ? BASE.used : BASE.new).forEach((s) => add(s, "vehicle"));
  if (/electric|ev\b|leaf|ariya|kw/i.test(`${v.fuel || ""} ${v.model || ""} ${v.engine || ""}`)) BASE.ev.forEach((s) => add(s, "vehicle"));
  products.forEach((p) => {
    const text = `${p.name || ""} ${p.kind || ""}`;
    rules.forEach((rule) => { if (rule.match.test(text)) rule.steps.forEach((s) => add(s, p.name || p.kind || "product")); });
  });
  BASE.always.forEach((s) => add(s, "delivery"));
  const when = r.deliveryDate ? String(r.deliveryDate).slice(0, 10) : "";
  items.forEach((i) => {
    i.startBy = when ? workDaysBefore(when, i.lead) : "";
    // Urgent: it has a lead time and, with a date, it should already be under way.
    i.urgent = i.lead >= 2 && (!when || (i.startBy && i.startBy <= today));
  });
  return items.sort((a, b) => b.lead - a.lead || a.label.localeCompare(b.label));
}

// The heads-up: the things with lead times, in a line — what to start today.
export function headsUp(items) {
  const lead = items.filter((i) => i.lead >= 2);
  if (!lead.length) return "Nothing with a lead time — the usual prep only.";
  return `Start now: ${lead.map((i) => `${i.label.replace(/ with service| from parts/g, "")} (${i.lead} days)`).join(" · ")}.`;
}
