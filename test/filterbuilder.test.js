// The filter on any field, built by hand: opened from the sheet, every
// field on offer in groups, an operator per type, the count as it's built,
// all or any, an order; Apply lands it as the question chip on All; the
// chip's tap clears it; a saved list keeps it.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message + " @ " + String(e.stack || "").split("\n").slice(1, 3).join(" | ")));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import" };
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2021 Honda Civic LX"];
  const leads = [];
  for (let i = 0; i < 20; i++) leads.push({ id: "o" + String(i).padStart(2, "0"), name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 4],
    currentPayment: 300 + i * 20, payoff: 10000 + i * 500, currentValue: 18000 + i * 300, currentApr: i % 2 ? 8.9 : 4.9, purchaseDate: i < 10 ? "2020-03-10" : "2023-06-01", dob: i % 5 === 0 ? "1980-11-20" : "", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x, status: "available" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, dailyProspects: 6, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 150 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".cut-row", { timeout: 30000 }).catch(() => fail("Outreach didn't open"));
await p.click('[data-filter="tocontact"]'); await p.waitForTimeout(400);

// The sheet offers Any field; it opens the builder with one empty condition and every field in groups.
await p.click('.cut-line > [data-act="audience"]'); await p.waitForSelector('.modal [data-act="any-field"]', { timeout: 5000 }).catch(() => fail("the sheet should offer Any field"));
await p.click('.modal [data-act="any-field"]'); await p.waitForSelector(".modal .fb", { timeout: 5000 }).catch(() => fail("the builder didn't open"));
let s = await p.evaluate(() => ({ rows: document.querySelectorAll(".modal .fb-row").length, groups: [...document.querySelectorAll(".modal .fb-field optgroup")].map((g) => g.label), fields: document.querySelectorAll(".modal .fb-field option").length, apply: document.querySelector('.modal [data-act="apply"]').disabled }));
console.log("builder:", JSON.stringify({ rows: s.rows, groups: s.groups, fields: s.fields, apply: s.apply }));
if (s.rows !== 1 || s.fields < 55 || !s.groups.includes("Their deal") || !s.groups.includes("Conversations") || !s.apply) fail("one empty row, every field in groups, Apply off until a value: " + JSON.stringify(s));

// Payment over 500: the count follows the typing.
await p.selectOption(".modal .fb-field", "currentPayment");
await p.selectOption(".modal .fb-op", "gt");
await p.fill('.modal .fb-val[data-k="value"]', "500"); await p.waitForTimeout(300);
s = await p.evaluate(() => ({ count: document.querySelector(".modal .fb-count")?.textContent.replace(/\s+/g, " ").trim(), apply: document.querySelector('.modal [data-act="apply"]').disabled }));
console.log("one:", JSON.stringify(s));
if (!/^9 customers match · payment over \$500/.test(s.count) || s.apply) fail("payment over 500 is nine, said as it's typed: " + JSON.stringify(s));

// Add: rate under 6 (so the pair is AND), then switch to Any and back.
await p.click('.modal [data-act="add"]'); await p.waitForTimeout(150);
await p.selectOption('.modal .fb-row[data-i="1"] .fb-field', "currentApr");
await p.selectOption('.modal .fb-row[data-i="1"] .fb-op', "lt");
await p.fill('.modal .fb-row[data-i="1"] .fb-val[data-k="value"]', "6"); await p.waitForTimeout(300);
s = await p.evaluate(() => document.querySelector(".modal .fb-count")?.textContent.replace(/\s+/g, " ").trim());
if (!/^4 customers match · payment over \$500 · rate under 6%/.test(s)) fail("both conditions, all of them: " + s);
await p.click('.modal [data-any="1"]'); await p.waitForTimeout(300);
s = await p.evaluate(() => document.querySelector(".modal .fb-count")?.textContent.replace(/\s+/g, " ").trim());
if (!/^15 customers match · payment over \$500 or rate under 6%/.test(s)) fail("any of them: " + s);
await p.click('.modal [data-any="0"]'); await p.waitForTimeout(200);

// A date operator with its own input: bought more than 1000 days ago. And a birthday month.
await p.click('.modal [data-act="add"]'); await p.waitForTimeout(150);
await p.selectOption('.modal .fb-row[data-i="2"] .fb-field', "purchaseDate");
await p.selectOption('.modal .fb-row[data-i="2"] .fb-op', "olderThanDays");
await p.fill('.modal .fb-row[data-i="2"] .fb-val[data-k="value"]', "1000"); await p.waitForTimeout(300);
s = await p.evaluate(() => document.querySelector(".modal .fb-count")?.textContent.replace(/\s+/g, " ").trim());
console.log("three:", s);
if (!/^\d+ customers? match · payment over \$500 · rate under 6% · purchase date over 1000 days ago/.test(s)) fail("a date condition reads right: " + s);
await p.evaluate(() => document.querySelector('.modal .fb-row[data-i="2"] .fb-del').click()); await p.waitForTimeout(200);
await p.click('.modal [data-act="add"]'); await p.waitForTimeout(150);
await p.selectOption('.modal .fb-row[data-i="2"] .fb-field', "birthMonth");
await p.selectOption('.modal .fb-row[data-i="2"] .fb-op', "is");
await p.fill('.modal .fb-row[data-i="2"] .fb-val[data-k="value"]', "11"); await p.waitForTimeout(300);
s = await p.evaluate(() => document.querySelector(".modal .fb-count")?.textContent.replace(/\s+/g, " ").trim());
if (!/birthday month exactly 11|birthday month 11/.test(s)) fail("a number field's exact match: " + s);
await p.evaluate(() => document.querySelector('.modal .fb-row[data-i="2"] .fb-del').click()); await p.waitForTimeout(200);

// Order by equity, highest first. Apply: the chip lands on All, lit, the bar counts four.
await p.selectOption(".modal .fb-sort", "equity"); await p.waitForTimeout(200);
await p.click('.modal [data-act="apply"]'); await p.waitForTimeout(600);
s = await p.evaluate(() => ({ chip: document.querySelector('[data-filter].btn-primary')?.dataset.filter, q: document.querySelector('.cut-row [data-act="query-chip"]')?.textContent.trim(), bar: document.querySelector(".cut-bar .aud-count")?.textContent, cards: [...document.querySelectorAll(".lead-list .card[data-lead-id]")].map((c) => c.dataset.leadId) }));
console.log("applied:", JSON.stringify(s));
if (s.chip !== "all" || !/payment over \$500 · rate under 6%, by equity/.test(s.q || "") || Number(s.bar) !== 4 || s.cards.length !== 4) fail("Apply lands as the question chip on All with the four: " + JSON.stringify(s));
if (s.cards[0] !== "o12" || s.cards[3] !== "o18") fail("highest equity first (equity falls as the payoff climbs faster than the value): " + JSON.stringify(s.cards));

// Save it as a list, then the chip's tap clears the question; the saved list brings it back.
await p.click('[data-act="list-save"]'); await p.waitForSelector('.modal [name="name"]', { timeout: 5000 });
await p.fill('.modal [name="name"]', "Cheap rate, big payment");
await p.click('.modal button[type="submit"]'); await p.waitForTimeout(400);
await p.click('.cut-bar [data-act="aud-clear"]'); await p.waitForTimeout(300);
s = await p.evaluate(() => ({ q: !!document.querySelector('.cut-row [data-act="query-chip"]'), list: document.querySelector(".cut-chip.cut-list")?.textContent.trim() }));
if (s.q || s.list !== "Cheap rate, big payment") fail("cleared, with the list saved: " + JSON.stringify(s));
await p.click(".cut-chip.cut-list"); await p.waitForTimeout(500);
s = await p.evaluate(() => ({ bar: document.querySelector(".cut-bar .aud-count")?.textContent, n: document.querySelectorAll(".lead-list .card[data-lead-id]").length }));
if (Number(s.bar) !== 4 || s.n !== 4) fail("the saved list brings the filter back: " + JSON.stringify(s));

// Re-open the builder from the sheet: prefilled with the two conditions.
await p.click('.cut-line > [data-act="audience"]'); await p.waitForSelector('.modal [data-act="any-field"]', { timeout: 5000 });
await p.click('.modal [data-act="any-field"]'); await p.waitForSelector(".modal .fb", { timeout: 5000 });
s = await p.evaluate(() => ({ rows: [...document.querySelectorAll(".modal .fb-row")].map((r) => [r.querySelector(".fb-field").value, r.querySelector(".fb-op").value, r.querySelector(".fb-val")?.value]) }));
if (JSON.stringify(s.rows) !== JSON.stringify([["currentPayment", "gt", "500"], ["currentApr", "lt", "6"]])) fail("the builder reopens on what's applied: " + JSON.stringify(s));
await p.click('.modal [data-act="clear"]'); await p.waitForTimeout(300);
s = await p.evaluate(() => ({ q: !!document.querySelector('.cut-row [data-act="query-chip"]'), n: document.querySelectorAll(".lead-list .card[data-lead-id]").length }));
if (s.q || s.n < 20) fail("Clear takes the filter off: " + JSON.stringify(s));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nfilterbuilder.test.js FAILED" : "\nfilterbuilder.test.js passed");
})();
