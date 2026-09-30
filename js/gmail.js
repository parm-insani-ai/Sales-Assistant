// Gmail — the same two halves as Outlook (msmail.js): what viniva sends
// goes out from the salesperson's own Gmail address and lands in their
// Sent Mail, and customers' replies are pulled from the inbox and filed
// into their history. Only mail from customers is kept.
//
// The difference from Outlook is where the sign-in finishes. Google won't
// hand a phone-only app a lasting sign-in without a client secret, so the
// code Google sends back is exchanged by the quick-api function (which
// holds GOOGLE_CLIENT_SECRET) and the tokens come back to this device,
// where they stay. Reading and sending talk to Gmail straight from the
// phone; only the token exchange and refresh go through the function.
//
// One-time setup (see supabase/README.md): a Google Cloud project with the
// Gmail API on, an OAuth client of type "Web application" whose authorised
// redirect URI is the app's URL, its Client ID pasted into Settings → Email
// and its client secret in the function's secrets.

import * as store from "./store.js";
import * as backend from "./backend.js";

const TOK_KEY = "viniva:gmail:tokens";
const LAST_KEY = "viniva:gmail:last";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "openid", "email"];
const SCOPE = SCOPES.join(" ");

function cfg() {
  const s = store.getSettings();
  return { clientId: (s.googleClientId || "").trim(), fn: (s.agentUrl || "").trim().replace(/\/+$/, "") };
}
export function gmailConfigured() { return !!cfg().clientId; }

function loadTok() { try { return JSON.parse(localStorage.getItem(TOK_KEY) || "null"); } catch { return null; } }
function saveTok(t) { try { localStorage.setItem(TOK_KEY, JSON.stringify(t)); } catch { /* fine */ } }
export function gmailAccount() { const t = loadTok(); return (t && t.account) || null; }
export function gmailConnected() { return !!loadTok(); }
export function gmailCanSend() { const t = loadTok(); return !!(t && /gmail\.send/.test(t.scope || "")); }
export function disconnectGmail() { localStorage.removeItem(TOK_KEY); localStorage.removeItem(LAST_KEY); }
export function lastGmailPull() { return localStorage.getItem(LAST_KEY) || null; }

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Start the sign-in: a PKCE challenge, then off to Google. Google returns
// to the app with ?code=…&state=g.… which handleGmailRedirect finishes.
export async function connectGmail() {
  const { clientId, fn } = cfg();
  if (!clientId) throw new Error("Paste your Google OAuth Client ID first — see the setup steps");
  if (!fn) throw new Error("Set up the voice agent function first (Settings → Voice agent) — it finishes the Google sign-in");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = "g." + b64url(crypto.getRandomValues(new Uint8Array(12)));
  sessionStorage.setItem("gmail:pkce", verifier);
  sessionStorage.setItem("gmail:state", state);
  const redirect = location.origin + location.pathname;
  location.assign(
    `${AUTH}?client_id=${encodeURIComponent(clientId)}&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(SCOPE)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&state=${encodeURIComponent(state)}` +
    `&access_type=offline&prompt=consent&include_granted_scopes=true`
  );
}

// The function does the part that needs the client secret.
async function gauth(payload) {
  const { clientId, fn } = cfg();
  if (!fn) throw new Error("Set up the voice agent function first (Settings → Voice agent)");
  let res;
  try {
    res = await fetch(fn, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ gauth: { clientId, ...payload } }) });
  } catch { throw new Error("Couldn't reach your function — check your connection"); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const msg = j.error || `HTTP ${res.status}`;
    if (/GOOGLE_CLIENT_SECRET/.test(msg)) throw new Error(`${msg}. Add it in Supabase → Edge Functions → Secrets (from the OAuth client in Google Cloud).`);
    if (/No messages/i.test(msg)) throw new Error("Your quick-api function needs the Gmail update — paste the latest code and deploy");
    throw new Error(msg);
  }
  return j;
}

// Called at boot, before Outlook's handler: if Google just sent us back
// with a code carrying our state, finish the connection. Returns true when
// a connection was completed.
export async function handleGmailRedirect() {
  const qs = new URLSearchParams(location.search);
  const code = qs.get("code");
  const state = qs.get("state") || "";
  if (!code || !state.startsWith("g.")) return false;
  if (state !== sessionStorage.getItem("gmail:state")) return false; // stale/foreign redirect
  history.replaceState(null, "", location.pathname + location.hash); // clean the URL
  const verifier = sessionStorage.getItem("gmail:pkce");
  sessionStorage.removeItem("gmail:state"); sessionStorage.removeItem("gmail:pkce");
  const j = await gauth({ code, verifier, redirect: location.origin + location.pathname });
  if (!j.access_token) throw new Error("Google didn't return a sign-in");
  let account = null;
  try {
    const me = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${j.access_token}` } }).then((r) => r.json());
    account = { email: me.emailAddress || "" };
  } catch { /* the email can be found later */ }
  saveTok({
    accessToken: j.access_token,
    refreshToken: j.refresh_token || null,
    expiresAt: Date.now() + ((j.expires_in || 3600) * 1000) - 60000,
    scope: j.scope || SCOPE,
    account,
  });
  return true;
}

export async function gmailAccessToken() { return accessToken(); }
async function accessToken() {
  const t = loadTok();
  if (!t) throw new Error("Gmail isn't connected — tap Connect Gmail in Settings → Email");
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) { disconnectGmail(); throw new Error("Gmail session expired — connect again in Settings → Email"); }
  const j = await gauth({ refresh: t.refreshToken });
  const nt = { ...t, accessToken: j.access_token, expiresAt: Date.now() + ((j.expires_in || 3600) * 1000) - 60000, scope: j.scope || t.scope };
  saveTok(nt);
  return nt.accessToken;
}

// Send one email from the connected Gmail. Plain text, one recipient; it
// lands in Sent Mail like anything sent from Gmail.
export async function sendViaGmail({ to, subject, text }) {
  if (!gmailCanSend()) throw new Error("Gmail is connected for reading only — tap Connect Gmail again in Settings → Email to allow sending");
  const token = await accessToken();
  const raw = [
    `To: ${String(to || "").trim()}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(String(subject || ""))))}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent(String(text || "")))),
  ].join("\r\n");
  const res = await fetch(`${API}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || `Gmail send failed (${res.status})`);
  return true;
}

// "Dana Muise <dana@example.com>" → { name, addr }
function parseFrom(v) {
  const s = String(v || "");
  const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(s);
  if (m) return { name: (m[1] || "").trim(), addr: m[2].trim().toLowerCase() };
  return { name: "", addr: s.trim().toLowerCase() };
}

// Pull recent inbox mail and file customer messages into their email
// history. First pull looks back 14 days; after that, only what's new.
// Idempotent — each Gmail message id is stored once. `match`, `seen` and
// `file` work as in msmail.pullOutlookMail.
export async function pullGmail({ match = null, seen = null, file = null } = {}) {
  const token = await accessToken();
  const h = { Authorization: `Bearer ${token}` };
  const last = lastGmailPull();
  const q = last ? `in:inbox after:${Math.floor(new Date(last).getTime() / 1000) - 60}` : "in:inbox newer_than:14d";
  const list = await fetch(`${API}/messages?maxResults=50&q=${encodeURIComponent(q)}`, { headers: h }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.error && j.error.message) || `Mail fetch failed (${r.status})`); return j; });
  const ids = (list.messages || []).map((m) => m.id).filter(Boolean);

  if (!seen) seen = new Set(store.all("emails").map((e) => e.msgId).filter(Boolean));
  if (!match) {
    const leads = store.all("leads");
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
  for (const id of ids) {
    if (seen.has(id)) continue;
    const m = await fetch(`${API}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: h }).then((r) => r.json()).catch(() => null);
    if (!m || !m.id) continue;
    const headers = (m.payload && m.payload.headers) || [];
    const hv = (n) => (headers.find((x) => String(x.name).toLowerCase() === n) || {}).value || "";
    const from = parseFrom(hv("from"));
    if (!from.addr) continue;
    const lead = match(from.addr, from.name);
    if (!lead) continue; // not a customer — ignore, never store
    await file(lead, {
      direction: "in",
      subject: hv("subject"),
      body: m.snippet || "",
      via: "gmail",
      msgId: m.id,
      receivedAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : "",
    });
    seen.add(m.id);
    linked++;
  }
  localStorage.setItem(LAST_KEY, new Date().toISOString());
  return { checked: ids.length, linked };
}

export function pullGmailIfStale(maxAgeMin = 20) {
  if (!gmailConnected()) return;
  const last = lastGmailPull();
  const stale = !last || (Date.now() - new Date(last).getTime()) > maxAgeMin * 60000;
  if (stale && navigator.onLine !== false) {
    pullGmail()
      .then((r) => { if (r.linked) window.dispatchEvent(new CustomEvent("viniva-mail", { detail: { ...r, from: "Gmail" } })); })
      .catch(() => {});
  }
}
