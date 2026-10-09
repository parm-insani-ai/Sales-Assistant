// The prep list from a read deal: every product becomes its steps with an
// owner and a lead time, the base steps follow how it's paid and what the
// car is, nothing is listed twice, and the heads-up names what to start.
const path = require("path");
(async () => {
const D = await import("file://" + path.resolve(__dirname, "../js/dealprep.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const labels = (items) => items.map((i) => i.label);

// A financed new Sentra with a trade, rust protection, etch and walkaway.
const approval = {
  form: "approval", vehicle: { newUsed: "New", model: "Sentra", fuel: "gas" },
  trade: [{ year: "2013", make: "Hyundai", model: "Elantra", lien: "N/A" }],
  finance: { type: "finance", term: 84 },
  products: [{ name: "Vehicle protection (10 yr rust)", kind: "protection" }, { name: "Security etch", kind: "etch" }, { name: "Walkaway protection", kind: "walkaway" }],
};
let items = D.prepFromDeal(approval, { today: "2026-10-09" });
console.log("approval:", JSON.stringify(items.map((i) => [i.label, i.owner, i.lead, i.urgent])));
const want = ["Book rust protection with service", "Security etch applied and registered", "Walkaway enrolment signed and submitted", "Lender approval and stips in (ID, income, void cheque)", "Proof of insurance from the customer", "Trade: ownership, both keys, lien payout letter if any", "PDI done and MVI on the car", "Plates and registration", "Detailed, fuelled, second key and manual in the car"];
for (const w of want) if (!labels(items).includes(w)) fail("missing: " + w);
if (labels(items).some((l) => /lien payout confirmed/.test(l))) fail("a trade with no lien got a lien payout step");
if (labels(items).some((l) => /EV rebate|Charged to 80/.test(l))) fail("a gas car got EV steps");
if (items[0].label !== "Book rust protection with service" || items[0].lead !== 3) fail("the longest lead time isn't first: " + items[0].label);
if (!items.find((i) => /rust/.test(i.label)).urgent || items.find((i) => /Plates/.test(i.label)).urgent) fail("urgency is wrong without a date");
if (new Set(labels(items)).size !== items.length) fail("a step is listed twice");
if (!/^Start now: Book rust protection \(3 days\) · .*Security etch applied and registered \(2 days\)\.$/.test(D.headsUp(items)) || /Plates|Walkaway/.test(D.headsUp(items))) fail("the heads-up is wrong: " + D.headsUp(items));

// A leased Leaf with a lien on the trade, a plan, an accessory package, delivered next Friday.
const lease = {
  form: "worksheet", vehicle: { newUsed: "New", model: "LEAF", fuel: "electric" },
  trade: [{ year: "2014", make: "Ford", model: "Escape", lien: "$4,200" }],
  finance: { type: "lease", term: 48 }, deliveryDate: "2026-10-16",
  products: [{ name: "Nissan Platinum Plan", kind: "warranty" }, { name: "WalkawaySTAND", kind: "walkaway" }, { name: "10 yr rust protection", kind: "protection" }, { name: "Atlantic Package", kind: "package" }, { name: "Security etch & other", kind: "etch" }],
};
items = D.prepFromDeal(lease, { today: "2026-10-09" });
console.log("lease:", JSON.stringify(items.map((i) => [i.label, i.lead, i.startBy, i.urgent])));
for (const w of ["Lease approval and stips in (ID, income, void cheque)", "Trade lien payout confirmed with the lienholder", "Extended plan contract signed and registered", "Order accessories from parts", "Book accessory install with service", "EV rebate paperwork submitted", "Charged to 80% and the charge cable in the car"]) if (!labels(items).includes(w)) fail("missing on the lease: " + w);
const parts = items.find((i) => /Order accessories/.test(i.label));
if (!parts || parts.startBy !== "2026-10-09" || !parts.urgent) fail("five working days before Friday the 16th is Friday the 9th, and it's due today: " + JSON.stringify(parts));
const plates = items.find((i) => /Plates/.test(i.label));
if (!plates || plates.startBy !== "2026-10-15" || plates.urgent) fail("one working day before the 16th is the 15th, not urgent yet: " + JSON.stringify(plates));

// Cash, used, no trade, nothing sold: the base list only.
items = D.prepFromDeal({ vehicle: { newUsed: "Used" }, finance: { type: "cash" }, products: [] });
if (!labels(items).includes("Funds confirmed (draft or wire)") || !labels(items).includes("MVI and safety on the car") || labels(items).some((l) => /Trade|Lender|PDI/.test(l))) fail("the cash used deal's base list is wrong: " + JSON.stringify(labels(items)));
if (!/Nothing with a lead time/.test(D.headsUp(items.filter((i) => i.lead < 2)))) fail("the heads-up for a plain deal is wrong");

console.log(process.exitCode ? "\ndealprep.test.js FAILED" : "\ndealprep.test.js passed");
})();
