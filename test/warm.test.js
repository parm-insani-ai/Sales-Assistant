// "The app is laggy on open and doesn't respond right away."
//
// The lot grew from a handful of units to the store's whole website — 340
// vehicles — and the Deal Radar prices every customer against every one of
// them. Home deferred that by a tick, but it still ran as one synchronous
// job, so the screen was drawn and then stiff until it finished.
//
// The properties to hold: Home paints before the radar computes; while the
// radar warms, no single task holds the main thread long; identical units
// are priced once; and a relaunch with the same lot prices nobody again.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  if (!sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    const leads = [];
    for (let i = 0; i < 700; i++) leads.push({ id: "l" + i, name: "Customer " + i, phone: "902555" + String(1000 + i), stage: i % 7 === 0 ? "sold" : "working",
      vehicleInterest: ["2019 Nissan Rogue", "2020 Nissan Kicks", "2018 Honda Civic", "2021 Nissan Sentra"][i % 4],
      purchaseDate: "2021-0" + (i % 9 + 1) + "-11", currentPayment: 380 + (i % 300), payoff: 8000 + (i % 15000), currentValue: 14000 + (i % 9000), currentApr: 5.9 + (i % 4),
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" });
    const vehicles = [];
    const models = [["Rogue", "SV", "SUV"], ["Rogue", "SL", "SUV"], ["Kicks", "SR", "Hatchback"], ["Sentra", "SV", "Sedan"], ["Pathfinder", "SL", "SUV"], ["Frontier", "PRO-4X", "Truck"], ["Ariya", "SV+", "SUV"]];
    for (let i = 0; i < 340; i++) {
      const m = models[i % models.length]; const isNew = i % 3 !== 0;
      vehicles.push({ id: "v" + i, year: isNew ? 2026 : 2019 + (i % 6), make: "Nissan", model: m[0], trim: m[1], bodyStyle: m[2], condition: isNew ? "New" : "Used",
        // Many identical new units, as a real lot has.
        price: isNew ? 30000 + (i % models.length) * 4000 : 18000 + (i % 40) * 500, mileage: isNew ? 10 : 20000 + (i % 50) * 1500, stock: "N" + (10000 + i), status: "available", source: "web",
        createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" });
    }
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles, settings: { salesperson: "Parm", cloudAutoSync: false } }));
  }
  // Every task that held the main thread for 50ms or more, from the start.
  window.__long = [];
  try { new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] }); } catch {}
});

// --- Cold launch: Home paints at once, says the book is being read, then fills.
const t0 = Date.now();
await p.goto(APP + "/#/");
await p.waitForFunction(() => document.querySelector(".plays-slot") && /Reading the book|Today's queue/.test(document.querySelector(".plays-slot").textContent), null, { timeout: 8000 });
const firstPaint = Date.now() - t0;
const early = await p.evaluate(() => ({ slot: document.querySelector(".plays-slot")?.textContent.trim().slice(0, 40), leads: document.querySelectorAll(".row-title").length }));
console.log(`Home painted in ${firstPaint}ms:`, JSON.stringify(early));
if (!/Reading the book/.test(early.slot || "")) fail("Home didn't say it was reading the book while the radar warmed: " + early.slot);

// --- While it warms, a tap lands: switch to Inventory and back within a few frames.
const tapAt = Date.now();
await p.evaluate(() => { location.hash = "#/inventory"; });
await p.waitForFunction(() => location.hash === "#/inventory" && document.querySelectorAll(".veh-list .row-title").length > 0, null, { timeout: 4000 });
const tapMs = Date.now() - tapAt;
console.log(`a tap during the warm-up answered in ${tapMs}ms`);
if (tapMs > 1500) fail(`a tap during the warm-up took ${tapMs}ms`);
await p.evaluate(() => { location.hash = "#/"; });

// --- The radar finishes in the background; the queue fills; nothing held the thread long.
// Polled from the page's own world: a module imported from another world is
// another instance, with an empty radar of its own.
const untilCurrent = async () => { for (let i = 0; i < 240; i++) { if (await p.evaluate(async () => { const d = await import("/js/views/dealbuilder.js"); return d.radarCurrent() && !d.radarStats.warming; })) return; await p.waitForTimeout(250); } fail("the radar never became current"); };
await untilCurrent();
await p.waitForTimeout(300);
const after = await p.evaluate(async () => {
  const d = await import("/js/views/dealbuilder.js");
  return { stats: { ...d.radarStats }, slot: document.querySelector(".plays-slot")?.textContent.trim().slice(0, 60), long: window.__long.slice().sort((a, b) => b - a).slice(0, 5), rows: d.topOpportunities(5).length };
});
console.log("after the warm-up:", JSON.stringify(after));
// One warm run prices the book; Home then stamps today's prospects, and the
// catch-up for those few is the one synchronous run allowed.
if (after.stats.warmRuns !== 1 || after.stats.syncRuns > 1) fail("the radar didn't warm in the background, or something forced it synchronously: " + JSON.stringify(after.stats));
if (after.stats.priced < 700 || after.stats.priced > 720) fail("the book was priced more than once, or not at all: " + JSON.stringify(after.stats));
if (!/Today's queue/.test(after.slot || "") || /Reading the book/.test(after.slot || "")) fail("the queue didn't fill after the warm-up: " + after.slot);
if (after.long.length && after.long[0] > 400) fail(`a task held the main thread ${after.long[0]}ms during the warm-up: ${JSON.stringify(after.long)}`);
if (!after.rows) fail("the radar found nobody");

// --- Identical units are priced once: the memo makes the lot cheap.
const memo = await p.evaluate(async () => {
  const d = await import("/js/views/dealbuilder.js"); const s = await import("/js/store.js");
  const l = s.all("leads")[1];
  const t = performance.now(); const rows = d.dealsForLead(l); const ms = performance.now() - t;
  const units = new Set(rows.map((r) => r.vehicle.id)).size;
  return { ms: Math.round(ms), rows: rows.length, units };
});
console.log("one customer against the lot:", JSON.stringify(memo));
if (memo.units < 300) fail("the rows don't cover the lot: " + JSON.stringify(memo));

// --- Relaunch with the same lot: the remembered prices are reused, nobody is priced again.
await p.waitForTimeout(2000); // the remembered prices are written a moment after the warm-up
await p.reload();
await untilCurrent();
const again = await p.evaluate(async () => { const d = await import("/js/views/dealbuilder.js"); return { ...d.radarStats }; });
console.log("relaunch:", JSON.stringify(again));
if (again.priced > 20) fail(`a relaunch with the same lot priced ${again.priced} customers again`);
if (again.syncRuns > 1) fail("a relaunch forced a synchronous radar run");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nwarm.test.js FAILED" : "\nwarm.test.js passed");
})();
