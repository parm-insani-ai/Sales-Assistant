// "Make me a list of everyone who owns a Nissan Rogue" — the customers on
// file who drive one, on the Leads screen under the audience filter. Never
// the lot: a Rogue on the lot is a unit for sale, not an owner.
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
    leads: [
      { id: "r1", name: "Dana Muise", phone: "9025551111", stage: "delivered", vehicleInterest: "2021 Nissan Rogue SV", payoff: 0, purchaseDate: "2024-05-01", createdAt: "x", updatedAt: "x" },
      { id: "r2", name: "Lee Wong", phone: "9025552222", stage: "working", vehicleInterest: "Rogue Platinum 2019", currentPayment: 420, payoff: 12000, createdAt: "x", updatedAt: "x" },
      { id: "s1", name: "Pat Roy", phone: "9025553333", stage: "delivered", vehicleInterest: "2018 Nissan Sentra SV", currentPayment: 0, createdAt: "x", updatedAt: "x" },
      { id: "h1", name: "Sam Hill", phone: "9025554444", stage: "new", vehicleInterest: "2020 Honda Civic Sport", createdAt: "x", updatedAt: "x" },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, mileage: 14, condition: "New", stock: "N26011", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v2", year: 2025, make: "Nissan", model: "Rogue", trim: "SV", price: 35990, mileage: 12400, condition: "Used", stock: "NHP1900", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v3", year: 2022, make: "Honda", model: "Civic", trim: "Sport", price: 24990, mileage: 94573, condition: "Used", stock: "NHP1868", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
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

const screen = () => p.evaluate(() => ({ hash: location.hash, bar: document.querySelector(".lead-audience")?.textContent.replace(/\s+/g, " ").trim() || "", rows: [...document.querySelectorAll(".lead-list .row-title")].map((n) => n.textContent.trim()).sort().join(",") }));

// --- The model picks lot_lookup for it (that's what happened on the floor):
// the tool answers from the book anyway, and the lot is not read out.
const asLot = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("lot_lookup", { question: "make me a list of everyone who owns a Nissan Rogue" }); });
console.log("lot_lookup →", JSON.stringify(asLot.result).slice(0, 300));
if (asLot.result.count !== 2 || !asLot.result.notTheLot || asLot.result.units) fail("asked of the lot, the owner question wasn't answered from the book: " + JSON.stringify(asLot.result));
if (!/^2 Rogue owners on file/.test(asLot.result.answer || "")) fail("the spoken answer doesn't say two Rogue owners: " + asLot.result.answer);
if (!asLot.result.customers.every((c) => /Rogue/i.test(c.vehicle)) || asLot.result.customers.length !== 2) fail("the customers aren't the two Rogue owners: " + JSON.stringify(asLot.result.customers));
await p.waitForTimeout(500);
let s = await screen();
console.log("on screen:", JSON.stringify(s));
if (s.hash !== "#/leads" || s.rows !== "Dana Muise,Lee Wong" || !/2 match · Rogue owners/.test(s.bar)) fail("the Rogue owners aren't on the Leads screen under the filter: " + JSON.stringify(s));

// --- find_customers with the sentence as `who`, and a paid-off twist.
const paid = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("find_customers", { who: "which of my customers have a paid off Nissan" }); });
console.log("find_customers who →", JSON.stringify(paid.result).slice(0, 200));
if (paid.result.count !== 2 || paid.result.audience !== "Nissan owners · paid off" || paid.result.customers.map((c) => c.name).sort().join() !== "Dana Muise,Pat Roy") fail("paid-off Nissan owners: " + JSON.stringify(paid.result));

// --- A plain vehicle query matches by the model however the car was written down.
const q = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("find_customers", { query: "Nissan Rogue" }); });
if (q.result.count !== 2) fail("query 'Nissan Rogue' should find both Rogue owners, however the vehicle was written: " + JSON.stringify(q.result));
const byName = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("find_customers", { query: "Pat" }); });
if (byName.result.count !== 1 || byName.result.customers[0].name !== "Pat Roy") fail("a name query still finds the person: " + JSON.stringify(byName.result));

// --- A real lot question is still the lot.
const lot = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("lot_lookup", { question: "do we have any rogues" }); });
if (lot.result.count !== 2 || !lot.result.units || lot.result.notTheLot) fail("a lot question stopped being answered from the lot: " + JSON.stringify(lot.result).slice(0, 200));

// --- Offline: the voice panel routes it to the owners, not the lot or the dealer search.
const parsed = await p.evaluate(async () => {
  const v = await import("/js/voice.js");
  return {
    list: v.parseCommand("make me a list of everyone who owns a Nissan Rogue").action,
    mine: v.parseCommand("show me my Sentra owners").action,
    who: v.parseCommand("who drives a Civic").action,
    lot: v.parseCommand("how many rogues do we have").action,
    blast: v.parseCommand("text everyone who owns a Rogue that the new one is in").action,
    call: v.parseCommand("who should I call today").action,
  };
});
console.log("parsed:", JSON.stringify(parsed));
if (parsed.list !== "owners" || parsed.mine !== "owners" || parsed.who !== "owners") fail("owner questions aren't routed to the owners: " + JSON.stringify(parsed));
if (parsed.lot !== "lot" || parsed.blast !== "outreach" || parsed.call === "owners") fail("something else got taken for an owner list: " + JSON.stringify(parsed));

const spoken = await p.evaluate(async () => {
  const v = await import("/js/voice.js");
  v.startVoiceAssistant();
  await new Promise((r) => setTimeout(r, 300));
  window.__spoke = [];
  document.querySelector("#v-text").value = "who drives a civic";
  document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 900));
  return (window.__spoke || []).join(" | ");
});
console.log("spoken:", spoken);
if (!/1 Civic owner on file/.test(spoken)) fail("the voice panel didn't answer with the Civic owner: " + spoken);
s = await screen();
if (s.rows !== "Sam Hill" || !/1 match · Civic owners/.test(s.bar)) fail("the Civic owner isn't the one on screen: " + JSON.stringify(s));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "owners: FAILED" : "owners: ok");
})().catch((e) => { console.error(e); process.exit(1); });
