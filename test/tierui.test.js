// The calculator has to tell the truth about the payment. Left alone it quotes
// whatever APR is typed in, which is the program rate, which only Tier 1 gets.
// This drives the real screen: pick a tier, and the panel must name the real
// payment, the lender behind it, and — when nobody will buy the structure — the
// down payment that changes the answer.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  colorScheme: "dark", serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false,
      taxRate: 14, docFee: 699, defaultApr: 5.99, defaultTerm: 72 },
  }));
});
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const panel = () => p.$eval("#c-lenders", (n) => n.textContent.replace(/\s+/g, " ").trim());
const quoted = () => p.$eval("#c-result .kv-total .mono", (n) => n.textContent.trim());

await p.goto(APP + "/#/calculator");
await p.waitForTimeout(700);

// A normal deal: $34k car, $3k down, no trade.
await p.fill("#c-price", "34000");
await p.fill("#c-down", "3000");
await p.waitForTimeout(250);
console.log("Quoted at the program rate:", await quoted());

// Before a tier is picked, the panel must say the quote above is Tier 1 money
// rather than silently implying everyone gets it.
let t = await panel();
if (!/Tier 1 money/i.test(t)) fail("with no tier picked, the panel doesn't warn the quote is prime pricing");

// --- Tier 5: the payment is not the payment.
await p.click('#c-lenders [data-tier="5"]');
await p.waitForTimeout(250);
t = await panel();
console.log("\nTier 5 panel:\n  " + t.slice(0, 320));
const real = await p.$eval("#c-lenders .kv-total .mono", (n) => n.textContent.trim());
const num = (s2) => Number(String(s2).replace(/[^0-9.]/g, ""));
if (!(num(real) > num(await quoted())))
  fail("a Tier 5 customer is being shown the same payment as a Tier 1 customer");
if (!/iA Auto Finance|Rifco|Eden Park/.test(t)) fail("the panel doesn't name which lender is behind the payment");
if (!/Won't look at Tier 5|One change away/i.test(t))
  fail("the panel doesn't say which lenders are out and why");
console.log(`  program ${await quoted()} → real ${real}`);

// "Use this rate" has to move the quote above, not just describe it.
await p.click('#c-lenders [data-act="userate"]');
await p.waitForTimeout(250);
if (num(await quoted()) !== num(real))
  fail('"Use this rate" did not re-quote the deal at the lender\'s rate');
console.log("  after Use this rate, the quote above reads " + (await quoted()));

// --- A structure nobody will advance against: tiny down, big negative equity.
await p.fill("#c-price", "34000");
await p.fill("#c-down", "0");
await p.fill("#c-trade", "6000");
await p.fill("#c-payoff", "19000");
await p.waitForTimeout(300);
t = await panel();
console.log("\n$13k upside down on a $34k car, Tier 5:\n  " + t.slice(0, 340));
if (!/Nobody buys this yet/i.test(t) && !/down brings it inside/i.test(t))
  fail("a wildly over-advanced structure is reported as buyable with no caveat");
if (!/down brings it inside/i.test(t))
  fail("the panel doesn't name the down payment that would fix the advance");
const ltv = (t.match(/Loan to value\s*(\d+)%/) || [])[1];
if (!ltv || Number(ltv) < 120) fail("LTV is not being reported on a clearly over-advanced deal");
console.log(`  LTV reported as ${ltv}%`);

// The seeded sheet must announce itself — a rate nobody entered should never
// look like the store's own rate sheet.
if (!/starting numbers, not your store/i.test(t))
  fail("placeholder rates are being presented as if they were the store's own");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ntierui.test.js FAILED" : "\ntierui.test.js passed");
})();
