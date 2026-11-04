// What worked.
//
// Everything before this was judgement: the scoring weights, the plan, the
// reasons an opener is built on. This is where the app starts finding out.
// Every opener the salesperson sends is logged with why it was sent — the
// kind (a prospect the app brought up, a plan step, a reply), the reasons
// on the card at the time, the score — and the outcomes are read back later
// from what the app already records: a reply in the thread, an appointment
// on the calendar, a sale in the tracker. Coach shows the readout; over the
// weeks it says which reasons actually get replies and which openers book.

import * as store from "./store.js";
import { categoryOf, WHY_CATEGORIES } from "./assess.js";

const DAY = 86400000;
const PENDING = "viniva:outreach-pending";

// The review flow knows why a text is being drafted; the send happens a
// screen later. Hand the why across.
export function setPending(ctx) {
  try { sessionStorage.setItem(PENDING, JSON.stringify({ ...ctx, at: Date.now() })); } catch {}
}
export function takePending(leadId) {
  try {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p.leadId !== leadId || Date.now() - (p.at || 0) > 30 * 60000) return null;
    sessionStorage.removeItem(PENDING);
    return p;
  } catch { return null; }
}

// Log a sent text with its context. Called by sendText.
export function logOutreach({ leadId, textId = null, kind = "manual", intent = "", reasons = [], score = null, tier = "", consent = "" }) {
  if (!leadId) return null;
  return store.create("outreach", {
    leadId, textId, kind, intent, reasons: (reasons || []).slice(0, 4), score, tier, consent,
    at: new Date().toISOString(),
  });
}

// The chip on a card, folded into the handful of reasons worth comparing.
export function reasonCategory(chip) {
  const s = String(chip || "");
  if (/\/mo less/i.test(s)) return "Cheaper payment";
  if (/^Same payment/i.test(s)) return "Same payment";
  if (/^\+\$/.test(s)) return "Small step up";
  if (/equity/i.test(s)) return "Equity";
  if (/upside down/i.test(s)) return "Upside down";
  if (/Lease|Contract/i.test(s)) return "Contract ending";
  if (/Warranty/i.test(s)) return "Warranty ending";
  if (/Opened/i.test(s)) return "Opened a link";
  if (/Texted you/i.test(s)) return "Texted us";
  if (/AutoAlert/i.test(s)) return "AutoAlert flag";
  if (/In service/i.test(s)) return "Service visit";
  if (/Owned/i.test(s)) return "Years owned";
  if (/%|Rate/i.test(s)) return "Rate";
  if (/Live lead|Shopping/i.test(s)) return "Live enquiry";
  if (/Paid off/i.test(s)) return "Paid off";
  if (/Over km|High km/i.test(s)) return "Mileage";
  return "Other";
}

// Did anything come of it? Read from the records the app keeps anyway.
const REPLY_DAYS = 7, BOOK_DAYS = 14, SALE_DAYS = 60;
function outcomesFor(row, idx) {
  const t0 = new Date(row.at).getTime();
  const within = (list, days, atOf) => (list || []).some((x) => { const t = new Date(atOf(x)).getTime(); return t > t0 && t - t0 <= days * DAY; });
  return {
    replied: within(idx.texts.get(row.leadId), REPLY_DAYS, (t) => t.at || t.createdAt),
    booked: within(idx.appts.get(row.leadId), BOOK_DAYS, (a) => a.createdAt || a.when),
    sold: within(idx.sales.get(row.leadId), SALE_DAYS, (s) => s.saleDate || s.createdAt),
  };
}

function index() {
  const by = (list, key) => { const m = new Map(); list.forEach((x) => { const k = x[key]; if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
  return {
    texts: by(store.all("texts").filter((t) => t.dir === "in"), "leadId"),
    appts: by(store.all("appointments"), "leadId"),
    sales: by(store.all("sales"), "leadId"),
  };
}

/**
 * The readout. { weeks:[{start, sent, replied, booked, sold}], byReason:[…],
 * byKind:[…], total:{…}, insights:[…] } for the last `weeks` weeks.
 */
export function outreachReport({ weeks = 4, now = Date.now() } = {}) {
  const idx = index();
  const since = now - weeks * 7 * DAY;
  const rows = store.all("outreach").filter((r) => new Date(r.at).getTime() >= since).map((r) => ({ ...r, ...outcomesFor(r, idx) }));

  const tally = () => ({ sent: 0, replied: 0, booked: 0, sold: 0 });
  const bump = (t, r) => { t.sent++; if (r.replied) t.replied++; if (r.booked) t.booked++; if (r.sold) t.sold++; };

  const weekOf = (t) => { const d = new Date(t); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 10); };
  const wk = new Map();
  for (let i = weeks - 1; i >= 0; i--) wk.set(weekOf(now - i * 7 * DAY), tally());
  rows.forEach((r) => { const k = weekOf(new Date(r.at).getTime()); if (!wk.has(k)) wk.set(k, tally()); bump(wk.get(k), r); });
  const weekRows = [...wk.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([start, t]) => ({ start, ...t }));

  const byReasonM = new Map(), byKindM = new Map();
  rows.forEach((r) => {
    const cats = new Set((r.reasons || []).map(reasonCategory));
    if (!cats.size) cats.add("No reason recorded");
    cats.forEach((c) => { if (!byReasonM.has(c)) byReasonM.set(c, tally()); bump(byReasonM.get(c), r); });
    const k = r.kind || "manual";
    if (!byKindM.has(k)) byKindM.set(k, tally());
    bump(byKindM.get(k), r);
  });
  const rate = (t) => (t.sent ? Math.round((t.replied / t.sent) * 100) : 0);
  const byReason = [...byReasonM.entries()].map(([reason, t]) => ({ reason, ...t, replyRate: rate(t) })).sort((a, b) => b.sent - a.sent);
  const byKind = [...byKindM.entries()].map(([kind, t]) => ({ kind, ...t, replyRate: rate(t) })).sort((a, b) => b.sent - a.sent);
  const total = tally(); rows.forEach((r) => bump(total, r));

  // What the numbers say, only once there are enough to say anything.
  const insights = [];
  if (total.sent < 5) insights.push(`${total.sent} opener${total.sent === 1 ? "" : "s"} sent in ${weeks} weeks — a few more and this readout starts meaning something.`);
  else {
    insights.push(`${total.sent} openers → ${total.replied} replies (${rate(total)}%), ${total.booked} appointment${total.booked === 1 ? "" : "s"}, ${total.sold} sold.`);
    const enough = byReason.filter((r) => r.sent >= 5);
    if (enough.length >= 2) {
      const best = enough.slice().sort((a, b) => b.replyRate - a.replyRate)[0];
      const worst = enough.slice().sort((a, b) => a.replyRate - b.replyRate)[0];
      if (best.reason !== worst.reason && best.replyRate >= worst.replyRate + 15) insights.push(`"${best.reason}" openers get replies at ${best.replyRate}%; "${worst.reason}" at ${worst.replyRate}% — lead with what's working.`);
    }
    const booking = byReason.filter((r) => r.sent >= 5 && r.booked).sort((a, b) => b.booked / b.sent - a.booked / a.sent)[0];
    if (booking) insights.push(`"${booking.reason}" books best: ${booking.booked} of ${booking.sent}.`);
    const plan = byKind.find((k) => k.kind === "plan"), pro = byKind.find((k) => k.kind === "prospect");
    if (plan && pro && plan.sent >= 5 && pro.sent >= 5) insights.push(`Plan texts reply at ${plan.replyRate}%, prospect openers at ${pro.replyRate}%.`);
  }
  return { weeks: weekRows, byReason, byKind, total: { ...total, replyRate: rate(total) }, insights };
}

// ---- Calls, and what the two together say ----
//
// Every call from a session is on the event log with why it was made (the
// reason's category) and which phrasing of the opener it led with. Read
// back against the calendar the same way the texts are: a conversation is
// a reach; an appointment inside two weeks is a booking.

const REACHED = new Set(["reached", "appointment", "not_interested"]);
const catLabel = (key) => (WHY_CATEGORIES.find((c) => c.key === key) || { label: key }).label;

/** { byReason:[{key, label, dials, reached, booked, reachRate, bookRate}], byOpener:[…], total, insights } */
export function callReport({ weeks = 4, now = Date.now() } = {}) {
  const idx = index();
  const since = now - weeks * 7 * DAY;
  const rows = store.all("events").filter((e) => e.kind === "session_outcome" && e.leadId && new Date(e.at).getTime() >= since);
  const tally = () => ({ dials: 0, reached: 0, booked: 0 });
  const bump = (t, e) => { t.dials++; if (REACHED.has(e.meta && e.meta.outcome)) t.reached++; if (outcomesFor({ at: e.at, leadId: e.leadId }, idx).booked) t.booked++; };
  const byR = new Map(), byO = new Map();
  rows.forEach((e) => {
    const k = (e.meta && e.meta.reason) || "other";
    if (!byR.has(k)) byR.set(k, tally()); bump(byR.get(k), e);
    const o = `${k}/${(e.meta && e.meta.opener) || "a"}`;
    if (!byO.has(o)) byO.set(o, tally()); bump(byO.get(o), e);
  });
  const finish = (t) => ({ ...t, reachRate: t.dials ? t.reached / t.dials : 0, bookRate: t.dials ? t.booked / t.dials : 0 });
  const byReason = [...byR.entries()].map(([key, t]) => ({ key, label: catLabel(key), ...finish(t) })).sort((a, b) => b.dials - a.dials);
  const byOpener = [...byO.entries()].map(([k, t]) => { const [key, opener] = k.split("/"); return { key, label: catLabel(key), opener, ...finish(t) }; }).sort((a, b) => a.key.localeCompare(b.key) || a.opener.localeCompare(b.opener));
  const total = finish(rows.reduce((t, e) => { bump(t, e); return t; }, tally()));
  const insights = [];
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (total.dials && total.dials < 10) insights.push(`${total.dials} call${total.dials === 1 ? "" : "s"} from sessions in ${weeks} weeks — a few more and the reasons start to separate.`);
  else if (total.dials) {
    insights.push(`${total.dials} calls → ${total.reached} reached (${pct(total.reachRate)}), ${total.booked} appointment${total.booked === 1 ? "" : "s"}.`);
    const enough = byReason.filter((r) => r.dials >= 8);
    const best = enough.slice().sort((a, b) => b.bookRate - a.bookRate)[0];
    if (best && best.booked) insights.push(`"${best.label}" books best on the phone: ${best.booked} of ${best.dials}.`);
    const pairs = new Map();
    byOpener.forEach((o) => { if (o.dials >= 8) pairs.set(o.key, [...(pairs.get(o.key) || []), o]); });
    pairs.forEach((list, key) => {
      if (list.length < 2) return;
      const [a, b] = list;
      const [hi, lo] = a.bookRate >= b.bookRate ? [a, b] : [b, a];
      if (hi.bookRate >= lo.bookRate + 0.1) insights.push(`On "${catLabel(key)}", phrasing ${hi.opener.toUpperCase()} books at ${pct(hi.bookRate)} against ${pct(lo.bookRate)} — lead with it.`);
    });
  }
  return { byReason, byOpener, total, insights };
}

/**
 * How much each reason earns, in this store, from everything tried so far:
 * texts and calls together, a booking being the thing that counts. A
 * reason with enough behind it (MIN_TRIES) is weighted up or down from the
 * book's average, inside a band — a nudge on the ranking, never a
 * takeover. { key: weight } for the reasons known; the rest are 1.
 */
export const MIN_TRIES = 8, MIN_ALL = 20, BAND = [0.85, 1.25];
export function reasonWeights({ weeks = 12, now = Date.now() } = {}) {
  const idx = index();
  const since = now - weeks * 7 * DAY;
  const tries = new Map();
  const add = (key, booked) => { const t = tries.get(key) || { n: 0, booked: 0 }; t.n++; if (booked) t.booked++; tries.set(key, t); };
  store.all("outreach").filter((r) => new Date(r.at).getTime() >= since).forEach((r) => add(categoryOf((r.reasons || [])[0]), outcomesFor(r, idx).booked));
  store.all("events").filter((e) => e.kind === "session_outcome" && e.leadId && new Date(e.at).getTime() >= since)
    .forEach((e) => add((e.meta && e.meta.reason) || "other", outcomesFor({ at: e.at, leadId: e.leadId }, idx).booked));
  const all = [...tries.values()].reduce((s, t) => ({ n: s.n + t.n, booked: s.booked + t.booked }), { n: 0, booked: 0 });
  if (all.n < MIN_ALL) return {};
  const avg = all.booked / all.n;
  const w = {};
  tries.forEach((t, key) => {
    if (t.n < MIN_TRIES) return;
    const rate = t.booked / t.n;
    const lift = 1 + 0.5 * ((rate - avg) / Math.max(avg, 0.03));
    w[key] = Math.max(BAND[0], Math.min(BAND[1], Math.round(lift * 100) / 100));
  });
  return w;
}

/** The list re-ordered by score × the reason's weight; ties keep their order. */
export function applyWeights(list, weights = reasonWeights(), { catOf = (x) => x.cat, scoreOf = (x) => x.score } = {}) {
  const keys = Object.keys(weights || {});
  if (!keys.length) return list;
  return list.map((x, i) => ({ x, i, s: (scoreOf(x) || 0) * (weights[catOf(x)] || 1) }))
    .sort((a, b) => b.s - a.s || a.i - b.i).map((r) => r.x);
}
