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
const lib = new Function(block + "\nreturn { parseInventoryHtml, invPageParam, invPageCount, invText, invSitemapLocs, invVdpLike, invLinks, invApiHints, invScripts, invStock, invPageProbe, invFromSlug, invFromPlatformVehicle, invServicesOrigin, invPlatformVehicleUrl, invKmFromSpecs, invSlim, invPlatformSpecsUrl, invPriceFromArea, invPlatformAreaUrl, invKey };")();

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

// --- 5b. A shell page: the vehicles are on their own pages, found through
// the site's links and its sitemap.
const shell = `<html><head><script src="/assets/app.js"></script><script>var cfg={apiBase:"https://www.example.com/api/v2/inventory/search"};</script></head><body>
<nav><a href="/inventory/">Inventory</a><a href="/inventory/?do-search=1&search.vehicle-inventory-type-ids.0=1">New</a></nav>
<div id="srp"></div><a href="/inventory/2026-nissan-rogue-sv-r26011/">quick link</a><a href="/about-us/">About</a></body></html>`;
const links = lib.invLinks(shell, "https://www.example.com/inventory/?do-search=1");
console.log("vehicle-page links from a shell:", JSON.stringify(links));
if (links.length !== 1 || !/2026-nissan-rogue-sv-r26011/.test(links[0])) fail("the vehicle page link wasn't picked out of the shell (and nothing else)");
const hints = lib.invApiHints(shell);
if (!hints.some((h) => /api\/v2\/inventory\/search/.test(h))) fail("the API hint wasn't found: " + JSON.stringify(hints));
if (!lib.invScripts(shell).includes("/assets/app.js")) fail("the script list is wrong");
const sm = `<?xml version="1.0"?><urlset><url><loc>https://www.example.com/inventory/</loc></url><url><loc>https://www.example.com/inventory/2021-nissan-rogue-sl-p4411/</loc></url><url><loc>https://www.example.com/used/2019-altima-sv-1N4BL4DV5KC111222/</loc></url><url><loc>https://www.example.com/contact-us/</loc></url></urlset>`;
const locs = lib.invSitemapLocs(sm).filter(lib.invVdpLike);
console.log("vehicle pages from a sitemap:", JSON.stringify(locs));
if (locs.length !== 2) fail(`sitemap: ${locs.length} vehicle pages, wanted 2 (not the index, not contact)`);

// --- 5c. One vehicle's own page, itself a shell: the VIN sits alone in an
// analytics push; the title, the metas and the visible text carry the rest.
const vdp = `<html><head><title>2024 Mazda CX-5 GS-L AWD | O'Regan's Nissan Halifax</title>
<meta property="og:title" content="2024 Mazda CX-5 GS-L AWD"><meta property="og:image" content="https://cdn.example/p12345-1.jpg">
<script>window.dataLayer = window.dataLayer || []; dataLayer.push({"event":"vdp_view","vehicle":{"vin":"JM3KFBCM5R0123456","vehicle_year":"2024","vehicle_make":"Mazda","vehicle_model":"CX-5","vehicle_trim":"GS-L AWD","vehicle_price":"32995","vehicle_odometer":"41,200","vehicle_condition":"used","stock_number":"P12345"}});</script>
</head><body><div id="vdp"></div><div class="specs">Stock #: P12345 · 41,200 km · Pre-Owned</div><div class="price">$32,995</div></body></html>`;
const one = lib.parseInventoryHtml(vdp, { single: true, url: "https://www.example.com/inventory/used/2024-mazda-cx-5-gs-l-awd-p12345/" });
console.log("a vehicle's own page →", JSON.stringify(one));
if (one.length !== 1) fail(`a vehicle page gave ${one.length} vehicles, wanted exactly 1`);
const cx5 = one[0] || {};
if (cx5.vin !== "JM3KFBCM5R0123456" || cx5.year !== 2024 || cx5.make !== "Mazda" || cx5.model !== "CX-5" || !/^GS-L/.test(cx5.trim) || cx5.price !== 32995 || cx5.mileage !== 41200 || cx5.stock !== "P12345" || cx5.condition !== "Used" || !/p12345-1\.jpg/.test(cx5.photo)) fail("the vehicle page didn't read right: " + JSON.stringify(cx5));
// The same page with only the VIN in the push and nothing else in scripts.
const bare = vdp.replace(/"vehicle_year"[\s\S]*?"stock_number":"P12345"/, '"x":1');
const two = lib.parseInventoryHtml(bare, { single: true, url: "https://www.example.com/inventory/used/2024-mazda-cx-5-gs-l-awd-p12345/" });
console.log("…with the VIN alone in the push →", JSON.stringify(two[0] || null));
const b2 = two[0] || {};
if (b2.vin !== "JM3KFBCM5R0123456" || b2.year !== 2024 || b2.make !== "Mazda" || b2.model !== "CX-5" || b2.price !== 32995 || b2.mileage !== 41200 || b2.stock !== "P12345" || b2.condition !== "Used") fail("the title/text fallback didn't fill the vehicle: " + JSON.stringify(b2));

// --- 5d. "Stock photos" is not a stock number; a shell page's VIN-only push reads nothing but the VIN.
const shellVdp = `<html><head><title>Inventory - Example Nissan</title><meta property="og:title" content="Inventory - Example Nissan"></head>
<body><div id="app"></div><p>Photos are stock photos and may not match.</p>
<script>dataLayer.push({"event":"vdp","vehicle":{"vin":"2HKRS6H90SH000111"}});</script></body></html>`;
const sh = lib.parseInventoryHtml(shellVdp, { single: true, url: "https://www.example.com/inventory/used/2HKRS6H90SH000111/" });
console.log("a shell page →", JSON.stringify(sh[0] || null));
if (!sh[0] || sh[0].vin !== "2HKRS6H90SH000111" || sh[0].stock !== "" || sh[0].make !== "") fail("the shell page invented fields: " + JSON.stringify(sh[0]));
if (lib.invStock("Stock #: A1900 · 48,300 km") !== "A1900" || lib.invStock("Stock No. R26011") !== "R26011" || lib.invStock("stock photos") !== "" || lib.invStock("Stock: K2610") !== "K2610") fail("the stock reader is off");
const probe = lib.invPageProbe(shellVdp, "https://www.example.com/inventory/used/2HKRS6H90SH000111/");
console.log("the probe →", JSON.stringify(probe).slice(0, 300));
if (!/Example Nissan/.test(probe.title) || probe.vinContexts.length !== 1 || probe.inlineScripts.length !== 1 || !/stock photos/.test(probe.textSnippet)) fail("the probe missed the page's parts: " + JSON.stringify(probe));

// --- 5e. The page's address says what the vehicle is when the page itself doesn't.
const slugs = {
  "https://x.com/inventory/Used-2019-Mazda-CX-5-Signature-NH22985A/": ["Used", 2019, "Mazda", "CX-5", "Signature", "NH22985A"],
  "https://x.com/inventory/Used-2024-Honda-CR-V-Hybrid-Touring-NIP1879/": ["Used", 2024, "Honda", "CR-V", "Hybrid Touring", "NIP1879"],
  "https://x.com/inventory/Used-2020-BMW-5-Series-530i-xDrive-NHP1895/": ["Used", 2020, "BMW", "5 Series", "530i xDrive", "NHP1895"],
  "https://x.com/inventory/New-2026-Nissan-Rogue-SV-N26011/": ["New", 2026, "Nissan", "Rogue", "SV", "N26011"],
  "https://x.com/inventory/New-2025-Nissan-Z-Performance-N25101/": ["New", 2025, "Nissan", "Z", "Performance", "N25101"],
  "https://x.com/inventory/Used-2023-Hyundai-IONIQ-5-Preferred-NH1001/": ["Used", 2023, "Hyundai", "IONIQ 5", "Preferred", "NH1001"],
  "https://x.com/inventory/Used-2022-Land-Rover-Range-Rover-Sport-HSE-NHP2001/": ["Used", 2022, "Land-Rover", "Range Rover", "Sport HSE", "NHP2001"],
  "https://x.com/inventory/Used-2021-Ford-F-150-XLT-NH3001/": ["Used", 2021, "Ford", "F-150", "XLT", "NH3001"],
  "https://x.com/inventory/New-2027-Nissan-Ariya-SV+-801028/": ["New", 2027, "Nissan", "Ariya", "SV+", "801028"],
  "https://x.com/inventory/New-2026-Nissan-Frontier-PRO-4X-794371/": ["New", 2026, "Nissan", "Frontier", "PRO 4X", "794371"],
};
for (const [u, want] of Object.entries(slugs)) {
  const s = lib.invFromSlug(u) || {};
  const got = [s.condition, s.year, s.make, s.model, s.trim, s.stock];
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`the address ${u} read as ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}
console.log("addresses →", Object.keys(slugs).length + " read right");
if (lib.invFromSlug("https://x.com/inventory/categories/6-month-warranty/")) fail("a category page read as a vehicle");
const fromSlug = lib.parseInventoryHtml(shellVdp, { single: true, url: "https://x.com/inventory/Used-2024-Honda-CR-V-Hybrid-Touring-NIP1879/" })[0] || {};
console.log("shell page + address →", JSON.stringify(fromSlug));
if (fromSlug.vin !== "2HKRS6H90SH000111" || fromSlug.year !== 2024 || fromSlug.make !== "Honda" || fromSlug.model !== "CR-V" || fromSlug.trim !== "Hybrid Touring" || fromSlug.stock !== "NIP1879" || fromSlug.condition !== "Used") fail("the address didn't fill the shell page's vehicle: " + JSON.stringify(fromSlug));

// --- 5f. The platform's answer for one vehicle, as its own widget reads it.
const platform = {"includeNewGetLowerPrice":false,"vin":"2HKRS6H98RH210868","stockNumber":"NIP1879","price":41990,"previousPrice":43990,"basePrice":"41990.00","vehicleYear":2024,"demo":0,"trimDescription":"Touring","shortDescription":null,"trimMarketingBlurb":"Leather I Sunroof","engineDescription":"2.0L","inventoryDate":"2026-09-17T00:00:00-03:00","vehicleInventoryType":{"id":2,"name":"Used"},"vehicleCategory":{"id":2,"name":"Green Light Certified","certified":1,"manufacturerCertified":0},"vehicleBodyStyleGroup":{"name":"SUV"},"vehicleModel":{"id":3048,"name":"CR-V Hybrid","slug":"CR-V-Hybrid","vehicleMake":{"id":17,"name":"Honda"}},"vehicleModelYear":null,"vinDetails":{"hasVinDetails":false,"vehicleTrim":null,"exteriorVehicleColor":null},"resolvedComprehensiveInfo":{"model":{"id":3048,"label":"CR-V Hybrid"},"trim":{"id":null,"label":"Touring"},"transmissionType":{"name":"Auto"},"drivetrainType":{"name":"All-Wheel drive"},"fuelType":{"id":5,"name":"Hybrid"},"interiorColor":{"name":"Black"},"exteriorColor":{"name":"Platinum White Pearl"}},"specs":{"odometerKm":24350},"jsonLd":{"@type":"Car","image":["https://cdn.example/nip1879-1.jpg"]}};
const pv = lib.invFromPlatformVehicle(platform, "https://x.com/inventory/Used-2024-Honda-CR-V-Hybrid-Touring-NIP1879/");
console.log("the platform's vehicle →", JSON.stringify(pv));
if (!pv || pv.vin !== "2HKRS6H98RH210868" || pv.stock !== "NIP1879" || pv.price !== 41990 || pv.wasPrice !== 43990 || pv.mileage !== 24350 || pv.year !== 2024 || pv.make !== "Honda" || pv.model !== "CR-V Hybrid" || pv.trim !== "Touring" || pv.condition !== "Used" || pv.certified !== true || pv.bodyStyle !== "SUV" || pv.color !== "Platinum White Pearl" || pv.drivetrain !== "All-Wheel drive" || pv.fuel !== "Hybrid" || !/nip1879-1\.jpg/.test(pv.photo)) fail("the platform vehicle didn't read right: " + JSON.stringify(pv));
const stubHtml = '<script>App.stub = {"pendingData":{"oregansServicesEmbedPlugin":{"websiteConfig":{"website":{"servicesWebsite":{"origin":"https:\\/\\/oserv3.example.com","version":"3.378.0"}}}}}};</script>';
if (lib.invServicesOrigin(stubHtml) !== "https://oserv3.example.com") fail("the platform origin wasn't read from the stub: " + lib.invServicesOrigin(stubHtml));
if (lib.invServicesOrigin("<html></html>") !== "") fail("a page without a stub invented a platform");
const pu = lib.invPlatformVehicleUrl("https://oserv3.example.com", "2HKRS6H98RH210868", "https://x.com/inventory/a/");
if (!/^https:\/\/oserv3\.example\.com\/api\/vehicle-inventory-details-screen-widget\/\?load-vehicle-request\.query\.vin=2HKRS6H98RH210868&do-load-vehicle-request=1&app\.referrer=https%3A%2F%2Fx\.com/.test(pu)) fail("the platform URL is wrong: " + pu);

// --- 5g. Kilometres from the specs widget, whatever shape it answers in.
if (lib.invKmFromSpecs({ specs: [{ label: "Odometer", value: "24,350 km" }] }) !== 24350) fail("km from a labelled spec");
if (lib.invKmFromSpecs({ vehicle: { odometerKm: 41200 } }) !== 41200) fail("km from a named number");
if (lib.invKmFromSpecs({ html: "<table><tr><td>Stock #</td><td>NIP1879</td></tr><tr><td>Kilometres</td><td>24,350 km</td></tr></table>" }) !== 24350) fail("km from html");
if (lib.invKmFromSpecs({ html: "<p>No specs</p>" }) !== null) fail("no km invented");
const slim = lib.invSlim({ a: "x".repeat(400), b: { c: [1, 2, 3, 4, 5, 6, 7, 8] } });
if (slim.a.length !== 161 || slim.b.c.length !== 6) fail("slim didn't cut: " + JSON.stringify(slim));
if (!/vehicle-summary-specs-widget\/\?load-vehicle-summary-specs-request\.vin=ABC&do-load-vehicle-summary-specs-request=1/.test(lib.invPlatformSpecsUrl("https://o.example.com", "ABC", "https://x.com/", "vin"))) fail("specs url");

// --- 5h. A new unit: the trim comes from the VIN when the description is UNKNOWN; the price from the price area.
const newUnit = JSON.parse(JSON.stringify(platform)); newUnit.price = null; newUnit.basePrice = null; newUnit.previousPrice = null; newUnit.trimDescription = "UNKNOWN";
newUnit.vinDetails.vehicleTrim = { id: 1, name: "SV+" }; newUnit.vehicleInventoryType = { id: 1, name: "New" }; newUnit.vehicleCategory = null;
const nu = lib.invFromPlatformVehicle(newUnit, "https://x.com/inventory/New-2027-Nissan-Ariya-SV-794371/");
if (nu.trim !== "SV+" || nu.price !== null || nu.condition !== "New" || nu.certified !== false) fail("the new unit didn't read right: " + JSON.stringify(nu));
if (lib.invPriceFromArea({ payment: { amount: 289, frequency: "bi-weekly" }, msrp: 52998 }) !== 52998) fail("price from a named msrp");
if (lib.invPriceFromArea({ html: "<div class='ovpawPayment'>$289 bi-weekly</div><div class='ovpawPrice'>MSRP <span>$52,998</span></div>" }) !== 52998) fail("price from html");
if (lib.invPriceFromArea({ html: "<div>$1,234 /mo</div><div>$61,500</div>" }) !== 61500) fail("largest dollar figure that isn't a payment");
if (lib.invPriceFromArea({ html: "<div>Call for pricing</div>" }) !== null) fail("no price invented");
if (!/vehicle-price-area-widget\/\?load-request\.vehicle-vin=ABC&do-load-request=1&load-request\.ok=1/.test(lib.invPlatformAreaUrl("https://o.example.com", "ABC", "https://x.com/", "load-request.vehicle-vin"))) fail("area url");

// --- 5i. Two factory orders without VINs are two records, not one.
const noVin = [{ vin: "", stock: "801028", url: "https://x.com/inventory/New-2027-Nissan-Ariya-SV+-801028/" }, { vin: "", stock: "801029", url: "https://x.com/inventory/New-2027-Nissan-Ariya-SV+-801029/" }, { vin: "", stock: "", url: "https://x.com/inventory/New-2027-Nissan-Leaf-SV+/" }, { vin: "", stock: "", url: "https://x.com/inventory/New-2027-Nissan-Leaf-S+/" }];
const keys = noVin.map(lib.invKey);
console.log("keys without a VIN →", JSON.stringify(keys));
if (new Set(keys).size !== 4 || keys[0] !== "stk_801028" || !/^url_/.test(keys[2])) fail("VIN-less units collapse: " + JSON.stringify(keys));
if (lib.invKey({ vin: "2hkrs6h98rh210868", stock: "NIP1879" }) !== "2HKRS6H98RH210868") fail("the VIN is the key when there is one");
const shellNoVin = lib.parseInventoryHtml(`<html><head><title>New 2027 Nissan Ariya SV+ #801028 - Example</title></head><body><script>App.stub = {"pendingData":{"vehicle":{"vin":"","title":"New 2027 Nissan Ariya SV+ #801028"}}};</script></body></html>`, { single: true, url: "https://x.com/inventory/New-2027-Nissan-Ariya-SV+-801028/" })[0] || {};
console.log("a page with no VIN →", JSON.stringify(shellNoVin));
if (shellNoVin.stock !== "801028" || shellNoVin.year !== 2027 || shellNoVin.model !== "Ariya" || shellNoVin.trim !== "SV+" || shellNoVin.condition !== "New") fail("a VIN-less page didn't read from its address: " + JSON.stringify(shellNoVin));

// --- 5. Nothing that looks like a vehicle is nothing.
const none = lib.parseInventoryHtml("<html><body><p>Coming soon</p></body></html>");
if (none.length) fail("an empty page produced vehicles");

console.log(process.exitCode ? "\ninventoryparse.test.js FAILED" : "\ninventoryparse.test.js passed");
