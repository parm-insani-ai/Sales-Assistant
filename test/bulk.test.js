// Importing a real book of business.
//
// 3,235 customers went in and the app stopped responding. Nothing was wrong
// with the file. Every create/update in the store persists the WHOLE state and
// notifies every subscriber, which is right for one edit and quadratic for a
// file: row 3,235 re-serialised 3,234 rows' worth of JSON before writing it,
// and did that 3,235 times. Measured here before the fix, it did not finish in
// two minutes on a desktop; a phone simply dies.
//
// So the thing to hold is not "imports work" but the shape of the cost: one
// save and one notification for the batch, however many rows it contains.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [], vehicles: [], settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(600);

const ROWS = 3235;

// --- A full book, written as one batch.
{
  const r = await p.evaluate(async (n) => {
    const store = await import("/js/store.js");
    // Shaped like an AutoAlert equity export, which is the fat case: every
    // financial column populated, not just a name and a number.
    const mk = (i) => ({
      name: `Customer Number ${i}`, phone: `902555${String(1000 + i).slice(-4)}`,
      email: `customer${i}@example.com`, stage: "new", source: "AutoAlert Import",
      vehicleInterest: "2019 Nissan Rogue SV AWD", currentPayment: 480, payoff: 12000,
      currentValue: 15500, currentApr: 6.9, currentTerm: 72, odometer: 88000,
      purchaseDate: "2019-04-11", notes: "Imported from equity export batch 2026-09",
    });
    let notifies = 0;
    const off = store.subscribe(() => notifies++);
    const t0 = performance.now();
    store.bulk(() => { for (let i = 0; i < n; i++) store.create("leads", mk(i)); });
    const ms = performance.now() - t0;
    off();
    // Writes are asynchronous now — wait for them, then count what's on disk.
    await store.flush();
    const persisted = await new Promise((res, rej) => {
      const r = indexedDB.open("entoa");
      r.onsuccess = () => {
        const q = r.result.transaction("rows").objectStore("rows").getAllKeys();
        q.onsuccess = () => res(q.result.filter((k) => k[0] === "leads").length);
        q.onerror = () => rej(q.error);
      };
      r.onerror = () => rej(r.error);
    });
    const mb = +(JSON.stringify(store.getState()).length / 1048576).toFixed(2);
    return {
      ms: Math.round(ms), notifies,
      inMemory: store.all("leads").length,
      persisted,
      mb,
      saveError: String(store.saveError() || ""),
    };
  }, ROWS);
  console.log(`${ROWS} customers:`, JSON.stringify(r));

  if (r.inMemory !== ROWS) fail(`only ${r.inMemory} of ${ROWS} rows landed in memory`);
  if (r.persisted !== ROWS) fail(`only ${r.persisted} of ${ROWS} rows were actually saved`);
  if (r.saveError) fail("the save failed: " + r.saveError);
  // The property that matters. One batch is one notification — if this climbs
  // with the row count, every subscriber (including the sync scheduler and any
  // mounted view) is running thousands of times and the cost is back.
  if (r.notifies !== 1) fail(`${r.notifies} store notifications for one batch — it isn't batched`);
  // Generous, because CI machines vary; the pre-fix number was "did not finish
  // in 120 seconds", so anything in this range proves the shape changed.
  if (r.ms > 5000) fail(`the batch took ${r.ms}ms — that's the per-row cost coming back`);
  // (No ceiling check any more: records live in IndexedDB, one row each, and
  // the ~5MB localStorage limit that used to loom here no longer applies.)
  console.log(`  one save, one notification, ${r.mb}MB, ${r.ms}ms`);
}

// --- Reading the same book back down from the cloud is the same problem by a
// different door: the first sync after a reinstall applies every record.
{
  const r = await p.evaluate(async (n) => {
    const store = await import("/js/store.js");
    let notifies = 0;
    const off = store.subscribe(() => notifies++);
    const t0 = performance.now();
    store.bulk(() => {
      for (let i = 0; i < n; i++) {
        store.applyRemote("leads", `remote-${i}`, { name: `Remote ${i}`, stage: "new", updatedAt: "2026-01-01T00:00:00Z" });
      }
    });
    const ms = performance.now() - t0;
    off();
    return { ms: Math.round(ms), notifies };
  }, 1000);
  console.log("1000 records pulled from the cloud:", JSON.stringify(r));
  if (r.notifies !== 1) fail(`${r.notifies} notifications applying a sync page`);
  if (r.ms > 5000) fail(`applying a sync page took ${r.ms}ms`);
}

// --- A failed save must not be reported as success. Storage filling up was a
// console line and nothing else: the rows showed on screen, the app said
// "Import complete", and the next launch had lost them. Records live in
// IndexedDB now, so the failure to simulate is IndexedDB refusing the write.
{
  const r = await p.evaluate(async () => {
    const store = await import("/js/store.js");
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; };
    let err;
    try {
      store.bulk(() => { store.create("leads", { name: "Overflow", stage: "new" }); });
      await store.flush();
      err = String(store.saveError() || "");
    } finally {
      IDBObjectStore.prototype.put = realPut;
    }
    // Storage works again: the retry lands and the error clears.
    store.create("leads", { name: "After", stage: "new" });
    await store.flush();
    return { err, clearedAfterGoodSave: String(store.saveError() || "") };
  });
  console.log("\nstorage full:", JSON.stringify(r));
  if (!/quota/i.test(r.err)) fail("a failed save isn't recorded anywhere: " + JSON.stringify(r.err));
  if (r.clearedAfterGoodSave) fail("the error sticks after a save that worked: " + r.clearedAfterGoodSave);

  // And the import screen has to act on it rather than celebrate.
  const src = await (await fetch(APP + "/js/views/import.js")).text();
  if (!/saveError\(\)/.test(src)) fail("the import never checks whether the save landed");
  if (!/storage is full/i.test(src)) fail("there's no message for a full device");
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nbulk.test.js FAILED" : "\nbulk.test.js passed");
})();
