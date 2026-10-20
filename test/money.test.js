// No figure reaches a customer — except advertised content: a figure that
// matches a current special on file (the manufacturer's rate, the lease
// payment, the cash) may be said, because the store already says it.
// Everything else with a number in it is still refused.
(async () => {
const m = await import("../js/money.js");
const fail = (x) => { console.error("FAIL: " + x); process.exitCode = 1; };
const today = "2026-10-20";
const specials = [
  { model: "Rogue", financeApr: 0, financeTerm: 60, expiry: "2026-11-30" },
  { model: "Kicks", financeApr: 2.9, leasePayment: 299, leaseDown: 1500, cash: 500, expiry: "2026-12-31", notes: "plus $750 loyalty" },
  { model: "Sentra", financeApr: 0.9, cash: 1000, expiry: "2026-09-30" }, // expired
];
const ads = m.advertisedFigures(specials, today);
console.log("advertised:", JSON.stringify([...ads]));
for (const k of ["0%", "2.9%", "$299", "299/mo", "$1500", "$500", "$750"]) if (!ads.has(k)) fail("advertised should carry " + k);
if (ads.has("0.9%") || ads.has("$1000")) fail("an expired special shouldn't be advertised");
// Keys compare the written form to the advertised one.
if (m.figureKey("$1,500") !== "$1500" || m.figureKey("0 %") !== "0%" || m.figureKey("299 a month") !== "299/mo" || m.figureKey("1.5k") !== "$1500") fail("figure keys");
// With the list set, advertised figures pass and the rest don't.
m.setAdvertised(ads);
const ok = ["there's 0% financing on the Rogue this month", "2.9% APR on the Kicks right now", "the Kicks lease is $299 a month with $1,500 down", "$500 cash on the Kicks plus $750 loyalty", "0 percent financing on Rogues"];
const bad = ["your trade is worth $14,000", "0% financing and $500 toward your trade, call it 14k", "the Sentra is 0.9% this month", "we'd put your trade at 14 grand", "a payment of 300 a month"];
ok.filter((t) => m.looksLikeMoney(t)).forEach((t) => fail("advertised content refused: " + t));
bad.filter((t) => !m.looksLikeMoney(t)).forEach((t) => fail("a figure got through: " + t));
if (m.moneyIn("0% financing and $500 toward your trade, call it 14k").map((x) => x.text).join("|") !== "14k") fail("moneyIn should name only the figure that isn't advertised: " + JSON.stringify(m.moneyIn("0% financing and $500 toward your trade, call it 14k")));
// Without the list, nothing passes — the default is strict.
m.setAdvertised([]);
if (!m.looksLikeMoney("there's 0% financing on the Rogue this month")) fail("with no specials on file, 0% is a figure like any other");
console.log(process.exitCode ? "\nmoney.test.js FAILED" : "\nmoney.test.js passed");
})().catch((e) => { console.error(e); process.exit(1); });
