// A list, said: the mic at the head of the Cut row. One sentence lights the
// chips, the cuts, the sheet and the order; the sheet reads it back with
// the count; Show them keeps it, a spoken name saves it, Cancel puts the
// screen back. Typing works the same, and what wasn't understood is named.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import" };
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2021 Nissan Kicks SR", "2016 Nissan Pathfinder SL", "2022 Nissan Frontier PRO-4X"];
  const leads = [];
  for (let i = 0; i < 40; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 6],
    currentPayment: 380 + i * 5, payoff: 12000 + i * 100, currentValue: i % 2 === 0 ? 20000 + i * 100 : 11000, currentApr: i % 5 === 0 ? 11.9 : 5.9, currentTerm: 84,
    purchaseDate: i % 3 === 0 ? "2020-03-10" : "2024-03-10", ...x });
  leads.push({ id: "nn1", name: "Nonum One", vehicleInterest: models[0], currentPayment: 400, payoff: 9000, currentValue: 16000, purchaseDate: "2021-01-01", ...x });
  leads.push({ id: "nn2", name: "Nonum Two", vehicleInterest: models[1], currentPayment: 420, payoff: 9000, currentValue: 16000, purchaseDate: "2021-01-01", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [
    { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x },
  ], settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 10, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72 } }));
  // A speech engine that says whatever the test put in window.__say.
  function Fake() {
    this.start = () => { setTimeout(() => { const said = window.__say || ""; if (said) { const r = [{ transcript: said, confidence: 0.9 }]; r.isFinal = true; this.onresult && this.onresult({ resultIndex: 0, results: [r] }); } this.onend && this.onend(); }, 60); };
    this.stop = () => {}; this.abort = () => {};
  }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".today-block", { timeout: 30000 }).catch(() => fail("Best now didn't open on today's batch"));
await p.waitForTimeout(600);

const state = () => p.evaluate(() => ({
  modal: !!document.querySelector(".modal"),
  n: document.querySelector(".modal .vl-n")?.textContent.trim(),
  on: document.querySelector(".modal .vl-on")?.textContent.trim(),
  label: document.querySelector(".modal .vl-label")?.textContent.trim(),
  miss: (() => { const m = document.querySelector(".modal .vl-miss"); return m && !m.hidden ? m.textContent.trim() : ""; })(),
  name: document.querySelector('.modal [data-f="name"]')?.value,
  lit: [...document.querySelectorAll(".cut-row .cut-chip.btn-primary")].map((c) => c.dataset.cut || ("list:" + (c.dataset.list ? c.textContent.trim() : "")) ),
  sort: document.querySelector('[data-act="sort"]')?.dataset.sort,
  chip: document.querySelector(".lead-seg-btn.btn-primary")?.dataset.filter,
  bar: document.querySelector(".cut-bar .aud-count")?.textContent.trim(),
  barLabel: document.querySelector(".cut-bar .small")?.textContent.replace(/\s+/g, " ").trim(),
  toast: document.querySelector(".toast")?.textContent.trim(),
}));
const say = async (words) => { await p.evaluate((w) => { window.__say = w; }, words); await p.click('[data-act="say-list"]'); await p.waitForFunction(() => { const r = document.querySelector(".modal .vl-result"); return r && !r.hidden; }, null, { timeout: 8000 }).catch(() => fail("the sheet didn't read it back: " + words)); await p.waitForTimeout(150); };

// --- Said: a model, a reason and an order.
await say("Rogue owners with equity, highest rate first");
let s = await state();
console.log("heard:", JSON.stringify(s));
if (!s.lit.includes("model:rogue") || !s.lit.includes("equity")) fail("Rogue and Equity should be lit on the row: " + JSON.stringify(s.lit));
if (s.sort !== "rate") fail("the order should be highest rate: " + s.sort);
if (!/^\d+$/.test(s.n || "") || Number(s.n) < 1) fail("the read-back should count them: " + s.n);
if (!/Rogue/.test(s.label) || !/Equity/.test(s.label)) fail("the read-back should say what it lit: " + s.label);
if (!/on Best now/.test(s.on) || !/Highest rate/.test(s.on)) fail("the read-back should say the chip and the order: " + s.on);
if (s.name !== s.label) fail("the name starts as the label: " + s.name);
const n1 = Number(s.n);
await p.click('.modal [data-act="show"]'); await p.waitForTimeout(250);
s = await state();
if (s.modal) fail("Show them should close the sheet");
if (Number(s.bar) !== n1 || !/Rogue · Equity/.test(s.barLabel)) fail("the cut bar should carry the same count and words: " + JSON.stringify(s));

// --- Said with a name: saved as a list chip at once.
await p.evaluate(() => { window.__say = "quiet ones without a phone number, call it Dead ends"; });
await p.click('[data-act="say-list"]');
await p.waitForFunction(() => !document.querySelector(".modal") && [...document.querySelectorAll(".cut-chip.cut-list")].some((c) => /Dead ends/.test(c.textContent)), null, { timeout: 8000 }).catch(() => fail("a spoken name should save the list and close the sheet"));
s = await state();
console.log("saved:", JSON.stringify({ lit: s.lit, bar: s.bar, barLabel: s.barLabel }));
if (!s.lit.some((x) => /Dead ends/.test(x)) || !s.lit.includes("quiet") || !s.lit.includes("nonumber")) fail("the saved list should be lit with its cuts: " + JSON.stringify(s.lit));
if (!/Dead ends/.test(s.barLabel || "")) fail("the bar should name the list: " + s.barLabel);
if (s.sort !== "best") fail("a sentence with no order resets to best first, the row's default");

// --- Cancel puts the screen back as it was.
await say("Sentra owners");
s = await state();
if (!s.lit.includes("model:sentra")) fail("Sentra should light while the sheet is up: " + JSON.stringify(s.lit));
await p.click('.modal [data-act="cancel"]'); await p.waitForTimeout(250);
s = await state();
if (s.modal || !s.lit.some((x) => /Dead ends/.test(x)) || s.lit.includes("model:sentra")) fail("Cancel should restore the saved list: " + JSON.stringify(s.lit));

// --- Typed instead, with a word it can't read: the rest applies, the word is named.
await p.evaluate(() => { window.__say = ""; });
await p.click('[data-act="say-list"]'); await p.waitForSelector(".modal textarea", { timeout: 5000 });
await p.fill(".modal textarea", "everyone with a blue Frontier I haven't contacted");
await p.keyboard.press("Enter");
await p.waitForFunction(() => { const r = document.querySelector(".modal .vl-result"); return r && !r.hidden; }, null, { timeout: 8000 }).catch(() => fail("typing and Enter should read it"));
s = await state();
console.log("typed:", JSON.stringify({ lit: s.lit, miss: s.miss, chip: s.chip, n: s.n }));
if (!s.lit.includes("model:frontier") || s.chip !== "tocontact") fail("Frontier on Best now: " + JSON.stringify(s));
if (!/Didn't understand "blue"/.test(s.miss)) fail("the word it couldn't read is named: " + s.miss);
// Save with the name typed.
await p.fill('.modal [data-f="name"]', "Blue Frontiers");
await p.click('.modal [data-act="save"]'); await p.waitForTimeout(300);
s = await state();
if (s.modal || !s.lit.some((x) => /Blue Frontiers/.test(x))) fail("Save as list should keep it under the typed name: " + JSON.stringify(s.lit));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nvoicelist.test.js FAILED" : "\nvoicelist.test.js passed");
})();
