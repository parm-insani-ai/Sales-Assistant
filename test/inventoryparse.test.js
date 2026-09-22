// The lot reader inside the Supabase function, run here in node. The block
// between the "inventory parser" markers in the function is plain JS so this
// test can lift it out and feed it the three shapes a dealer site takes:
// structured data for search engines, inline JSON for the site's own
// scripts, and bare HTML with a VIN in it.
const fs = require("fs"), path = require("path");
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

const src = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "voice-agent", "index.ts"), "utf8");
const start = src.indexOf("// === inventory parser (plain JS");
const end = src.indexOf("// === inventory parser end ===");
if (start < 0 || end < 0) { fail("the parser markers aren't in the function"); process.exit(1); }
const block = src.slice(start, end);
const lib = new Function(block + "\nreturn { parseInventoryHtml, invPageParam, invPageCount, invText };")();

// --- 1. Structured data, the way most dealer platforms publish it.
const jsonld = `<html><head><title>New and Used Inventory | O'Regan's</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
 {"@type":"ListItem","position":1,"item":{"@type":"Car","name":"2026 Nissan Rogue SV","vehicleIdentificationNumber":"5N1BT3BB1SC123456","sku":"R26011","brand":{"@type":"Brand","name":"Nissan"},"model":"Rogue","vehicleConfiguration":"SV","vehicleModelDate":"2026","color":"Gun Metallic","itemCondition":"https://schema.org/NewCondition","mileageFromOdometer":{"@type":"QuantitativeValue","value":"14","unitCode":"KMT"},"url":"/vehicle/2026-nissan-rogue-sv-r26011","image":["https://cdn.example/r26011-1.jpg"],"offers":{"@type":"Offer","price":"38995","priceCurrency":"CAD"}}},
 {"@type":"ListItem","position":2,"item":{"@type":"Car","name":"2021 Nissan Rogue SL Platinum","vehicleIdentificationNumber":"JN8AT3CB0MW654321","sku":"P4411","brand":"Nissan","model":"Rogue","vehicleConfiguration":"SL Platinum","vehicleModelDate":"2021","itemCondition":"https://schema.org/UsedCondition","mileageFromOdometer":{"@type":"QuantitativeValue","value":"61,204"},"url":"https://www.example.com/vehicle/p4411","offers":{"@type":"Offer","price":27900}}}
]}</script></head><body>
<a href="/inventory/?do-search=1&page=2">2</a><a href="/inventory/?do-search=1&page=3">3</a>
</body></html>`;
const a = lib.parseInventoryHtml(jsonld);
console.log("structured data →", JSON.stringify(a.map((v) => [v.year, v.make, v.model, v.trim, v.price, v.mileage, v.stock, v.condition, v.via])));
if (a.length !== 2) fail(`structured data: ${a.length} vehicles, wanted 2`);
if (!a.some((v) => v.vin === "5N1BT3BB1SC123456" && v.year === 2026 && v.make === "Nissan" && v.model === "Rogue" && v.trim === "SV" && v.price === 38995 && v.mileage === 14 && v.stock === "R26011" && v.condition === "New" && v.url === "/vehicle/2026-nissan-rogue-sv-r26011" && v.photo === "https://cdn.example/r26011-1.jpg")) fail("the new Rogue didn't read right: " + JSON.stringify(a[0]));
if (!a.some((v) => v.vin === "JN8AT3CB0MW654321" && v.trim === "SL Platinum" && v.price === 27900 && v.mileage === 61204 && v.condition === "Used")) fail("the used Rogue didn't read right: " + JSON.stringify(a[1]));
if (lib.invPageParam(jsonld) !== "page" || lib.invPageCount(jsonld) !== 3) fail(`pagination: ${lib.invPageParam(jsonld)} / ${lib.invPageCount(jsonld)}`);

// --- 2. Inline JSON for the site's own scripts (quoted and unquoted keys).
const inline = `<html><body><div id="srp"></div>
<script>window.__SRP__ = {"results":[{"vin":"1N4BL4BV5RC000001","stock_number":"R2601","year":2026,"make":"Nissan","model":"Rogue","trim":"SV","price":38995,"odometer":12,"exterior_color":"Gun Metallic","body_style":"SUV","isNew":true,"vdpUrl":"/vehicles/r2601"},
{"vin":"5N1AT3AA0RC000002","stock_number":"K2502","year":2025,"make":"Nissan","model":"Kicks","trim":"SR","price":"29,450","odometer":"8","exterior_color":"Blue","isNew":false,"vdpUrl":"/vehicles/k2502"}]};
var other = { vin: '3N1AB8CV0RY000003', title: '2024 Nissan Sentra SV', price: 24990, kilometers: 31000, stockNo: 'S1003', type: 'Used' };</script>
</body></html>`;
const b = lib.parseInventoryHtml(inline);
console.log("inline JSON →", JSON.stringify(b.map((v) => [v.year, v.make, v.model, v.trim, v.price, v.mileage, v.stock, v.condition, v.via])));
if (b.length !== 3) fail(`inline JSON: ${b.length} vehicles, wanted 3`);
const rogue = b.find((v) => v.vin === "1N4BL4BV5RC000001");
if (!rogue || rogue.price !== 38995 || rogue.mileage !== 12 || rogue.stock !== "R2601" || rogue.condition !== "New" || rogue.color !== "Gun Metallic" || rogue.url !== "/vehicles/r2601") fail("the Rogue from inline JSON didn't read right: " + JSON.stringify(rogue));
const kicks = b.find((v) => v.vin === "5N1AT3AA0RC000002");
if (!kicks || kicks.price !== 29450 || kicks.condition !== "Used") fail("the Kicks didn't read right: " + JSON.stringify(kicks));
const sentra = b.find((v) => v.vin === "3N1AB8CV0RY000003");
if (!sentra || sentra.year !== 2024 || sentra.model !== "Sentra" || sentra.trim !== "SV" || sentra.mileage !== 31000 || sentra.stock !== "S1003" || sentra.condition !== "Used") fail("the unquoted-keys Sentra didn't read right: " + JSON.stringify(sentra));

// --- 3. Bare HTML: a card with a VIN, a title, a price, kilometres, a stock number.
const html = `<html><body>
<div class="vehicle-card"><a href="/inventory/used/2019-nissan-altima-sv-a1900/"><img data-src="https://cdn.example/a1900.jpg"></a>
<h3>2019 Nissan Altima SV AWD</h3><span class="badge">Pre-Owned</span>
<div class="price">$21,495</div><div class="km">48,300 km</div><div>Stock #: A1900</div><div class="vin">VIN: 1N4BL4DV5KC111222</div></div>
<div class="vehicle-card"><a href="/inventory/new/2026-nissan-kicks-sr-k2610/"><img src="https://cdn.example/k2610.webp"></a>
<h3>2026 Nissan Kicks SR</h3><span class="badge">New</span><div class="price">$31,240</div><div>Stock #: K2610</div><div class="vin">VIN: 3N8AP6DB0SL333444</div></div>
<nav><a href="?do-search=1&pg=2">Next</a></nav>
</body></html>`;
const c = lib.parseInventoryHtml(html);
console.log("bare HTML →", JSON.stringify(c.map((v) => [v.year, v.make, v.model, v.trim, v.price, v.mileage, v.stock, v.condition, v.via])));
if (c.length !== 2) fail(`bare HTML: ${c.length} vehicles, wanted 2`);
const altima = c.find((v) => v.vin === "1N4BL4DV5KC111222");
if (!altima || altima.year !== 2019 || altima.make !== "Nissan" || altima.model !== "Altima" || !/^SV/.test(altima.trim) || altima.price !== 21495 || altima.mileage !== 48300 || altima.stock !== "A1900" || altima.condition !== "Used" || !/a1900/.test(altima.url) || !/a1900\.jpg/.test(altima.photo)) fail("the Altima from bare HTML didn't read right: " + JSON.stringify(altima));
const k2610 = c.find((v) => v.vin === "3N8AP6DB0SL333444");
if (!k2610 || k2610.price !== 31240 || k2610.condition !== "New" || k2610.stock !== "K2610") fail("the Kicks from bare HTML didn't read right: " + JSON.stringify(k2610));
if (lib.invPageParam(html) !== "pg") fail(`pagination param from bare HTML: ${lib.invPageParam(html)}`);

// --- 4. The strategies merge: structured data wins, bare HTML fills a blank.
const mixed = jsonld.replace("</body>", `<div>2026 Nissan Rogue SV Stock #: R26011 VIN 5N1BT3BB1SC123456 $38,995 <span>Sunroof</span> 14 km</div></body>`);
const d = lib.parseInventoryHtml(mixed);
if (d.length !== 2) fail(`merging: ${d.length} vehicles, wanted 2 (the same VIN twice is one)`);

// --- 5. Nothing that looks like a vehicle is nothing.
const none = lib.parseInventoryHtml("<html><body><p>Coming soon</p></body></html>");
if (none.length) fail("an empty page produced vehicles");

console.log(process.exitCode ? "\ninventoryparse.test.js FAILED" : "\ninventoryparse.test.js passed");
