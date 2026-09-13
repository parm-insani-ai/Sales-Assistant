// Cloud sync engine — local-first with last-write-wins. The device's
// localStorage stays the working copy (instant, offline); this mirrors changes
// to Supabase and pulls others down. Conflicts resolve by newest updatedAt.
//
// Flow each sync: push local changes (an outbox of what changed since last
// push), then pull everything changed on the server since our cursor and apply
// anything newer than our local copy.

import * as store from "./store.js";
import * as backend from "./backend.js";

const META_KEY = "viniva:sync"; // { cursor, lastSyncAt, initializedFor }

function meta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch { return {}; }
}
function setMeta(patch) {
  localStorage.setItem(META_KEY, JSON.stringify({ ...meta(), ...patch }));
}
function emit(status, extra = {}) {
  window.dispatchEvent(new CustomEvent("viniva-sync", { detail: { status, ...extra } }));
}

export function lastSyncAt() { return meta().lastSyncAt || null; }

// Full snapshot of every local record, as push rows.
function collectAll() {
  const rows = [];
  store.SYNC_COLLECTIONS.forEach((coll) => {
    store.all(coll).forEach((rec) => rows.push({ id: rec.id, collection: coll, data: rec, deleted: false }));
  });
  return rows;
}

async function pushAll() {
  await backend.pushRecords(collectAll());
  store.clearOutboxKeys(store.getOutbox().map((e) => `${e.collection}:${e.id}`));
}

async function pushOutbox() {
  const entries = store.getOutbox();
  if (!entries.length) return;
  const rows = entries.map((e) => {
    // Tombstones carry the deletion time as updatedAt so last-write-wins can
    // compare a delete against an edit on the same (app) clock.
    if (e.deleted) return { id: e.id, collection: e.collection, data: { updatedAt: e.at }, deleted: true };
    const rec = store.get(e.collection, e.id);
    return rec
      ? { id: e.id, collection: e.collection, data: rec, deleted: false }
      : { id: e.id, collection: e.collection, data: { updatedAt: e.at }, deleted: true };
  });
  await backend.pushRecords(rows);
  store.clearOutboxKeys(entries.map((e) => `${e.collection}:${e.id}`));
}

async function pullApply() {
  const { rows, cursor } = await backend.pullRecords(meta().cursor);
  let applied = 0;
  // One save for the whole page, not one per row. The first sync after a
  // reinstall pulls the entire book down at once, and applying it record by
  // record re-serialises the whole store each time — the same quadratic cost
  // that made importing 3,235 customers lock the phone up, arriving by a
  // different door.
  store.bulk(() => rows.forEach((row) => {
    const key = `${row.collection}:${row.id}`;
    const remoteTime = (row.data && row.data.updatedAt) || row.updated_at || "";
    const local = store.get(row.collection, row.id);
    const localTime = local?.updatedAt || "";
    if (row.deleted) {
      if (local && remoteTime >= localTime) { store.applyRemoteDelete(row.collection, row.id); store.clearOutboxKeys([key]); applied++; }
    } else if (!local || remoteTime > localTime) {
      store.applyRemote(row.collection, row.id, { ...row.data, id: row.id });
      store.clearOutboxKeys([key]);
      applied++;
    }
  }));
  if (cursor) setMeta({ cursor });
  // The settings mirror arrives as an ordinary record; fold it back into the
  // live settings. This is what makes a reinstall recover the dealership name,
  // fees, goals, templates and numbers instead of asking for them all again.
  if (store.adoptRemoteConfig()) applied++;
  return applied;
}

// Make the cloud match the device, rather than trusting that it already does.
//
// The old model was: seed the cloud once per install, then push a queue of
// changes. Anything that fell outside that — rows created while signed out,
// a queue emptied by signing out, an import that predated the account — was
// never pushed and never would be. On a phone that is the ONLY copy, so the
// first uninstall deletes it. 2,923 customers went that way.
//
// This asks the server what it holds (ids only, cheap) and pushes every local
// record it lacks. If the server holds ids this device lacks, the cursor is
// dropped so the next pull starts from the beginning. Runs on the first sync
// of a session, after an import, and on a manual sync — not on the 20-second
// poll, which only needs the queue.
async function reconcile() {
  const remote = await backend.listRecordIds();
  const have = new Set(remote.map((r) => r.id));
  const missing = [];
  store.SYNC_COLLECTIONS.forEach((coll) => {
    store.all(coll).forEach((rec) => { if (!have.has(rec.id)) missing.push({ id: rec.id, collection: coll, data: rec, deleted: false }); });
  });
  if (missing.length) await backend.pushRecords(missing);
  const localIds = new Set();
  store.SYNC_COLLECTIONS.forEach((coll) => store.all(coll).forEach((r) => localIds.add(r.id)));
  const unseen = remote.some((r) => !r.deleted && !localIds.has(r.id));
  if (unseen) setMeta({ cursor: null });
  return { pushed: missing.length, refetch: unseen };
}

let running = null;
let reconciledThisSession = false;
// Rows applied from the cloud since the app opened. The Storage check uses it
// to tell "restored from the cloud" apart from "never written" — both look
// like loaded 0 / in memory N, and they are opposite diagnoses.
let appliedThisSession = 0;
export function rowsAppliedThisSession() { return appliedThisSession; }

// Run a full sync cycle. Safe to call often — concurrent calls share one run.
// { reconcile: true } forces the local↔server comparison; it also runs on the
// first sync of every session regardless.
export function syncNow(opts = {}) {
  if (running) return running;
  if (!backend.isConfigured() || !backend.isSignedIn()) return Promise.resolve({ skipped: true });
  if (navigator.onLine === false) { emit("offline"); return Promise.resolve({ offline: true }); }

  running = (async () => {
    emit("syncing");
    try {
      const user = backend.currentUser();
      let pushed = 0;
      if (meta().initializedFor !== user?.id) {
        await pushAll();                 // first sync on this device/account: seed the cloud
        setMeta({ initializedFor: user?.id });
        reconciledThisSession = true;    // a full push IS a reconcile
      } else {
        await pushOutbox();
        if (opts.reconcile || !reconciledThisSession) {
          const r = await reconcile();
          pushed = r.pushed;
          reconciledThisSession = true;
        }
      }
      const applied = await pullApply();
      appliedThisSession += applied;
      const at = new Date().toISOString();
      setMeta({ lastSyncAt: at });
      emit("synced", { at, applied, pushed });
      return { ok: true, applied, pushed };
    } catch (e) {
      emit("error", { error: e?.message || "Sync failed" });
      return { error: e?.message || "Sync failed" };
    } finally {
      running = null;
    }
  })();
  return running;
}

// Force-push the entire local dataset to the cloud (manual "Back up now").
export async function backupNow() {
  if (!backend.isConfigured() || !backend.isSignedIn()) throw new Error("Sign in to back up");
  emit("syncing");
  try { await pushAll(); const at = new Date().toISOString(); setMeta({ lastSyncAt: at, initializedFor: backend.currentUser()?.id }); emit("synced", { at }); }
  catch (e) { emit("error", { error: e?.message }); throw e; }
}

// Turn syncing on for this session (after sign-in / configuration).
export function enable() {
  store.setSyncTracking(true);
  // A fresh sign-in is a fresh claim about what the cloud holds. Compare
  // again on the next sync rather than trusting an earlier session's answer.
  reconciledThisSession = false;
}
export function disable() {
  store.setSyncTracking(false);
}

let debounce;
function scheduleSync() {
  clearTimeout(debounce);
  debounce = setTimeout(() => syncNow(), 2500);
}

// How often to look for anything that arrived from the outside while the app
// is open and being used. Everything this device does syncs immediately; this
// interval only exists for things it can't know about locally.
const POLL_MS = 20000;
let poll;

// Wire up automatic background sync. Call once at startup.
export function init() {
  if (!backend.isConfigured() || !backend.isSignedIn()) return;
  enable();
  // Re-sync on local edits (debounced), when coming online, and on focus.
  store.subscribe(() => { if (!running) scheduleSync(); });
  window.addEventListener("online", () => syncNow());
  window.addEventListener("focus", () => { if (store.getSettings().cloudAutoSync) syncNow(); });

  // An inbound text never touches this device: the carrier posts it to the
  // function, which writes the record. Nothing here knows it happened. Without
  // a poll the reply sits on the server unseen while you are looking straight
  // at the thread waiting for it — which is exactly what a messaging screen
  // must never do. Same for a customer self-booking a time.
  //
  // visibilitychange rather than focus: on iOS a home-screen PWA reliably
  // reports visibility, and often doesn't fire focus at all.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (store.getSettings().cloudAutoSync) syncNow();
  });
  clearInterval(poll);
  poll = setInterval(() => {
    if (document.visibilityState !== "visible") return; // backgrounded: don't burn battery
    if (!store.getSettings().cloudAutoSync) return;
    if (running) return;
    syncNow();
  }, POLL_MS);

  // First sync shortly after load.
  setTimeout(() => syncNow(), 800);
}
