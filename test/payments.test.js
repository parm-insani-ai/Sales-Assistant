// The Deal Calculator quotes the payment three ways — monthly, bi-weekly and
// weekly — because a used-car quote is said by the week or two weeks. The
// bi-weekly and weekly figures are the same loan amortized at that
// frequency (26 or 52 payments a year over the same months), which is what
// the lender bills: a shade under the monthly figure split, never over.
// A lease, priced by the month, just splits the year's payments.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  sessionStorage.setItem("calc-method", "finance");
});
await p.goto(`${APP}/#/calculator`, { waitUntil: "networkidle" });
await p.waitForSelector("#c-price");

const money = (s) => Number(String(s).replace(/[^0-9.]/g, ""));
async function quote(fields) {
  for (const [k, v] of Object.entries(fields)) await p.fill(`#c-${k}`, String(v));
  await p.waitForTimeout(50);
  return p.evaluate(() => ({
    monthly: document.querySelector("#c-result .kv-total .mono")?.textContent,
    biweekly: document.querySelector("[data-biweekly]")?.textContent,
    weekly: document.querySelector("[data-weekly]")?.textContent,
  }));
}

// --- 0%: the loan simply divides — $26,000 over 72 months is 156 bi-weekly or 312 weekly payments.
const zero = await quote({ price: 26000, down: 0, trade: 0, payoff: 0, feestax: 0, tax: 0, apr: 0, term: 72 });
console.log("0% over 72:", JSON.stringify(zero));
if (Math.abs(money(zero.monthly) - 361.11) > 0.01) fail("monthly at 0% should be 26000/72: " + zero.monthly);
if (Math.abs(money(zero.biweekly) - 166.67) > 0.01) fail("bi-weekly at 0% should be 26000/156: " + zero.biweekly);
if (Math.abs(money(zero.weekly) - 83.33) > 0.01) fail("weekly at 0% should be 26000/312: " + zero.weekly);
if (!/\/2 wk/.test(zero.biweekly) || !/\/wk/.test(zero.weekly)) fail("each row should say its period: " + JSON.stringify(zero));

// --- With interest: amortized at the frequency, so a touch under the monthly split, and the module agrees with the page.
const used = await quote({ price: 18500, down: 1000, trade: 0, payoff: 0, feestax: 499, tax: 15, apr: 8.99, term: 84 });
console.log("used car, 8.99% over 84:", JSON.stringify(used));
const m = money(used.monthly), bw = money(used.biweekly), wk = money(used.weekly);
if (!(bw < m * 12 / 26 && bw > m * 12 / 26 * 0.985)) fail("bi-weekly should sit just under half the monthly: " + JSON.stringify(used));
if (!(wk < m * 12 / 52 && wk > m * 12 / 52 * 0.985)) fail("weekly should sit just under a quarter of the monthly: " + JSON.stringify(used));
const calc = await p.evaluate(async () => {
  const c = await import("/js/views/calculator.js");
  const d = c.computeDeal({ price: 18500, down: 1000, feesTaxable: 499, taxRate: 15, apr: 8.99, term: 84 });
  const l = c.computeLease({ price: 32000, term: 48, residualPct: 50, taxRate: 15, apr: 4.9 });
  return { biweekly: d.biweekly, weekly: d.weekly, monthly: d.monthly, lease: l };
});
if (Math.abs(calc.biweekly - bw) > 0.01 || Math.abs(calc.weekly - wk) > 0.01) fail("the page should show the module's figures: " + JSON.stringify({ calc, used }));
// The bi-weekly schedule costs the same loan less in total: fewer dollars of interest.
if (!(calc.biweekly * 182 < calc.monthly * 84)) fail("paying bi-weekly should cost less over the term than monthly");
if (Math.abs(calc.lease.biweekly - calc.lease.monthly * 12 / 26) > 0.01 || Math.abs(calc.lease.weekly - calc.lease.monthly * 12 / 52) > 0.01) fail("a lease splits the year's payments 26 or 52 ways: " + JSON.stringify(calc.lease));

// --- Lease mode shows the same two rows under its payment.
await p.click('[data-method="lease"]');
await p.waitForSelector("#c-res");
const lease = await quote({ price: 32000, down: 0, trade: 0, payoff: 0, feestax: 0, tax: 15, apr: 4.9, term: 48, res: 50 });
console.log("lease:", JSON.stringify(lease));
if (!lease.biweekly || !lease.weekly || !(money(lease.biweekly) < money(lease.monthly))) fail("the lease should also quote bi-weekly and weekly: " + JSON.stringify(lease));

// --- The assistant's payment tool hands all three back.
const tool = await p.evaluate(async () => {
  const a = await import("/js/agent.js");
  const r = await a.execTool("payment_quote", { price: 26000, apr: 0, term: 72, fees: 0, taxRate: 0 });
  return r && r.result;
});
console.log("tool:", JSON.stringify(tool));
if (!tool || !(tool.biweekly === 167 && tool.weekly === 83)) fail("the assistant's quote should include bi-weekly and weekly: " + JSON.stringify(tool));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "payments.test.js FAILED" : "payments: ok");
})();
