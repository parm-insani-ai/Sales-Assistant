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

// Certified and as-is, read from the words on the card and in the structured data.
const lib2 = new Function(src.slice(start, end) + "\nreturn { parseInventoryHtml, invAsIs, invCertified };")();
if (!lib2.invAsIs("Wholesale As-Is unit") || !lib2.invAsIs("sold as is") || lib2.invAsIs("Certified Pre-Owned")) fail("as-is reader");
if (!lib2.invCertified("Certified Pre-Owned") || !lib2.invCertified("CPO") || lib2.invCertified("Used")) fail("certified reader");
const cards = `<div class="card">2019 Nissan Kicks SV $9,900 100,000 km Stock #: W1001 Wholesale As-Is VIN 3N1CP5CU3KL123456 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .</div>
<div class="card">2021 Toyota RAV4 XLE Certified Pre-Owned $31,900 45,000 km Stock #: T9981 VIN 2T3P1RFV5MC123456</div>`;
const read = lib2.parseInventoryHtml(cards, {});
const kicks = read.find((v) => v.stock === "W1001"), rav = read.find((v) => v.stock === "T9981");
if (!kicks || !kicks.asIs || kicks.certified || kicks.condition !== "Used") fail("the wholesale unit is as-is and used: " + JSON.stringify(kicks));
if (!rav || !rav.certified || rav.asIs) fail("the CPO unit is certified: " + JSON.stringify(rav));
const ld = `<script type="application/ld+json">{"@type":"Car","name":"2020 Honda CR-V EX-L","description":"Sold as-is, wholesale to the public","vehicleIdentificationNumber":"2HKRW2H88LH123456","brand":"Honda","model":"CR-V","vehicleModelDate":"2020","itemCondition":"https://schema.org/UsedCondition","offers":{"@type":"Offer","price":"12995"}}</script>`;
const l = lib2.parseInventoryHtml(ld, {});
if (!l[0] || !l[0].asIs) fail("as-is from the structured data's description: " + JSON.stringify(l));

// The group site's search feed: the page names the widget and the platform,
// the feed's address carries the page's filters, and a rendered card reads
// field by field — store, price, kilometres, stock, VIN, and the badges that
// say certified or as-traded.
const lib3 = new Function(src.slice(start, end) + "\nreturn { invFeedInfo, invFeedUrl, parseFeedItem };")();
const shell = `<div class="appScreenWidgetArea" data-osw-api-call="vehicle-inventory-search-screen-widget" data-osw-profile-id="abc-123"></div><script>App.stub = {"pendingData":{"oregansServicesEmbedPlugin":{"websiteConfig":{"website":{"servicesWebsite":{"origin":"https:\\/\\/services.example.com","version":"3.1"}}}}}};</script>`;
const info = lib3.invFeedInfo(shell);
if (!info || info.origin !== "https://services.example.com" || info.profile !== "abc-123") fail("the feed from the page: " + JSON.stringify(info));
if (lib3.invFeedInfo("<html><body>plain listing</body></html>") !== null) fail("no widget, no feed");
const feedUrl = new URL(lib3.invFeedUrl(info, "https://www.example.com/inventory/?utm_source=x&search.vehicle-inventory-type-ids.0=2&search.vehicle-category-ids.0=3", 200, 100));
if (feedUrl.origin + feedUrl.pathname !== "https://services.example.com/api/vehicle-inventory-search/") fail("feed path: " + feedUrl.href);
if (feedUrl.searchParams.get("search.vehicle-inventory-type-ids.0") !== "2" || feedUrl.searchParams.get("search.vehicle-category-ids.0") !== "3" || feedUrl.searchParams.has("utm_source")) fail("the page's search filters, and only those, ride along: " + feedUrl.search);
if (feedUrl.searchParams.get("search.results-offset") !== "200" || feedUrl.searchParams.get("search.results-limit") !== "100" || feedUrl.searchParams.get("app.widgetProfile.id") !== "abc-123.searchResults.search" || feedUrl.searchParams.get("do-search") !== "1") fail("offset, limit, profile: " + feedUrl.search);

const card = (o) => `<div data-vehicle-inventory-type-id="${o.type}" class="ouvsrItem" data-vehicle-id="1" data-vehicle-stock="${o.stock}"><div class="ouvsrMedia orP"><a href="${o.href}" class="ouvsrPhoto"><span class="ouvsrMainImage" data-img-ren-load-state="0"></span></a></div><div class="ouvsrHeading orH"><a href="${o.href}" class="ouvsrHeadingLink"><span class="ouvsrInventoryType">${o.typeText}</span><span class="ouvsrModelYear"><span class="ouvsrYear">${o.year}</span><span class="ouvsrMake">${o.make}</span><span class="ouvsrModel">${o.model}</span></span><span class="ouvsrTrimAndPackage">${o.trim}</span><span class="ouvsrTagline">${o.tagline || ""}</span></a></div><div class="ouvsrOwnerLocation"><div class="ouvsrOwnerLocationLink">${o.dealer}</div></div>${o.desc ? `<div class="ouvsrDescription orP">${o.desc}&nbsp;<a class="ouvsrDescriptionMoreLink" href="${o.href}">More</a></div>` : ""}<div class="ouvsrStamps orP"><div class="ouvsrCertsArea orP">${o.badge ? `<a href="/inventory/categories/" data-engagement-content-id="2" class="ouvsrCertificationBadge ouvsrCert" title="${o.badge}"><img class="ouvsrCertificationImage" src="x.png" alt="${o.badge}"/></a>` : ""}</div></div><div class="ouvsrCost"><div class="ouvsrPriceArea"><div class="ouvsrCurrentPrice"><span class="currencyUnit">$</span><span class="currencyValue">${o.price}</span></div><span class="ouvsrPriceTagline"></span></div></div><ul class="ouvsrTechSpecs ouvsrSpecs"><li><div class="ouvsrSpec ouvsrExteriorColor"><span class="ouvsrLabel">Colour</span><span class="ouvsrValue"><span style="background-color:rgb(0,0,139)" class="ouvsrColorSwatch"></span><span class="ouvsrColorName">${o.color}</span></span></div></li><li data-ouvsr-important="1"><div class="ouvsrSpec ouvsrMileage"><span class="ouvsrLabel">Odometer</span><span class="ouvsrValue"><span class="ouvsrValueNum">${o.km}</span><span class="ouvsrValueSuffix">km</span></span></div></li><li><div class="ouvsrSpec ouvsrEngine"><span class="ouvsrLabel">Engine</span><span class="ouvsrValue">2.4L TURBO</span></div></li><li><div class="ouvsrSpec ouvsrTransmission"><span class="ouvsrLabel">Transmission</span><span class="ouvsrValue">Auto</span></div></li><li><div class="ouvsrSpec ouvsrDrivetrain"><span class="ouvsrLabel">Drivetrain</span><span class="ouvsrValue">All-Wheel drive</span></div></li><li><div class="ouvsrSpec ouvsrFuelType"><span class="ouvsrLabel">Fuel Type</span><span class="ouvsrValue">Gas</span></div></li><li><div class="ouvsrSpec ouvsrStockNumber"><span class="ouvsrLabel">Stock #</span><span class="ouvsrValue"><span class="ouvsrShortLabel">#</span>${o.stock}</span></div></li></ul><ul class="ouvsrToolsList"><li><a href="/check-availability/?vehicle.vin=${o.vin}" class="ouvsrContactLink">Contact Us</a></li><li><a href="${o.href}" class="ouvsrDetailsLink">View Details</a></li></ul></div>`;
const base = "https://www.example.com/inventory/";
const cpo = lib3.parseFeedItem(card({ type: 2, typeText: "Used", year: 2024, make: "Nissan", model: "Rogue", trim: "SV", tagline: "Heated seats, Apple CarPlay", dealer: "O&#039;Regan&#039;s Nissan Dartmouth", badge: "Nissan Certified", price: "26,990", color: "Red", km: "41,250", stock: "T9981", vin: "5N1BT3BA0RC000001", href: "/inventory/Used-2024-Nissan-Rogue-SV-T9981/" }), base);
console.log("feed card:", JSON.stringify(cpo));
if (!cpo || cpo.year !== 2024 || cpo.make !== "Nissan" || cpo.model !== "Rogue" || cpo.trim !== "SV" || cpo.condition !== "Used") fail("the card's basics: " + JSON.stringify(cpo));
if (cpo.price !== 26990 || cpo.mileage !== 41250 || cpo.color !== "Red" || cpo.stock !== "T9981" || cpo.vin !== "5N1BT3BA0RC000001") fail("price, km, colour, stock, VIN: " + JSON.stringify(cpo));
if (cpo.dealer !== "O'Regan's Nissan Dartmouth" || cpo.url !== "https://www.example.com/inventory/Used-2024-Nissan-Rogue-SV-T9981/" || cpo.pageUrl !== cpo.url) fail("store and page: " + JSON.stringify(cpo));
if (!cpo.certified || cpo.asIs || cpo.certification !== "Nissan Certified") fail("the certification badge: " + JSON.stringify(cpo));
if (cpo.engine !== "2.4L TURBO" || cpo.transmission !== "Auto" || cpo.drivetrain !== "All-Wheel drive" || cpo.fuel !== "Gas" || !/Heated seats/.test(cpo.description)) fail("specs and tagline: " + JSON.stringify(cpo));
const traded = lib3.parseFeedItem(card({ type: 2, typeText: "Used", year: 2018, make: "Nissan", model: "Qashqai", trim: "SV AWD", dealer: "O'Regan's Wholesale Direct Halifax", badge: "As Traded", desc: "As-TRADED Come view these trades before it's too late!", price: "9,990", color: "Grey", km: "160,232", stock: "NH23380A", vin: "JN1BJ1CR0JW000002", href: "/inventory/Used-2018-Nissan-Qashqai-SV-AWD-NH23380A/" }), base);
if (!traded || !traded.asIs || traded.certified || traded.condition !== "Used" || traded.certification !== "As Traded") fail("the as-traded badge is as-is, never certified: " + JSON.stringify(traded));
if (!/As-TRADED Come view/.test(traded.description)) fail("the description without its More link: " + traded.description);
const plain = lib3.parseFeedItem(card({ type: 2, typeText: "Used", year: 2020, make: "Kia", model: "Sedona", trim: "LX", dealer: "O'Regan's Kia Halifax", price: "19,990", color: "Black", km: "88,000", stock: "25055B", vin: "KNDMB5C10L6000003", href: "/inventory/Used-2020-Kia-Sedona-LX-25055B/" }), base);
if (!plain || plain.certified || plain.asIs || plain.certification !== "") fail("no badge: plain used: " + JSON.stringify(plain));
const neu = lib3.parseFeedItem(card({ type: 1, typeText: "New", year: 2026, make: "Nissan", model: "Kicks", trim: "SR", dealer: "O'Regan's Nissan Halifax", price: "31,990", color: "White", km: "12", stock: "N26001", vin: "3N1CP5DV0SL000004", href: "/inventory/New-2026-Nissan-Kicks-SR-N26001/" }), base);
if (!neu || neu.condition !== "New") fail("a new card reads New: " + JSON.stringify(neu));
if (lib3.parseFeedItem("<div class='ouvsrItem'>nothing here</div>", base) !== null) fail("a card without make and model is nothing");

console.log(process.exitCode ? "\nnetworkparse.test.js FAILED" : "\nnetworkparse.test.js passed");
