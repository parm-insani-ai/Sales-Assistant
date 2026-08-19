// Outlook inbox sync — Microsoft Graph, entirely on-device.
// The app signs into the user's Microsoft account with OAuth (authorization
// code + PKCE, registered as a Single-Page Application so no secret is
// needed), keeps the tokens in localStorage on this device only, and pulls
// recent inbox mail straight from Graph. Senders are matched to customers
// (by email address, then by exact name) and matched messages land in the
// lead's email history as "↓ In". Unmatched personal mail is ignored and
// never stored.
//
// One-time setup (see supabase/README.md): register an app at
// entra.microsoft.com → App registrations, platform "Single-page
// application", redirect URI = the app's URL, then paste the Application
// (client) ID into Settings → Email.

import * as store from "./store.js";

const TOK_KEY = "entoa:msmail:tokens";
const LAST_KEY = "entoa:msmail:last";
const AUTH_BASE = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = "openid profile offline_access https://graph.microsoft.com/Mail.Read";

function cfg() {
  const s = store.getSettings();
  return { clientId: (s.msClientId || "").trim(), tenant: (s.msTenant || "").trim() || "common" };
}
export function outlookConfigured() { return !!cfg().clientId; }

function loadTok() { try { return JSON.parse(localStorage.getItem(TOK_KEY) || "null"); } catch { return null; } }
function saveTok(t) { try { localStorage.setItem(TOK_KEY, JSON.stringify(t)); } catch {} }
export function outlookAccount() { const t = loadTok(); return (t && t.account) || null; }
export function outlookConnected() { return !!loadTok(); }
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
    account,
  });
  return true;
}

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
  };
  saveTok(nt);
  return nt.accessToken;
}

// Pull recent inbox mail and file customer messages into their email history.
// First pull looks back 14 days; after that, only what's new. Idempotent —
// each Graph message id is stored once.
export async function pullOutlookMail() {
  const token = await accessToken();
  const since = lastMailPull() || new Date(Date.now() - 14 * 86400000).toISOString();
  const url = `${GRAPH}/me/messages?$top=50&$orderby=receivedDateTime desc` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview` +
    `&$filter=${encodeURIComponent(`receivedDateTime ge ${since.slice(0, 19)}Z`)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || `Mail fetch failed (${res.status})`);
  const msgs = j.value || [];

  const seen = new Set(store.all("emails").map((e) => e.msgId).filter(Boolean));
  const leads = store.all("leads");
  let linked = 0;
  for (const m of msgs) {
    if (!m.id || seen.has(m.id)) continue;
    const addr = String(m.from?.emailAddress?.address || "").toLowerCase();
    const fromName = String(m.from?.emailAddress?.name || "").trim();
    if (!addr) continue;
    // Match by email address first; fall back to an exact name match (and
    // backfill the lead's email so future matching is instant).
    let lead = leads.find((l) => (l.email || "").toLowerCase() === addr);
    if (!lead && fromName) {
      lead = leads.find((l) => (l.name || "").trim().toLowerCase() === fromName.toLowerCase());
      if (lead && !lead.email) store.update("leads", lead.id, { email: addr });
    }
    if (!lead) continue; // not a customer — ignore, never store
    store.create("emails", {
      leadId: lead.id,
      direction: "in",
      subject: m.subject || "",
      body: m.bodyPreview || "",
      via: "outlook",
      msgId: m.id,
      receivedAt: m.receivedDateTime || "",
    });
    linked++;
  }
  localStorage.setItem(LAST_KEY, new Date().toISOString());
  return { checked: msgs.length, linked };
}

// Background refresh on app open (same pattern as calendar feeds).
export function pullMailIfStale(maxAgeMin = 20) {
  if (!outlookConnected()) return;
  const last = lastMailPull();
  const stale = !last || (Date.now() - new Date(last).getTime()) > maxAgeMin * 60000;
  if (stale && navigator.onLine !== false) {
    pullOutlookMail()
      .then((r) => { if (r.linked) window.dispatchEvent(new CustomEvent("entoa-mail", { detail: r })); })
      .catch(() => {});
  }
}
