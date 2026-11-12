// The network's used inventory in the app: its own chip on Inventory with
// the store on each card, lot answers that say what's here and what's at
// other stores (and the store), "our lot" and "across the network" asked
// apart, the assistant's lot picture, and the switch in Settings.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", status: "available", source: "web" };
  const vehicles = [
    { id: "web_A", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "New", lot: "store", ...x },
    { id: "web_B", year: 2022, make: "Nissan", model: "Rogue", trim: "SV", price: 29900, mileage: 41000, stock: "P22", condition: "Used", lot: "store", ...x },
    { id: "web_C", year: 2021, make: "Nissan", model: "Rogue", trim: "SL", price: 27500, mileage: 58000, stock: "T9981", condition: "Used", lot: "network", dealer: "O'Regan's Toyota Dartmouth", site: "www.oreganstoyotadartmouth.com", ...x },
    { id: "web_D", year: 2020, make: "Nissan", model: "Rogue", trim: "S", price: 23900, mileage: 77000, stock: "H551", condition: "Used", lot: "network", dealer: "O'Regan's Honda Dartmouth", ...x },
    { id: "web_E", year: 2019, make: "Toyota", model: "RAV4", trim: "XLE", price: 26900, mileage: 66000, stock: "T1", condition: "Used", lot: "network", dealer: "O'Regan's Toyota Dartmouth", ...x },
    { id: "web_F", year: 2018, make: "Nissan", model: "Sentra", trim: "SV", price: 14900, mileage: 90000, stock: "P9", condition: "Used", lot: "network", dealer: "O'Regan's Nissan Halifax", status: "sold", createdAt: x.createdAt, updatedAt: x.updatedAt, source: "web" },
    // An as-is Rogue at another store: never offered unless asked for by name.
    { id: "web_G", year: 2016, make: "Nissan", model: "Rogue", trim: "S", price: 8900, mileage: 190000, stock: "W77", condition: "Used", asIs: true, lot: "network", dealer: "O'Regan's Nissan Halifax", ...x },
  ];
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], vehicles, settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72 } }));
});
await p.goto(APP + "/#/inventory");
await p.waitForTimeout(800);

// --- Inventory: the chips keep our lot; the network has its own, counted; the card names the store.
let s = await p.evaluate(() => ({ chips: [...document.querySelectorAll("[data-filter]")].map((c) => c.textContent.trim()), avail: document.querySelectorAll(".veh-list .card").length }));
console.log("chips:", JSON.stringify(s));
if (!s.chips.includes("Network used · 4") || s.avail !== 2) fail("Available shows our two; Network used counts four (the sold one isn't counted; the as-is one is): " + JSON.stringify(s));
await p.click('[data-filter="network"]'); await p.waitForTimeout(300);
s = await p.evaluate(() => ({ n: document.querySelectorAll(".veh-list .card").length, at: [...document.querySelectorAll(".veh-list .veh-at")].map((e) => e.textContent.trim()), asis: [...document.querySelectorAll(".veh-list .row-sub")].filter((e) => /As-is/.test(e.textContent)).length }));
console.log("network chip:", JSON.stringify(s));
if (s.n !== 4 || !s.at.some((t) => /Toyota Dartmouth/.test(t)) || !s.at.some((t) => /Honda Dartmouth/.test(t)) || s.asis !== 1) fail("the network chip lists the four with their stores, the as-is one marked: " + JSON.stringify(s));
await p.click('[data-filter="used"]'); await p.waitForTimeout(300);
s = await p.evaluate(() => document.querySelectorAll(".veh-list .card").length);
if (s !== 1) fail("Used is our own used only: " + s);

// --- Lot answers.
const lot = await p.evaluate(async () => {
  const st = await import("/js/store.js"); const L = await import("/js/lot.js");
  const V = st.all("vehicles");
  const ask = (q) => { const r = L.answerLot(V, q, {}, { force: true }); return r ? { answer: r.answer, count: r.count, ours: r.ours, network: r.network, first: r.matches[0] && r.matches[0].id } : null; };
  return { used: ask("any used Rogues"), ours: ask("used Rogues on our lot"), net: ask("used Rogues across the network"), neu: ask("do we have any new Rogues"), rav: ask("do we have a RAV4"), asis: ask("any as-is Rogues"), summary: L.lotSummary(V) };
});
if (!lot.asis || lot.asis.count !== 1 || lot.asis.first !== "web_G" || !/as-is/.test(lot.asis.answer)) fail("as-is units answer only when asked for: " + JSON.stringify(lot.asis));
if (!/1 as-is, offered only when asked for/.test(lot.summary)) fail("the lot picture counts the as-is apart: " + lot.summary);
console.log("lot:", JSON.stringify(lot, null, 0));
if (!lot.used || lot.used.count !== 3 || lot.used.ours !== 1 || lot.used.network !== 2 || !/1 on our lot and 2 across the network/.test(lot.used.answer) || lot.used.first !== "web_B") fail("used Rogues: ours first, both counted: " + JSON.stringify(lot.used));
if (!/at O'Regan's (Toyota|Honda) Dartmouth/.test(lot.used.answer)) fail("the network unit names its store: " + lot.used.answer);
if (!lot.ours || lot.ours.count !== 1 || lot.ours.network !== 0) fail("'on our lot' is ours alone: " + JSON.stringify(lot.ours));
if (!lot.net || lot.net.count !== 2 || lot.net.ours !== 0 || !/across the network/.test(lot.net.answer)) fail("'across the network' is theirs alone: " + JSON.stringify(lot.net));
if (!lot.neu || lot.neu.count !== 1 || lot.neu.network !== 0) fail("new Rogues never come from the network: " + JSON.stringify(lot.neu));
if (!lot.rav || lot.rav.count !== 1 || !/across the network/.test(lot.rav.answer) || !/Toyota Dartmouth/.test(lot.rav.answer)) fail("a RAV4 we don't stock is found at the Toyota store: " + JSON.stringify(lot.rav));
// Four units at three stores (the sold Sentra doesn't count; the as-is Rogue at the Nissan store does).
if (!/2 vehicles on the lot/.test(lot.summary) || !/Plus 4 used across the 3 other stores in the group/.test(lot.summary)) fail("the assistant's lot picture counts the network apart: " + lot.summary);

// --- The assistant's tool carries the store.
const tool = await p.evaluate(async () => { const m = await import("/js/agent.js"); return (await m.execTool("lot_lookup", { question: "any used Rogues" })).result; });
console.log("tool:", JSON.stringify({ count: tool.count, ours: tool.onOurLot, net: tool.acrossNetwork, units: tool.units.map((u) => [u.vehicle, u.at || ""]) }));
if (tool.count !== 3 || tool.onOurLot !== 1 || tool.acrossNetwork !== 2 || !tool.units.some((u) => /Toyota Dartmouth/.test(u.at || ""))) fail("the tool says where each unit is: " + JSON.stringify(tool));

// --- Settings: the switch, the group name, the button.
await p.evaluate(() => { location.hash = "#/settings"; }); await p.waitForTimeout(700);
const sw = await p.evaluate(async () => {
  const d = document.querySelector('[data-fold="advanced"]'); if (d && !d.open) d.open = true;
  const on = document.querySelector("#d-net-on"), btn = document.querySelector("#net-import"), grp = document.querySelector("#d-net-group");
  if (!on || !btn || !grp) return { found: false };
  const before = btn.disabled;
  on.click(); on.dispatchEvent(new Event("change", { bubbles: true }));
  const st = await import("/js/store.js");
  return { found: true, before, after: btn.disabled, setting: st.getSettings().networkInventory, group: grp.value };
});
console.log("settings:", JSON.stringify(sw));
if (!sw.found || !sw.before || sw.after || sw.setting !== true || sw.group !== "O'Regan's") fail("the switch should turn the network read on and enable the button: " + JSON.stringify(sw));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nnetwork.test.js FAILED" : "\nnetwork.test.js passed");
})();
