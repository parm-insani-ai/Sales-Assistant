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
import { gmailConnected, gmailAccount, gmailAccessToken, gmailCanSend } from "./gmail.js";
import { outlookConnected, outlookAccount, outlookAccessToken, outlookCanSend } from "./msmail.js";
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
// The parts of a Gmail message: the text, the HTML, and every attachment
// (inline pictures carry a content id the HTML refers to as cid:…).
function gmailWalk(p, out) {
  if (!p) return;
  const hv = (n) => ((p.headers || []).find((x) => String(x.name).toLowerCase() === n) || {}).value || "";
  const body = p.body || {};
  if (p.filename && (body.attachmentId || body.data)) {
    const cid = hv("content-id").replace(/^<|>$/g, "");
    out.attachments.push({ id: body.attachmentId || "", data: body.data || "", name: p.filename, type: p.mimeType || "application/octet-stream", size: body.size || 0, cid, inline: !!cid || /inline/i.test(hv("content-disposition")) });
  } else if (p.mimeType === "text/plain" && body.data && !out.text) out.text = b64urlDecode(body.data);
  else if (p.mimeType === "text/html" && body.data && !out.html) out.html = b64urlDecode(body.data);
  (p.parts || []).forEach((c) => gmailWalk(c, out));
}
async function gmailContent(msg) {
  const token = await gmailAccessToken();
  const m = await fetch(`${GMAIL}/messages/${encodeURIComponent(msg.id)}?format=full`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const out = { text: "", html: "", attachments: [] };
  gmailWalk(m.payload, out);
  if (!out.text) out.text = out.html ? stripHtml(out.html) : (m.snippet || "");
  return out;
}
async function gmailAttachment(msg, att) {
  if (att.data) return b64urlBytes(att.data);
  const token = await gmailAccessToken();
  const j = await fetch(`${GMAIL}/messages/${encodeURIComponent(msg.id)}/attachments/${encodeURIComponent(att.id)}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  if (!j.data) throw new Error((j.error && j.error.message) || "Couldn't fetch the attachment");
  return b64urlBytes(j.data);
}
function b64urlBytes(s) {
  const b = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// A File's bytes as base64, for a MIME part or a Graph attachment.
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    r.readAsDataURL(file);
  });
}
const wrap76 = (s) => s.replace(/.{76}/g, "$&\r\n");
const encWord = (s) => `=?UTF-8?B?${btoa(unescape(encodeURIComponent(String(s || ""))))}?=`;
const safeName = (n) => String(n || "file").replace(/["\r\n]/g, "_");

// "a@x.com, Dana <d@y.com>; e@z.com" → the addresses, each as given.
export function splitAddrs(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || "").split(/[,;]/).map((s) => s.trim()).filter((s) => /@/.test(s));
}

// One RFC 822 message: plain text, and multipart/mixed when files ride
// along. The blank line after the headers is load-bearing.
async function buildMime({ to, cc = [], subject, text, files = [], inReplyTo = "" }) {
  const head = [
    `To: ${splitAddrs(to).join(", ")}`,
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    `Subject: ${encWord(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    inReplyTo ? `References: ${inReplyTo}` : null,
    "MIME-Version: 1.0",
  ].filter((l) => l !== null);
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(btoa(unescape(encodeURIComponent(String(text || "")))))];
  if (!files.length) return [...head, ...textPart].join("\r\n");
  const B = "part-" + Math.random().toString(36).slice(2);
  const lines = [...head, `Content-Type: multipart/mixed; boundary="${B}"`, "", `--${B}`, ...textPart];
  for (const f of files) {
    lines.push(`--${B}`, `Content-Type: ${f.type || "application/octet-stream"}; name="${safeName(f.name)}"`, `Content-Disposition: attachment; filename="${safeName(f.name)}"`, "Content-Transfer-Encoding: base64", "", wrap76(await fileBase64(f)));
  }
  lines.push(`--${B}--`, "");
  return lines.join("\r\n");
}

// Send through Gmail: a JSON raw message when it's text alone, the upload
// endpoint (multipart: metadata + the message) when files ride along,
// since the JSON route stops at a few megabytes.
async function gmailSend({ to, cc = [], subject, text, files = [], replyTo = null }) {
  const token = await gmailAccessToken();
  const mime = await buildMime({ to, cc, subject, text, files, inReplyTo: replyTo && replyTo.messageId });
  const meta = replyTo && replyTo.threadId ? { threadId: replyTo.threadId } : {};
  let res;
  if (files.length) {
    const B = "viniva-" + Date.now().toString(36);
    const body = [`--${B}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(meta), `--${B}`, "Content-Type: message/rfc822", "", mime, `--${B}--`, ""].join("\r\n");
    res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary="${B}"` }, body });
  } else {
    res = await fetch(`${GMAIL}/messages/send`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: b64urlEncode(mime), ...meta }) });
  }
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
async function outlookContent(msg) {
  const token = await outlookAccessToken();
  const h = { Authorization: `Bearer ${token}` };
  const m = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(msg.id)}?$select=body,hasAttachments`, { headers: h }).then((r) => r.json());
  const b = m.body || {};
  const html = String(b.contentType || "").toLowerCase() === "html" ? String(b.content || "") : "";
  const text = html ? stripHtml(html) : String(b.content || "").trim();
  let attachments = [];
  if (m.hasAttachments) {
    const a = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(msg.id)}/attachments?$select=id,name,contentType,size,isInline,contentId`, { headers: h }).then((r) => r.json()).catch(() => ({}));
    attachments = (a.value || []).map((x) => ({ id: x.id, name: x.name || "file", type: x.contentType || "application/octet-stream", size: x.size || 0, cid: x.contentId || "", inline: !!x.isInline }));
  }
  return { text, html, attachments };
}
async function outlookAttachment(msg, att) {
  const token = await outlookAccessToken();
  const r = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(msg.id)}/attachments/${encodeURIComponent(att.id)}/$value`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Couldn't fetch the attachment (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
const OUTLOOK_MAX = 3 * 1024 * 1024; // per file, on this route
async function outlookSend({ to, cc = [], subject, text, files = [], replyTo = null }) {
  const big = files.find((f) => f.size > OUTLOOK_MAX);
  if (big) throw new Error(`Outlook takes files up to 3 MB each from here — ${big.name} is bigger`);
  const token = await outlookAccessToken();
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const recips = (list) => splitAddrs(list).map((a) => { const p = parseAddress(a); return { emailAddress: { address: p.addr, ...(p.name ? { name: p.name } : {}) } }; });
  const atts = [];
  for (const f of files) atts.push({ "@odata.type": "#microsoft.graph.fileAttachment", name: f.name, contentType: f.type || "application/octet-stream", contentBytes: await fileBase64(f) });
  const fail = async (res, what) => { const j = await res.json().catch(() => ({})); throw new Error((j.error && j.error.message) || `${what} (${res.status})`); };
  if (replyTo) {
    // A reply is drafted by Outlook (it quotes the original), gets the copies
    // and the files, then goes.
    const d = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(replyTo.id)}/createReply`, { method: "POST", headers: H, body: JSON.stringify({ comment: String(text || ""), ...(cc.length ? { message: { ccRecipients: recips(cc) } } : {}) }) });
    if (!d.ok) return fail(d, "Outlook reply failed");
    const draft = await d.json();
    for (const a of atts) { const r = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draft.id)}/attachments`, { method: "POST", headers: H, body: JSON.stringify(a) }); if (!r.ok) return fail(r, `Couldn't attach ${a.name}`); }
    const s = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST", headers: H });
    if (s.status !== 202) return fail(s, "Outlook send failed");
    return true;
  }
  const res = await fetch(`${GRAPH}/me/sendMail`, { method: "POST", headers: H, body: JSON.stringify({ saveToSentItems: true, message: {
    subject: String(subject || ""), body: { contentType: "Text", content: String(text || "") },
    toRecipients: recips(to), ...(cc.length ? { ccRecipients: recips(cc) } : {}), ...(atts.length ? { attachments: atts } : {}),
  } }) });
  if (res.status !== 202) return fail(res, "Outlook send failed");
  return true;
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
    // What's new since the last look — not on the first look, which is
    // everything.
    const known = new Set(state.provider === provider && state.at ? state.messages.map((m) => m.id) : []);
    const arrived = state.at && state.provider === provider ? messages.filter((m) => !known.has(m.id)) : [];
    state = { provider, account: mailboxAccount(), at: new Date().toISOString(), messages };
    remember();
    try { window.dispatchEvent(new CustomEvent("viniva-mailbox", { detail: { fresh: arrived, customers: arrived.filter((m) => m.from && customerFor(m.from.addr, m.from.name)).length } })); } catch { /* no window */ }
    return state;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
export function mailboxStale(maxAgeMin = 5) {
  return !state.at || (Date.now() - new Date(state.at).getTime()) > maxAgeMin * 60000;
}

// The inbox keeps itself current, so there's nothing to tap: a check every
// so often while the app is in front (Settings → mailPollSec, a minute by
// default), and one on coming back to the app or back online when the
// last look is more than a minute old. Each check tells the app what's
// new (the "viniva-mailbox" event) — the Email tab repaints, Home says so.
let watching = false;
export function startMailboxWatch() {
  if (watching) return;
  watching = true;
  const everyMs = () => Math.max(5, Number(store.getSettings().mailPollSec) || 60) * 1000;
  const quiet = () => { if (!document.hidden && navigator.onLine !== false && mailboxProvider()) refreshMailbox().catch(() => {}); };
  const soonIfStale = () => { if (mailboxProvider() && mailboxStale(1)) quiet(); };
  let timer = setInterval(quiet, everyMs());
  // The interval is read once; a changed setting takes on the next open.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) soonIfStale(); });
  window.addEventListener("focus", soonIfStale);
  window.addEventListener("online", soonIfStale);
  return () => { clearInterval(timer); timer = null; watching = false; };
}

// A message in full — its text, its HTML (kept when it's not enormous) and
// what's attached — fetched once and kept with it.
const HTML_KEEP = 300000;
export async function messageContent(msg) {
  if (msg.body != null && msg.attachments) return { text: msg.body, html: msg.html || "", attachments: msg.attachments };
  const c = msg.provider === "gmail" ? await gmailContent(msg) : await outlookContent(msg);
  msg.body = c.text;
  msg.html = c.html.length <= HTML_KEEP ? c.html : "";
  msg.attachments = c.attachments;
  remember();
  return { text: msg.body, html: msg.html, attachments: msg.attachments };
}
// The text alone (what the conversation record reads).
export async function messageBody(msg) {
  if (msg.body != null) return msg.body;
  return (await messageContent(msg)).text;
}

// An attachment's bytes as a Blob, fetched on demand and kept for the
// session (not persisted — a picture is fetched again next time).
const blobs = new Map();
export async function attachmentBlob(msg, att) {
  const key = `${msg.id}|${att.id || att.name}`;
  if (blobs.has(key)) return blobs.get(key);
  const bytes = msg.provider === "gmail" ? await gmailAttachment(msg, att) : await outlookAttachment(msg, att);
  const blob = new Blob([bytes], { type: att.type || "application/octet-stream" });
  blobs.set(key, blob);
  return blob;
}

// Send from the connected mailbox — a new email or a reply in its thread —
// with copies and files when given. Without a mailbox, text-only email
// still goes through the function's sender; files and copies need the
// mailbox, since that's where they come from.
export async function sendMail({ to, cc = "", subject, text, files = [], replyTo = null }) {
  const ccs = splitAddrs(cc);
  const provider = replyTo ? replyTo.provider : mailboxProvider();
  if (provider === "gmail" && gmailCanSend()) return gmailSend({ to, cc: ccs, subject, text, files, replyTo });
  if (provider === "outlook" && outlookCanSend()) return outlookSend({ to, cc: ccs, subject, text, files, replyTo });
  if (provider) throw new Error(`${provider === "gmail" ? "Gmail" : "Outlook"} is connected for reading only — connect it again in Settings → Email to allow sending`);
  if (files.length || ccs.length) throw new Error("Connect Gmail or Outlook in Settings → Email to send files or copy people in");
  return sendEmail({ to, subject, text });
}

// Reply in the same thread, from the connected mailbox. `quoted` is the
// original under the reply, as the mail apps send it (Gmail only —
// Outlook's reply drafts the original itself). A reply to a customer is
// logged in their history too, the reply text alone.
export async function replyToMessage(msg, text, quoted = "", { cc = "", files = [] } = {}) {
  const to = msg.from.name ? `${msg.from.name} <${msg.from.addr}>` : msg.from.addr;
  const subject = /^re:/i.test(msg.subject || "") ? msg.subject : `Re: ${msg.subject || ""}`;
  await sendMail({ to, cc, subject, text: msg.provider === "gmail" && quoted ? `${text}\n\n${quoted}` : text, files, replyTo: msg });
  const lead = customerFor(msg.from.addr, msg.from.name);
  if (lead) {
    logEmail(lead.id, { direction: "out", subject, body: files.length ? `${text}\n(${files.length} file${files.length > 1 ? "s" : ""} attached)` : text, via: msg.provider });
    store.update("leads", lead.id, { lastContacted: new Date().toISOString(), lastContactVia: "email" });
    store.logActivity("touch");
  }
  markRead(msg.id);
  return true;
}

// A new email to anyone, from the connected mailbox (or the function's
// sender when none is connected). Logged to the customer when it's one.
export async function composeEmail({ to, cc = "", subject, text, files = [] }) {
  await sendMail({ to, cc, subject, text, files });
  const lead = customerFor(parseAddress(splitAddrs(to)[0] || to).addr);
  if (lead) {
    logEmail(lead.id, { direction: "out", subject, body: files.length ? `${text}\n(${files.length} file${files.length > 1 ? "s" : ""} attached)` : text, via: mailboxProvider() || "function" });
    store.update("leads", lead.id, { lastContacted: new Date().toISOString(), lastContactVia: "email" });
    store.logActivity("touch");
  }
  return true;
}
