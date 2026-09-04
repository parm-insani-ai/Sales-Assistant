// The lender matrix. What's being protected here is a specific way of losing a
// customer: quoting the program rate to someone who doesn't book at it, or
// quoting a payment on a structure no lender will advance against. Both send
// the customer home happy and let the desk deliver the bad news later.
//
// So these cases are the ones that actually kill deals — tier pricing, the
// advance cap, and the term cap — plus the thing that makes the screen worth
// looking at: a decline has to say what would fix it.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ settings: { cloudAutoSync: false } }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(400);

const run = (deal) => p.evaluate(async (d) => {
  const m = await import("/js/lenders.js");
  const res = m.matchLenders(d);
  const slim = (r) => ({ name: r.name, kind: r.kind, apr: r.apr, monthly: r.monthly,
    ltv: r.ltv, fee: r.fee, blocks: r.blocks, fix: r.fix });
  return { approved: res.approved.map(slim), declined: res.declined.map(slim) };
}, deal);

const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const money = (n) => "$" + Math.round(n).toLocaleString();

// --- 1. A clean prime deal: banks and the captive all buy it, cheapest first.
{
  const r = await run({ amountFinanced: 38000, value: 42000, term: 72, tier: "1" });
  console.log("Tier 1, $38k on a $42k car, 72mo:");
  r.approved.forEach((a) => console.log(`   ✓ ${a.name} ${a.apr}% → ${money(a.monthly)}/mo`));
  if (r.approved.length < 4) fail("a clean prime deal should book almost anywhere");
  const p2 = r.approved.map((a) => a.monthly);
  if (p2.some((v, i) => i && v < p2[i - 1])) fail("approved lenders are not sorted cheapest-first");
  if (r.approved.some((a) => a.kind === "subprime")) fail("subprime lenders should not buy a Tier 1 customer");
}

// --- 2. The same car, same structure, Tier 5. This is the whole point: the
// payment is not the payment, and most of the sheet simply won't look at it.
{
  const t1 = await run({ amountFinanced: 38000, value: 42000, term: 72, tier: "1" });
  const t5 = await run({ amountFinanced: 38000, value: 42000, term: 72, tier: "5" });
  const a = t1.approved[0], z = t5.approved[0];
  console.log(`\nSame deal at Tier 1 vs Tier 5: ${money(a.monthly)} → ${z ? money(z.monthly) : "nobody"}`);
  if (!z) fail("nobody at all would buy a Tier 5 deal inside every cap — too strict to be useful");
  if (z.monthly <= a.monthly) fail("a Tier 5 customer must not be quoted a Tier 1 payment");
  if (!t5.declined.some((d) => /doesn't buy/i.test(d.blocks.join(" "))))
    fail("banks that don't buy Tier 5 should say so");
  if (!(z.fee > 0)) fail("subprime paper is bought at a discount — the fee has to be reported");
  console.log(`   ${z.name} at ${z.apr}% costs the store ${money(z.fee)} in discount`);
}

// --- 3. Over the advance cap. The deal isn't priced worse, it's declined —
// and the only useful thing to say is how much down fixes it.
{
  const r = await run({ amountFinanced: 41000, value: 28000, term: 72, tier: "2" });
  console.log(`\n$41k financed on a $28k car (146% LTV):`);
  r.declined.slice(0, 3).forEach((d) => console.log(`   ✗ ${d.name}: ${d.blocks.join("; ")} → ${d.fix || "no fix"}`));
  if (r.approved.length) fail("146% LTV should not be approved by anyone on the seeded sheet");
  const withFix = r.declined.filter((d) => /down/i.test(d.fix || ""));
  if (!withFix.length) fail("an over-advance decline must name the down payment that fixes it");
  // The named figure has to actually work: put that much down and it books.
  const need = Number((withFix[0].fix.match(/\$([\d,]+)/) || [])[1].replace(/,/g, ""));
  const after = await run({ amountFinanced: 41000 - need, value: 28000, term: 72, tier: "2" });
  if (!after.approved.some((x) => x.name === withFix[0].name))
    fail(`${withFix[0].name} said ${money(need)} down would fix it, and it doesn't`);
  console.log(`   ${money(need)} down → ${withFix[0].name} buys it. The fix is real.`);
}

// --- 4. Term cap. A lender that stops at 72 must be shown as a re-run, not a
// dead end — the salesperson can change the term.
{
  const r = await run({ amountFinanced: 30000, value: 34000, term: 84, tier: "5" });
  const rifco = r.declined.find((d) => /Rifco/.test(d.name));
  console.log(`\nTier 5 at 84 months — ${rifco ? rifco.fix : "(Rifco not declined)"}`);
  if (!rifco || !/72 months/.test(rifco.fix || "")) fail("a term-capped lender should suggest the term that works");
}

// --- 5. Long terms cost more. A sheet that ignores the term bump quietly
// under-quotes every 84-month deal.
{
  const at72 = await run({ amountFinanced: 30000, value: 34000, term: 72, tier: "2" });
  const at84 = await run({ amountFinanced: 30000, value: 34000, term: 84, tier: "2" });
  const a = at72.approved.find((x) => /Scotiabank/.test(x.name));
  const z = at84.approved.find((x) => /Scotiabank/.test(x.name));
  console.log(`\nScotiabank ${a.apr}% at 72 → ${z.apr}% at 84`);
  if (!(z.apr > a.apr)) fail("the long-term rate bump is not being applied");
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlenders.test.js FAILED" : "\nlenders.test.js passed");
})();
