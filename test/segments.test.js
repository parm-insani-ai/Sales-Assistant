// The next vehicle is a step across or up from what they drive, never down.
const path = require("path");
(async () => {
const seg = await import("file://" + path.resolve(__dirname, "../js/segments.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const c = (t) => { const r = seg.classify(t); return `${r.make}|${r.model}|${r.body}${r.size}|${r.tier}${r.ev ? "|ev" : ""}${r.hybrid ? "|hybrid" : ""}`; };
const want = {
  "2019 INFINITI QX60 LUXE AWD": "infiniti|qx60|suv4|luxury",
  "2021 Infiniti QX50 Sensory": "infiniti|qx50|suv2|luxury",
  "2018 Lexus RX 350": "lexus|rx|suv3|luxury",
  "2020 BMW X5 xDrive40i": "bmw|x5|suv3|luxury",
  "2022 Mercedes-Benz GLC 300": "mercedes|glc 300|suv2|luxury",
  "2017 Toyota RAV4 LE": "toyota|rav4|suv2|mainstream",
  "2020 Honda CR-V Hybrid Touring": "honda|cr-v hybrid|suv2|mainstream|hybrid",
  "2019 Nissan Rogue SV": "nissan|rogue|suv2|mainstream",
  "2016 Nissan Pathfinder Platinum": "nissan|pathfinder|suv4|mainstream",
  "2021 Ford F-150 Lariat": "ford|f-150|truck5|mainstream",
  "2018 Toyota Tacoma TRD": "toyota|tacoma|truck3|mainstream",
  "2022 Tesla Model Y": "tesla|model y|suv2|luxury|ev",
  "2015 Honda Odyssey": "honda|odyssey|van4|mainstream",
  "2020 Range Rover Sport HSE": "range rover|range rover sport|suv3|luxury",
  "2019 Kia Forte LX": "kia|forte|car2|mainstream",
  "2018 Nissan Altima SL": "nissan|altima|car3|mainstream",
};
for (const [t, w] of Object.entries(want)) { const got = c(t); if (got !== w) fail(`${t} → ${got}, wanted ${w}`); }
console.log("classes: " + Object.keys(want).length + " read");

// Ranking: what an Infiniti QX60 owner gets offered.
const lot = [
  { year: 2026, make: "Nissan", model: "Kicks", trim: "SR", condition: "New" },
  { year: 2026, make: "Nissan", model: "Rogue", trim: "SV", condition: "New" },
  { year: 2026, make: "Nissan", model: "Rogue", trim: "Platinum", condition: "New" },
  { year: 2026, make: "Nissan", model: "Murano", trim: "SL", condition: "New" },
  { year: 2026, make: "Nissan", model: "Pathfinder", trim: "Platinum", condition: "New" },
  { year: 2026, make: "Nissan", model: "Pathfinder", trim: "S", condition: "New" },
  { year: 2026, make: "Nissan", model: "Armada", trim: "Platinum", condition: "New" },
  { year: 2023, make: "Infiniti", model: "QX60", trim: "Luxe", condition: "Used" },
  { year: 2017, make: "Infiniti", model: "QX60", trim: "Luxe", condition: "Used" },
  { year: 2022, make: "Infiniti", model: "QX50", trim: "Sensory", condition: "Used" },
  { year: 2026, make: "Nissan", model: "Sentra", trim: "SV", condition: "New" },
  { year: 2026, make: "Nissan", model: "Ariya", trim: "Platinum+", condition: "New" },
  { year: 2026, make: "Nissan", model: "Frontier", trim: "PRO-4X", condition: "New" },
];
const rank = (owned) => { const o = seg.classify(owned); return lot.map((v) => ({ v: `${v.year} ${v.make} ${v.model} ${v.trim}`, s: seg.fitScore(o, seg.classifyUnit(v), v) })).sort((a, b) => b.s - a.s); };
const show = (owned) => { const r = rank(owned); console.log(owned + " →", r.slice(0, 4).map((x) => `${x.v} (${x.s})`).join("; ")); return r; };
let r = show("2019 INFINITI QX60 LUXE AWD");
if (!/QX60/.test(r[0].v) || !/2023/.test(r[0].v)) fail("a QX60 owner's first pick isn't the newer QX60 on the lot: " + r[0].v);
if (!r.slice(0, 4).some((x) => /Pathfinder Platinum/.test(x.v))) fail("Pathfinder Platinum isn't in a QX60 owner's top four");
const kicks = r.find((x) => /Kicks/.test(x.v)), older = r.find((x) => /2017 Infiniti/.test(x.v));
if (kicks.s >= r[3].s) fail("a Kicks SR is offered to a QX60 owner: " + JSON.stringify(r.map((x) => x.v + ":" + x.s)));
if (older.s >= r[0].s - 20) fail("an older QX60 ranks near the newer one");
r = show("2021 Infiniti QX50 Sensory");
if (!/QX50|Murano|Rogue Platinum/.test(r[0].v)) fail("a QX50 owner's first pick: " + r[0].v);
if (/Kicks|Sentra|Frontier/.test(r[0].v + r[1].v)) fail("a QX50 owner is offered a Kicks, Sentra or Frontier first");
r = show("2017 Toyota RAV4 LE");
if (!/Rogue/.test(r[0].v)) fail("a RAV4 owner's first pick isn't a Rogue: " + r[0].v);
r = show("2019 Kia Forte LX");
if (!/Sentra/.test(r[0].v)) fail("a Forte owner's first pick isn't a Sentra: " + r[0].v);
r = show("2021 Ford F-150 Lariat");
if (!/Frontier/.test(r[0].v)) fail("an F-150 owner's first pick isn't the truck on the lot: " + r[0].v);
r = show("2022 Tesla Model Y");
if (!/Ariya/.test(r[0].v)) fail("a Model Y owner's first pick isn't the Ariya: " + r[0].v);
r = show("2015 Honda Odyssey");
if (!/Pathfinder/.test(r[0].v)) fail("a minivan owner's first pick isn't a Pathfinder: " + r[0].v);
r = show("2016 Nissan Pathfinder Platinum");
if (!/Pathfinder Platinum/.test(r[0].v)) fail("a Pathfinder Platinum owner's first pick isn't the new Pathfinder Platinum: " + r[0].v);
if (seg.fitScore(seg.classify("something unknown"), seg.classifyUnit(lot[0]), lot[0]) !== 50) fail("an unknown vehicle should score everything equal");
console.log(process.exitCode ? "\nsegments.test.js FAILED" : "\nsegments.test.js passed");
})();
