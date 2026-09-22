// "Do we have any Rogue SVs?" — asked out loud, answered from the lot with the
// website's prices, on the device, with the units it counted put on screen.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, mileage: 14, color: "Gun Metallic", bodyStyle: "SUV", condition: "New", stock: "N26011", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v2", year: 2025, make: "Nissan", model: "Rogue", trim: "SV", price: 35990, mileage: 12400, color: "Pearl White", bodyStyle: "SUV", condition: "Used", certified: true, stock: "NHP1900", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v3", year: 2022, make: "Honda", model: "Civic", trim: "Sport", price: 24990, mileage: 94573, color: "Black", bodyStyle: "Sedan", condition: "Used", certified: true, stock: "NHP1868", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v4", year: 2027, make: "Nissan", model: "Ariya", trim: "SV+", price: null, mileage: null, color: "Northern Lights Metallic", condition: "New", stock: "801028", status: "available", source: "web", fuel: "Electric", inventoryDate: "2099-10-22", createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak: (u) => { (window.__spoke = window.__spoke || []).push(String(u.text)); if (u.onend) setTimeout(u.onend, 0); }, cancel: () => {} } });
});
await p.goto(APP + "/#/");
await p.waitForTimeout(700);

// --- The agent's tool: the count, the website's price, the units.
const tool = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("lot_lookup", { question: "do we have any rogue svs" }); });
console.log("lot_lookup →", JSON.stringify(tool.result).slice(0, 300));
if (tool.result.count !== 2 || !/38,995/.test(tool.result.answer) || !/35,990/.test(tool.result.answer)) fail("the tool didn't count the two Rogue SVs with the website's prices: " + JSON.stringify(tool.result));
if (!tool.result.units.some((u) => u.stock === "NHP1900" && u.price === 35990 && u.km === 12400)) fail("the units don't carry stock, price and km");
await p.waitForTimeout(400);
const screen = await p.evaluate(() => ({ hash: location.hash, chip: document.querySelector('[data-act="unpick"]')?.textContent.trim(), rows: [...document.querySelectorAll(".row-title")].map((n) => n.textContent.trim()) }));
console.log("on screen:", JSON.stringify(screen));
if (screen.hash !== "#/inventory" || !/Rogue SV/.test(screen.chip || "") || screen.rows.length !== 2) fail("the counted units aren't on the Inventory screen under the question: " + JSON.stringify(screen));

// --- Tapping the chip away shows the whole lot again.
await p.click('[data-act="unpick"]');
await p.waitForTimeout(200);
const whole = await p.evaluate(() => [...document.querySelectorAll(".row-title")].length);
if (whole !== 4) fail(`the whole lot didn't come back after the chip: ${whole}`);

// --- The offline parser knows a lot question from a command.
const parsed = await p.evaluate(async () => {
  const v = await import("/js/voice.js");
  return {
    q: v.parseCommand("how many rogues do we have").action,
    km: v.parseCommand("how many kilometres on the civic sport").action,
    price: v.parseCommand("what's stock NHP1868 going for").action,
    lead: v.parseCommand("add a lead named Rogue Smith interested in a Kicks").action,
    appt: v.parseCommand("book Dana Thursday at 4").action,
    ev: v.parseCommand("do we have any electric vehicles").action,
  };
});
console.log("parsed:", JSON.stringify(parsed));
if (parsed.q !== "lot" || parsed.km !== "lot" || parsed.price !== "lot" || parsed.ev !== "lot") fail("lot questions aren't recognised: " + JSON.stringify(parsed));
if (parsed.lead !== "lead" || parsed.appt !== "appointment") fail("a command got taken for a lot question: " + JSON.stringify(parsed));

// --- Said into the voice panel with no agent set up: answered on the device.
const spoken = await p.evaluate(async () => {
  const v = await import("/js/voice.js");
  v.startVoiceAssistant();
  await new Promise((r) => setTimeout(r, 300));
  window.__spoke = [];
  document.querySelector("#v-text").value = "what's the civic sport going for";
  document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 900));
  return (window.__spoke || []).join(" | ");
});
console.log("spoken:", spoken);
if (!/listed at \$24,990/.test(spoken) || !/94,573 km/.test(spoken)) fail("the voice panel didn't answer from the lot: " + spoken);
const ev = await p.evaluate(async () => {
  window.__spoke = [];
  document.querySelector("#v-text").value = "any electric vehicles";
  document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 900));
  return (window.__spoke || []).join(" | ");
});
console.log("spoken:", ev);
if (!/Ariya SV\+/.test(ev) || !/no price on the site yet/.test(ev) || !/arrives October 22/.test(ev)) fail("an incoming unit isn't described honestly: " + ev);

// --- The deal builder prices the new unit with no website price at its catalogue MSRP, labelled.
const deal = await p.evaluate(async () => {
  const d = await import("/js/views/dealbuilder.js");
  const s = await import("/js/store.js");
  const opts = d.dealsForLead(s.all("leads")[0]);
  const list = (opts && (opts.options || opts.matches || opts.deals || opts)) || [];
  const arr = Array.isArray(list) ? list : [];
  const seen = new Set();
  return arr.map((o) => { const v = o.vehicle || o.v || o; return [v.model, v.trim, v.price, v.priceSource || (v.lineup ? "lineup" : "")]; }).filter((x) => { const k = x.join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
});
console.log("deal candidates:", JSON.stringify(deal.filter((x) => /Rogue|Ariya|Civic/.test(x[0]))));
const ariya = deal.find((x) => x[0] === "Ariya" && x[3] === "msrp");
if (!ariya || !(ariya[2] > 40000)) fail("the unpriced new Ariya on the lot isn't priced at its catalogue MSRP and labelled: " + JSON.stringify(deal));
if (!deal.some((x) => x[0] === "Rogue" && x[1] === "SV" && x[2] === 38995 && x[3] === "site")) fail("the Rogue SV on the lot isn't priced at the website's price: " + JSON.stringify(deal));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlotvoice.test.js FAILED" : "\nlotvoice.test.js passed");
})();
