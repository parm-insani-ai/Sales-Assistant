// Supabase backend client — dependency-free. Talks to Supabase's Auth and REST
// (PostgREST) endpoints with plain fetch, so the app keeps its no-build,
// offline-first shape. Configuration (project URL + public anon key) lives in
// Settings; the anon key is safe to ship in a client — Row-Level Security is
// what actually protects the data.

import * as store from "./store.js";
import { BACKEND_DEFAULTS } from "./config.js";

const AUTH_KEY = "viniva:auth"; // { access_token, refresh_token, expires_at, user }

function cfg() {
  const s = store.getSettings();
  // Settings first, then whatever the build ships. The build-time default is
  // what makes a reinstall recoverable: the credentials live in localStorage,
  // so wiping the app takes away the only means it had of reaching the backup
  // its data is sitting in. See js/config.js.
  const raw = (s.supabaseUrl || BACKEND_DEFAULTS.url || "").trim();
  // Heal a common paste mistake: the function URL (or any API path) in the
  // project-URL field. Auth/REST calls need the bare project origin.
  const url = raw
    .replace(/\/(functions|rest|auth|storage|realtime)\/.*$/, "")
    .replace(/\/+$/, "");
  const anonKey = (s.supabaseAnonKey || BACKEND_DEFAULTS.anonKey || "").trim();
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
  // A signed-out install must not keep claiming the cloud is seeded for a
  // user it no longer has. Left in place, the next sign-in by the same person
  // skipped the seed and pushed only the queue — and the queue had just been
  // emptied by signing out. That is how 2,923 imported customers lived only on
  // one phone until the app was deleted.
  try { localStorage.removeItem("viniva:sync"); } catch { }
}

// Return a valid access token, refreshing if it's within 60s of expiry.
async function token() {
  let sess = getSession();
  if (!sess?.access_token) throw new Error("Not signed in");
  if ((sess.expires_at || 0) - 60 < Math.floor(Date.now() / 1000)) sess = await refresh();
  return sess.access_token;
}

// The headers every call to the cloud function carries: JSON, and the
// signed-in session so the function knows who is asking. The function takes
// the user from this token and from nothing else — a request without it can
// only reach the public paths (booking, short links).
export async function fnHeaders() {
  const h = { "Content-Type": "application/json" };
  const sess = getSession();
  if (!sess?.access_token) return h; // not signed in: the function will say so
  let t = sess.access_token;
  // Refresh when it's about to expire; if that can't be done right now
  // (offline, or the auth server is unreachable), send what we have and let
  // the function judge it rather than sending nothing.
  if ((sess.expires_at || 0) - 60 < Math.floor(Date.now() / 1000)) {
    try { t = (await refresh()).access_token; } catch { /* keep the current token */ }
  }
  h.Authorization = `Bearer ${t}`;
  return h;
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

// A database function (PostgREST rpc), as the signed-in user.
export async function rpc(name, args = {}) {
  return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
}

// Records the signed-in user is allowed to read that belong to `userId` —
// their own, or a rep's when they manage that rep's store. `filters` are
// PostgREST conditions on the JSON, e.g. { "data->>stage": "in.(new,working)" }.
export async function readRecords(userId, collection, filters = {}, { select = "id,data,updated_at", limit = 5000 } = {}) {
  const q = new URLSearchParams({ select, user_id: `eq.${userId}`, collection: `eq.${collection}`, deleted: "eq.false", limit: String(limit) });
  for (const [k, v] of Object.entries(filters)) if (v != null && v !== "") q.append(k, String(v));
  return (await rest(`records?${q.toString()}`)) || [];
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
    // The table's primary key is (user_id, id) — the collection is NOT part of
    // it — so two collections using the same id are one row up here. Sending
    // both in a single statement makes Postgres reject the whole batch with
    // "ON CONFLICT DO UPDATE command cannot affect row a second time", and
    // splitting them across chunks would be worse: they'd overwrite each other
    // silently. Catch it here, where the collections are still named, rather
    // than letting a database string be the only clue.
    const seen = new Map();
    for (const row of chunk) {
      const other = seen.get(row.id);
      if (other && other !== row.collection) {
        throw new Error(`Two collections are using the id "${row.id}" (${other} and ${row.collection}). ` +
          `Records share one table keyed by id, so those are the same row — one of them needs a different id.`);
      }
      seen.set(row.id, row.collection);
    }
    await rest("records?on_conflict=user_id,id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
  }
}

// Every record id the server holds for this user, with the collection and
// whether it's a tombstone. Ids only — about 60 bytes a row, so a book of
// three thousand is a couple of hundred KB, cheap enough to do once a session.
// This is what lets sync RECONCILE instead of trusting a one-time seed.
export async function listRecordIds() {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const page = await rest(`records?select=id,collection,deleted&order=updated_at.asc`,
      { headers: { Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items" } });
    if (!page || !page.length) break;
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

// How many live rows the server holds for this user, without downloading them.
// For the Storage check: "on this phone 61, in the cloud 61" answers the
// question that took a reinstall to ask.
export async function countRecords() {
  const { url, anonKey } = cfg();
  const t = await token();
  const res = await fetch(`${url}/rest/v1/records?select=id&deleted=eq.false`, {
    method: "HEAD",
    headers: { apikey: anonKey, Authorization: `Bearer ${t}`, Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" },
  });
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  const cr = res.headers.get("Content-Range") || "";
  const m = cr.match(/\/(\d+)$/);
  return m ? Number(m[1]) : null;
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
