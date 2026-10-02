// Best now's reason groups survive a relaunch on a read of the book saved by
// an older version. The app keeps its read of the book on the phone between
// launches; a read saved before the reason category existed was reused as
// is, and put the whole book under "Worth a look". Both ways in are tested:
// an older saved read (no version) is redone, and a read that somehow lacks
// the category is worked out from the reasons on the card.
const { launch } = require("./browser.js");
(async () => {
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const b = await launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.addInitScript(() => {
  if (localStorage.getItem("sales-assistant:v1")) return;
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2017 Nissan Micra SV", "2021 Nissan Kicks SR", "2016 Nissan Pathfinder"];
  const leads = [];
  for (let i = 0; i < 60; i++) leads.push({ id: "o" + i, name: "Owner " + i, phone: "90255" + String(10000 + i), stage: "delivered", source: "Import", vehicleInterest: models[i % 6], currentPayment: i % 3 ? 380 + i * 4 : null, paymentsLeft: i % 4 ? 6 + i : null, purchaseDate: "2020-0" + (1 + i % 9) + "-15", currentValue: i % 4 === 1 ? 18000 + i * 100 : null, payoff: i % 4 === 1 ? 6000 : null, ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Parm", cloudAutoSync: false } }));
});
const groups = () => p.evaluate(() => [...document.querySelectorAll(".lead-group[data-why]")].map((h) => h.textContent.replace(/\s+/g, " ").trim()).join(" | "));
await p.goto("http://127.0.0.1:8137/#/leads"); await p.waitForSelector(".lead-list .card-tap", { timeout: 20000 }); await p.waitForTimeout(2500);
const first = await groups();
console.log("first launch:", first);
if (!/Same payment or less/.test(first) || /Worth a look · 60/.test(first)) fail("the first launch should group by reason: " + first);
for (const [label, strip] of [["an older version's saved read", (saved) => { delete saved.v; }], ["a saved read without categories", () => {}]]) {
  await p.evaluate(async (dropVersion) => {
    const c = await import("/js/cachedb.js");
    const saved = await c.cacheGet("book");
    saved.per.forEach((row) => { if (row[2]) delete row[2].cat; });
    if (dropVersion) delete saved.v;
    await c.cacheSet("book", saved);
  }, label.startsWith("an older"));
  await p.reload(); await p.waitForSelector(".lead-list .card-tap", { timeout: 20000 }); await p.waitForTimeout(2500);
  const again = await groups();
  console.log(`relaunch on ${label}:`, again);
  if (again !== first) fail(`a relaunch on ${label} should group the same as a fresh read: ${again}`);
}
await b.close();
console.log(process.exitCode ? "\nwhygroups.test.js FAILED" : "\nwhygroups.test.js passed");
})();
