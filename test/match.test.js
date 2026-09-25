// Payment matching against the store's lot, pinned: the desk's arithmetic
// per unit, the trade, the match a customer gets, and how it reads in the
// manager's assessment.
const path = require("path");
(async () => {
const M = await import("file://" + path.resolve(__dirname, "../js/match.js"));
const R = await import("file://" + path.resolve(__dirname, "../js/reach.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const s = { taxRate: 15, docFee: 699, avpRogue: 699, avpOther: 599, feeFreight: 2100, feeAirTax: 100, feeTireLevy: 22.5, feePlateReg: 13.2, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 50 };

// --- Per dollar, fees, the units.
const k = M.perDollar(7.9, 72);
if (Math.abs(k - 0.01748) > 0.0002) fail("per dollar at 7.9%/72: " + k);
if (Math.abs(M.perDollar(0, 60) - 1 / 60) > 1e-9) fail("zero rate is straight division");
const lot = [
  { id: "n1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 41000, mileage: 12, condition: "New", status: "available" },
  { id: "n2", year: 2026, make: "Nissan", model: "Kicks", trim: "SR", price: 29450, mileage: 8, condition: "New", status: "available" },
  { id: "u1", year: 2022, make: "Nissan", model: "Frontier", trim: "PRO-4X", price: 39900, mileage: 41000, condition: "Used", status: "available" },
  { id: "u2", year: 2021, make: "Honda", model: "Civic", trim: "Sport", price: 24990, mileage: 60000, condition: "Used", status: "available" },
  { id: "x1", year: 2026, make: "Nissan", model: "Pathfinder", trim: "SL", price: null, condition: "New", status: "available" }, // no price → out
  { id: "x2", year: 2024, make: "Nissan", model: "Sentra", trim: "S", price: 22000, condition: "Used", status: "sold" }, // sold → out
];
const units = M.prepareUnits(lot, s);
if (units.length !== 4) fail("units without a price or already sold shouldn't be priced: " + units.map((u) => u.v.id).join());
const rogue = units.find((u) => u.v.id === "n1"), civic = units.find((u) => u.v.id === "u2");
// New fees: (699 + 2100 + 100 + 22.5 + 699) × 1.15 + 13.2
if (Math.abs(rogue.fixed - (3620.5 * 1.15 + 13.2)) > 0.01) fail("new-vehicle fees: " + rogue.fixed);
if (Math.abs(civic.fixed - 699 * 1.15) > 0.01) fail("used fees are the doc fee: " + civic.fixed);

// --- One customer: a Frontier owner with $13k of equity paying $610.
const frontier = { id: "b", name: "Big Equity", phone: "1", stage: "delivered", vehicleInterest: "2020 Nissan Frontier PRO-4X", currentValue: 31000, payoff: 18000, currentPayment: 610, purchaseDate: "2020-08-01", createdAt: "2024-01-01" };
const trade = M.tradeOf(frontier);
if (trade.value !== 31000 || trade.payoff !== 18000) fail("trade: " + JSON.stringify(trade));
// The Rogue: price 41000, taxable 10000 → 1500 tax, fees 4176.8, minus 13000 equity = 33676.8 × k
const rogueMonthly = M.monthlyFor(rogue, trade);
if (Math.abs(rogueMonthly - Math.round(33676.8 * k)) > 1) fail("the Rogue's monthly for the Frontier owner: " + rogueMonthly);
const m = M.matchFor(frontier, units, s);
console.log("match:", JSON.stringify({ best: [m.best.unit.name, m.best.monthly, m.best.delta], replacement: [m.replacement.unit.name, m.replacement.monthly, m.replacement.delta, m.replacement.fit], pitch: m.pitch.unit.name }));
if (m.replacement.unit.v.id !== "u1") fail("the like-for-like replacement for a Frontier owner is the Frontier: " + m.replacement.unit.name);
if (m.pitch.unit.v.id !== "u1" || m.pitch.delta > 50) fail("the pitch should be the replacement when it fits the payment: " + JSON.stringify([m.pitch.unit.name, m.pitch.delta]));
// A Murano owner: the Rogue fits them; the Frontier only fits the payment. Fit wins.
const murano = { id: "m", name: "Murano Owner", phone: "1", stage: "delivered", vehicleInterest: "2019 Nissan Murano SL", currentValue: 22000, payoff: 9000, currentPayment: 480, purchaseDate: "2019-06-01", createdAt: "2022-01-01" };
const m3 = M.matchFor(murano, units, s);
console.log("murano:", JSON.stringify({ best: [m3.best.unit.name, m3.best.delta], pitch: [m3.pitch.unit.name, m3.pitch.delta, m3.pitch.fit] }));
if (m3.pitch.unit.v.id !== "n1") fail("a Murano owner should be pitched the Rogue, not the truck at the closest payment: " + m3.pitch.unit.name);
if (m3.best.unit.v.id !== "u1") fail("the closest payment is still reported as the closest payment: " + m3.best.unit.name);
// A customer with no payment on file still gets a natural next vehicle.
const paidOff = { id: "q", name: "Paid Off", phone: "1", stage: "delivered", vehicleInterest: "2017 Nissan Sentra SV", currentValue: 9000, purchaseDate: "2017-05-01", createdAt: "2020-01-01" };
const m2 = M.matchFor(paidOff, units, s);
if (m2.best !== null || !m2.pitch || m2.pitch.delta !== null || m2.pitch.monthly <= 0) fail("no payment: a pitch with no delta: " + JSON.stringify(m2 && [m2.pitch && m2.pitch.unit.name, m2.pitch && m2.pitch.delta]));

// --- In the manager's read.
const matcher = M.makeMatcher(lot, s);
const read = R.readCustomer(frontier, { match: matcher, dealMatchBand: 50, now: new Date("2026-09-25T12:00:00") });
console.log("read:", read.score, read.reasons, read.next.label, read.deal && [read.deal.name, read.deal.monthly, read.deal.delta]);
if (!read.deal || read.deal.unit.id !== "u1" || !read.deal.fits) fail("the read didn't carry the deal: " + JSON.stringify(read.deal));
if (!read.reasons.some((x) => /\/mo less$|^Same payment$/.test(x))) fail("no payment chip: " + JSON.stringify(read.reasons));
if (!/pitch a 2022 Nissan Frontier PRO-4X at about the same payment/.test(read.next.label)) fail("the next move should name the pitch: " + read.next.label);
const noLot = R.readCustomer(frontier, { now: new Date("2026-09-25T12:00:00") });
if (read.score <= noLot.score) fail("a payment match should raise the score");
const ranked = R.rankBook([{ lead: frontier, rep: { user_id: "p", name: "Parm" } }, { lead: paidOff, rep: { user_id: "p", name: "Parm" } }], { match: matcher, dealMatchBand: 50, now: new Date("2026-09-25T12:00:00") });
const t = R.taskFor(ranked.rows.find((r) => r.lead.id === "b"), { by: "Sam", now: new Date("2026-09-25T12:00:00") });
console.log("task:", t.title);
if (!/^Reach out to Big Equity — 2022 Nissan Frontier PRO-4X at ~\$\d{3}\/mo, /.test(t.title)) fail("the task should lead with the deal: " + t.title);
console.log(process.exitCode ? "\nmatch.test.js FAILED" : "\nmatch.test.js passed");
})();
