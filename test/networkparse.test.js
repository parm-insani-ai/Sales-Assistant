// The network read's store reader, lifted out of the function and run in
// node: the store from the structured data's seller, from a field in the
// site's script, from the group's name in a card's text, and from the
// vehicle page's host — and never the group's own name from a header.
const fs = require("fs"), path = require("path");
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const src = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "voice-agent", "index.ts"), "utf8");
const start = src.indexOf("// === inventory parser (plain JS"), end = src.indexOf("// === inventory parser end ===");
const lib = new Function(src.slice(start, end) + "\nreturn { parseInventoryHtml, invDealerRe, invDealerIn, invDealerFromHost };")();
const prefix = "O'Regan's";
const re = lib.invDealerRe(prefix);

// The name in a card's text, curly or straight apostrophes; the words after a name cut off.
const a = lib.invDealerIn("2021 Toyota RAV4 XLE $31,900 O’Regan’s Toyota Dartmouth Used 45,000 km", re, prefix);
if (a !== "O'Regan's Toyota Dartmouth") fail("the store from the card: " + a);
const b = lib.invDealerIn("O'Regan's Hyundai Dartmouth View Details", re, prefix);
if (b !== "O'Regan's Hyundai Dartmouth") fail("stop at 'View': " + b);
const c = lib.invDealerIn("Welcome to O'Regan's Auto Group — Used Inventory", re, prefix);
if (c !== "") fail("the group's own name is not a store: " + JSON.stringify(c));
const d = lib.invDealerIn("Browse O'Regan's inventory across the group", re, prefix);
if (d !== "") fail("'inventory' is not a store: " + JSON.stringify(d));

// The host, when the group site links to the store's own page.
if (lib.invDealerFromHost("www.oregansnissanhalifax.com", prefix) !== "O'Regan's Nissan Halifax") fail("host → store: " + lib.invDealerFromHost("www.oregansnissanhalifax.com", prefix));
if (lib.invDealerFromHost("oreganstoyotadartmouth.com", prefix) !== "O'Regan's Toyota Dartmouth") fail("host → store 2");
if (lib.invDealerFromHost("www.oregansvw.com", prefix) !== "O'Regan's Volkswagen") fail("host → vw: " + lib.invDealerFromHost("www.oregansvw.com", prefix));
if (lib.invDealerFromHost("www.oregans.com", prefix) !== "") fail("the group host names no store");

// Structured data with a seller.
const jsonld = `<script type="application/ld+json">{"@type":"Car","name":"2020 Honda CR-V EX-L","vehicleIdentificationNumber":"2HKRW2H88LH123456","sku":"H5521","brand":"Honda","model":"CR-V","vehicleModelDate":"2020","itemCondition":"https://schema.org/UsedCondition","offers":{"@type":"Offer","price":"29995","seller":{"@type":"AutoDealer","name":"O'Regan's Honda Dartmouth"}}}</script>`;
const j = lib.parseInventoryHtml(jsonld, { dealerRe: re, dealerPrefix: prefix });
if (j.length !== 1 || j[0].dealer !== "O'Regan's Honda Dartmouth" || j[0].condition !== "Used") fail("seller from structured data: " + JSON.stringify(j));

// A card in plain HTML, the store named in its text.
const html = `<div class="card"><h3>2021 Toyota RAV4 XLE</h3><span>$31,900</span><span>45,000 km</span><span>Stock #: T9981</span><span>O'Regan's Toyota Dartmouth</span><a href="/inventory/used-2021-toyota-rav4-xle-t9981/">View</a><span>VIN 2T3P1RFV5MC123456</span></div>
<div class="card"><h3>2019 Nissan Kicks SV</h3><span>$18,500</span><span>61,000 km</span><span>Stock #: N4410</span><span>O'Regan's Nissan Halifax</span><a href="/inventory/used-2019-nissan-kicks-sv-n4410/">View</a><span>VIN 3N1CP5CU3KL123456</span></div>`;
const h = lib.parseInventoryHtml(html, { dealerRe: re, dealerPrefix: prefix });
if (h.length !== 2 || h[0].dealer !== "O'Regan's Toyota Dartmouth" || h[1].dealer !== "O'Regan's Nissan Halifax") fail("each card its own store: " + JSON.stringify(h.map((v) => [v.model, v.dealer])));
// Without a prefix nothing is read as a store, and nothing breaks.
const n = lib.parseInventoryHtml(html, {});
if (n.length !== 2 || n[0].dealer !== "") fail("no prefix, no store: " + JSON.stringify(n.map((v) => v.dealer)));

console.log(process.exitCode ? "\nnetworkparse.test.js FAILED" : "\nnetworkparse.test.js passed");
