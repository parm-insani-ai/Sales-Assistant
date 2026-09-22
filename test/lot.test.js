// Questions about the lot, answered from the lot with the website's prices.
const path = require("path");

(async () => {
const lot = await import("file://" + path.resolve(__dirname, "../js/lot.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const today = "2026-09-22";
const V = [
  { id: "1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, mileage: 14, color: "Gun Metallic", bodyStyle: "SUV", condition: "New", stock: "N26011", status: "available", fuel: "Gas", drivetrain: "All-Wheel drive" },
  { id: "2", year: 2025, make: "Nissan", model: "Rogue", trim: "SV", price: 35990, mileage: 12400, color: "Pearl White", bodyStyle: "SUV", condition: "Used", certified: true, stock: "NHP1900", status: "available", drivetrain: "All-Wheel drive" },
  { id: "3", year: 2023, make: "Nissan", model: "Rogue", trim: "Platinum", price: 33990, mileage: 41200, color: "Black", bodyStyle: "SUV", condition: "Used", stock: "NH22001A", status: "available" },
  { id: "4", year: 2022, make: "Honda", model: "Civic", trim: "Sport", price: 24990, mileage: 94573, color: "Black", bodyStyle: "Sedan", condition: "Used", certified: true, stock: "NHP1868", status: "available", fuel: "Gas" },
  { id: "5", year: 2019, make: "Mazda", model: "CX-5", trim: "Signature", price: 25990, mileage: 69073, color: "Black", bodyStyle: "SUV", condition: "Used", certified: true, stock: "NH22985A", status: "available" },
  { id: "6", year: 2024, make: "Honda", model: "CR-V Hybrid", trim: "Touring", price: 41990, wasPrice: 43990, mileage: 51056, color: "Platinum White Pearl", bodyStyle: "SUV", condition: "Used", certified: true, stock: "NIP1879", status: "available", fuel: "Hybrid" },
  { id: "7", year: 2027, make: "Nissan", model: "Ariya", trim: "SV+", price: null, mileage: null, color: "Northern Lights Metallic", condition: "New", stock: "801028", status: "available", fuel: "Electric", inventoryDate: "2026-10-22" },
  { id: "8", year: 2020, make: "BMW", model: "5 Series", trim: "530i xDrive", price: 31990, mileage: 67675, color: "Mediterranean Blue Metallic", bodyStyle: "Sedan", condition: "Used", stock: "NHP1895", status: "available" },
  { id: "9", year: 2021, make: "Nissan", model: "Kicks", trim: "SV", price: 19990, mileage: 51000, color: "Orange", bodyStyle: "Hatchback", condition: "Used", stock: "NHP1876", status: "sold" },
];
const ask = (q, hints) => lot.answerLot(V, q, hints, { today });
const show = (q, r) => console.log(`"${q}" →`, r ? `[${r.count}] ${r.answer}` : "not a lot question");

// --- Yes/no and counts, by model and trim, plural or not.
let r = ask("do we have any rogue svs");
show("do we have any rogue svs", r);
if (!r || r.count !== 2 || !/38,995/.test(r.answer) || !/35,990/.test(r.answer) || !/Rogue SV/.test(r.label)) fail("rogue svs: " + JSON.stringify(r && [r.count, r.label, r.answer]));
r = ask("how many rogues do we have on the lot");
show("how many rogues do we have on the lot", r);
if (!r || r.count !== 3 || !/^3 Rogue/.test(r.answer)) fail("how many rogues: " + (r && r.answer));
r = ask("how many used rogues");
if (!r || r.count !== 2) fail("used rogues: " + (r && r.count));

// --- The website's price, and the was-price when there is one.
r = ask("what's the civic sport going for");
show("what's the civic sport going for", r);
if (!r || r.count !== 1 || !/24,990/.test(r.answer) || !/94,573 km/.test(r.answer) || !/NHP1868/.test(r.answer)) fail("civic price: " + (r && r.answer));
r = ask("price of stock NIP1879");
show("price of stock NIP1879", r);
if (!r || r.count !== 1 || !/41,990/.test(r.answer) || !/down from \$43,990/.test(r.answer)) fail("stock price: " + (r && r.answer));
r = ask("how much is the cr-v hybrid");
if (!r || r.count !== 1 || !/41,990/.test(r.answer)) fail("cr-v hybrid: " + (r && r.answer));

// --- Kilometres.
r = ask("how many kilometres on the civic");
show("how many kilometres on the civic", r);
if (!r || !/^94,573 km on the 2022 Honda Civic Sport/.test(r.answer)) fail("civic km: " + (r && r.answer));
r = ask("mileage on the 5 series");
if (!r || !/67,675 km/.test(r.answer)) fail("5 series km: " + (r && r.answer));

// --- Cheapest with a body, a condition and a spoken price cap.
r = ask("what's the cheapest used suv under thirty thousand");
show("what's the cheapest used suv under thirty thousand", r);
if (!r || r.count !== 1 || !/Cheapest used .*SUV under \$30,000 is the 2019 Mazda CX-5 Signature, \$25,990/.test(r.answer)) fail("cheapest suv: " + (r && r.answer));
r = ask("cheapest suv under 40k");
if (!r || r.count !== 4 || !/CX-5/.test(r.answer) || !/Next is the 2023 Nissan Rogue Platinum/.test(r.answer)) fail("cheapest under 40k: " + (r && [r.count, r.answer]));
r = ask("anything under 25");
show("anything under 25", r);
if (!r || r.count !== 1 || !/Civic/.test(r.answer)) fail("under 25 means 25,000: " + (r && [r.count, r.answer]));
r = ask("used suvs under 60,000 km");
show("used suvs under 60,000 km", r);
if (!r || r.count !== 3 || r.filters.maxPrice) fail("km cap isn't a price cap: " + (r && [r.count, r.filters.maxPrice, r.filters.maxKm]));

// --- Colour, fuel, drive, year, certified.
r = ask("any black suvs");
if (!r || r.count !== 2) fail("black suvs: " + (r && r.count));
r = ask("do we have any electric vehicles");
show("do we have any electric vehicles", r);
if (!r || r.count !== 1 || !/no price on the site yet/.test(r.answer) || !/arrives October 22/.test(r.answer)) fail("electric: " + (r && r.answer));
r = ask("hybrids in stock");
if (!r || r.count !== 1 || !/CR-V/.test(r.answer)) fail("hybrids: " + (r && r.answer));
r = ask("any awd rogues");
if (!r || r.count !== 2) fail("awd rogues: " + (r && r.count));
r = ask("2023 or newer used rogues");
if (!r || r.count !== 2) fail("2023 or newer: " + (r && r.count));
r = ask("certified rogue");
if (!r || r.count !== 1 || !/2025/.test(r.answer)) fail("certified rogue: " + (r && r.answer));

// --- The speech engine's spelling.
r = ask("do we have any rouge svs");
show("do we have any rouge svs", r);
if (!r || r.count !== 2) fail("rouge → rogue: " + (r && r.count));

// --- Nothing matches: say so, then one step wider.
r = ask("any rogue sl");
show("any rogue sl", r);
if (!r || !/Nothing on the lot matches Rogue SL/.test(r.answer) || !/3 Rogues? in other trims/.test(r.answer) || !r.widened) fail("wider: " + (r && r.answer));
r = ask("any new civics");
show("any new civics", r);
if (!r || !/Nothing on the lot matches new Civic/.test(r.answer) || !/used/.test(r.answer)) fail("new → used: " + (r && r.answer));

// --- Sold units are not on the lot; not-a-lot sentences are left alone.
r = ask("any kicks");
show("any kicks", r);
if (!r || r.count !== 0 || r.widened) fail("a sold Kicks is not on the lot: " + (r && [r.count, r.answer]));
if (lot.answerLot(V, "book Ken Thursday at 4", {}, { today })) fail("an appointment is not a lot question");
if (lot.answerLot(V, "text Sara that her car is ready", {}, { today })) fail("a text is not a lot question");
if (lot.answerLot(V, "who should I call today", {}, { today })) fail("a who-to-call is not a lot question");
if (lot.answerLot(V, "add a lead named Rogue Smith", {}, { today })) fail("adding a lead is not a lot question");

// --- Structured hints from the agent override the words.
r = ask("what have we got", { condition: "Used", body: /sedan/i, maxPrice: 30000 });
show("what have we got + hints", r);
if (!r || r.count !== 1 || !/Civic/.test(r.answer)) fail("hints: " + (r && [r.count, r.answer]));

// --- The summary the assistant reads.
const s = lot.lotSummary(V);
console.log("summary →", s);
if (!/8 vehicles on the lot \(2 new, 6 used, 1 new units without a website price yet\)/.test(s) || !/Nissan Rogue 3 \(1 new\)/.test(s)) fail("summary: " + s);

console.log(process.exitCode ? "\nlot.test.js FAILED" : "\nlot.test.js passed");
})();
