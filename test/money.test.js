// The numbers a salesperson says out loud.
//
// Everything else in this app is a convenience. This is the part that gets
// quoted to a customer at a desk, and a payment that is wrong — or right for
// the wrong reason — costs credibility that doesn't come back. It was also the
// only major area with no tests at all.
//
// Every expected value here is worked out by hand in the comment above it, not
// copied from what the code currently returns. A test that records the current
// answer isn't a test, it's a signature on whatever the bug is.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const near = (got, want, tol, what) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "ok  " : "BAD "} ${what}: ${Math.round(got * 100) / 100} (expected ${want})`);
  if (!ok) fail(`${what}: got ${got}, expected ${want}`);
};

await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [], vehicles: [],
    settings: { salesperson: "Parm", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72 },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(600);

const deal = (input) => p.evaluate(async (i) => {
  const m = await import("/js/views/calculator.js");
  return m.computeDeal(i);
}, input);
const lease = (input) => p.evaluate(async (i) => {
  const m = await import("/js/views/calculator.js");
  return m.computeLease(i);
}, input);

// ---------------------------------------------------------------- finance
console.log("finance:");

// $30,000 over 60 months at 0%. Nothing else. 30000/60 = 500.00
{
  const d = await deal({ price: 30000, term: 60, apr: 0, taxRate: 0 });
  near(d.monthly, 500, 0.01, "$30k / 60mo / 0%");
  near(d.amountFinanced, 30000, 0.01, "  amount financed");
  near(d.totalInterest, 0, 0.01, "  interest at 0%");
}

// $30,000 over 60 months at 6%. Standard amortisation:
//   r = 0.06/12 = 0.005;  1.005^60 = 1.3488502
//   monthly = 30000(0.005) / (1 - 1/1.3488502) = 150 / 0.2586279 = 579.98
{
  const d = await deal({ price: 30000, term: 60, apr: 6, taxRate: 0 });
  near(d.monthly, 579.98, 0.02, "$30k / 60mo / 6%");
  // Total interest = 579.98*60 - 30000 = 34798.90 - 30000 = 4798.90
  near(d.totalInterest, 4798.9, 1.5, "  total interest");
}

// The trade-in tax credit — Nova Scotia taxes the DIFFERENCE, not the price.
// $40,000 car, $10,000 trade, 15% HST:
//   taxable = 40000 - 10000 = 30000  →  tax 4500   (NOT 6000)
//   financed = 40000 + 4500 - 10000 = 34500  →  /60 = 575.00
// The credit is worth 15% x 10000 = $1,500 to the customer, and quoting it
// without the credit overstates the payment by $25/mo.
{
  const d = await deal({ price: 40000, tradeAllowance: 10000, term: 60, apr: 0, taxRate: 15 });
  near(d.tax, 4500, 0.01, "tax on price minus trade");
  near(d.monthly, 575, 0.01, "  payment with the credit");
}

// Upside down: they owe more than the car is worth. The negative equity has to
// be ADDED to the amount financed, and the tax credit still applies to the
// allowance — the store still took the trade in.
//   allowance 8000, payoff 15000  →  net equity -7000
//   taxable = 30000 - 8000 = 22000  →  tax 0 (rate 0 here, kept simple)
//   financed = 30000 - (-7000) = 37000  →  /60 = 616.67
{
  const d = await deal({ price: 30000, tradeAllowance: 8000, tradePayoff: 15000, term: 60, apr: 0, taxRate: 0 });
  near(d.netTradeEquity, -7000, 0.01, "negative equity");
  near(d.amountFinanced, 37000, 0.01, "  rolled into the loan");
  near(d.taxableBase, 22000, 0.01, "  trade credit still applies");
}

// Plate registration is a government fee and is NEVER taxed; the taxable
// add-ons (AVP, freight, air tax, tire levy) go into the pre-tax subtotal.
//   taxable subtotal = 30000 + 2000 = 32000  →  tax 4800
//   financed = 30000 + 2000 + 4800 + 13.20 = 36813.20
// If plate reg were taxed the tax would be 4801.98 — small, but it's the kind
// of wrong that a customer with a calculator finds.
{
  const d = await deal({ price: 30000, feesTaxable: 2000, fees: 13.2, term: 60, apr: 0, taxRate: 15 });
  near(d.tax, 4800, 0.01, "plate reg excluded from tax");
  near(d.amountFinanced, 36813.2, 0.01, "  amount financed");
}

// Degenerate inputs must produce a number, not NaN or Infinity on screen.
{
  const zero = await deal({ price: 30000, term: 0, apr: 6 });
  const empty = await deal({});
  console.log(`  ok   term 0 → ${zero.monthly}, empty input → ${empty.monthly}`);
  if (!Number.isFinite(zero.monthly) || zero.monthly !== 0) fail("term 0 gave " + zero.monthly);
  if (!Number.isFinite(empty.monthly)) fail("empty input gave " + empty.monthly);
}

// A trade worth more than the car can't produce a negative loan.
{
  const d = await deal({ price: 20000, tradeAllowance: 40000, term: 60, apr: 0, taxRate: 0 });
  console.log(`  ok   trade bigger than the car → financed ${d.amountFinanced}, payment ${d.monthly}`);
  if (d.amountFinanced < 0 || d.monthly < 0) fail("negative loan/payment: " + JSON.stringify(d));
}

// ------------------------------------------------------------------ lease
console.log("\nlease:");

// $30,000, 48 months, 55% residual, 0% (money factor 0):
//   residual = 16500;  depreciation = (30000-16500)/48 = 281.25;  rent = 0
{
  const l = await lease({ price: 30000, term: 48, residualPct: 55, apr: 0, taxRate: 0 });
  near(l.monthly, 281.25, 0.01, "$30k / 48mo / 55% / 0%");
  near(l.residual, 16500, 0.01, "  residual");
}

// Same lease at 4.8% APR. Money factor = 4.8/2400 = 0.002.
//   rent = (30000 + 16500) * 0.002 = 93.00
//   monthly = 281.25 + 93.00 = 374.25
{
  const l = await lease({ price: 30000, term: 48, residualPct: 55, apr: 4.8, taxRate: 0 });
  near(l.monthly, 374.25, 0.01, "  same lease at 4.8%");
}

// Tax on a lease applies to the PAYMENT, not the cap cost.
//   374.25 * 1.15 = 430.39
{
  const l = await lease({ price: 30000, term: 48, residualPct: 55, apr: 4.8, taxRate: 15 });
  near(l.monthly, 430.39, 0.02, "  with 15% on the payment");
}

// The residual is a percentage of MSRP, not of the reduced cap cost — otherwise
// putting money down would shrink the residual and quietly raise the payment.
{
  const a = await lease({ price: 30000, msrp: 30000, down: 5000, term: 48, residualPct: 55, apr: 0, taxRate: 0 });
  near(a.residual, 16500, 0.01, "residual holds when cash goes down");
  // depreciation = (25000 - 16500)/48 = 177.08
  near(a.monthly, 177.08, 0.02, "  payment falls by 5000/48 = 104.17");
}

// Equity larger than the lease needs: a "$0/mo" row is not a quotable offer.
// Cap at zero and report the surplus.
//   adjCap = 30000 - 25000 = 5000;  residual 16500
//   depreciation = (5000 - 16500)/48 = -239.58  →  surplus 239.58 * 48 = 11500
// Sanity: they put in 25000, the car uses up 13500 of value, 11500 comes back.
{
  const l = await lease({ price: 30000, tradeAllowance: 25000, term: 48, residualPct: 55, apr: 0, taxRate: 0 });
  near(l.monthly, 0, 0.01, "payment floored at zero");
  near(l.surplus, 11500, 2, "  surplus handed back");
}

// ----------------------------------------------------------------- equity
console.log("\nequity:");

// A missing appraisal must read as UNKNOWN. The dangerous bug here is reading
// it as "negative the whole payoff", which turns every un-appraised customer
// into someone who looks buried.
{
  const r = await p.evaluate(async () => {
    const db = await import("/js/views/dealbuilder.js");
    const mk = (o) => ({ id: "x", name: "T", stage: "working", createdAt: "x", updatedAt: "x", ...o });
    return {
      noValue: db.equity(mk({ payoff: 18000 })),
      positive: db.equity(mk({ currentValue: 20000, payoff: 5000 })),
      negative: db.equity(mk({ currentValue: 10000, payoff: 18000 })),
      noPayoff: db.equity(mk({ currentValue: 12000 })),
    };
  });
  console.log("  " + JSON.stringify(r));
  if (r.noValue !== null) fail(`an un-appraised trade reports equity ${r.noValue} instead of unknown`);
  if (r.positive !== 15000) fail("positive equity is wrong: " + r.positive);
  if (r.negative !== -8000) fail("upside down should be -8000, got " + r.negative);
  if (r.noPayoff !== 12000) fail("no payoff means it's paid off: " + r.noPayoff);
}

// ------------------------------------------------------- what gets ranked first
// The arithmetic above is all correct. The defect was one level up: "who can I
// get into something cheaper" ranked by the headline payment, and the headline
// payment is lowest for whichever option eats the most of the customer's
// equity — which is almost always a lease.
//
// A customer with $15,000 of equity paying $720/mo gets offered a $117/mo lease.
// True: they'd pay $117. Also true: they've spent $15,000 to do it and own
// nothing in four years. That was the first name and the first number the app
// gave, and it's the one a salesperson would have to walk back at the desk.
// Every option must carry its term. A payment with no term attached is not a
// quote — and the default computed lease was pushing exactly that, which is how
// a $15,000-equity lease reported a "true cost" identical to its headline.
console.log("\nevery option carries a term:");
{
  const bad = await p.evaluate(async () => {
    const store = await import("/js/store.js");
    const db = await import("/js/views/dealbuilder.js");
    store.create("vehicles", { year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, stock: "T1", condition: "New" });
    const lead = store.create("leads", { name: "Term Check", stage: "working", currentPayment: 600, payoff: 3000, currentValue: 12000 });
    const rows = db.dealsForLead(lead, { method: "both" });
    const missing = rows.filter((r) => !(Number(r.term) > 0));
    store.remove("leads", lead.id);
    return { total: rows.length, missing: missing.length, sample: missing.slice(0, 2).map((r) => ({ method: r.method, monthly: Math.round(r.monthly), term: r.term })) };
  });
  console.log("  " + JSON.stringify(bad));
  if (!bad.total) fail("no options at all to check");
  if (bad.missing) fail(`${bad.missing} of ${bad.total} options have no term: ${JSON.stringify(bad.sample)}`);
}

console.log("\nranking a cheaper payment:");
{
  const r = await p.evaluate(async () => {
    const store = await import("/js/store.js");
    store.updateSettings({ taxRate: 15, defaultApr: 7.9, defaultTerm: 72, dealMethod: "both" });
    store.create("leads", {
      name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2018 Nissan Rogue",
      currentPayment: 720, payoff: 4000, currentValue: 19000, currentApr: 8.9,
    });
    store.create("vehicles", { year: 2026, make: "Nissan", model: "Sentra", trim: "SV", price: 27995, stock: "N1", condition: "New" });
    store.create("vehicles", { year: 2026, make: "Nissan", model: "Kicks", trim: "SV", price: 27198, stock: "N2", condition: "New" });
    const agent = await import("/js/agent.js");
    const out = await agent.execTool("deal_radar", { cheaperOnly: true, limit: 5 });
    return out.result.opportunities || [];
  });
  r.forEach((o) => console.log(`  ${o.method.padEnd(8)} $${o.monthly}/mo  true $${o.trueMonthly}/mo  equity used $${o.equityUsed}  ${o.vehicle}`));
  if (!r.length) fail("the radar found nobody for a customer with $15k equity paying $720/mo");
  else {
    const top = r[0];
    // The saving must still be reported honestly against what they pay today.
    if (top.pays !== 720) fail("the current payment isn't carried through");
    // Whatever wins, the cost of the saving has to travel with it. A lease
    // payment quoted without the equity it consumed is half a sentence.
    if (top.equityUsed == null) fail("the equity a deal spends isn't reported");
    if (top.trueMonthly == null) fail("there's no true monthly cost to compare on");
    if (top.method === "lease") {
      // A lease can legitimately win — but only on true cost, and it must say
      // out loud what it costs.
      const honest = top.monthly + Math.round(top.equityUsed / 48);
      if (top.trueMonthly <= top.monthly && top.equityUsed > 0)
        fail(`a lease funded by $${top.equityUsed} of equity reports a true cost of $${top.trueMonthly} — the equity is free in that number`);
      if (!(top.reasons || []).some((x) => /equity/i.test(x) && /nothing owned|spends/i.test(x)))
        fail("a lease that spends the customer's equity doesn't say so: " + JSON.stringify(top.reasons));
      console.log(`  (lease wins on true cost ${top.trueMonthly} — honest floor ~${honest} — and says what it costs)`);
    }
    // And ordering is by true cost, not by the headline.
    const trues = r.map((o) => o.trueMonthly);
    if (JSON.stringify(trues) !== JSON.stringify(trues.slice().sort((x, y) => x - y)))
      fail("rows aren't ordered by true cost: " + JSON.stringify(trues));
  }
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmoney.test.js FAILED" : "\nmoney.test.js passed");
})();
