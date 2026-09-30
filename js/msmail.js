// Outlook — Microsoft Graph, entirely on-device. One connection does both
// halves of email: the app signs into the user's Microsoft account with
// OAuth (authorization code + PKCE, registered as a Single-Page Application
// so no secret is needed), keeps the tokens in localStorage on this device
// only, pulls recent inbox mail straight from Graph, and sends through the
// same mailbox (Mail.Send) so every email comes from the salesperson's own
// address and lands in their Sent Items. Senders are matched to customers
// (by email address, then by exact name) and matched messages land in the
// lead's email history as "↓ In". Unmatched personal mail is ignored and
// never stored.
//
// One-time setup (see supabase/README.md): register an app at
// entra.microsoft.com → App registrations, platform "Single-page
// application", redirect URI = the app's URL, then paste the Application
// (client) ID into Settings → Email.

import * as store from "./store.js";

const TOK_KEY = "viniva:msmail:tokens";
const LAST_KEY = "viniva:msmail:last";
const AUTH_BASE = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = "openid profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send";

function cfg() {
  const s = store.getSettings();
  return { clientId: (s.msClientId || "").trim(), tenant: (s.msTenant || "").trim() || "common" };
}
export function outlookConfigured() { return !!cfg().clientId; }

function loadTok() { try { return JSON.parse(localStorage.getItem(TOK_KEY) || "null"); } catch { return null; } }
function saveTok(t) { try { localStorage.setItem(TOK_KEY, JSON.stringify(t)); } catch {} }
export function outlookAccount() { const t = loadTok(); return (t && t.account) || null; }
export function outlookConnected() { return !!loadTok(); }
// A connection made before sending existed carries no Mail.Send consent;
// it reads fine and needs one more Connect to send.
export function outlookCanSend() { const t = loadTok(); return !!(t && /Mail\.Send/.test(t.scope || "")); }
export function disconnectOutlook() { localStorage.removeItem(TOK_KEY); localStorage.removeItem(LAST_KEY); }
export function lastMailPull() { return localStorage.getItem(LAST_KEY) || null; }

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Start the sign-in: build a PKCE challenge and hand off to Microsoft. The
// browser returns to the app with ?code=… which handleAuthRedirect exchanges.
export async function connectOutlook() {
  const { clientId, tenant } = cfg();
  if (!clientId) throw new Error("Paste your Application (client) ID first — see the setup steps");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  sessionStorage.setItem("msmail:pkce", verifier);
  sessionStorage.setItem("msmail:state", state);
  const redirect = location.origin + location.pathname;
  location.assign(
    `${AUTH_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize` +
    `?client_id=${encodeURIComponent(clientId)}&response_type=code&response_mode=query` +
    `&redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(SCOPE)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&prompt=select_account`
  );
}

async function tokenRequest(params) {
  const { clientId, tenant } = cfg();
  const res = await fetch(`${AUTH_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description || j.error || `Microsoft sign-in failed (${res.status})`);
  return j;
}

// Called once at app boot: if Microsoft just redirected back with a code,
// exchange it for tokens. Returns true when a connection was completed.
export async function handleAuthRedirect() {
  const qs = new URLSearchParams(location.search);
  const code = qs.get("code");
  const err = qs.get("error_description") || qs.get("error");
  if (!code && !err) return false;
  history.replaceState(null, "", location.pathname + location.hash); // clean the URL
  if (err) throw new Error(err);
  const state = qs.get("state");
  if (state !== sessionStorage.getItem("msmail:state")) return false; // stale/foreign redirect
  const verifier = sessionStorage.getItem("msmail:pkce");
  const j = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: location.origin + location.pathname,
    code_verifier: verifier,
  });
  let account = null;
  try {
    const me = await fetch(`${GRAPH}/me?$select=displayName,mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${j.access_token}` },
    }).then((r) => r.json());
    account = { name: me.displayName || "", email: me.mail || me.userPrincipalName || "" };
  } catch {}
  saveTok({
    accessToken: j.access_token,
    refreshToken: j.refresh_token || null,
    expiresAt: Date.now() + ((j.expires_in || 3600) * 1000) - 60000,
    scope: j.scope || SCOPE,
    account,
  });
  return true;
}

export async function outlookAccessToken() { return accessToken(); }
async function accessToken() {
  const t = loadTok();
  if (!t) throw new Error("Outlook isn't connected — tap Connect Outlook in Settings → Email");
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) { disconnectOutlook(); throw new Error("Outlook session expired — connect again in Settings → Email"); }
  const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken, scope: SCOPE });
  const nt = {
    ...t,
    accessToken: j.access_token,
    refreshToken: j.refresh_token || t.refreshToken,
    expiresAt: Date.now() + ((j.expires_in || 3600) * 1000) - 60000,
    scope: j.scope || t.scope || "",
  };
  saveTok(nt);
  return nt.accessToken;
}

// Send one email from the connected mailbox. Plain text, one recipient,
// saved to Sent Items like anything else sent from Outlook.
export async function sendViaOutlook({ to, subject, text }) {
  if (!outlookCanSend()) throw new Error("Outlook is connected for reading only — tap Connect Outlook again in Settings → Email to allow sending");
  const token = await accessToken();
  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { subject: String(subject || ""), body: { contentType: "Text", content: String(text || "") }, toRecipients: [{ emailAddress: { address: String(to || "").trim() } }] },
      saveToSentItems: true,
    }),
  });
  if (res.status === 202) return true;
  const j = await res.json().catch(() => ({}));
  throw new Error((j.error && j.error.message) || `Outlook send failed (${res.status})`);
}

// Pull recent inbox mail and file customer messages into their email history.
// First pull looks back 14 days; after that, only what's new. Idempotent —
// each Graph message id is stored once.
//
// Who the customers are and where a match is filed depend on who's signed
// in: a rep's are their own book and their own email history (the default);
// a manager's are every rep's customers, filed into that rep's book
// (pullStoreMail). `match(addr, name)` finds the customer, `seen` holds the
// message ids already filed, `file(lead, email)` stores one.
export async function pullOutlookMail({ match = null, seen = null, file = null } = {}) {
  const token = await accessToken();
  const since = lastMailPull() || new Date(Date.now() - 14 * 86400000).toISOString();
  const url = `${GRAPH}/me/messages?$top=50&$orderby=receivedDateTime desc` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${since.slice(0, 19)}Z`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || `Mail fetch failed (${res.status})`);
  const msgs = j.value || [];

  if (!seen) seen = new Set(store.all("emails").map((e) => e.msgId).filter(Boolean));
  if (!match) {
    const leads = store.all("leads");
    // Match by email address first; fall back to an exact name match (and
    // backfill the lead's email so future matching is instant).
    match = (addr, fromName) => {
      let lead = leads.find((l) => (l.email || "").toLowerCase() === addr);
      if (!lead && fromName) {
        lead = leads.find((l) => (l.name || "").trim().toLowerCase() === fromName.toLowerCase());
        if (lead && !lead.email) store.update("leads", lead.id, { email: addr });
      }
      return lead || null;
    };
  }
  if (!file) file = (lead, email) => store.create("emails", { leadId: lead.id, ...email });
  let linked = 0;
  for (const m of msgs) {
    if (!m.id || seen.has(m.id)) continue;
    const addr = String(m.from?.emailAddress?.address || "").toLowerCase();
    const fromName = String(m.from?.emailAddress?.name || "").trim();
    if (!addr) continue;
    const lead = match(addr, fromName);
    if (!lead) continue; // not a customer — ignore, never store
    await file(lead, {
      direction: "in",
      subject: m.subject || "",
      body: m.bodyPreview || "",
      via: "outlook",
      msgId: m.id,
      receivedAt: m.receivedDateTime || "",
    });
    seen.add(m.id);
    linked++;
  }
  localStorage.setItem(LAST_KEY, new Date().toISOString());
  return { checked: msgs.length, linked };
}

// The manager's inbox: a reply from a customer on any rep's book is filed
// into that rep's book, against that customer, through the database's
// manager door. What's been filed is remembered on this phone.
const SEEN_KEY = "viniva:msmail:filed";
function loadSeen() { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); } }
function saveSeen(seen) { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-1000))); } catch { /* fine */ } }
export async function pullStoreMail(team) {
  const { loadBook, logRepEmail } = await import("./team.js");
  const book = await loadBook(team);
  const seen = loadSeen();
  const match = (addr, fromName) => {
    let row = book.rows.find((r) => (r.lead.email || "").toLowerCase() === addr);
    if (!row && fromName) row = book.rows.find((r) => (r.lead.name || "").trim().toLowerCase() === fromName.toLowerCase());
    return row ? { id: row.lead.id, rep: row.rep.user_id } : null;
  };
  const file = async (lead, email) => { await logRepEmail(lead.rep, { leadId: lead.id, ...email }); seen.add(email.msgId); saveSeen(seen); };
  return pullOutlookMail({ match, seen, file });
}
export function pullStoreMailIfStale(team, maxAgeMin = 20) {
  if (!outlookConnected() || !team) return;
  const last = lastMailPull();
  const stale = !last || (Date.now() - new Date(last).getTime()) > maxAgeMin * 60000;
  if (stale && navigator.onLine !== false) {
    pullStoreMail(team)
      .then((r) => { if (r.linked) window.dispatchEvent(new CustomEvent("viniva-mail", { detail: r })); })
      .catch(() => {});
  }
}

// Background refresh on app open (same pattern as calendar feeds).
export function pullMailIfStale(maxAgeMin = 20) {
  if (!outlookConnected()) return;
  const last = lastMailPull();
  const stale = !last || (Date.now() - new Date(last).getTime()) > maxAgeMin * 60000;
  if (stale && navigator.onLine !== false) {
    pullOutlookMail()
      .then((r) => { if (r.linked) window.dispatchEvent(new CustomEvent("viniva-mail", { detail: r })); })
      .catch(() => {});
  }
}
