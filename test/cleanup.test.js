// v150 shipped credit tiers and a lender matrix; v151 removed them. This
// checks the leftovers actually go — including the half that's easy to miss.
// Wiping a field locally leaves the cloud copy intact, so a fresh install pulls
// it straight back; the cleaned record has to be queued for push, or the data
// outlives the feature by design.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

// State exactly as a v150 user would have left it.
await p.addInitScript(() => {
  // Seed once only: this runs on every navigation, and re-injecting the dirty
  // state on reload would hide whether the cleanup is actually one-time.
  if (localStorage.getItem("seeded") === "1") return;
  localStorage.setItem("seeded", "1");
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "a", name: "Ann Lee", phone: "9025551111", stage: "working", creditTier: "4", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "b", name: "Bo Chan", phone: "9025552222", stage: "new", updatedAt: "2026-09-01T00:00:00.000Z" },
    ],
    outbox: {},
    settings: {
      salesperson: "Parm", cloudAutoSync: false,
      lenders: [{ id: "lnd_0", name: "Nissan Canada Finance", tiers: { 1: 4.49 }, maxAdvance: 145 }],
    },
  }));
});

await p.goto(APP + "/#/leads");
await p.waitForTimeout(800);

// Persisted state now lives in IndexedDB, one record per row. Read it back the
// way a relaunch would, rather than through the retired localStorage blob.
const persisted = () => p.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open("entoa");
  r.onsuccess = () => {
    const tx = r.result.transaction(["rows", "outbox", "kv"]);
    const rk = tx.objectStore("rows").getAllKeys(), rv = tx.objectStore("rows").getAll();
    const ok = tx.objectStore("outbox").getAllKeys(), ov = tx.objectStore("outbox").getAll();
    const kv = tx.objectStore("kv").get("settings");
    tx.oncomplete = () => {
      // Rebuild the shape the old blob had: one array per collection, plus
      // outbox and settings.
      const state = { outbox: {}, settings: kv.result || {} };
      rv.result.forEach((v, i) => {
        const c = String(rk.result[i][0]);
        (state[c] = state[c] || []).push(v);
      });
      ov.result.forEach((v, i) => { state.outbox[String(ok.result[i])] = v; });
      res(state);
    };
    tx.onerror = () => rej(tx.error);
  };
  r.onerror = () => rej(r.error);
}));

const state = await persisted();

console.log("settings.lenders after load:", JSON.stringify(state.settings.lenders));
if (state.settings.lenders !== undefined) fail("the invented rate sheet is still in settings");
if (!state.settings.lenderCleanup) fail("the cleanup didn't mark itself done — it will run again every load");

const ann = state.leads.find((l) => l.id === "a");
const bo = state.leads.find((l) => l.id === "b");
console.log("Ann after load:", JSON.stringify(ann));
if ("creditTier" in ann) fail("creditTier is still on the customer record");
if (ann.name !== "Ann Lee" || ann.phone !== "9025551111") fail("the cleanup damaged the rest of the record");

// The cloud copy still has the field, so the cleaned record must be queued.
console.log("outbox:", JSON.stringify(state.outbox));
if (!state.outbox["leads:a"]) fail("the cleaned record wasn't queued — the cloud copy keeps creditTier forever");
if (ann.updatedAt === "2026-09-01T00:00:00.000Z")
  fail("updatedAt wasn't touched, so the stale cloud row would win on the next pull");

// A customer who never had a tier must not be touched at all — no churn, no
// spurious push, no jumping to the top of a list sorted by recency.
if (state.outbox["leads:b"]) fail("a lead that never had a tier was queued for push anyway");
if (bo.updatedAt !== "2026-09-01T00:00:00.000Z") fail("an untouched lead had its updatedAt bumped");

// And it must be genuinely one-time.
await p.reload();
await p.waitForTimeout(600);
const again = await persisted();
if (again.leads.find((l) => l.id === "a").updatedAt !== ann.updatedAt)
  fail("the cleanup ran a second time and re-touched the record");
console.log("second load left it alone ✓");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncleanup.test.js FAILED" : "\ncleanup.test.js passed");
})();
