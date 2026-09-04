// The rate sheet editor. The matching engine is only as honest as this screen,
// so the two things that matter are: the numbers a user types actually reach
// the matcher, and a lender still carrying placeholder rates says so — out
// loud, everywhere it's shown. A placeholder quoted as if it were the store's
// own sheet is worse than no rate at all.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  colorScheme: "dark", serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    settings: { salesperson: "Parm", cloudAutoSync: false, taxRate: 14, docFee: 699, defaultApr: 5.99 },
  }));
});
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.goto(APP + "/#/settings");
await p.waitForTimeout(800);

const sheet = () => p.$eval("#lenders-slot", (n) => n.textContent.replace(/\s+/g, " ").trim());
let t = await sheet();
console.log("Rate sheet on first open:\n  " + t.slice(0, 240));
if (!/starting numbers, not yours/i.test(t))
  fail("a fresh sheet of placeholder rates doesn't announce itself as placeholders");
const seededBefore = await p.$$eval("#lenders-slot .badge", (n) => n.length);
if (seededBefore < 5) fail("seeded lenders aren't individually flagged");

// --- Edit the captive: a real rate and a real advance cap.
await p.click('#lenders-slot [data-edit]');
await p.waitForTimeout(400);
await p.fill("#f_tier1", "4.49");
await p.fill("#f_maxAdvance", "145");
await p.click('form button[type="submit"]');
await p.waitForTimeout(500);

t = await sheet();
console.log("\nAfter editing the first lender:\n  " + t.slice(0, 240));
if (!/T1 4\.49%/.test(t)) fail("the edited rate isn't shown on the sheet");
if (!/145% advance/.test(t)) fail("the edited advance cap isn't shown on the sheet");
const seededAfter = await p.$$eval("#lenders-slot .badge", (n) => n.length);
if (seededAfter !== seededBefore - 1)
  fail("an edited lender still claims to be carrying starting numbers");

// --- And the edit has to actually reach the matcher, not just the list.
const apr = await p.evaluate(async () => {
  const m = await import("/js/lenders.js");
  const r = m.matchLenders({ amountFinanced: 38000, value: 42000, term: 60, tier: "1" });
  return r.best ? { name: r.best.name, apr: r.best.apr } : null;
});
console.log(`\nMatcher now prices Tier 1 at ${apr.apr}% (${apr.name})`);
if (apr.apr !== 4.49) fail("the matcher is still using the seeded rate after the sheet was edited");

// --- Turning a lender off has to remove it from matching entirely.
await p.click('#lenders-slot [data-edit]');
await p.waitForTimeout(400);
await p.selectOption("#f_active", "no");
await p.click('form button[type="submit"]');
await p.waitForTimeout(500);
const after = await p.evaluate(async () => {
  const m = await import("/js/lenders.js");
  return m.matchLenders({ amountFinanced: 38000, value: 42000, term: 60, tier: "1" }).approved.map((x) => x.name);
});
console.log("Approved after switching that lender off: " + after.join(", "));
if (after.includes(apr.name)) fail("a lender switched off is still being offered as a buyer");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nratesheet.test.js FAILED" : "\nratesheet.test.js passed");
})();
