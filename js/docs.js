// The paperwork on a sale — the bill of sale, the worksheet, the trade
// appraisal, whatever's on the desk — photographed or scanned from the
// Sold screen and kept with the customer. The file lives on the device
// first (IndexedDB, so it shows at once and offline) and goes up to the
// cloud bucket in the background, under this account's own folder; a row
// in the synced "docs" collection says what it is and where it went, so
// another device of yours lists it and fetches it on tap.

import * as store from "./store.js";
import * as backend from "./backend.js";
import { cacheGet, cacheSet } from "./cachedb.js";

const BUCKET = "docs";
const MAX_EDGE = 1600; // a photo of a page: plenty to read, a fraction of the size
const key = (id) => `doc:${id}`;

export function docsFor(saleId) {
  return store.all("docs").filter((d) => d.saleId === saleId).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}
export function docCount(saleId) { return store.all("docs").filter((d) => d.saleId === saleId).length; }

// A photo shrinks to a readable JPEG; a PDF or anything else goes as is.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || "")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob || file;
  } catch { return file; }
}

export async function addDoc({ saleId, leadId = null, file, name = "" }) {
  const blob = await shrink(file);
  const mime = blob.type || file.type || "application/octet-stream";
  const rec = store.create("docs", { saleId, leadId: leadId || null, name: name || file.name || "", mime, size: blob.size, at: new Date().toISOString(), path: "", uploaded: null });
  await cacheSet(key(rec.id), blob);
  syncDocs();
  return rec;
}

// The file: from the device, else from the cloud (and kept on the device).
export async function docBlob(doc) {
  const local = await cacheGet(key(doc.id));
  if (local) return local;
  if (doc.path && backend.isSignedIn()) {
    try { const b = await backend.getObject(BUCKET, doc.path); await cacheSet(key(doc.id), b); return b; } catch { return null; }
  }
  return null;
}

export async function removeDoc(doc) {
  store.remove("docs", doc.id);
  await cacheSet(key(doc.id), null);
  if (doc.path && backend.isSignedIn()) backend.deleteObject(BUCKET, doc.path).catch(() => { /* a stray file in the bucket; harmless */ });
}

const ext = (mime) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[mime] || "bin");

// Everything not yet in the cloud goes up, one at a time; what can't go
// (offline, not signed in) waits for the next call.
let syncing = false;
export async function syncDocs() {
  if (syncing || !backend.isConfigured() || !backend.isSignedIn()) return 0;
  syncing = true;
  let sent = 0;
  try {
    const user = backend.currentUser();
    for (const d of store.all("docs").filter((x) => !x.uploaded)) {
      const blob = await cacheGet(key(d.id));
      if (!blob) continue; // taken on another device; nothing here to send
      const path = `${user.id}/${d.saleId}/${d.id}.${ext(d.mime)}`;
      try {
        await backend.putObject(BUCKET, path, blob, d.mime);
        store.update("docs", d.id, { path, uploaded: new Date().toISOString() });
        sent++;
      } catch { /* next time */ }
    }
  } finally { syncing = false; }
  return sent;
}

export function pendingDocs() { return store.all("docs").filter((x) => !x.uploaded).length; }
