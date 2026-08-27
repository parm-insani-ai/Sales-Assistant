// Supabase backend client — dependency-free. Talks to Supabase's Auth and REST
// (PostgREST) endpoints with plain fetch, so the app keeps its no-build,
// offline-first shape. Configuration (project URL + public anon key) lives in
// Settings; the anon key is safe to ship in a client — Row-Level Security is
// what actually protects the data.

import * as store from "./store.js";

const AUTH_KEY = "entoa:auth"; // { access_token, refresh_token, expires_at, user }

function cfg() {
  const s = store.getSettings();
  // Heal a common paste mistake: the function URL (or any API path) in the
  // project-URL field. Auth/REST calls need the bare project origin.
  const url = (s.supabaseUrl || "").trim()
    .replace(/\/(functions|rest|auth|storage|realtime)\/.*$/, "")
    .replace(/\/+$/, "");
  const anonKey = (s.supabaseAnonKey || "").trim();
  return { url, anonKey };
}

export function isConfigured() {
  const { url, anonKey } = cfg();
  return !!(url && anonKey);
}

// --- Session persistence ---
export function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
function setSession(sess) {
  if (sess) localStorage.setItem(AUTH_KEY, JSON.stringify(sess));
  else localStorage.removeItem(AUTH_KEY);
}
export function currentUser() {
  return getSession()?.user || null;
}
export function isSignedIn() {
  return !!getSession()?.access_token;
}

function saveTokens(json) {
  const sess = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (json.expires_in || 3600),
    user: json.user ? { id: json.user.id, email: json.user.email } : getSession()?.user || null,
  };
  setSession(sess);
  return sess;
}

function authError(json, res) {
  return (
    json?.error_description || json?.msg || json?.message || json?.error ||
    (res ? `Request failed (${res.status})` : "Request failed")
  );
}

// --- Auth ---
export async function signUp(email, password) {
  const { url, anonKey } = cfg();
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(authError(json, res));
  // If confirmations are off, Supabase returns a session immediately.
  if (json.access_token) return { session: saveTokens(json), needsConfirmation: false };
  return { session: null, needsConfirmation: true };
}

export async function signIn(email, password) {
  const { url, anonKey } = cfg();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(authError(json, res));
  return saveTokens(json);
}

async function refresh() {
  const sess = getSession();
  if (!sess?.refresh_token) throw new Error("Not signed in");
  const { url, anonKey } = cfg();
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: sess.refresh_token }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) { setSession(null); throw new Error("Session expired — please sign in again"); }
  return saveTokens(json);
}

export async function signOut() {
  const { url, anonKey } = cfg();
  const sess = getSession();
  if (sess?.access_token) {
    fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${sess.access_token}` },
    }).catch(() => {});
  }
  setSession(null);
}

// Return a valid access token, refreshing if it's within 60s of expiry.
async function token() {
  let sess = getSession();
  if (!sess?.access_token) throw new Error("Not signed in");
  if ((sess.expires_at || 0) - 60 < Math.floor(Date.now() / 1000)) sess = await refresh();
  return sess.access_token;
}

// --- REST (records table) ---
async function rest(path, opts = {}) {
  const { url, anonKey } = cfg();
  const t = await token();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.message || j.error || `Server error (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// Upsert a batch of records. Each row: { id, collection, data, updated_at, deleted }.
// user_id is filled server-side from the auth token (never trust the client).
export async function pushRecords(rows) {
  if (!rows.length) return;
  // Chunk to keep requests reasonable.
  const size = 200;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size).map((r) => ({
      id: r.id,
      collection: r.collection,
      data: r.data,
      deleted: !!r.deleted,
    }));
    await rest("records?on_conflict=user_id,id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
  }
}

// Pull every record changed on the server since `cursorISO` (exclusive),
// oldest first, paginated. Returns { rows, cursor } where cursor is the newest
// server updated_at seen (feed it back next time).
export async function pullRecords(cursorISO) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  let cursor = cursorISO || null;
  for (;;) {
    const filter = cursorISO ? `&updated_at=gt.${encodeURIComponent(cursorISO)}` : "";
    const page = await rest(
      `records?select=id,collection,data,updated_at,deleted&order=updated_at.asc${filter}`,
      { headers: { Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items" } }
    );
    if (!page || !page.length) break;
    rows.push(...page);
    cursor = page[page.length - 1].updated_at;
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return { rows, cursor };
}
