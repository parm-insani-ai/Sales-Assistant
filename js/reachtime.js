// Best time to reach.
//
// Every attempt the salesperson makes is on file with its clock time and
// what came of it (a call logged from a tray, a session outcome, a plan
// step). That is enough to learn two things nobody writes down: when this
// customer tends to pick up, and when this book as a whole does. The read
// is by part of the day — morning, midday, afternoon, evening — because
// that is how people's days are shaped, and because a few attempts per
// customer can't support anything finer.
//
// It's used three ways. The calling session puts the people likely to
// answer right now at the front. A retry after no answer lands in the part
// of the day that has worked for them (or, knowing nothing, the other half
// from the attempt). And the card says it, when it's known: "tends to pick
// up mornings".
//
// Small numbers are handled honestly: a customer's own record is shrunk
// toward the book's by a prior worth a few attempts, so one lucky pickup at
// 4pm doesn't become "afternoons". Nothing is said on a card until there's
// something to say.

import * as store from "./store.js";

export const PARTS = [
  { key: "morning", label: "mornings", from: 8, to: 12, hh: 10, mm: 30 },
  { key: "midday", label: "around midday", from: 12, to: 15, hh: 13, mm: 15 },
  { key: "afternoon", label: "afternoons", from: 15, to: 18, hh: 16, mm: 0 },
  { key: "evening", label: "evenings", from: 18, to: 21, hh: 18, mm: 30 },
];
const PRIOR = 3;          // the book's rate counts as this many attempts of the customer's own
const SAY_MIN = 3;        // attempts before a card says anything about a customer
const SAY_LIFT = 0.15;    // and the part has to beat their other parts by this much
const REACHED = new Set(["reached"]);
const TRIED = new Set(["reached", "voicemail", "no_answer"]);

export function partOf(d = new Date()) {
  const h = d.getHours();
  const p = PARTS.find((x) => h >= x.from && h < x.to);
  return p || (h < 8 ? PARTS[0] : PARTS[3]);
}

// Outbound call attempts with a verdict, as { leadId, at, part, reached }.
export function attempts(rows = store.all("calls")) {
  return rows
    .filter((c) => c && c.dir !== "in" && (c.via || "call") === "call" && TRIED.has(c.outcome) && c.at)
    .map((c) => { const d = new Date(c.at); return isNaN(d) ? null : { leadId: c.leadId, at: c.at, part: partOf(d).key, weekday: d.getDay(), reached: REACHED.has(c.outcome) }; })
    .filter(Boolean);
}

const tally = () => Object.fromEntries(PARTS.map((p) => [p.key, { tried: 0, reached: 0 }]));
function count(list) {
  const t = tally();
  list.forEach((a) => { t[a.part].tried++; if (a.reached) t[a.part].reached++; });
  return t;
}

// The book's own pattern: pickup rate by part of day over every attempt.
// Cached per generation of the calls collection.
let cache = { key: null, book: null, byLead: null };
function read() {
  const key = (() => { try { return store.generation("calls"); } catch { return store.all("calls").length; } })();
  if (cache.key === key && cache.book) return cache;
  const all = attempts();
  const byLead = new Map();
  all.forEach((a) => { if (!a.leadId) return; if (!byLead.has(a.leadId)) byLead.set(a.leadId, []); byLead.get(a.leadId).push(a); });
  const book = count(all);
  const total = all.length, reached = all.filter((a) => a.reached).length;
  cache = { key, book, byLead, total, overall: total ? reached / total : 0.3 };
  return cache;
}

/** The book's read: [{ part, label, tried, reached, rate }] and the overall rate. */
export function bookTimes() {
  const r = read();
  return { overall: r.overall, total: r.total, parts: PARTS.map((p) => ({ ...p, ...r.book[p.key], rate: r.book[p.key].tried ? r.book[p.key].reached / r.book[p.key].tried : null })) };
}

// The chance this customer picks up in a part of the day: their own record
// there, shrunk toward the book's rate for that part (or overall when the
// book has nothing there either) by a prior worth a few attempts.
export function pickupOdds(leadId, partKey, r = read()) {
  const mine = count(r.byLead.get(leadId) || [])[partKey];
  const bk = r.book[partKey];
  const base = bk.tried >= 5 ? bk.reached / bk.tried : r.overall;
  return (mine.reached + PRIOR * base) / (mine.tried + PRIOR);
}

/**
 * When this customer tends to pick up, if it's known: { part, label, rate,
 * tried } — else null. Known means a few attempts, and one part of the day
 * clearly ahead of the rest.
 */
export function bestTime(leadId) {
  const r = read();
  const mine = r.byLead.get(leadId) || [];
  if (mine.length < SAY_MIN) return null;
  const parts = PARTS.map((p) => ({ part: p.key, label: p.label, odds: pickupOdds(leadId, p.key, r), ...count(mine)[p.key] })).filter((x) => x.tried);
  if (parts.length < 1) return null;
  parts.sort((a, b) => b.odds - a.odds);
  const best = parts[0], rest = parts.slice(1);
  const others = rest.length ? rest.reduce((s, x) => s + x.odds, 0) / rest.length : 0;
  if (!best.reached || best.odds < others + SAY_LIFT) return null;
  return { part: best.part, label: best.label, rate: best.reached / best.tried, tried: best.tried, odds: best.odds };
}

/** One line for a card, or "". */
export function reachLine(leadId) {
  const b = bestTime(leadId);
  return b ? `Tends to pick up ${b.label}` : "";
}

/**
 * Who to call now: the customers in order of their odds of answering in
 * this part of the day. Ties keep the order given (best first), so with no
 * history this is the batch as it stands. Someone tried in this same part
 * of the day without an answer goes to the back: try them at another time.
 */
export function orderForNow(items, { now = new Date(), idOf = (x) => (x.lead ? x.lead.id : x.id) } = {}) {
  const r = read();
  const part = partOf(now).key;
  const today = now.toISOString().slice(0, 10);
  const scored = items.map((it, i) => {
    const id = idOf(it);
    const mine = r.byLead.get(id) || [];
    const triedNow = mine.some((a) => a.part === part && !a.reached && String(a.at).slice(0, 10) === today);
    return { it, i, odds: triedNow ? -1 : pickupOdds(id, part, r) };
  });
  scored.sort((a, b) => (b.odds - a.odds) || (a.i - b.i));
  return scored.map((s) => s.it);
}

/**
 * When to try this customer again after no answer: the part of the day
 * that works for them when known; else the other half of the day from the
 * attempt. { key, label, hh, mm, word, known }.
 */
export function retrySlot(leadId, now = new Date()) {
  const b = bestTime(leadId);
  const nowPart = partOf(now).key;
  if (b && b.part !== nowPart) { const p = PARTS.find((x) => x.key === b.part); return { key: p.key, label: p.label, hh: p.hh, mm: p.mm, word: p.label.replace(/^around /, ""), known: true }; }
  // The book's best part that isn't this one, when it has a clear read;
  // else simply the other half of the day.
  const bt = bookTimes().parts.filter((p) => p.key !== nowPart && p.tried >= 8 && p.rate != null).sort((a, b) => b.rate - a.rate)[0];
  if (bt && bt.rate >= (bookTimes().overall || 0) + 0.1) return { key: bt.key, label: bt.label, hh: bt.hh, mm: bt.mm, word: bt.label.replace(/^around /, ""), known: true };
  const other = now.getHours() < 13 ? PARTS[2] : PARTS[0];
  return { key: other.key, label: other.label, hh: other.hh, mm: other.mm, word: other.label.replace(/^around /, ""), known: false };
}
