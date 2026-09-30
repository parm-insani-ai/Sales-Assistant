// The mailbox — the salesperson's own inbox, in the app. Gmail or Outlook
// (whichever is connected), read straight from the phone: the latest
// inbox mail, a message's full text on demand, a reply in the same thread,
// a new email to anyone. Customers' mail is also filed into their history
// (gmail.js / msmail.js do that); this is everything else too, so email
// can be worked from Comms without leaving for the mail app.
//
// The list is kept on this device only (cachedb, never synced) and refreshed
// when Comms → Email opens, on pull-to-refresh, or on Check mail.

import * as store from "./store.js";
import { cacheGet, cacheSet } from "./cachedb.js";
import { gmailConnected, gmailAccount, gmailAccessToken } from "./gmail.js";
import { outlookConnected, outlookAccount, outlookAccessToken } from "./msmail.js";
import { sendEmail, logEmail } from "./email.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0";
const CACHE_KEY = "mailbox";
const READ_KEY = "viniva:mailbox:read";
const KEEP = 200;

let state = { provider: "", account: "", at: null, messages: [] };
let loaded = null;

// Gmail first when both are connected — it matches the sender (email.js).
export function mailboxProvider() {
  if (gmailConnected()) return "gmail";
  if (outlookConnected()) return "outlook";
  return "";
}
export function mailboxAccount() {
  const p = mailboxProvider();
  return p === "gmail" ? (gmailAccount() || {}).email || "" : p === "outlook" ? (outlookAccount() || {}).email || "" : "";
}

// What's cached, ready for the screen (call loadMailbox once first).
export function mailboxMessages() { return state.messages; }
export function mailboxCheckedAt() { return state.at; }
export function loadMailbox() {
  if (!loaded) loaded = cacheGet(CACHE_KEY).then((saved) => { if (saved && saved.provider === mailboxProvider()) state = saved; }).catch(() => {});
  return loaded;
}
function remember() { cacheSet(CACHE_KEY, state).catch(() => {}); }

// Read state lives on the device: marking read at the provider would need
// a wider permission, and the point is what you have and haven't looked at
// here.
function readSet() { try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); } catch { return new Set(); } }
export function markRead(id) { const s = readSet(); s.add(id); try { localStorage.setItem(READ_KEY, JSON.stringify([...s].slice(-500))); } catch { /* fine */ } const m = state.messages.find((x) => x.id === id); if (m) m.unread = false; }
export function unreadCount() { return state.messages.filter((m) => m.unread).length; }

// "Dana Muise <dana@example.com>" → { name, addr }
export function parseAddress(v) {
  const s = String(v || "");
  const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(s);
  if (m) return { name: (m[1] || "").trim(), addr: m[2].trim().toLowerCase() };
  return { name: "", addr: s.trim().toLowerCase() };
}

// The customer this address belongs to, if any.
export function customerFor(addr, name = "") {
  const a = String(addr || "").toLowerCase();
  const leads = store.all("leads");
  return leads.find((l) => (l.email || "").toLowerCase() === a) || (name ? leads.find((l) => (l.name || "").trim().toLowerCase() === String(name).trim().toLowerCase()) || null : null);
}

function b64urlDecode(s) {
  const b = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; bytes.forEach((c) => { bin += String.fromCharCode(c); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function stripHtml(html) {
  return String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- Gmail ----
async function gmailList() {
  const token = await gmailAccessToken();
  const h = { Authorization: `Bearer ${token}` };
  const list = await fetch(`${GMAIL}/messages?maxResults=40&q=${encodeURIComponent("in:inbox")}`, { headers: h }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && j.error.message) || `Mail fetch failed (${r.status})`); return j; });
  const ids = (list.messages || []).map((m) => m.id);
  const known = new Map(state.messages.map((m) => [m.id, m]));
  const out = [];
  for (const id of ids) {
    if (known.has(id)) { out.push(known.get(id)); continue; }
    const m = await fetch(`${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID`, { headers: h }).then((r) => r.json()).catch(() => null);
    if (!m || !m.id) continue;
    const headers = (m.payload && m.payload.headers) || [];
    const hv = (n) => (headers.find((x) => String(x.name).toLowerCase() === n) || {}).value || "";
    out.push({ id: m.id, threadId: m.threadId || "", provider: "gmail", from: parseAddress(hv("from")), to: hv("to"), subject: hv("subject"), snippet: m.snippet || "", at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : "", unread: (m.labelIds || []).includes("UNREAD"), messageId: hv("message-id") });
  }
  return out;
}
function gmailPart(p, want) {
  if (!p) return "";
  if (p.mimeType === want && p.body && p.body.data) return b64urlDecode(p.body.data);
  for (const c of p.parts || []) { const t = gmailPart(c, want); if (t) return t; }
  return "";
}
async function gmailBody(msg) {
  const token = await gmailAccessToken();
  const m = await fetch(`${GMAIL}/messages/${encodeURIComponent(msg.id)}?format=full`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const plain = gmailPart(m.payload, "text/plain");
  if (plain) return plain.trim();
  const html = gmailPart(m.payload, "text/html");
  return html ? stripHtml(html) : (m.snippet || "");
}
async function gmailReply(msg, text) {
  const token = await gmailAccessToken();
  const subject = /^re:/i.test(msg.subject || "") ? msg.subject : `Re: ${msg.subject || ""}`;
  const raw = [
    `To: ${msg.from.name ? `${msg.from.name} <${msg.from.addr}>` : msg.from.addr}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    msg.messageId ? `In-Reply-To: ${msg.messageId}` : "",
    msg.messageId ? `References: ${msg.messageId}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent(String(text || "")))),
  ].filter((l) => l !== "").join("\r\n");
  const res = await fetch(`${GMAIL}/messages/send`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: b64urlEncode(raw), threadId: msg.threadId || undefined }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || `Gmail send failed (${res.status})`);
  return true;
}

// ---- Outlook ----
async function outlookList() {
  const token = await outlookAccessToken();
  const url = `${GRAPH}/me/messages?$top=40&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,internetMessageId,webLink`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || `Mail fetch failed (${res.status})`);
  return (j.value || []).map((m) => ({
    id: m.id, threadId: m.conversationId || "", provider: "outlook",
    from: { name: String(m.from?.emailAddress?.name || "").trim(), addr: String(m.from?.emailAddress?.address || "").toLowerCase() },
    to: (m.toRecipients || []).map((r) => r.emailAddress && r.emailAddress.address).filter(Boolean).join(", "),
    subject: m.subject || "", snippet: m.bodyPreview || "", at: m.receivedDateTime || "", unread: m.isRead === false, messageId: m.internetMessageId || "", webLink: m.webLink || "",
  }));
}

// Where this message lives in the mail app itself. Gmail's web address for
// a thread opens the Gmail app on a phone that has it (and Gmail in the
// browser otherwise); Outlook hands each message its own link.
export function messageLink(m) {
  if (!m) return "";
  if (m.provider === "gmail") {
    const acct = state.account || mailboxAccount();
    return `https://mail.google.com/mail/${acct ? `?authuser=${encodeURIComponent(acct)}` : "u/0/"}#all/${encodeURIComponent(m.threadId || m.id)}`;
  }
  if (m.provider === "outlook") return m.webLink || `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(m.id)}`;
  return "";
}

// The same message in the phone's own mail app, where the platform allows
// it. Android Chrome takes an intent link that names the Gmail package and
// Gmail opens the very conversation (falling back to the web link when
// the app isn't there). The Gmail app on iPhone only lets other apps open
// its compose screen, so there the button opens the Gmail app itself —
// the email is at the top of the inbox. Outlook's app on either phone
// opens a message by its id. Anywhere else it's the web link. Returns
// { href, app } where app is true when href targets an installed app.
export function mailAppLink(m, ua = navigator.userAgent) {
  const web = messageLink(m);
  if (!web) return null;
  const android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua);
  if (m.provider === "gmail" && android) {
    return { app: true, href: `intent://${web.replace(/^https:\/\//, "")}#Intent;scheme=https;package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(web)};end` };
  }
  if (m.provider === "gmail" && ios) return { app: true, href: "googlegmail://" };
  if (m.provider === "outlook" && (android || ios)) {
    const acct = state.account || mailboxAccount();
    return { app: true, href: `ms-outlook://emails/message/open?restid=${encodeURIComponent(m.id)}${acct ? `&account=${encodeURIComponent(acct)}` : ""}` };
  }
  return { app: false, href: web };
}
async function outlookBody(msg) {
  const token = await outlookAccessToken();
  const m = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(msg.id)}?$select=body`, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } }).then((r) => r.json());
  const b = m.body || {};
  return String(b.contentType || "").toLowerCase() === "html" ? stripHtml(b.content) : String(b.content || "").trim();
}
async function outlookReply(msg, text) {
  const token = await outlookAccessToken();
  const res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(msg.id)}/reply`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment: String(text || "") }) });
  if (res.status === 202) return true;
  const j = await res.json().catch(() => ({}));
  throw new Error((j.error && j.error.message) || `Outlook reply failed (${res.status})`);
}

// ---- The mailbox ----
let refreshing = null;
export function refreshMailbox() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    await loadMailbox();
    const provider = mailboxProvider();
    if (!provider) { state = { provider: "", account: "", at: null, messages: [] }; return state; }
    const fresh = provider === "gmail" ? await gmailList() : await outlookList();
    const read = readSet();
    const byId = new Map(state.provider === provider ? state.messages.map((m) => [m.id, m]) : []);
    fresh.forEach((m) => byId.set(m.id, { ...m, unread: m.unread && !read.has(m.id) }));
    const messages = [...byId.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, KEEP);
    state = { provider, account: mailboxAccount(), at: new Date().toISOString(), messages };
    remember();
    return state;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
export function mailboxStale(maxAgeMin = 5) {
  return !state.at || (Date.now() - new Date(state.at).getTime()) > maxAgeMin * 60000;
}

// A message's full text, fetched once and kept with it.
export async function messageBody(msg) {
  if (msg.body != null) return msg.body;
  const body = msg.provider === "gmail" ? await gmailBody(msg) : await outlookBody(msg);
  msg.body = body;
  remember();
  return body;
}

// Reply in the same thread, from the connected mailbox. A reply to a
// customer is logged in their history too.
export async function replyToMessage(msg, text) {
  if (msg.provider === "gmail") await gmailReply(msg, text); else await outlookReply(msg, text);
  const lead = customerFor(msg.from.addr, msg.from.name);
  if (lead) {
    logEmail(lead.id, { direction: "out", subject: /^re:/i.test(msg.subject || "") ? msg.subject : `Re: ${msg.subject || ""}`, body: text, via: msg.provider });
    store.update("leads", lead.id, { lastContacted: new Date().toISOString(), lastContactVia: "email" });
    store.logActivity("touch");
  }
  markRead(msg.id);
  return true;
}

// A new email to anyone, from the connected mailbox (or the function's
// sender when none is connected). Logged to the customer when it's one.
export async function composeEmail({ to, subject, text }) {
  await sendEmail({ to, subject, text });
  const lead = customerFor(to);
  if (lead) {
    logEmail(lead.id, { direction: "out", subject, body: text, via: mailboxProvider() || "function" });
    store.update("leads", lead.id, { lastContacted: new Date().toISOString(), lastContactVia: "email" });
    store.logActivity("touch");
  }
  return true;
}
