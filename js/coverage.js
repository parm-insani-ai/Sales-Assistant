// Reach the book.
//
// The outreach system's one objective: a conversation with every person on
// file, and an outcome on their file from it. This binds reachstate.js to
// the store and does the three things that make the sequence proactive:
//
//   · the count — how much of the book has been spoken with, this week's
//     conversations, the pace, and when the book is covered at that pace
//     (the number a manager reads)
//   · the top-up — people nobody has ever tried, fed into the day's batch
//     behind the ones with a reason, oldest first, so the whole book gets
//     its turn and not only the people a deal can be read on
//   · the reply — a text back is a conversation: the chase stops, the
//     conversation is the follow-up, and it goes on their file as one

import * as store from "./store.js";
import { buildReachIndex, reachStateOf, conversationOf, countStates, conversationsIn, CYCLE_DAYS } from "./reachstate.js";
import { hasCadence } from "./cadence.js";

const DAY = 86400000;
const todayK = () => new Date().toISOString().slice(0, 10);

// The index, once per change to anything it reads.
let memo = { key: "", idx: null };
export function reachIndex(now = Date.now()) {
  const key = ["calls", "texts", "tasks", "appointments", "leads"].map((n) => store.generation(n)).join("|") + "|" + Math.floor(now / (10 * 60000));
  if (memo.idx && memo.key === key) return memo.idx;
  memo = { key, idx: buildReachIndex({ calls: store.all("calls"), texts: store.all("texts"), tasks: store.all("tasks"), appointments: store.all("appointments"), now }) };
  return memo.idx;
}

/** This person's state toward the goal (reachstate.js). */
export function reachState(leadOrId, now = Date.now()) {
  const l = typeof leadOrId === "string" ? store.get("leads", leadOrId) : leadOrId;
  return l ? reachStateOf(l, reachIndex(now)) : null;
}
/** The last conversation with them, or null. */
export function lastConversation(leadOrId, now = Date.now()) {
  const l = typeof leadOrId === "string" ? store.get("leads", leadOrId) : leadOrId;
  return l ? conversationOf(l, reachIndex(now)) : null;
}
/** Attempts on them inside the window — misses and texts sent (session.js's count). */
export function attemptsFor(leadId, now = Date.now()) {
  return reachIndex(now).tries.get(leadId) || 0;
}

/**
 * The book against the goal: the counts by state, the share spoken with,
 * this week's and last week's conversations, the pace over four weeks, and
 * the weeks to cover what's left at that pace.
 */
export function coverage(now = Date.now()) {
  const leads = store.all("leads");
  const idx = reachIndex(now);
  const c = countStates(leads, idx);
  const week = conversationsIn(leads, idx, 7);
  const month = conversationsIn(leads, idx, 28);
  const pace = Math.round((month / 4) * 10) / 10;
  const left = c.reachable - c.spoken;
  const weeksLeft = pace > 0 ? Math.ceil(left / pace) : null;
  const coveredBy = weeksLeft != null ? new Date(now + weeksLeft * 7 * DAY) : null;
  return { ...c, week, month, pace, left, weeksLeft, coveredBy, cycleDays: CYCLE_DAYS };
}

/** One line for a block: "Spoken with 412 of 3,100 · 38 this week · the book by June". */
export function coverageLine(c = coverage()) {
  if (!c.total) return "";
  const by = c.coveredBy && c.weeksLeft <= 104 ? ` · at this pace the book by ${c.coveredBy.toLocaleDateString("en-CA", { month: "long", year: c.coveredBy.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined })}` : c.left && !c.pace ? " · no conversations yet this month" : "";
  return `Spoken with ${c.spoken.toLocaleString()} of ${c.reachable.toLocaleString()} (${c.pct}%) · ${c.week} this week${by}`;
}

// ---- The top-up ----

const CAMPAIGN_DAYS = 30, COOLDOWN_DAYS = 21;
const within = (iso, days, now) => { if (!iso) return false; const x = new Date(iso).getTime(); return isFinite(x) && now - x < days * DAY; };

/**
 * People the batch should bring up so the whole book gets its turn: never
 * tried first (oldest on file first), then lapsed (longest ago first).
 * Nobody in a plan, snoozed, campaigned this month, or brought up in the
 * last three weeks. Shaped like a batch candidate: { lead, score, reasons,
 * why, best, cat, coverage: true }.
 */
export function coveragePicks(n = 10, now = Date.now()) {
  const idx = reachIndex(now);
  const day = todayK();
  const rows = [];
  for (const l of store.all("leads")) {
    if (!l || store.optedOut(l) || l.doNotContact) continue;
    if (["sold", "lost", "appointment", "negotiating"].includes(l.stage)) continue;
    if (!l.phone || l.badPhone) continue;
    if (l.prospectSnoozedUntil && l.prospectSnoozedUntil > day) continue;
    if (within(l.lastCampaignAt, CAMPAIGN_DAYS, now) || within(l.lastProspectedAt, COOLDOWN_DAYS, now)) continue;
    const r = reachStateOf(l, idx);
    if (r.state !== "untouched" && r.state !== "lapsed") continue;
    if (hasCadence(l.id)) continue;
    rows.push({ l, r });
  }
  rows.sort((a, b) => {
    if (a.r.state !== b.r.state) return a.r.state === "untouched" ? -1 : 1;
    if (a.r.state === "untouched") return String(a.l.importedAt || a.l.createdAt || "").localeCompare(String(b.l.importedAt || b.l.createdAt || ""));
    return (Math.max(a.r.lastTry || 0, a.r.conversation ? a.r.conversation.at : 0)) - (Math.max(b.r.lastTry || 0, b.r.conversation ? b.r.conversation.at : 0));
  });
  return rows.slice(0, Math.max(0, n)).map(({ l, r }) => coverageEntry(l, r));
}
/** The batch-candidate shape for a coverage pick. */
export function coverageEntry(l, r = reachState(l)) {
  const years = l.purchaseDate ? Math.floor((Date.now() - new Date(l.purchaseDate).getTime()) / (365.25 * DAY)) : null;
  const reason = r && r.state === "lapsed" ? "Not spoken with in a while" : "Never spoken with";
  const why = [l.vehicleInterest ? `they drive a ${String(l.vehicleInterest).replace(/^\d{4}\s+/, "")}` : "", years != null && years >= 1 ? `a customer for ${years} year${years === 1 ? "" : "s"}` : "", "nobody has had a real conversation with them yet"].filter(Boolean);
  return { lead: l, score: 0, tier: "", reasons: [reason], why, whySafe: why, best: null, next: null, consent: null, cat: "coverage", coverage: true, state: r ? r.state : "untouched" };
}
/** How many are still waiting for a first (or fresh) conversation and could be brought up. */
export function coverageBehind(now = Date.now()) {
  return coveragePicks(1e9, now).length;
}

// ---- The reply ----

/**
 * A text back is a conversation. For every inbound text newer than the last
 * one absorbed: the open attempts on that person are taken off the queue
 * (the chase is over — the conversation is the follow-up now), the reply is
 * stamped on their file, and it goes on the event log as a conversation.
 * Idempotent; safe to run after every sync.
 */
export function absorbReplies(now = Date.now()) {
  const latest = new Map();
  store.all("texts").forEach((x) => {
    if (!x || x.dir !== "in" || !x.leadId) return;
    const at = String(x.at || x.createdAt || "");
    if (at && (!latest.has(x.leadId) || at > latest.get(x.leadId))) latest.set(x.leadId, at);
  });
  if (!latest.size) return 0;
  let n = 0;
  store.bulk(() => {
    latest.forEach((at, leadId) => {
      const l = store.get("leads", leadId);
      if (!l || (l.lastReplyAt && l.lastReplyAt >= at)) return;
      const open = store.all("tasks").filter((k) => k.leadId === leadId && k.sequence && !k.done);
      open.forEach((k) => store.remove("tasks", k.id));
      store.update("leads", leadId, { lastReplyAt: at });
      store.logEvent("conversation", { leadId, meta: { via: "text", outcome: "replied", stopped: open.length } });
      n++;
    });
  });
  return n;
}
