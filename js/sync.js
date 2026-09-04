// Cloud sync engine — local-first with last-write-wins. The device's
// localStorage stays the working copy (instant, offline); this mirrors changes
// to Supabase and pulls others down. Conflicts resolve by newest updatedAt.
//
// Flow each sync: push local changes (an outbox of what changed since last
// push), then pull everything changed on the server since our cursor and apply
// anything newer than our local copy.

import * as store from "./store.js";
import * as backend from "./backend.js";

const META_KEY = "entoa:sync"; // { cursor, lastSyncAt, initializedFor }

function meta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch { return {}; }
}
function setMeta(patch) {
  localStorage.setItem(META_KEY, JSON.stringify({ ...meta(), ...patch }));
}
function emit(status, extra = {}) {
  window.dispatchEvent(new CustomEvent("entoa-sync", { detail: { status, ...extra } }));
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
  rows.forEach((row) => {
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
  });
  if (cursor) setMeta({ cursor });
  return applied;
}

let running = null;

// Run a full sync cycle. Safe to call often — concurrent calls share one run.
export function syncNow() {
  if (running) return running;
  if (!backend.isConfigured() || !backend.isSignedIn()) return Promise.resolve({ skipped: true });
  if (navigator.onLine === false) { emit("offline"); return Promise.resolve({ offline: true }); }

  running = (async () => {
    emit("syncing");
    try {
      const user = backend.currentUser();
      if (meta().initializedFor !== user?.id) {
        await pushAll();                 // first sync on this device/account: seed the cloud
        setMeta({ initializedFor: user?.id });
      } else {
        await pushOutbox();
      }
      const applied = await pullApply();
      const at = new Date().toISOString();
      setMeta({ lastSyncAt: at });
      emit("synced", { at, applied });
      return { ok: true, applied };
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
