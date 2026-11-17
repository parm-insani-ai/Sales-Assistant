// The lease maturity pipeline: every lease on the book by the month it ends,
// and where each one stands toward being kept.
//
// A lease end is a sale the store either keeps or loses, so a lease is read
// as a stage, not a date:
//
//   untouched  nobody has tried them inside the window
//   contacted  tried — a call that didn't connect, a text unanswered
//   spoken     a conversation on file inside the window (a call they
//              answered, a text they replied to, a visit)
//   booked     an appointment ahead, or the conversation ended in one
//   retained   they bought from us around the end
//   lost       they told us they bought elsewhere, or the lease ended and
//              nothing was sold inside the grace period
//
// The window opens WINDOW_DAYS before the end: a conversation older than
// that doesn't count toward this lease. Inside SOON_DAYS with no
// conversation the lease is red — the call that hasn't happened.
//
// Pure over arrays (horizon.js finds the ends, reachstate.js reads the
// conversations) so node can test it; the Timing screen and the assistant
// bind it to the store.

import { contractsEnding, monthKeyOf } from "./horizon.js";
import { conversationOf, reachStateOf } from "./reachstate.js";

export const WINDOW_DAYS = 180;
export const SOON_DAYS = 90;
export const GRACE_DAYS = 60;
const DAY = 86400000;

export const STAGES = [
  { key: "untouched", label: "Not touched", color: "var(--muted)" },
  { key: "contacted", label: "Tried", color: "var(--warning)" },
  { key: "spoken", label: "Spoken with", color: "var(--brand)" },
  { key: "booked", label: "Booked", color: "#7c3aed" },
  { key: "retained", label: "Retained", color: "var(--success)" },
  { key: "lost", label: "Lost", color: "var(--danger)" },
];
export const stageLabel = (k) => (STAGES.find((s) => s.key === k) || { label: k }).label;

const t = (v) => { if (!v) return null; const x = new Date(v).getTime(); return isFinite(x) ? x : null; };
const emptyCounts = () => ({ untouched: 0, contacted: 0, spoken: 0, booked: 0, retained: 0, lost: 0 });

/**
 * The stage of one lease. `end` is a Date (or null when unknown); `idx` the
 * reach index; `sales` and `appointments` the lead's own rows.
 */
export function leaseStage(lead, { end, idx, sales = [], appointments = [], now = Date.now() }) {
  const endMs = end ? end.getTime() : null;
  const since = (endMs != null ? Math.min(now, endMs) : now) - WINDOW_DAYS * DAY;
  // Retained: a sale to them in the last year of the lease or after it.
  const yearBefore = endMs != null ? endMs - 365 * DAY : now - 365 * DAY;
  const sold = sales.some((s) => s && s.leadId === lead.id && (t(s.saleDate) || t(s.createdAt) || 0) >= yearBefore)
    || (["sold", "delivered"].includes(lead.stage) && t(lead.purchaseDate) != null && t(lead.purchaseDate) >= yearBefore && (endMs == null || t(lead.purchaseDate) > endMs - 365 * DAY));
  if (sold) return "retained";
  const conversation = conversationOf(lead, idx);
  const convIn = conversation && conversation.at >= since ? conversation : null;
  // Lost: they said so, or the lease is past its grace with nothing sold.
  if (lead.lastConversationOutcome === "bought_elsewhere" || (convIn && convIn.outcome === "bought_elsewhere")) return "lost";
  if (endMs != null && now - endMs > GRACE_DAYS * DAY) return "lost";
  // Booked: an appointment ahead of them, or the conversation came to one.
  const ahead = appointments.some((a) => a && a.leadId === lead.id && a.status !== "canceled" && !a.outcome && (t(a.when) || 0) >= now - DAY);
  if (ahead || (convIn && convIn.outcome === "appointment")) return "booked";
  if (convIn) return "spoken";
  const r = reachStateOf(lead, idx);
  const tried = (r.lastTry || 0) >= since || r.attempts > 0;
  return tried ? "contacted" : "untouched";
}

/**
 * The pipeline over a book.
 *   leads: the customers; ctx: { now, idx, sales, appointments, matcher }
 *   months: how far ahead the months run (default 12)
 * → { months: [{ key, label, total, counts, red, rows }], ended: {...same},
 *     later: n, unknown: n, totals: { total, counts, red, decided, retained, pct } }
 * Rows: { lead, end, days, past, payment, stage, red, conversation, replacement }.
 */
export function leasePipeline(leads, { now = Date.now(), idx, sales = [], appointments = [], matcher = null, months = 12 } = {}) {
  const at = now instanceof Date ? now.getTime() : now;
  const list = contractsEnding(leads, { now: at, type: "lease" });
  const byLead = (rows) => { const m = new Map(); for (const r of rows) { if (!r || !r.leadId) continue; if (!m.has(r.leadId)) m.set(r.leadId, []); m.get(r.leadId).push(r); } return m; };
  const salesBy = byLead(sales), apptsBy = byLead(appointments);
  const start = new Date(at); start.setDate(1); start.setHours(0, 0, 0, 0);
  const horizon = new Date(start); horizon.setMonth(horizon.getMonth() + months);
  const groups = new Map();
  for (let i = 0; i < months; i++) {
    const d = new Date(start); d.setMonth(d.getMonth() + i);
    groups.set(monthKeyOf(d), { key: monthKeyOf(d), label: d.toLocaleDateString("en-CA", { month: "long", year: "numeric" }), total: 0, counts: emptyCounts(), red: 0, rows: [] });
  }
  const ended = { key: "ended", label: "Ended — still open", total: 0, counts: emptyCounts(), red: 0, rows: [] };
  const totals = { total: 0, counts: emptyCounts(), red: 0 };
  let later = 0, unknown = 0;
  for (const r of list) {
    const lead = r.lead;
    if (!r.end) { unknown++; continue; }
    const endMs = r.end.getTime();
    if (endMs >= horizon.getTime()) { later++; continue; }
    const stage = leaseStage(lead, { end: r.end, idx, sales: salesBy.get(lead.id) || [], appointments: apptsBy.get(lead.id) || [], now: at });
    // A lease past its grace is decided (lost) and leaves the open list;
    // one that ended inside the grace is still a conversation to have.
    const past = endMs < at;
    if (past && stage === "lost" && at - endMs > GRACE_DAYS * DAY && !(lead.lastConversationOutcome === "bought_elsewhere")) {
      // Decided by time alone: counted in the totals, not listed under a month.
      totals.total++; totals.counts.lost++;
      continue;
    }
    const days = Math.round((endMs - at) / DAY);
    const conversation = conversationOf(lead, idx);
    const red = !past && days <= SOON_DAYS && (stage === "untouched" || stage === "contacted");
    let replacement = null;
    if (matcher && ["untouched", "contacted", "spoken", "booked"].includes(stage)) {
      try { const m = matcher(lead); if (m && m.pitch) replacement = { name: m.pitch.unit.name, monthly: m.pitch.monthly, delta: m.pitch.delta, network: !!m.pitch.unit.network }; } catch { replacement = null; }
    }
    const row = { lead, end: r.end, days, past, payment: r.payment, stage, red, conversation, replacement };
    const g = past ? ended : groups.get(monthKeyOf(r.end));
    if (!g) { later++; continue; }
    g.rows.push(row); g.total++; g.counts[stage]++; if (red) g.red++;
    totals.total++; totals.counts[stage]++; if (red) totals.red++;
  }
  const sortRows = (rows) => rows.sort((a, b) => (b.red - a.red) || (a.end.getTime() - b.end.getTime()) || String(a.lead.name || "").localeCompare(String(b.lead.name || "")));
  for (const g of groups.values()) sortRows(g.rows);
  sortRows(ended.rows);
  const decided = totals.counts.retained + totals.counts.lost;
  return {
    months: [...groups.values()], ended, later, unknown,
    totals: { ...totals, decided, retained: totals.counts.retained, pct: decided ? Math.round((totals.counts.retained / decided) * 100) : null },
  };
}

/** The people in a group (or the whole pipeline) still worth a call: not spoken with, reachable, soonest first. */
export function toCall(rowsOrPipe) {
  const rows = Array.isArray(rowsOrPipe) ? rowsOrPipe : [...rowsOrPipe.ended.rows, ...rowsOrPipe.months.flatMap((m) => m.rows)];
  return rows.filter((r) => (r.stage === "untouched" || r.stage === "contacted") && r.lead.phone && !r.lead.badPhone && !r.lead.doNotContact)
    .sort((a, b) => (b.red - a.red) || (a.end.getTime() - b.end.getTime()));
}

/** One line for the assistant and the Coach: "41 leases end in the next 12 months · 9 inside 90 days with no conversation · retention 62% (8 of 13)". */
export function pipelineLine(pipe) {
  const open = pipe.months.reduce((n, m) => n + m.total, 0);
  const bits = [`${open} lease${open === 1 ? "" : "s"} end${open === 1 ? "s" : ""} in the next ${pipe.months.length} months`];
  if (pipe.ended.total) bits.push(`${pipe.ended.total} ended and still open`);
  if (pipe.totals.red) bits.push(`${pipe.totals.red} inside ${SOON_DAYS} days with no conversation`);
  if (pipe.totals.pct != null) bits.push(`retention ${pipe.totals.pct}% (${pipe.totals.retained} of ${pipe.totals.decided})`);
  if (pipe.unknown) bits.push(`${pipe.unknown} with no end date on file`);
  return bits.join(" · ");
}
