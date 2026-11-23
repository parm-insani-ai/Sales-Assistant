// The Facebook Marketplace scoreboard: posts (listings copied), Facebook
// leads laid against the post of their model, what came of them — by
// model, body style and price band — and the posts sitting; on
// Performance for the month, and the assistant's answer.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const pad = (n) => String(n).padStart(2, "0");
const d = new Date(); const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const DAY = 86400000; const ago = (days, h = 10) => new Date(Date.now() - days * DAY - (10 - h) * 3600000).toISOString();
await p.addInitScript(([ago20, ago18, ago16, ago12, ago9, ago3, ago1]) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { updatedAt: "2026-01-01T00:00:00.000Z" };
  const vehicles = [
    { id: "v1", year: 2022, make: "Nissan", model: "Frontier", trim: "PRO-4X", price: 42000, stock: "U100", bodyStyle: "Truck", condition: "used", status: "available", createdAt: "2026-01-01T00:00:00.000Z", ...x },
    { id: "v2", year: 2019, make: "Nissan", model: "Sentra", trim: "SV", price: 14500, stock: "U200", bodyStyle: "Sedan", condition: "used", status: "available", createdAt: "2026-01-01T00:00:00.000Z", ...x },
    { id: "v3", year: 2021, make: "Nissan", model: "Rogue", trim: "SV", price: 28900, stock: "U300", bodyStyle: "SUV", condition: "used", status: "available", createdAt: "2026-01-01T00:00:00.000Z", ...x },
  ];
  const events = [
    { id: "e1", kind: "fb_post", at: ago20, by: "rep", meta: { vehicleId: "v1", vehicle: "2022 Nissan Frontier PRO-4X", stock: "U100" } },
    { id: "e2", kind: "fb_post", at: ago18, by: "rep", meta: { vehicleId: "v2", vehicle: "2019 Nissan Sentra SV", stock: "U200" } },
    { id: "e3", kind: "fb_post", at: ago16, by: "rep", meta: { vehicleId: "v3", vehicle: "2021 Nissan Rogue SV", stock: "U300" } },
    { id: "e4", kind: "fb_post", at: ago3, by: "rep", meta: { vehicleId: "v1", vehicle: "2022 Nissan Frontier PRO-4X", stock: "U100" } },
  ];
  const leads = [
    { id: "l1", name: "Truck Buyer", phone: "9025550001", source: "Facebook Marketplace", vehicleInterest: "2022 Nissan Frontier PRO-4X", stage: "sold", createdAt: ago18, ...x },
    { id: "l2", name: "Truck Two", phone: "9025550002", source: "Facebook", vehicleInterest: "Frontier", stage: "appointment", createdAt: ago12, ...x },
    { id: "l3", name: "Truck Three", phone: "9025550003", source: "facebook marketplace", vehicleInterest: "Nissan Frontier", stage: "new", createdAt: ago1, ...x },
    { id: "l4", name: "Sentra Buyer", phone: "9025550004", source: "Facebook Marketplace", vehicleInterest: "2019 Sentra", stage: "new", createdAt: ago9, ...x },
    { id: "l5", name: "Kicks Asker", phone: "9025550005", source: "Facebook Marketplace", vehicleInterest: "Nissan Kicks", stage: "new", createdAt: ago9, ...x },
    { id: "l6", name: "Walk In", phone: "9025550006", source: "Walk-in", vehicleInterest: "2021 Nissan Rogue SV", stage: "new", createdAt: ago9, ...x },
  ];
  const appointments = [{ id: "a1", leadId: "l2", customerName: "Truck Two", type: "testdrive", when: ago9.slice(0, 16), status: "scheduled", createdAt: ago12, ...x }];
  const sales = [{ id: "s1", leadId: "l1", customerName: "Truck Buyer", vehicle: "2022 Nissan Frontier PRO-4X", saleDate: ago12.slice(0, 10), frontGross: 1500, backGross: 600, commission: 600, createdAt: ago12, ...x }];
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles, events, appointments, sales, settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, goalUnits: 10 } }));
}, [ago(20), ago(18), ago(16), ago(12), ago(9), ago(3), ago(1)]);

// --- The numbers, from the module.
await p.goto(APP + "/#/");
await p.waitForSelector("#view .card", { timeout: 30000 });
const sb = await p.evaluate(async () => {
  const M = await import("/js/mpscore.js"); const st = await import("/js/store.js");
  const to = new Date(); const from = new Date(Date.now() - 60 * 86400000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const sb = M.marketplaceScoreboard({ from: iso(from), to: iso(to), events: st.all("events"), leads: st.all("leads"), appointments: st.all("appointments"), sales: st.all("sales"), vehicles: st.all("vehicles") });
  return { ...sb, line: M.scoreboardLine(sb), key: M.modelKey("2021 Nissan Rogue SV") };
});
console.log("scoreboard:", JSON.stringify({ posts: sb.posts, leads: sb.leads, unmatched: sb.unmatched, total: sb.total, byModel: sb.byModel, byBody: sb.byBody, byPrice: sb.byPrice, sitting: sb.sitting, line: sb.line }));
if (sb.key.make !== "nissan" || sb.key.model !== "rogue") fail("the model key: " + JSON.stringify(sb.key));
if (sb.posts !== 4 || sb.leads !== 5 || sb.unmatched !== 1) fail("four posts, five Facebook leads (the walk-in isn't one), one naming a model never posted: " + JSON.stringify({ posts: sb.posts, leads: sb.leads, unmatched: sb.unmatched }));
const fr = sb.byModel.find((r) => /Frontier/i.test(r.label)), se = sb.byModel.find((r) => /Sentra/i.test(r.label)), ro = sb.byModel.find((r) => /Rogue/i.test(r.label)), ki = sb.byModel.find((r) => /Kicks/i.test(r.label));
if (!fr || fr.posts !== 2 || fr.leads !== 3 || fr.perPost !== 1.5 || fr.booked !== 1 || fr.sold !== 1) fail("the Frontier: two posts, three leads, one booked, one sold: " + JSON.stringify(fr));
if (!se || se.posts !== 1 || se.leads !== 1 || se.daysToLead !== 9) fail("the Sentra: one post, one lead nine days on: " + JSON.stringify(se));
if (!ro || ro.posts !== 1 || ro.leads !== 0 || ro.sitting !== 1) fail("the Rogue: posted, no Facebook lead (the walk-in doesn't count), sitting: " + JSON.stringify(ro));
if (!ki || ki.posts !== 0 || ki.leads !== 1) fail("the Kicks: asked for on Facebook, never posted: " + JSON.stringify(ki));
if (sb.byModel[0].label !== fr.label) fail("best pullers first: " + sb.byModel.map((r) => r.label).join());
const truck = sb.byBody.find((r) => r.label === "Truck"), suv = sb.byBody.find((r) => r.label === "SUV");
if (!truck || truck.leads !== 3 || !suv || suv.leads !== 0) fail("by body style: " + JSON.stringify(sb.byBody));
if (!sb.byPrice.some((r) => r.label === "Under $15k" && r.leads === 1) || !sb.byPrice.some((r) => r.label === "$40k and up" && r.leads === 3)) fail("by price band: " + JSON.stringify(sb.byPrice));
if (sb.sitting.length !== 1 || !/Rogue/.test(sb.sitting[0].name) || sb.sitting[0].days < 15) fail("the Rogue post is the one sitting: " + JSON.stringify(sb.sitting));
if (!/4 posts · 5 leads \(1\.25 a post\) · 1 booked · 1 sold — Frontier pulls best \(1\.5 a post\); 1 post sitting with no lead/.test(sb.line)) fail("the line: " + sb.line);

// --- On Performance, for the month.
await p.evaluate(() => { location.hash = "#/performance"; });
await p.waitForFunction(() => [...document.querySelectorAll("#pf-body .section-title")].some((n) => /Facebook Marketplace/.test(n.textContent)), null, { timeout: 15000 }).catch(() => fail("Performance should carry the Marketplace section"));
const ui = await p.evaluate(() => ({ line: document.querySelector(".pf-mp-line .small")?.textContent.trim(), heads: [...document.querySelectorAll("#pf-body .pf-head")].map((h) => [...h.children].map((c) => c.textContent.trim()).join(" ").trim()), rows: [...document.querySelectorAll("#pf-body .pf-row:not(.pf-head)")].map((r) => [...r.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" ")).filter((t) => /Frontier|Rogue|Sentra|Kicks|Truck|SUV|Sedan/.test(t)) }));
console.log("performance:", JSON.stringify(ui));
if (!/posts? · /.test(ui.line || "") || !ui.heads.some((h) => /Posts Leads \/post Booked Sold Days/.test(h)) || !ui.rows.some((r) => /Frontier 2 3 1\.5 1 1/.test(r))) fail("the section draws the tables: " + JSON.stringify(ui));

// --- The lead form offers the source.
const src = await p.evaluate(async () => { const L = await import("/js/views/leads.js"); L.openLeadForm(); await new Promise((r) => setTimeout(r, 300)); const o = [...document.querySelectorAll('.modal select[name="source"] option')].map((x) => x.value); document.querySelector(".modal .modal-close")?.click(); return o; });
if (!src.includes("Facebook Marketplace")) fail("the lead form should offer Facebook Marketplace: " + JSON.stringify(src));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmpscore.test.js FAILED" : "\nmpscore.test.js passed");
})();
