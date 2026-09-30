// The conversation record: everything said between the salesperson and
// each customer — texts, emails, calls — in one order, plus what's sitting
// in the connected mailbox. This is what the assistant refers to when it's
// asked what someone said, and what every drafted message continues from.
//
// Sources, all on the device already: the synced texts, emails and calls
// collections (store.js), and the mailbox list (mailbox.js) for mail from a
// customer that hasn't been filed yet or whose full text has been opened.
// Nothing here fetches; it reads what the app has.

import * as store from "./store.js";
import { mailboxMessages, customerFor, messageBody } from "./mailbox.js";

const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const at = (r) => String(r.receivedAt || r.at || r.createdAt || "");
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

function callLine(c) {
  if (c.dir === "in") return "They called";
  if (c.via === "text") return "Texted them (logged by hand)";
  if (c.via === "email") return "Emailed them (logged by hand)";
  const what = c.outcome && c.outcome !== "reached" ? `Called them — ${c.outcome}` : "Called them";
  return c.notes ? `${what}: ${c.notes}` : what;
}

// The mailbox's copy of a message, by Gmail/Outlook id — it may hold the
// whole text where the filed record kept the snippet.
function mailboxById() {
  const m = new Map();
  mailboxMessages().forEach((x) => m.set(x.id, x));
  return m;
}

/**
 * Every exchange with one customer, oldest first, as
 * { at, kind: "text"|"email"|"call", dir: "in"|"out", subject?, text }.
 * `limit` keeps the most recent; 0 keeps all.
 */
export function conversationFor(leadId, { kinds = ["text", "email", "call"], limit = 12 } = {}) {
  const items = [];
  if (kinds.includes("text")) {
    store.textsFor(leadId).forEach((t) => {
      if (t.status === "failed") return;
      items.push({ at: at(t), kind: "text", dir: t.dir === "in" ? "in" : "out", text: String(t.body || "") });
    });
  }
  if (kinds.includes("email")) {
    const mb = mailboxById();
    const seen = new Set();
    store.all("emails").filter((e) => e.leadId === leadId).forEach((e) => {
      const full = e.msgId ? mb.get(e.msgId) : null;
      if (e.msgId) seen.add(e.msgId);
      items.push({ at: at(e), kind: "email", dir: e.direction === "in" ? "in" : "out", subject: e.subject || "", text: String((full && full.body) || e.body || "") });
    });
    // Mail from this customer in the connected inbox that hasn't been filed
    // (the pull runs every twenty minutes; the mailbox is checked more often).
    const lead = store.get("leads", leadId);
    const addr = lead && lead.email ? String(lead.email).toLowerCase() : "";
    if (addr) {
      mailboxMessages().forEach((m) => {
        if (seen.has(m.id) || !m.from || m.from.addr !== addr) return;
        items.push({ at: String(m.at || ""), kind: "email", dir: "in", subject: m.subject || "", text: String(m.body || m.snippet || "") });
      });
    }
  }
  if (kinds.includes("call")) {
    store.callsFor(leadId).forEach((c) => items.push({ at: at(c), kind: "call", dir: c.dir === "in" ? "in" : "out", text: callLine(c) }));
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  return limit ? items.slice(-limit) : items;
}

// The inbox keeps a snippet until a message is opened. Before the assistant
// reads a customer's mail back, fetch the whole text of their latest few —
// kept with the message afterwards, so it's once per email.
export async function loadBodies(leadId, { limit = 4 } = {}) {
  const lead = store.get("leads", leadId);
  const addr = lead && lead.email ? String(lead.email).toLowerCase() : "";
  const filed = new Set(store.all("emails").filter((e) => e.leadId === leadId && e.msgId).map((e) => e.msgId));
  const mine = mailboxMessages().filter((m) => filed.has(m.id) || (addr && m.from && m.from.addr === addr))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
  await Promise.all(mine.filter((m) => m.body == null).map((m) => messageBody(m).catch(() => null)));
  return mine.length;
}

// Where things stand: the last thing said by text or email, and whether the
// customer is the one waiting.
export function standingWith(leadId) {
  const items = conversationFor(leadId, { kinds: ["text", "email"], limit: 0 });
  const last = items[items.length - 1] || null;
  return { last, waitingOnMe: !!(last && last.dir === "in") };
}

function whenLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const ms = Date.now() - d.getTime();
  if (ms >= 0 && ms < 3600e3) return `${Math.max(1, Math.round(ms / 60000))}m ago`;
  if (ms >= 0 && ms < 86400e3) return `${Math.round(ms / 3600e3)}h ago`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400e3);
  if (days === 1) return "yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// The exchanges as lines the model reads: when, who, by what, what was said.
export function transcript(items, { name = "", maxChars = 240 } = {}) {
  const them = first(name) || "them";
  return items.map((i) => {
    const who = i.dir === "in" ? them : "me";
    const subj = i.kind === "email" && i.subject ? `"${i.subject}" — ` : "";
    return `${whenLabel(i.at)} · ${who} (${i.kind}): ${subj}${clip(i.text, maxChars)}`;
  });
}

function answeredAfter(leadId, when) {
  return store.textsFor(leadId).some((t) => t.dir === "out" && t.status !== "failed" && at(t) > when) ||
    store.all("emails").some((e) => e.leadId === leadId && e.direction !== "in" && at(e) > when) ||
    store.callsFor(leadId).some((c) => c.dir !== "in" && at(c) > when);
}

/**
 * What came in recently, from everyone — customers by text and email, and
 * anyone at all in the connected mailbox — newest first. Each:
 * { at, kind, who, leadId?, customer, subject?, text, answered }.
 */
export function recentInbound({ hours = 48, limit = 12 } = {}) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const byId = new Map(store.all("leads").map((l) => [l.id, l]));
  const out = [];
  store.all("texts").forEach((t) => {
    if (t.dir !== "in" || at(t) < since) return;
    const l = byId.get(t.leadId);
    out.push({ at: at(t), kind: "text", who: l ? l.name : (t.phone || "unknown number"), leadId: t.leadId, customer: !!l, text: String(t.body || ""), answered: answeredAfter(t.leadId, at(t)) });
  });
  const mb = mailboxById();
  const seen = new Set();
  store.all("emails").forEach((e) => {
    if (e.direction !== "in" || at(e) < since) return;
    if (e.msgId) seen.add(e.msgId);
    const l = byId.get(e.leadId);
    const full = e.msgId ? mb.get(e.msgId) : null;
    out.push({ at: at(e), kind: "email", who: l ? l.name : "unknown", leadId: e.leadId, customer: !!l, subject: e.subject || "", text: String((full && full.body) || e.body || ""), answered: answeredAfter(e.leadId, at(e)) });
  });
  mailboxMessages().forEach((m) => {
    if (seen.has(m.id) || String(m.at || "") < since) return;
    const l = m.from ? customerFor(m.from.addr, m.from.name) : null;
    out.push({ at: String(m.at || ""), kind: "email", who: l ? l.name : (m.from && (m.from.name || m.from.addr)) || "unknown", leadId: l ? l.id : null, customer: !!l, subject: m.subject || "", text: String(m.body || m.snippet || ""), answered: l ? answeredAfter(l.id, String(m.at || "")) : !m.unread });
  });
  out.sort((a, b) => b.at.localeCompare(a.at));
  return limit ? out.slice(0, limit) : out;
}

// The standing brief the assistant carries into every turn: who has written
// in lately and whether they've been answered. Short — the details are one
// tool call away.
export function recentDigest({ hours = 48, limit = 10, maxChars = 1600 } = {}) {
  const lines = recentInbound({ hours, limit }).map((i) =>
    `${whenLabel(i.at)} ${i.who}${i.customer ? "" : " (not on file)"} ${i.kind === "email" ? "emailed" : i.kind === "text" ? "texted" : "called"}${i.answered ? "" : " — WAITING on a reply"}: ${i.subject ? `"${i.subject}" ` : ""}${clip(i.text, 140)}`);
  let text = "";
  for (const l of lines) { if (text.length + l.length + 1 > maxChars) break; text += (text ? "\n" : "") + l; }
  return text;
}
