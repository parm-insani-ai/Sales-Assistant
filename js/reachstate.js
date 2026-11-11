// What "reached" means, read from the records.
//
// The job is a conversation with every person on file — on the phone, or a
// text exchange with a reply — and an outcome on their file from it. A
// message left is not a conversation; neither is a text nobody answered.
// So the book is read as states toward that one goal:
//
//   spoken      a conversation on file inside the cycle (six months)
//   working     missed, with the next of six attempts on the queue, later
//   due         the next attempt is due now (or a miss with nothing queued)
//   rested      six misses; resting before the next round
//   lapsed      spoken or tried once, long ago, and nothing open
//   untouched   never tried at all
//   unreachable no number that works, or do-not-contact
//
// Pure over arrays so node can test it; coverage.js binds it to the store.

export const CYCLE_DAYS = 180;         // a conversation this recent counts
export const ATTEMPT_WINDOW_DAYS = 21; // the six attempts live inside this
export const ATTEMPTS = 6;
const DAY = 86400000;
const t = (v) => { if (!v) return null; const x = new Date(v).getTime(); return isFinite(x) ? x : null; };
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const MISS = new Set(["voicemail", "no_answer"]);
const REACHED = new Set(["reached"]);

/**
 * Index the records once: { conv, lastTry, tries, open, now }.
 *   conv:    leadId → the last conversation { at, via, outcome }
 *   lastTry: leadId → the last outbound attempt (any outcome), ms
 *   tries:   leadId → attempts inside the window (misses + texts sent)
 *   open:    leadId → the earliest open sequence task
 */
export function buildReachIndex({ calls = [], texts = [], tasks = [], appointments = [], now = Date.now() } = {}) {
  const conv = new Map(), lastTry = new Map(), tries = new Map(), open = new Map();
  const since = now - ATTEMPT_WINDOW_DAYS * DAY;
  const bump = (m, id, at) => { if (at == null) return; const cur = m.get(id); if (cur == null || at > cur) m.set(id, at); };
  const talk = (id, at, via, outcome) => { if (at == null) return; const cur = conv.get(id); if (!cur || at > cur.at) conv.set(id, { at, via, outcome: outcome || "" }); };
  for (const c of calls) {
    if (!c || !c.leadId || c.dir === "in") continue;
    const at = t(c.at); if (at == null) continue;
    const via = c.via || "call";
    bump(lastTry, c.leadId, at);
    if (REACHED.has(c.outcome)) talk(c.leadId, at, via, c.conversationOutcome || "");
    else if (via === "call" && MISS.has(c.outcome) && at >= since) tries.set(c.leadId, (tries.get(c.leadId) || 0) + 1);
  }
  for (const x of texts) {
    if (!x || !x.leadId) continue;
    const at = t(x.at || x.createdAt); if (at == null) continue;
    if (x.dir === "in") talk(x.leadId, at, "text", "replied");
    else { bump(lastTry, x.leadId, at); if (at >= since) tries.set(x.leadId, (tries.get(x.leadId) || 0) + 1); }
  }
  for (const a of appointments) {
    if (!a || !a.leadId) continue;
    if (a.outcome === "showed" || a.outcome === "sold") talk(a.leadId, t(a.when), "in person", a.outcome);
  }
  for (const k of tasks) {
    if (!k || !k.leadId || k.done || !k.sequence) continue;
    const cur = open.get(k.leadId);
    if (!cur || String(k.due || "") < String(cur.due || "")) open.set(k.leadId, k);
  }
  return { conv, lastTry, tries, open, now };
}

/** The last conversation with this person, from every record that is one, or null. */
export function conversationOf(lead, idx) {
  if (!lead) return null;
  let best = idx.conv.get(lead.id) || null;
  const take = (at, via, outcome) => { const ms = t(at); if (ms != null && (!best || ms > best.at)) best = { at: ms, via, outcome }; };
  if (lead.lastContactOutcome === "reached" && lead.lastContacted) take(lead.lastContacted, lead.lastContactVia || "call", lead.lastConversationOutcome || "");
  if (lead.loggedAt) take(lead.loggedAt, "in person", "logged");
  if (lead.lastReplyAt) take(lead.lastReplyAt, "text", "replied");
  if (lead.notInterestedAt) take(lead.notInterestedAt, "call", "not_interested");
  // Buying from the store lately is the conversation of record. An old
  // purchase is not: the owner book is full of people who bought years ago
  // and have never had a call since — they are exactly who this is for.
  const bought = t(lead.purchaseDate);
  if (bought != null && ["sold", "delivered"].includes(lead.stage) && (idx.now || Date.now()) - bought <= CYCLE_DAYS * DAY) take(bought, "in person", "bought");
  return best;
}

/** { state, attempts, conversation, lastTry, next, days } for one person. */
export function reachStateOf(lead, idx) {
  const now = idx.now || Date.now();
  const today = dayKey(now);
  const conversation = conversationOf(lead, idx);
  const attempts = idx.tries.get(lead.id) || 0;
  const lastTry = Math.max(idx.lastTry.get(lead.id) || 0, t(lead.lastContacted) || 0) || null;
  const open = idx.open.get(lead.id) || null;
  const out = { attempts, conversation, lastTry, next: open ? open.due || null : null, days: conversation ? Math.floor((now - conversation.at) / DAY) : null };
  if ((!lead.phone || lead.badPhone) || lead.doNotContact) return { ...out, state: "unreachable" };
  if (conversation && now - conversation.at <= CYCLE_DAYS * DAY) return { ...out, state: "spoken" };
  if (open) return { ...out, state: String(open.due || "") <= today ? "due" : "working" };
  if (lead.restedAt && lead.prospectSnoozedUntil && lead.prospectSnoozedUntil > today) return { ...out, state: "rested" };
  if (attempts > 0) return { ...out, state: "due" };
  if (conversation || lastTry) return { ...out, state: "lapsed" };
  return { ...out, state: "untouched" };
}

export const STATES = [
  { key: "spoken", label: "Spoken with" },
  { key: "due", label: "Due now" },
  { key: "working", label: "Being worked" },
  { key: "rested", label: "Resting" },
  { key: "lapsed", label: "Lapsed" },
  { key: "untouched", label: "Never tried" },
  { key: "unreachable", label: "No way to reach" },
];
export const stateLabel = (k) => (STATES.find((s) => s.key === k) || { label: k }).label;

/** Everyone, counted by state: { total, spoken, due, working, rested, lapsed, untouched, unreachable, reachable, pct }. */
export function countStates(leads, idx) {
  const c = { total: 0, spoken: 0, due: 0, working: 0, rested: 0, lapsed: 0, untouched: 0, unreachable: 0 };
  for (const l of leads) { if (!l || l.stage === "lost") continue; c.total++; c[reachStateOf(l, idx).state]++; }
  c.reachable = c.total - c.unreachable;
  c.pct = c.reachable ? Math.round((c.spoken / c.reachable) * 100) : 0;
  return c;
}

/** Distinct people spoken with in a window of days ending now. */
export function conversationsIn(leads, idx, days) {
  const since = (idx.now || Date.now()) - days * DAY;
  let n = 0;
  for (const l of leads) { const c = conversationOf(l, idx); if (c && c.at >= since) n++; }
  return n;
}
