// The import screen's "What this file gives you": the report drawn from the
// mapping as it stands, and redrawn when a column is fixed by hand.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], vehicles: [], settings: { salesperson: "Parm", cloudAutoSync: false } }));
  sessionStorage.setItem("import-type", "leads");
});
await p.goto(APP + "/#/import");
await p.waitForSelector("#imp-file", { state: "attached", timeout: 20000 });
// An equity export with the payment under an odd heading the matcher won't
// find, so the report starts without it and gains it when the column is set.
const rows = Array.from({ length: 12 }, (_, i) => `Owner ${i} Example,90255500${String(10 + i)},${420 + i},12000,16000,2021-03-0${(i % 9) + 1},2021 Nissan Rogue SV`);
const csv = "Customer,Cell,Mo Amt,Payoff,Value,Sale Date,Vehicle\n" + rows.join("\n");
await p.setInputFiles("#imp-file", { name: "book.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await p.waitForSelector("#imp-report", { timeout: 10000 }).catch(() => fail("the report should be on the mapping screen"));
await p.waitForTimeout(300);
const read = () => p.evaluate(() => ({
  head: document.querySelector("#imp-report .strong")?.textContent.trim(),
  rows: [...document.querySelectorAll("#imp-report .ir-row")].map((r) => `${r.querySelector(".ir-label").textContent.trim()} ${r.querySelector(".ir-dot").className.replace(/ir-dot\s*/, "")} ${r.querySelector(".ir-n").textContent.trim()}`),
  asks: [...document.querySelectorAll("#imp-report .ir-ask .small:not(.strong)")].map((n) => n.textContent.trim()),
  payment: document.querySelector('select[data-field="currentPayment"]')?.value,
}));
let r = await read();
console.log("before:", r.head, JSON.stringify(r.rows), JSON.stringify(r.asks), "payment col:", JSON.stringify(r.payment));
if (r.payment) fail("the odd heading shouldn't have matched the payment: " + r.payment);
if (!r.rows.some((x) => /^Same or cheaper payment ir-missing/.test(x))) fail("without the payment column the payment reason is missing: " + JSON.stringify(r.rows));
if (!r.rows.some((x) => /^Equity in the trade ir-good 100%/.test(x))) fail("payoff and value give equity on every row: " + JSON.stringify(r.rows));
if (!r.asks.some((a) => /current monthly payment/.test(a))) fail("the payment should be on the asks: " + JSON.stringify(r.asks));
await p.selectOption('select[data-field="currentPayment"]', "Mo Amt"); await p.waitForTimeout(200);
r = await read();
console.log("after fixing the column:", r.head, JSON.stringify(r.rows.filter((x) => /payment/.test(x))));
if (!r.rows.some((x) => /^Same or cheaper payment ir-good 100%/.test(x))) fail("setting the column should make the payment reason good: " + JSON.stringify(r.rows));
if (r.asks.some((a) => /current monthly payment/.test(a))) fail("and take it off the asks: " + JSON.stringify(r.asks));
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nimportscreen.test.js FAILED" : "\nimportscreen.test.js passed");
})();
