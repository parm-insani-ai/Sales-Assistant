// "When I go into the Outreach page, it still always reads the book."
//
// A phone opens the app cold every time, and the read of the book — every
// customer against the lot — is a second or more on a big book. Outreach and
// Home's queue are drawn from the last read, kept on the device, the moment
// they open; the current read is made behind them and the list takes it up.
// Only the first launch ever, with nothing to draw from, says "Reading the
// book…". The lot changing overnight (nothing reusable) is the hard case and
// must paint the same way.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  if (!localStorage.getItem("seeded")) {
    localStorage.setItem("seeded", "1");
    const leads = [];
    for (let i = 0; i < 1500; i++) leads.push({ id: "l" + i, name: "Customer " + i, phone: "902555" + String(1000 + i), stage: "working",
      vehicleInterest: ["2019 Nissan Rogue", "2020 Nissan Kicks", "2018 Honda Civic", "2021 Nissan Sentra"][i % 4],
      purchaseDate: "2021-0" + (i % 9 + 1) + "-11", currentPayment: 380 + (i % 300), payoff: 8000 + (i % 15000), currentValue: 14000 + (i % 9000), currentApr: 5.9 + (i % 4),
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" });
    const vehicles = [];
    const models = [["Rogue", "SV", "SUV"], ["Rogue", "SL", "SUV"], ["Kicks", "SR", "Hatchback"], ["Sentra", "SV", "Sedan"], ["Pathfinder", "SL", "SUV"], ["Frontier", "PRO-4X", "Truck"], ["Ariya", "SV+", "SUV"]];
    for (let i = 0; i < 300; i++) { const m = models[i % models.length]; const isNew = i % 3 !== 0;
      vehicles.push({ id: "v" + i, year: isNew ? 2026 : 2019 + (i % 6), make: "Nissan", model: m[0], trim: m[1], bodyStyle: m[2], condition: isNew ? "New" : "Used", price: isNew ? 30000 + (i % models.length) * 4000 : 18000 + (i % 40) * 500, mileage: isNew ? 10 : 20000 + (i % 50) * 1500, stock: "N" + (10000 + i), status: "available", source: "web", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }); }
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles, settings: { salesperson: "Parm", cloudAutoSync: false } }));
  }
});
// A real relaunch: a new document, not a hash change (a goto to the same
// URL with another hash is a same-document navigation and resets nothing).
let launchN = 0;
const relaunch = (hash) => p.goto(`${APP}/?launch=${++launchN}${hash}`);
// How the page opened: did it ever say "Reading the book…", and when did the list draw?
const opened = async () => {
  const t0 = Date.now(); let reading = false;
  for (let i = 0; i < 600; i++) {
    const st = await p.evaluate(() => ({ reading: /Reading the book…/.test(document.querySelector("#view")?.textContent || ""), rows: document.querySelectorAll("#view .lc-row").length }));
    if (st.reading) reading = true;
    if (!st.reading && st.rows > 0) return { ms: Date.now() - t0, reading, rows: st.rows };
    await p.waitForTimeout(50);
  }
  return { ms: Date.now() - t0, reading, rows: 0 };
};
const stats = () => p.evaluate(async () => { const a = await import("/js/assess.js"); const d = await import("/js/views/dealbuilder.js"); return { read: a.bookStats.read, bookSync: a.bookStats.syncRuns, bookWarm: a.bookStats.warmRuns, priced: d.radarStats.priced, radarSync: d.radarStats.syncRuns, warming: a.bookStats.warming || d.radarStats.warming }; });
const settled = async () => { for (let i = 0; i < 200; i++) { if (!(await stats()).warming) return; await p.waitForTimeout(200); } fail("the read never settled"); };

// The first launch ever: nothing to draw from, so it reads first.
await relaunch("#/leads");
const first = await opened();
console.log("first launch:", JSON.stringify(first));
if (!first.reading || !first.rows) fail("the first launch should read the book before the list: " + JSON.stringify(first));
await settled(); await p.waitForTimeout(2000); // the read is kept on the device a moment after it settles

// A relaunch straight into Outreach: the last read paints, nothing is said.
await relaunch("#/leads");
const again = await opened();
console.log("relaunch:", JSON.stringify(again));
if (again.reading || !again.rows || again.ms > 1500) fail("a relaunch should open Outreach on the last read at once: " + JSON.stringify(again));
await settled();
const s1 = await stats();
if (s1.bookSync || s1.radarSync) fail("the relaunch forced a synchronous read: " + JSON.stringify(s1));
if (s1.priced > 20 || s1.read > 20) fail("the relaunch with the same lot read the book again: " + JSON.stringify(s1));

// The lot changed overnight, while the app was closed: the reads kept on
// the device are from another lot, so nothing in them can be reused — and
// still the last read paints while the new one is made behind it.
await p.evaluate(async () => { const c = await import("/js/cachedb.js"); for (const k of ["book", "radar"]) { const v = await c.cacheGet(k); await c.cacheSet(k, { ...v, key: k + ":another-lot" }); } });
await relaunch("#/leads");
const changed = await opened();
console.log("relaunch after the lot changed:", JSON.stringify(changed));
if (changed.reading || !changed.rows || changed.ms > 1500) fail("Outreach should open on the last read while the new one is made: " + JSON.stringify(changed));
await settled();
const s2 = await stats();
console.log("after the lot changed:", JSON.stringify(s2));
if (s2.bookSync || s2.radarSync) fail("the new read was forced synchronously: " + JSON.stringify(s2));
if (s2.priced < 1500 || s2.read < 1500) fail("the new lot didn't get the book read again in the background: " + JSON.stringify(s2));
// And it was kept, so the next open paints the new read with nothing to redo.
await p.waitForTimeout(2500);
await relaunch("#/");
await p.waitForFunction(() => document.querySelector("#view .card"), null, { timeout: 10000 });
const home = await p.evaluate(() => /Reading the book…/.test(document.querySelector("#view")?.textContent || ""));
if (home) fail("Home's queue said it was reading the book on a relaunch");
await settled();
const s3 = await stats();
console.log("the relaunch after:", JSON.stringify(s3));
if (s3.priced > 20 || s3.read > 20) fail("the read after the lot changed wasn't kept: " + JSON.stringify(s3));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nbookpaint.test.js FAILED" : "\nbookpaint.test.js passed");
})();
