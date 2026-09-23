// On a customer's page: the replacement options with their payments, and a
// picker to add any vehicle from the lot or the lineup with one tap.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "inf", name: "Iris Infiniti", phone: "9025551111", stage: "working", vehicleInterest: "2019 INFINITI QX60 LUXE AWD", currentPayment: 720, payoff: 9000, currentValue: 24000, purchaseDate: "2019-06-01", currentTerm: 84, ...x }],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Kicks", trim: "SR", price: 32698, condition: "New", stock: "N1", status: "available", source: "web", ...x },
      { id: "v2", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38848, condition: "New", stock: "N2", status: "available", source: "web", ...x },
      { id: "v4", year: 2026, make: "Nissan", model: "Murano", trim: "SL", price: 62498, condition: "New", stock: "N4", status: "available", source: "web", ...x },
      { id: "v5", year: 2026, make: "Nissan", model: "Pathfinder", trim: "Platinum", price: 63398, condition: "New", stock: "N5", status: "available", source: "web", ...x },
      { id: "v6", year: 2023, make: "Infiniti", model: "QX60", trim: "Luxe", price: 52990, mileage: 31000, color: "Black", condition: "Used", stock: "NHP1", status: "available", source: "web", ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 84, dealMatchBand: 150 },
  }));
});
await p.goto(APP + "/#/leads/inf");
await p.waitForFunction(() => document.querySelector(".ro-list"), null, { timeout: 20000 });
const read = () => p.evaluate(() => [...document.querySelectorAll(".ro-row")].map((r) => ({ title: r.querySelector(".row-title").textContent.replace(/\s+/g, " ").trim(), mo: r.querySelector(".row-meta .strong").textContent.trim(), picked: !!r.querySelector("[data-unpick]") })));
let rows = await read();
console.log("options:", JSON.stringify(rows));
if (rows.length < 3) fail("fewer than three options shown");
if (!/QX60|Pathfinder|Murano/.test(rows[0].title) || !/best fit/.test(rows[0].title)) fail("the first option isn't the best fit: " + JSON.stringify(rows[0]));
if (!rows.every((r) => /^\$[\d,]+\/mo$/.test(r.mo))) fail("an option has no payment: " + JSON.stringify(rows));
if (rows.some((r) => /Kicks/.test(r.title))) fail("a Kicks is suggested to an Infiniti owner");

// --- Pick a vehicle: search, tap, and it's on the list with its payment.
await p.click('[data-act="pick-vehicle"]');
await p.waitForFunction(() => document.querySelector(".vp-list .vp-row"), null, { timeout: 5000 });
const before = await p.evaluate(() => document.querySelectorAll(".vp-list .vp-row").length);
await p.fill(".modal input[type=search]", "kicks");
await p.waitForTimeout(250);
const found = await p.evaluate(() => [...document.querySelectorAll(".vp-list .vp-row")].map((r) => r.querySelector(".row-title").textContent.trim() + " " + r.querySelector(".row-meta .strong").textContent.trim()));
console.log("picker:", before, "rows; searched →", JSON.stringify(found));
if (before < 5 || found.length !== 1 || !/Kicks SR \$\d/.test(found[0])) fail("the picker didn't search the lot: " + JSON.stringify(found));
await p.click(".vp-list .vp-row");
await p.waitForTimeout(400);
rows = await read();
console.log("after the pick:", JSON.stringify(rows));
if (!rows[0].picked || !/Kicks SR/.test(rows[0].title) || !/picked/.test(rows[0].title)) fail("the picked vehicle isn't first and marked: " + JSON.stringify(rows[0]));
const saved = await p.evaluate(async () => { const s = await import("/js/store.js"); return s.get("leads", "inf").shortlist; });
if (!saved || saved[0] !== "v1") fail("the shortlist isn't saved on the customer: " + JSON.stringify(saved));

// --- It survives a reload; removing it works.
await p.reload();
await p.waitForFunction(() => document.querySelector(".ro-list"), null, { timeout: 20000 });
rows = await read();
if (!rows[0].picked || !/Kicks/.test(rows[0].title)) fail("the pick didn't survive a reload: " + JSON.stringify(rows));
await p.click(".ro-row [data-unpick]");
await p.waitForTimeout(300);
rows = await read();
if (rows.some((r) => r.picked)) fail("the pick wasn't removed: " + JSON.stringify(rows));

// --- Tapping an option opens the full breakdown.
await p.click(".ro-row");
await p.waitForTimeout(400);
const modal = await p.evaluate(() => document.querySelector(".modal")?.textContent.replace(/\s+/g, " ").slice(0, 120));
console.log("breakdown:", modal);
if (!modal || !/\/mo|Monthly|payment/i.test(modal)) fail("tapping an option didn't open the breakdown");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nreplace.test.js FAILED" : "\nreplace.test.js passed");
})();
