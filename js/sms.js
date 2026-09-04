// Two-way texting through the dedicated number.
//
// Before this, every text left through the phone's own SMS app: fine for
// sending, but nothing ever came back, so the agent went silent at exactly the
// moment a customer engaged. A dedicated number owned by the function means
// replies land in the app — which is what makes the difference between a tool
// that drafts messages and an agent that holds a conversation.
//
// Sending stays optimistic: the message is written locally first so the thread
// updates instantly, then confirmed or marked failed when the carrier answers.
// A failed row keeps its text so it can be retried rather than retyped.

import * as store from "./store.js";
import * as backend from "./backend.js";
import { navigate } from "./router.js";
import { toast } from "./components.js";
import { isLikelyPrefetch } from "./plays.js";

// Texting needs a signed-in cloud account (to own the records), the function
// URL (to reach Twilio), and a number configured on this account.
export function smsReady() {
  const s = store.getSettings();
  const user = backend.currentUser();
  return !!(user && user.id && (s.agentUrl || "").trim() && (s.smsFrom || "").trim());
}

// Why texting isn't available, phrased for the person who has to fix it.
export function smsBlocker() {
  const s = store.getSettings();
  if (!backend.currentUser()) return "Sign in to your cloud account to text from the app.";
  if (!(s.agentUrl || "").trim()) return "Add your agent function URL in Settings to text from the app.";
  if (!(s.smsFrom || "").trim()) return "Add your texting number in Settings to send and receive replies in the app.";
  return "";
}

export function threadFor(leadId) {
  return store.textsFor(leadId);
}

// Send to a customer, logging both the attempt and the outcome.
// Returns { ok, id, error }.
export async function sendText(lead, body) {
  const text = String(body || "").trim();
  if (!lead || !text) return { ok: false, error: "Nothing to send." };
  if (store.optedOut(lead)) return { ok: false, error: `${lead.name || "This customer"} has opted out of texts.` };
  const blocker = smsBlocker();
  if (blocker) return { ok: false, error: blocker };

  const s = store.getSettings();
  const user = backend.currentUser();
  const now = new Date().toISOString();
  // Written first so the thread shows it immediately; the id is shared with the
  // server so its copy merges onto this row instead of duplicating it.
  const row = store.create("texts", {
    leadId: lead.id, dir: "out", body: text, phone: lead.phone || "",
    at: now, read: true, status: "sending",
  });

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch((s.agentUrl || "").trim().replace(/\/+$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sms: { u: user.id, id: row.id, leadId: lead.id, to: lead.phone, body: text } }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.sent) {
      const error = j.error || `Send failed (${res.status}).`;
      store.update("texts", row.id, { status: "failed", error });
      return { ok: false, id: row.id, error };
    }
    store.update("texts", row.id, { status: "sent", sid: j.sid || "" });
    store.logActivity("text");
    return { ok: true, id: row.id };
  } catch (e) {
    const error = e.name === "AbortError" ? "Send timed out." : "Send failed — no connection.";
    store.update("texts", row.id, { status: "failed", error });
    return { ok: false, id: row.id, error };
  }
}

export async function retryText(textId) {
  const row = store.get("texts", textId);
  if (!row) return { ok: false, error: "Message is gone." };
  const lead = store.get("leads", row.leadId);
  if (!lead) return { ok: false, error: "Customer is gone." };
  store.remove("texts", textId); // the retry writes a fresh row at the end of the thread
  return sendText(lead, row.body);
}

// ---- Routing every "Text" button through the number ----
//
// Every send button in the app is an <a href="sms:…">, which hands off to the
// phone's own messaging app. Once a texting number is configured that's the
// wrong destination: the customer's reply lands in the salesperson's personal
// messages, where the agent can't see it — the exact thing two-way texting
// exists to fix. Rather than rewrite every call site (and miss the next one
// somebody adds), the click is intercepted in one place.
//
// It opens the thread with the message prefilled rather than firing it off.
// Handing off to iMessage always had a review step before the customer got
// anything, and silently sending on tap would quietly remove it.

const PREFILL = "entoa:sms-prefill";

// (902) 555-1234 from anything ten digits or longer.
function fmtPhone(p) {
  const d = store.phoneKey(p);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || "Unknown");
}

function parseSmsHref(href) {
  const m = /^sms:([^?]*)(?:\?&?body=(.*))?$/.exec(String(href || ""));
  if (!m || !m[1]) return null;
  let body = "";
  try { body = m[2] ? decodeURIComponent(m[2]) : ""; } catch { body = m[2] || ""; }
  return { phone: m[1], body };
}

export function takePrefill(leadId) {
  try {
    const raw = sessionStorage.getItem(PREFILL);
    if (!raw) return "";
    const p = JSON.parse(raw);
    if (p.leadId !== leadId) return "";
    sessionStorage.removeItem(PREFILL);
    return p.body || "";
  } catch { return ""; }
}

// Open a conversation instead of the phone's SMS app. Returns false when
// texting isn't configured, so callers can fall back to their old behaviour.
export function openText(phone, body = "") {
  if (!smsReady()) return false;
  if (store.phoneKey(phone).length < 10) return false;
  let lead = store.leadByPhone(phone);
  // Texting someone the app doesn't know yet — the inbound webhook makes a lead
  // out of a stranger's text for the same reason, so the conversation has
  // somewhere to live.
  if (!lead) {
    const d = store.phoneKey(phone);
    lead = store.create("leads", {
      name: d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone,
      phone, stage: "new", source: "text",
    });
  }
  if (store.optedOut(lead)) return false; // let the caller explain; we don't send
  try {
    if (body) sessionStorage.setItem(PREFILL, JSON.stringify({ leadId: lead.id, body }));
  } catch { /* private mode — the thread still opens, just empty */ }
  navigate(`/inbox/${lead.id}`);
  return true;
}

export function interceptSmsLinks() {
  document.addEventListener("click", (e) => {
    if (!smsReady()) return;
    const a = e.target && e.target.closest && e.target.closest('a[href^="sms:"]');
    if (!a) return;
    const parsed = parseSmsHref(a.getAttribute("href"));
    if (!parsed) return;
    const lead = store.leadByPhone(parsed.phone);
    if (lead && store.optedOut(lead)) {
      e.preventDefault();
      return toast(`${(lead.name || "They").split(" ")[0]} has opted out of texts`, "warn");
    }
    if (openText(parsed.phone, parsed.body)) e.preventDefault();
  }, true);
}

// ---- The conversation ----
//
// A thread is everything that passed between you and one customer, in order:
// texts, calls, and the times they opened a link you sent. Link opens belong
// here rather than in a feed of their own — "Ann opened the booking page twice
// this afternoon" is a fact about the conversation with Ann, and putting it
// anywhere else means reading two lists and joining them by hand.

const HOT_MS = 48 * 3600 * 1000;

// Is this open worth acting on right now?
export function linkIsHot(lk) {
  if (!lk || !lk.lastOpenAt) return false;
  if (isLikelyPrefetch(lk)) return false;
  return Date.now() - new Date(lk.lastOpenAt).getTime() < HOT_MS;
}

// One customer's timeline, oldest first.
export function timelineFor(leadId) {
  const items = [];
  store.textsFor(leadId).forEach((t) =>
    items.push({ type: "text", at: t.at || t.createdAt, rec: t }));
  store.callsFor(leadId).forEach((c) =>
    items.push({ type: "call", at: c.at || c.createdAt, rec: c }));
  // One entry per link, placed at its most recent open — a link opened five
  // times is one thing that happened five times, not five separate events, and
  // the count is what tells you how interested they are.
  store.linksForLead(leadId).forEach((lk) => {
    if (!lk.lastOpenAt || isLikelyPrefetch(lk)) return;
    items.push({ type: "open", at: lk.lastOpenAt, rec: lk });
  });
  return items.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

// Threads with something waiting on them, newest first. This is the inbox.
export function inboxThreads() {
  const byLead = new Map();
  const touch = (leadId, at) => {
    if (!leadId) return null;
    if (!byLead.has(leadId)) byLead.set(leadId, { at: "", unread: 0, opens: 0, hot: false, last: null });
    const e = byLead.get(leadId);
    if (String(at || "") > e.at) e.at = String(at || "");
    return e;
  };

  store.all("texts").forEach((t) => {
    const e = touch(t.leadId, t.at || t.createdAt);
    if (!e) return;
    const at = String(t.at || t.createdAt || "");
    if (!e.last || at >= e.lastAt) { e.last = { type: "text", rec: t }; e.lastAt = at; }
    if (t.dir === "in" && !t.read) e.unread += 1;
  });
  store.all("calls").forEach((c) => {
    const e = touch(c.leadId, c.at || c.createdAt);
    if (!e) return;
    const at = String(c.at || c.createdAt || "");
    if (!e.last || at >= e.lastAt) { e.last = { type: "call", rec: c }; e.lastAt = at; }
  });
  store.all("links").forEach((lk) => {
    const leadId = lk.meta && lk.meta.leadId;
    if (!leadId || !lk.lastOpenAt || isLikelyPrefetch(lk)) return;
    const e = touch(leadId, lk.lastOpenAt);
    if (!e) return;
    e.opens += Number(lk.opens) || 0;
    if (linkIsHot(lk)) e.hot = true;
    const at = String(lk.lastOpenAt);
    if (!e.last || at >= e.lastAt) { e.last = { type: "open", rec: lk }; e.lastAt = at; }
  });

  return [...byLead.entries()]
    .map(([leadId, e]) => {
      // A message must never be invisible because its customer record is
      // missing. The two arrive as separate synced rows, so a thread can land
      // before — or without — the lead it belongs to, and dropping it means a
      // real customer texted and nothing anywhere shows it. Stand in with the
      // number until the record catches up.
      const lead = store.get("leads", leadId) || (e.last && e.last.rec && e.last.rec.phone
        ? { id: leadId, name: fmtPhone(e.last.rec.phone), phone: e.last.rec.phone, orphan: true }
        : null);
      return { leadId, lead, ...e };
    })
    .filter((t) => t.lead)
    .sort((a, b) => {
      // Unanswered replies first — someone is waiting on a person. Then live
      // link opens, because that window closes fast and they don't know you can
      // see it. Everything else by recency.
      if (!!a.unread !== !!b.unread) return a.unread ? -1 : 1;
      if (!!a.hot !== !!b.hot) return a.hot ? -1 : 1;
      return b.at.localeCompare(a.at);
    });
}
