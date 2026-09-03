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

// Threads with something waiting on them, newest first. This is the inbox.
export function inboxThreads() {
  const byLead = new Map();
  store.all("texts").forEach((t) => {
    const cur = byLead.get(t.leadId);
    const at = String(t.at || t.createdAt || "");
    if (!cur || at > cur.at) byLead.set(t.leadId, { at, last: t });
    const e = byLead.get(t.leadId);
    if (t.dir === "in" && !t.read) e.unread = (e.unread || 0) + 1;
  });
  return [...byLead.entries()]
    .map(([leadId, e]) => ({ leadId, lead: store.get("leads", leadId), last: e.last, at: e.at, unread: e.unread || 0 }))
    .filter((t) => t.lead)
    .sort((a, b) => {
      // Anything unanswered outranks everything else — that's the whole point.
      if (!!a.unread !== !!b.unread) return a.unread ? -1 : 1;
      return b.at.localeCompare(a.at);
    });
}
