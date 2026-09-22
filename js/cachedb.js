// A small on-device cache for answers that are expensive to recompute and
// cheap to store — the Deal Radar's read of the whole book, for one. Separate
// from the store's own database on purpose: nothing here is a record, and
// losing it costs a recompute, never data.

const DB = "viniva-cache";
const STORE = "kv";
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch { /* exists */ } };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return opening;
}

export async function cacheGet(key) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result == null ? null : req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function cacheSet(key, value) {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

export async function cacheClear() {
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    try { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).clear(); tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve; } catch { resolve(); }
  });
}

// A short, stable fingerprint of a string (FNV-1a), for cache keys.
export function fingerprint(s) {
  let h = 0x811c9dc5;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0") + ":" + str.length;
}
