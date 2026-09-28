// When it makes sense, pinned: the projection of value and payoff month by
// month, the month the window opens and why, the buckets, the leases in
// order of ending, and the to-do a manager hands over.
const path = require("path");
(async () => {
const H = await import("file://" + path.resolve(__dirname, "../js/horizon.js"));
const M = await import("file://" + path.resolve(__dirname, "../js/match.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const now = new Date("2026-09-28T12:00:00");
const ago = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const label = (d) => new Date(d).toLocaleDateString("en-CA", { month: "short", year: "numeric" });

// --- The projection: value drifts down, the payoff comes off faster.
const fin = { id: "a", name: "Finance Later", phone: "1", stage: "delivered", vehicleInterest: "2024 Nissan Rogue SV", currentValue: 30000, payoff: 31000, currentPayment: 620, currentApr: 6.9, paymentsLeft: 58, paymentsLeftAsOf: ago(0), purchaseDate: "2024-08-01", createdAt: ago(700) };
const p0 = H.projectAt(fin, 0, { now }), p12 = H.projectAt(fin, 12, { now }), p24 = H.projectAt(fin, 24, { now });
console.log("projection:", JSON.stringify([p0, p12, p24].map((p) => ({ m: p.m, value: p.value, payoff: p.payoff, left: p.left, equity: p.equity }))));
if (p0.value !== 30000 || p0.payoff !== 31000 || p0.equity !== -1000 || p0.left !== 58) fail("month 0 should be the file as it is");
if (p12.value !== 26400 || p12.left !== 46) fail("a year on: 12% off the value, twelve fewer payments: " + JSON.stringify(p12));
// Amortised at 6.9%: 31000 grows by ~$178/mo interest and loses $620 — about $25,500 after a year.
if (p12.payoff < 25000 || p12.payoff > 26000) fail("the payoff should amortise at their rate: " + p12.payoff);
if (!(p24.equity > p12.equity && p12.equity > p0.equity)) fail("equity should climb month by month");
// Without a rate, the payoff comes down in proportion to payments left.
const noRate = H.projectAt({ ...fin, currentApr: undefined }, 29, { now });
if (noRate.payoff !== 15500) fail("no rate: half the payments left is half the payoff: " + noRate.payoff);
// With only a payment and a count, payoff is payment × payments left.
const est = H.projectAt({ ...fin, payoff: undefined }, 10, { now });
if (est.payoff !== 620 * 48) fail("payment × payments left: " + est.payoff);

// --- When: upside down today, equity crosses $3,000 in a couple of years.
let hz = H.horizonFor(fin, { now });
console.log("finance:", hz.m, hz.trigger, hz.why, label(hz.at));
if (hz.m === 0 || hz.m == null || hz.trigger !== "equity" || hz.equityThen < 3000 || !/Equity reaches about \$3,[0-9]{3} by/.test(hz.why)) fail("the finance customer should have a month: " + JSON.stringify(hz));
// The month before, equity was under the line.
const before = H.projectAt(fin, hz.m - 1, { now });
if (before.equity >= 3000) fail("the window should open the first month equity clears the line");
if (H.bucketOf(hz) !== (hz.m <= 12 ? "year" : "later")) fail("bucket: " + H.bucketOf(hz));

// Equity today: now.
const rich = { ...fin, id: "b", name: "Rich Now", currentValue: 31000, payoff: 18000 };
hz = H.horizonFor(rich, { now });
if (hz.m !== 0 || hz.trigger !== "equity" || !/of equity now/.test(hz.why) || H.bucketOf(hz) !== "now") fail("equity today is now: " + JSON.stringify(hz));

// A lease: the window opens six months before the end.
const lease = { id: "c", name: "Lease Next Year", phone: "1", stage: "delivered", vehicleInterest: "2023 Nissan Rogue SV", dealType: "Lease", leaseEnd: "2027-08-15", currentPayment: 520, purchaseDate: "2023-08-15", createdAt: ago(900) };
hz = H.horizonFor(lease, { now });
console.log("lease:", hz.m, hz.why);
if (hz.trigger !== "lease" || hz.m !== 5 || !/Lease ends Aug 2027; the conversation starts 6 months out, in Feb 2027/.test(hz.why)) fail("the lease window: " + JSON.stringify(hz));
hz = H.horizonFor({ ...lease, leaseEnd: "2026-12-10" }, { now });
if (hz.m !== 0 || !/window is open/.test(hz.why)) fail("a lease ending in two months is now: " + JSON.stringify(hz));

// Paid off before the equity line: the payoff-date is the moment.
const cheap = { id: "d", name: "Nearly Done", phone: "1", stage: "delivered", vehicleInterest: "2019 Nissan Kicks", currentValue: 2600, payoff: 1400, currentPayment: 350, paymentsLeft: 4, paymentsLeftAsOf: ago(0), purchaseDate: "2020-01-01", createdAt: ago(900) };
hz = H.horizonFor(cheap, { now });
console.log("cheap:", hz.m, hz.trigger, hz.why);
if (hz.trigger !== "contract" || hz.m !== 1) fail("with four payments left the contract-end window opens next month: " + JSON.stringify(hz));

// A payment match against the lot, once the trade has caught up.
const lot = [{ id: "u1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, mileage: 12, condition: "New", status: "available" }];
const s = { taxRate: 15, docFee: 699, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 50 };
const match = M.makeMatcher(lot, s);
const swap = { id: "e", name: "Same Payment Soon", phone: "1", stage: "delivered", vehicleInterest: "2023 Nissan Rogue SV", currentValue: 22000, payoff: 21000, currentPayment: 640, currentApr: 3.9, paymentsLeft: 36, paymentsLeftAsOf: ago(0), purchaseDate: "2023-09-01", createdAt: ago(800) };
const nowDeal = match(swap);
hz = H.horizonFor(swap, { now, match, dealMatchBand: 50 });
console.log("swap: today a Rogue is", nowDeal.pitch.delta, "/mo over →", hz.m, hz.trigger, hz.why);
if (nowDeal.pitch.delta <= 50) fail("the test wants a customer who is NOT at the same payment today");
if (hz.m == null || hz.m === 0 || !["deal", "equity"].includes(hz.trigger)) fail("the swap customer should get a month: " + JSON.stringify(hz));

// Not applicable: a live lead, lost, just bought.
if (H.horizonFor({ id: "f", name: "Live", stage: "new", vehicleInterest: "Kicks", createdAt: ago(3) }, { now }) !== null) fail("a live lead has no timing");
if (H.horizonFor({ ...rich, stage: "lost" }, { now }) !== null) fail("lost is out");
if (H.horizonFor({ ...rich, stage: "delivered", purchaseDate: ago(10) }, { now }) !== null) fail("just bought is out");
// Unknowable: an owner with nothing but a purchase date.
hz = H.horizonFor({ id: "g", name: "Thin File", stage: "delivered", purchaseDate: "2022-05-01", vehicleInterest: "2022 Nissan Sentra" }, { now });
if (!hz || !hz.unknown) fail("a thin file is unknown, not never: " + JSON.stringify(hz));
// Never: deeply upside down on a long term.
hz = H.horizonFor({ id: "h", name: "Deep", stage: "delivered", vehicleInterest: "2025 Nissan Armada", currentValue: 60000, payoff: 82000, currentPayment: 900, currentApr: 9.9, paymentsLeft: 90, paymentsLeftAsOf: ago(0), purchaseDate: "2025-06-01" }, { now });
console.log("deep:", hz.m, hz.why);
if (!hz.never || !/upside down three years out/.test(hz.why)) fail("deeply upside down is never: " + JSON.stringify(hz));

// --- The book, in order, and the buckets.
const book = H.horizonBook([rich, fin, lease, cheap, { id: "f", name: "Live", stage: "new", createdAt: ago(3) }].map((lead) => ({ lead, rep: { user_id: "r" } })), { now });
console.log("book:", book.map((r) => `${r.lead.name}:${r.hz.m}`).join(" "));
if (book.length !== 4 || book[0].lead.name !== "Rich Now" || book[1].lead.name !== "Nearly Done" || book[2].lead.name !== "Lease Next Year" || book[3].lead.name !== "Finance Later") fail("the book isn't soonest first: " + book.map((r) => r.lead.name).join(","));

// --- Every lease, in order of ending, by month.
const leases = H.contractsEnding([lease, { ...lease, id: "c2", name: "Lease Sooner", leaseEnd: "2026-11-02" }, { ...lease, id: "c3", name: "Lease Past", leaseEnd: "2026-08-01" }, { ...lease, id: "c4", name: "Lease Unknown", leaseEnd: undefined, purchaseDate: undefined }, fin], { now });
console.log("leases:", leases.map((r) => `${r.lead.name}:${r.end ? label(r.end) : "?"}${r.past ? " (past)" : ""}`).join(" · "));
if (leases.length !== 4 || leases[0].lead.name !== "Lease Past" || !leases[0].past || leases[1].lead.name !== "Lease Sooner" || leases[3].lead.name !== "Lease Unknown" || leases[3].end) fail("the leases aren't in order of ending: " + JSON.stringify(leases.map((r) => r.lead.name)));
const months = H.byMonth(leases);
if (months[0].label !== "August 2026" || months[months.length - 1].key !== "unknown") fail("by month: " + JSON.stringify(months.map((g) => g.label)));
const fins = H.contractsEnding([lease, fin, cheap], { now, type: "finance" });
if (fins.length !== 2 || fins[0].lead.name !== "Nearly Done") fail("finance contracts: " + fins.map((r) => r.lead.name).join(","));

// --- The follow-up and the to-do.
hz = H.horizonFor(lease, { now });
if (H.followUpFor(hz, now) !== "2027-02-28") fail("the follow-up lands in the month the window opens: " + H.followUpFor(hz, now));
if (H.followUpFor(H.horizonFor(rich, { now }), now) !== "2026-09-28") fail("now means today");
const task = H.horizonTaskFor({ lead: lease, hz }, { by: "Sam", now });
if (task.due !== "2027-02-28" || !/Reach out to Lease Next Year — Lease ends Aug 2027/.test(task.title) || !/Lease-end/.test(task.note) || !task.fromManager) fail("the to-do: " + JSON.stringify(task));

console.log(process.exitCode ? "\nhorizon.test.js FAILED" : "\nhorizon.test.js passed");
})();
