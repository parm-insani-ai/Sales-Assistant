// Any question about the book, answered from every field on file.
//
// The spoken-list parser (listspeech.js) reads the sentences people say
// most; this is for everything else — "everyone with a payment over five
// hundred who bought in 2021", "how many of my customers have a lease",
// "average rate on my Rogue owners", "who has a birthday this month". The
// assistant turns the sentence into a small structured query over the
// fields below; the phone runs it against the book, puts the people on
// Outreach and says the number back. Nothing about a customer leaves the
// phone but the counts and the few rows the reply reads from.
//
//   spec = { where: [{ field, op, value }], any, sort: { field, dir },
//            limit, measure: { op, field }, group }
//
// Pure over arrays, so node can test it. Signals that need the book read
// (score, reasons, tier) come in through `ctx.assess`, a Map by id; the
// calendar, the to-dos and the sales through `ctx.appointments`, `ctx.tasks`,
// `ctx.sales`.

import { classify } from "./segments.js";
import { equityOf } from "./reach.js";
import { paymentsLeftOf } from "./contract.js";
import { isLease } from "./horizon.js";

const DAY = 86400000;
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const str = (v) => (v == null ? "" : String(v)).trim();
const lower = (v) => str(v).toLowerCase();
const dateOf = (v) => { if (!v) return null; const t = new Date(v).getTime(); return isFinite(t) ? t : null; };
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const CAT = { payment: /\/mo less$|^Same payment|^\+\$/, equity: /equity$|^Positive equity|^Paid off/, ending: /^(Lease|Contract) ends/, service: /^In service/, rate: /% → |^Rate /, warranty: /warranty|km/i, flagged: /^AutoAlert|^High priority|^🏷/, cycle: /^Owned /, engaged: /^(Opened your link|Texted you|Live lead|Shopping now)/ };
const kindsOf = (reasons) => Object.keys(CAT).filter((k) => (reasons || []).some((r) => CAT[k].test(String(r))));

// The calendar, the to-dos and the sales, indexed once per query.
function indexes(ctx) {
  if (ctx._ix) return ctx._ix;
  const appts = new Map(), tasks = new Map(), sales = new Map();
  const now = ctx.now || Date.now();
  for (const a of ctx.appointments || []) { if (!a || !a.leadId) continue; const t = dateOf(a.when); if (t == null || t < now || a.outcome === "no_show") continue; const cur = appts.get(a.leadId); if (cur == null || t < cur) appts.set(a.leadId, t); }
  for (const t of ctx.tasks || []) { if (!t || !t.leadId || t.done) continue; tasks.set(t.leadId, (tasks.get(t.leadId) || 0) + 1); }
  for (const s of ctx.sales || []) { if (!s || !s.leadId) continue; sales.set(s.leadId, (sales.get(s.leadId) || 0) + 1); }
  ctx._ix = { appts, tasks, sales };
  return ctx._ix;
}

// Every field a question can turn on. `get` returns null when the file
// doesn't say. Money and percent fields are marked so the label reads right.
const F = (key, type, label, says, get, fmt) => ({ key, type, label, says, get, fmt: fmt || null });
export const FIELDS = [
  F("name", "text", "name", "the customer's name", (l) => str(l.name) || null),
  F("phone", "text", "phone", "their number; missing when there is none", (l) => str(l.phone) || null),
  F("email", "text", "email", "their email; missing when there is none", (l) => str(l.email) || null),
  F("stage", "enum", "stage", "new | working | appointment | negotiating | sold | delivered | lost (delivered = a past customer)", (l) => lower(l.stage) || null, { values: ["new", "working", "appointment", "negotiating", "sold", "delivered", "lost"] }),
  F("source", "text", "source", "where they came from (Import, Walk-in, Referral, Facebook…)", (l) => str(l.source) || null),
  F("rep", "text", "rep", "the salesperson they're assigned to, when the file says", (l) => str(l.rep) || null),
  F("notes", "text", "notes", "free text about them; `contains` searches it", (l) => str(l.notes) || null),
  F("vehicle", "text", "vehicle", "what they drive, as written (year make model trim)", (l) => str(l.vehicleInterest) || null),
  F("make", "text", "make", "the make of what they drive (nissan, honda, toyota…)", (l) => classify(str(l.vehicleInterest)).make || null),
  F("model", "text", "model", "the model (rogue, sentra, kicks, murano…)", (l) => classify(str(l.vehicleInterest)).model || null),
  F("year", "number", "model year", "the vehicle's model year", (l) => classify(str(l.vehicleInterest)).year || null),
  F("body", "enum", "body style", "suv | truck | car | van | sports", (l) => classify(str(l.vehicleInterest)).body || null, { values: ["suv", "truck", "car", "van", "sports"] }),
  F("trim", "text", "trim", "the trim they drive or want", (l) => str(l.trim) || null),
  F("vin", "text", "VIN", "the VIN when on file", (l) => str(l.vin) || null),
  F("odometer", "number", "odometer", "kilometres on their vehicle", (l) => num(l.odometer)),
  F("dealType", "enum", "deal type", "lease | finance — how they bought", (l) => (isLease(l) ? "lease" : /retail|finance|loan|purchase/i.test(str(l.dealType)) || num(l.currentPayment) != null || num(l.payoff) != null ? "finance" : null), { values: ["lease", "finance"] }),
  F("purchaseDate", "date", "purchase date", "when they bought (YYYY-MM-DD)", (l) => dateOf(l.purchaseDate)),
  F("ownedYears", "number", "years owned", "years since they bought", (l, c) => { const t = dateOf(l.purchaseDate); return t == null ? null : Math.round(((c.now || Date.now()) - t) / (365.25 * DAY) * 10) / 10; }),
  F("leaseEnd", "date", "lease end", "when the lease or contract matures, as the file says", (l) => dateOf(l.leaseEnd)),
  F("contractEnd", "date", "contract end", "when the contract runs out — the maturity date, or worked out from the term or the payments left", (l, c) => { const p = paymentsLeftOf(l, new Date(c.now || Date.now())); if (!p) return null; if (p.end) return p.end.getTime(); const base = p.asOf ? p.asOf.getTime() : (c.now || Date.now()); return base + p.left * 30.44 * DAY; }),
  F("paymentsLeft", "number", "payments left", "months of payments still to go", (l, c) => { const p = paymentsLeftOf(l, new Date(c.now || Date.now())); return p ? p.left : null; }),
  F("dob", "date", "birthday", "date of birth", (l) => dateOf(l.dob)),
  F("birthMonth", "number", "birthday month", "1–12, the month of their birthday", (l) => { const t = dateOf(l.dob); return t == null ? null : new Date(t).getMonth() + 1; }),
  F("currentPayment", "number", "payment", "what they pay a month now, $", (l) => num(l.currentPayment), { money: true }),
  F("payoff", "number", "payoff", "what they still owe, $", (l) => num(l.payoff), { money: true }),
  F("currentValue", "number", "vehicle value", "what their vehicle is worth, $", (l) => num(l.currentValue), { money: true }),
  F("equity", "number", "equity", "value minus payoff, $ (negative = upside down); missing when the file can't say", (l, c) => equityOf(l, c.now || Date.now()).v, { money: true }),
  F("currentApr", "number", "rate", "their interest rate, %", (l) => num(l.currentApr), { pct: true }),
  F("currentTerm", "number", "term", "the contract term in months", (l) => num(l.currentTerm)),
  F("serviceAppt", "date", "service appointment", "their next service visit, when known", (l) => dateOf(l.serviceAppt)),
  F("lastService", "date", "last service", "their last service visit", (l) => dateOf(l.lastService)),
  F("alertType", "text", "alert", "the alert or opportunity type the file came with (AutoAlert etc.)", (l) => str(l.alertType) || null),
  F("priority", "text", "priority", "the file's priority mark", (l) => str(l.priority) || null),
  F("lastContacted", "date", "last contact", "when they were last contacted; missing when never", (l) => dateOf(l.lastContacted)),
  F("daysSinceContact", "number", "days since contact", "days since the last contact — 36500 when never contacted, so `gt 90` includes the untouched", (l, c) => { const t = dateOf(l.lastContacted); return t == null ? 36500 : Math.floor(((c.now || Date.now()) - t) / DAY); }),
  F("contacted", "bool", "contacted", "true once they've been contacted at all", (l) => !!l.lastContacted),
  F("lastContactVia", "enum", "last contact via", "call | text | email | visit", (l) => lower(l.lastContactVia) || null, { values: ["call", "text", "email", "visit"] }),
  F("lastContactOutcome", "text", "last outcome", "how the last attempt went (left message, no answer, spoke…)", (l) => str(l.lastContactOutcome) || null),
  F("followUp", "date", "follow-up", "the date the next follow-up is due", (l) => dateOf(l.followUp)),
  F("lastCampaignAt", "date", "last blast", "when they were last in a mass text or email", (l) => dateOf(l.lastCampaignAt)),
  F("canText", "bool", "can text", "true when they have a number that works and haven't opted out", (l) => !!l.phone && !l.badPhone && !l.smsOptOut && !l.doNotContact),
  F("doNotContact", "bool", "do not contact", "true when marked do-not-contact", (l) => !!l.doNotContact),
  F("badPhone", "bool", "wrong number", "true when a call found the number wrong", (l) => !!l.badPhone),
  F("createdAt", "date", "added", "when they were added to the app", (l) => dateOf(l.createdAt)),
  F("importedAt", "date", "imported", "when they came in from a file", (l) => dateOf(l.importedAt)),
  F("score", "number", "score", "the app's read of how ready they are to trade, 0–100", (l, c) => { const a = c.assess && c.assess.get(l.id); return a ? num(a.score) : null; }),
  F("tier", "enum", "tier", "hot | strong | worth — the top of the book by score", (l, c) => { const a = c.assess && c.assess.get(l.id); return a && a.tier ? a.tier.key : null; }, { values: ["hot", "strong", "worth"] }),
  F("reasons", "list", "reasons", "the app's reasons for them, as shown on the card ('Same payment', '$4,200 equity', 'Lease ends in 40d'…); `contains` matches a word", (l, c) => { const a = c.assess && c.assess.get(l.id); return a && a.reasons && a.reasons.length ? a.reasons.slice() : null; }),
  F("reasonKinds", "list", "reason kinds", "payment | equity | ending | rate | warranty | service | cycle | engaged | flagged — the kinds of reason on the card", (l, c) => { const a = c.assess && c.assess.get(l.id); const k = a ? kindsOf(a.reasons) : []; return k.length ? k : null; }),
  F("nextAppointment", "date", "next appointment", "their next appointment on the calendar, when there is one", (l, c) => { const t = indexes(c).appts.get(l.id); return t == null ? null : t; }),
  F("openTasks", "number", "open to-dos", "how many open to-dos name them", (l, c) => indexes(c).tasks.get(l.id) || 0),
  F("sales", "number", "sales", "how many sales logged to them", (l, c) => indexes(c).sales.get(l.id) || 0),
  F("budget", "number", "budget", "their stated budget, $", (l) => num(l.budget), { money: true }),
  F("timeline", "text", "timeline", "when they said they'd buy", (l) => str(l.timeline) || null),
  F("tradeIn", "text", "trade-in", "what they'd trade", (l) => str(l.tradeIn) || null),
  F("newUsed", "enum", "new or used", "new | used | either", (l) => lower(l.newUsed) || null, { values: ["new", "used", "either"] }),
  F("features", "list", "must-haves", "features they want", (l) => (Array.isArray(l.features) && l.features.length ? l.features.slice() : null)),
  F("hotButtons", "list", "what matters", "why they're shopping", (l) => (Array.isArray(l.hotButtons) && l.hotButtons.length ? l.hotButtons.slice() : null)),
];
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
// Lenient on the spelling: "payment", "current_payment", "lastContact" all land.
const ALIAS = { payment: "currentPayment", monthly: "currentPayment", apr: "currentApr", rate: "currentApr", value: "currentValue", lease: "leaseEnd", leaseend: "leaseEnd", maturity: "leaseEnd", birthday: "dob", lastcontact: "lastContacted", quiet: "daysSinceContact", dayssincecontact: "daysSinceContact", km: "odometer", mileage: "odometer", vehicleinterest: "vehicle", car: "vehicle", bought: "purchaseDate", purchased: "purchaseDate", owned: "ownedYears", term: "currentTerm", dealtype: "dealType", type: "dealType", appointment: "nextAppointment", tasks: "openTasks", todos: "openTasks", tasksopen: "openTasks" };
export function fieldFor(key) {
  const k = str(key);
  if (BY_KEY.has(k)) return BY_KEY.get(k);
  const flat = k.toLowerCase().replace(/[^a-z]/g, "");
  if (ALIAS[flat]) return BY_KEY.get(ALIAS[flat]);
  return FIELDS.find((f) => f.key.toLowerCase() === flat) || null;
}

export const OPS = ["is", "isnt", "contains", "startsWith", "in", "gt", "gte", "lt", "lte", "between", "exists", "missing", "before", "after", "withinDays", "pastDays", "olderThanDays", "inMonth", "inYear"];

// Does this customer pass one condition?
function passOne(cond, l, ctx) {
  const f = fieldFor(cond.field);
  if (!f) return false;
  const v = f.get(l, ctx);
  const op = str(cond.op) || "is";
  const want = cond.value;
  const now = ctx.now || Date.now();
  if (op === "exists") return f.type === "bool" ? v === true : f.type === "number" && f.key === "openTasks" ? v > 0 : v != null && v !== "" && !(Array.isArray(v) && !v.length);
  if (op === "missing") return f.type === "bool" ? v !== true : v == null || v === "" || (Array.isArray(v) && !v.length);
  if (v == null) return false;
  if (f.type === "list") {
    const items = v.map(lower);
    if (op === "contains" || op === "is") return items.some((x) => x.includes(lower(want)));
    if (op === "isnt") return !items.some((x) => x.includes(lower(want)));
    if (op === "in") return (Array.isArray(want) ? want : [want]).some((w) => items.some((x) => x.includes(lower(w))));
    return false;
  }
  if (f.type === "bool") {
    const w = typeof want === "string" ? !/^(false|no|0)$/i.test(want) : want == null ? true : !!want;
    return op === "isnt" ? v !== w : v === w;
  }
  if (f.type === "date") {
    const d = new Date(v);
    const t = (x) => dateOf(x);
    switch (op) {
      case "before": case "lt": case "lte": { const w = t(want); return w != null && v < w + (op === "lte" ? DAY : 0); }
      case "after": case "gt": case "gte": { const w = t(want); return w != null && v >= w + (op === "gt" ? DAY : 0); }
      case "between": { const a = t(want && want[0]), b = t(want && want[1]); return a != null && b != null && v >= a && v < b + DAY; }
      case "withinDays": { const n = num(want); return n != null && v >= now - DAY && v <= now + n * DAY; }
      case "pastDays": { const n = num(want); return n != null && v <= now && v >= now - n * DAY; }
      case "olderThanDays": { const n = num(want); return n != null && v < now - n * DAY; }
      case "inMonth": { const n = num(want); return n != null && d.getMonth() + 1 === n; }
      case "inYear": { const n = num(want); return n != null && d.getFullYear() === n; }
      case "is": { const w = str(want); return w.length === 4 ? d.getFullYear() === Number(w) : ymd(v) === w.slice(0, 10); }
      case "isnt": { const w = str(want); return !(w.length === 4 ? d.getFullYear() === Number(w) : ymd(v) === w.slice(0, 10)); }
      default: return false;
    }
  }
  if (f.type === "number") {
    const n = Number(v), w = num(want);
    switch (op) {
      case "is": return w != null && n === w;
      case "isnt": return w == null || n !== w;
      case "gt": return w != null && n > w;
      case "gte": return w != null && n >= w;
      case "lt": return w != null && n < w;
      case "lte": return w != null && n <= w;
      case "between": { const a = num(want && want[0]), b = num(want && want[1]); return a != null && b != null && n >= Math.min(a, b) && n <= Math.max(a, b); }
      case "in": return (Array.isArray(want) ? want : [want]).map(num).includes(n);
      default: return false;
    }
  }
  // text / enum
  const s = lower(v);
  switch (op) {
    case "is": return s === lower(want);
    case "isnt": return s !== lower(want);
    case "contains": return s.includes(lower(want));
    case "startsWith": return s.startsWith(lower(want));
    case "in": return (Array.isArray(want) ? want : [want]).map(lower).includes(s);
    default: return false;
  }
}

/** Does this customer pass the whole query? */
export function queryPasses(spec, l, ctx = {}) {
  const where = Array.isArray(spec && spec.where) ? spec.where : [];
  if (!where.length) return true;
  return spec.any ? where.some((c) => passOne(c, l, ctx)) : where.every((c) => passOne(c, l, ctx));
}

/** The rows in the query's order (unchanged when it names none). */
export function sortByQuery(spec, rows, ctx = {}) {
  const s = spec && spec.sort;
  const f = s && fieldFor(s.field);
  if (!f) return rows;
  const desc = /^desc/i.test(str(s.dir)) || (!s.dir && f.type === "number" && /score|equity|currentPayment|currentValue|currentApr|odometer|ownedYears|daysSinceContact|sales|openTasks/.test(f.key));
  const val = new Map(rows.map((l) => [l.id, f.get(l, ctx)]));
  return rows.slice().sort((a, b) => {
    const x = val.get(a.id), y = val.get(b.id);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // the unknown go last either way
    if (y == null) return -1;
    const c = typeof x === "number" || f.type === "date" ? Number(x) - Number(y) : String(Array.isArray(x) ? x.join() : x).localeCompare(String(Array.isArray(y) ? y.join() : y));
    return desc ? -c : c;
  });
}

/** Check a spec before running it: { ok, errors }. */
export function validateQuery(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return { ok: false, errors: ["no query"] };
  for (const c of Array.isArray(spec.where) ? spec.where : []) {
    if (!c || !fieldFor(c.field)) errors.push(`unknown field "${c && c.field}"`);
    else if (c.op && !OPS.includes(c.op)) errors.push(`unknown op "${c.op}" (use ${OPS.join(", ")})`);
  }
  if (spec.sort && spec.sort.field && !fieldFor(spec.sort.field)) errors.push(`unknown sort field "${spec.sort.field}"`);
  if (spec.group && !fieldFor(spec.group)) errors.push(`unknown group field "${spec.group}"`);
  if (spec.measure && spec.measure.field && !fieldFor(spec.measure.field)) errors.push(`unknown measure field "${spec.measure.field}"`);
  if (spec.measure && spec.measure.op && !["count", "sum", "avg", "min", "max"].includes(spec.measure.op)) errors.push(`unknown measure "${spec.measure.op}" (count, sum, avg, min, max)`);
  return { ok: !errors.length, errors };
}

function measureOf(m, rows, ctx) {
  if (!m) return null;
  const op = str(m.op) || "count";
  if (op === "count") return rows.length;
  const f = fieldFor(m.field);
  if (!f) return null;
  const vals = rows.map((l) => f.get(l, ctx)).filter((v) => v != null && isFinite(Number(v))).map(Number);
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  const r = op === "sum" ? sum : op === "avg" ? sum / vals.length : op === "min" ? Math.min(...vals) : op === "max" ? Math.max(...vals) : null;
  return r == null ? null : f.type === "date" ? ymd(r) : Math.round(r * 100) / 100;
}

/**
 * Run it: { count, rows, groups, measure, label }.
 *   rows: the customers that pass, in the query's order
 *   groups: with `group`, [{ value, count, measure }] biggest first
 *   measure: with `measure`, the number over everyone that passes
 */
export function runQuery(spec, leads, ctx = {}) {
  const c = { now: Date.now(), ...ctx };
  let rows = (leads || []).filter((l) => queryPasses(spec, l, c));
  rows = sortByQuery(spec, rows, c);
  let groups = null;
  if (spec.group) {
    const f = fieldFor(spec.group);
    const m = new Map();
    for (const l of rows) {
      let v = f.get(l, c);
      if (f.type === "date") v = v == null ? null : spec.groupBy === "year" ? String(new Date(v).getFullYear()) : ymd(v).slice(0, 7);
      const keys = Array.isArray(v) ? v : [v == null ? "(none)" : String(v)];
      for (const k of keys) { const g = m.get(k) || { value: k, rows: [] }; g.rows.push(l); m.set(k, g); }
    }
    groups = [...m.values()].map((g) => ({ value: g.value, count: g.rows.length, measure: spec.measure && spec.measure.op !== "count" ? measureOf(spec.measure, g.rows, c) : g.rows.length })).sort((a, b) => (b.measure ?? -Infinity) - (a.measure ?? -Infinity) || b.count - a.count).slice(0, Math.max(1, Math.min(50, spec.groupLimit || 20)));
  }
  const measure = spec.measure ? measureOf(spec.measure, rows, c) : null;
  const limit = num(spec.limit);
  return { count: rows.length, rows: limit != null && limit > 0 ? rows.slice(0, limit) : rows, groups, measure, label: describeQuery(spec) };
}

// Money and percent read as money and percent; dates as dates.
const money = (n) => (n < 0 ? "-" : "") + "$" + Math.round(Math.abs(Number(n))).toLocaleString("en-CA");
function sayValue(f, v) {
  if (Array.isArray(v)) return v.map((x) => sayValue(f, x)).join(" or ");
  if (v == null) return "";
  if (f.fmt && f.fmt.money) return money(v);
  if (f.fmt && f.fmt.pct) return `${v}%`;
  if (f.type === "date") { const t = dateOf(v); return t == null ? str(v) : String(v).length === 4 ? str(v) : new Date(t).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }); }
  return str(v);
}
const cap = (s) => str(s).replace(/^\w/, (ch) => ch.toUpperCase());
function sayCond(c) {
  const f = fieldFor(c.field);
  if (!f) return "";
  const op = str(c.op) || "is", v = c.value, L = f.label;
  const V = sayValue(f, v);
  switch (op) {
    case "is": return f.type === "bool" ? (v === false || /^(false|no)$/i.test(str(v)) ? `not ${L}` : L) : f.key === "model" || f.key === "make" ? `${cap(V)} owners` : `${L} ${V}`;
    case "isnt": return f.type === "bool" ? `not ${L}` : `${L} not ${V}`;
    case "contains": return `${L} has "${V}"`;
    case "startsWith": return `${L} starts "${V}"`;
    case "in": return `${L} ${V}`;
    case "gt": return `${L} over ${V}`;
    case "gte": return `${L} ${V}+`;
    case "lt": return `${L} under ${V}`;
    case "lte": return `${L} up to ${V}`;
    case "between": return `${L} ${sayValue(f, v && v[0])}–${sayValue(f, v && v[1])}`;
    case "exists": return f.type === "bool" ? L : `has ${L}`;
    case "missing": return f.type === "bool" ? `not ${L}` : `no ${L}`;
    case "before": return `${L} before ${V}`;
    case "after": return `${L} after ${V}`;
    case "withinDays": return `${L} in ${v} days`;
    case "pastDays": return `${L} in the last ${v} days`;
    case "olderThanDays": return `${L} over ${v} days ago`;
    case "inMonth": return `${L} in ${new Date(2000, Number(v) - 1, 1).toLocaleDateString("en-CA", { month: "long" })}`;
    case "inYear": return `${L} in ${v}`;
    default: return `${L} ${op} ${V}`;
  }
}
/** The query in words, for the bar and the saved name. */
export function describeQuery(spec) {
  const where = Array.isArray(spec && spec.where) ? spec.where : [];
  const bits = where.map(sayCond).filter(Boolean);
  let s = bits.length ? bits.join(spec.any ? " or " : " · ") : "everyone";
  if (spec.sort && fieldFor(spec.sort.field)) { const f = fieldFor(spec.sort.field); s += `, by ${f.label}${/^desc/i.test(str(spec.sort.dir)) ? " (highest first)" : spec.sort.dir ? " (lowest first)" : ""}`; }
  return s;
}

// What the assistant is told it can ask, compact enough for every turn.
export const FIELD_HELP = FIELDS.map((f) => `${f.key} (${f.type}${f.fmt && f.fmt.money ? ", $" : f.fmt && f.fmt.pct ? ", %" : ""}): ${f.says}`).join("; ");

// The book's shape — how many have what — so the assistant knows what a
// question can be answered from before it asks. No names, no numbers of
// anyone's; counts only.
export function bookProfile(leads, ctx = {}) {
  const c = { now: Date.now(), ...ctx };
  const n = (leads || []).length;
  if (!n) return "No customers on file yet.";
  const have = (key) => { const f = BY_KEY.get(key); let k = 0; for (const l of leads) { const v = f.get(l, c); if (v != null && v !== "" && v !== false && !(Array.isArray(v) && !v.length)) k++; } return k; };
  const tally = (key, top = 8) => { const f = BY_KEY.get(key); const m = new Map(); for (const l of leads) { const v = f.get(l, c); if (v == null || v === "") continue; m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", "); };
  const cover = ["phone", "email", "currentPayment", "payoff", "currentValue", "equity", "currentApr", "leaseEnd", "purchaseDate", "dob", "odometer", "serviceAppt", "lastContacted", "notes"].map((k) => `${BY_KEY.get(k).label} ${have(k).toLocaleString()}`).join(" · ");
  return `${n.toLocaleString()} customers. How many have each on file — ${cover}. Stages: ${tally("stage") || "none"}. Deal types: ${tally("dealType") || "unknown"}. Makes: ${tally("make", 6) || "unknown"}. Models: ${tally("model", 10) || "unknown"}. Body styles: ${tally("body") || "unknown"}.`;
}
