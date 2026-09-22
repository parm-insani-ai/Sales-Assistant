// A profile of the app under a realistic book, printed as a table. Not a
// pass/fail test: the numbers are what the optimisation work is measured
// against. Run with the stub server up: node test/perf.js
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const N = { leads: Number(process.env.PERF_LEADS || 3000), vehicles: 340, tasks: 600, texts: 900, links: 300 };

await p.addInitScript((N) => {
  if (!sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    const day = (i) => "2026-09-" + String(1 + (i % 28)).padStart(2, "0");
    const leads = [], tasks = [], texts = [], links = [], appointments = [];
    for (let i = 0; i < N.leads; i++) {
      leads.push({ id: "l" + i, name: "Customer " + i, phone: "902555" + String(1000 + i), email: i % 3 ? `c${i}@example.com` : "", stage: ["new", "working", "appointment", "sold", "working", "working", "lost"][i % 7],
        vehicleInterest: ["2019 Nissan Rogue", "2020 Nissan Kicks", "2018 Honda Civic", "2021 Nissan Sentra", "2017 Toyota RAV4"][i % 5], source: "Import",
        purchaseDate: "2021-0" + (i % 9 + 1) + "-11", currentPayment: 380 + (i % 300), payoff: 8000 + (i % 15000), currentValue: 14000 + (i % 9000), currentApr: 5.9 + (i % 4),
        followUp: i % 4 === 0 ? day(i) : "", notes: "Imported " + i, createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-0" + (1 + i % 9) + "T00:00:00.000Z" });
    }
    for (let i = 0; i < N.tasks; i++) tasks.push({ id: "t" + i, leadId: "l" + (i % N.leads), title: "Follow up " + i, due: day(i), at: day(i) + "T10:15", channel: i % 2 ? "call" : "message", cadence: i % 3 === 0 ? { step: 1 } : null, done: false, createdAt: "x", updatedAt: "x" });
    for (let i = 0; i < N.texts; i++) texts.push({ id: "x" + i, leadId: "l" + (i % 400), dir: i % 3 ? "out" : "in", body: "Message " + i, at: "2026-09-" + String(1 + (i % 20)).padStart(2, "0") + "T12:00:00.000Z", read: i % 5 !== 0, createdAt: "x", updatedAt: "x" });
    for (let i = 0; i < N.links; i++) links.push({ id: "k" + i, meta: { leadId: "l" + (i % 300) }, opens: i % 4, lastOpenAt: i % 4 ? "2026-09-20T12:00:00.000Z" : null, createdAt: "x", updatedAt: "x" });
    for (let i = 0; i < 40; i++) appointments.push({ id: "a" + i, leadId: "l" + i, customerName: "Customer " + i, type: "appointment", when: day(i) + "T14:00", status: "scheduled", createdAt: "x", updatedAt: "x" });
    const vehicles = [];
    const models = [["Rogue", "SV", "SUV"], ["Rogue", "SL", "SUV"], ["Kicks", "SR", "Hatchback"], ["Sentra", "SV", "Sedan"], ["Pathfinder", "SL", "SUV"], ["Frontier", "PRO-4X", "Truck"], ["Ariya", "SV+", "SUV"], ["Civic", "Sport", "Sedan"]];
    for (let i = 0; i < N.vehicles; i++) {
      const m = models[i % models.length]; const isNew = i % 3 !== 0;
      vehicles.push({ id: "v" + i, year: isNew ? 2026 : 2019 + (i % 6), make: m[0] === "Civic" ? "Honda" : "Nissan", model: m[0], trim: m[1], bodyStyle: m[2], condition: isNew ? "New" : "Used", certified: !isNew && i % 2 === 0,
        price: isNew ? 30000 + (i % models.length) * 4000 : 18000 + (i % 40) * 500, mileage: isNew ? 10 : 20000 + (i % 50) * 1500, color: ["Black", "White", "Grey", "Blue"][i % 4], stock: "N" + (10000 + i), status: "available", source: "web", createdAt: "x", updatedAt: "x" });
    }
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles, tasks, texts, links, appointments, settings: { salesperson: "Parm", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72 } }));
  }
  window.__long = [];
  try { new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push({ ms: Math.round(e.duration), at: Math.round(e.startTime) }))).observe({ entryTypes: ["longtask"] }); } catch {}
}, N);

const rows = [];
const mark = (what, ms, extra = "") => rows.push([what, Math.round(ms), extra]);
const longs = async (label) => { const l = await p.evaluate(() => { const x = window.__long.splice(0); return x.map((e) => e.ms).sort((a, b) => b - a).slice(0, 4); }); return l.length ? `long tasks ${l.join("/")}ms` : "no long tasks"; };
const go = async (hash, until) => {
  const t = Date.now();
  await p.evaluate((h) => { location.hash = h; }, hash);
  await p.waitForFunction(until, null, { timeout: 60000 });
  return Date.now() - t;
};

// --- Cold boot (first launch: the store seeds from localStorage into IndexedDB).
let t = Date.now();
await p.goto(APP + "/#/");
await p.waitForFunction(() => document.querySelector(".plays-slot"), null, { timeout: 60000 });
mark("first launch → Home painted", Date.now() - t, await longs());
const nav = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const res = performance.getEntriesByType("resource"); return { dom: Math.round(n.domContentLoadedEventEnd), modules: res.filter((r) => /\.js$/.test(r.name)).length, css: res.filter((r) => /\.css$/.test(r.name)).length, bytesJs: Math.round(res.filter((r) => /\.js$/.test(r.name)).reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0) / 1024) }; });
mark("  modules loaded", nav.modules, `${nav.bytesJs} KB of script, DOMContentLoaded at ${nav.dom}ms`);
const untilCurrent = async () => { for (let i = 0; i < 400; i++) { if (await p.evaluate(async () => { const d = await import("/js/views/dealbuilder.js"); return d.radarCurrent() && !d.radarStats.warming; })) return; await p.waitForTimeout(100); } };
t = Date.now(); await untilCurrent(); mark("  radar warm-up (background)", Date.now() - t, await longs());
await p.waitForTimeout(300);
const storeStats = await p.evaluate(async () => { const s = await import("/js/store.js"); return { leads: s.all("leads").length, vehicles: s.all("vehicles").length, tasks: s.all("tasks").length, nodes: document.querySelectorAll("*").length }; });
mark("  Home DOM nodes", storeStats.nodes, `${storeStats.leads} customers, ${storeStats.vehicles} vehicles, ${storeStats.tasks} tasks`);

// --- Warm relaunch: IndexedDB, remembered radar.
await p.waitForTimeout(2000);
t = Date.now();
await p.reload();
await p.waitForFunction(() => document.querySelector(".plays-slot"), null, { timeout: 60000 });
mark("relaunch → Home painted", Date.now() - t, await longs());
t = Date.now(); await untilCurrent(); mark("  radar current after relaunch", Date.now() - t, await longs());
await p.waitForTimeout(200);
const inner = await p.evaluate(async () => {
  const s = await import("/js/store.js"); const a = await import("/js/assess.js"); const d = await import("/js/views/dealbuilder.js"); const m = await import("/js/moves.js"); const lot = await import("/js/lot.js");
  const time = (fn) => { const t = performance.now(); const r = fn(); return [Math.round((performance.now() - t) * 10) / 10, r]; };
  const out = {};
  out.storeAllLeads = time(() => s.all("leads").length)[0];
  out.assessAllCold = time(() => a.assessAll().sorted.length)[0];
  out.assessAllWarm = time(() => a.assessAll().sorted.length)[0];
  const lead = s.all("leads")[7];
  s.update("leads", lead.id, { notes: "touched" });
  out.assessAllAfterOneEdit = time(() => a.assessAll().sorted.length)[0];
  out.assessQuick = time(() => a.assessQuick(lead.id))[0];
  out.dealsForLead = time(() => d.dealsForLead(lead).length)[0];
  out.topOpportunities = time(() => d.topOpportunities(50).length)[0];
  out.nextMoves = time(() => m.nextMoves(lead.id, "left a voicemail, wants to come Saturday to look at an SV").moves.length)[0];
  out.lotSummary = time(() => lot.lotSummary(s.all("vehicles")).length)[0];
  out.lotQuestion = time(() => lot.answerLot(s.all("vehicles"), "cheapest used suv under thirty").count)[0];
  return out;
});
Object.entries(inner).forEach(([k, v]) => mark("  " + k, v));

// --- Screens.
mark("Leads (All)", await go("#/leads", () => location.hash === "#/leads" && document.querySelectorAll(".lead-card, [data-lead-id]").length > 0), await longs());
const leadId = await p.evaluate(() => document.querySelector("[data-lead-id]")?.dataset.leadId);
mark("open a customer", await go("#/leads/" + leadId, () => document.querySelector(".context-card, .moves-card, [data-act='back']")), await longs());
mark("back to Leads", await go("#/leads", () => location.hash === "#/leads" && document.querySelectorAll("[data-lead-id]").length > 0), await longs());
mark("Inventory", await go("#/inventory", () => document.querySelectorAll(".veh-list .row-title").length > 0), await longs());
mark("Comms", await go("#/comms", () => location.hash === "#/comms" && document.querySelector("#view").children.length > 0), await longs());
mark("Calendar", await go("#/calendar", () => location.hash === "#/calendar" && document.querySelector("#view").children.length > 0), await longs());
mark("Tasks/Goals", await go("#/goals", () => location.hash === "#/goals" && document.querySelector("#view").children.length > 0), await longs());
mark("Home again", await go("#/", () => location.hash === "#/" && /Today's queue/.test(document.querySelector(".plays-slot")?.textContent || "")), await longs());
await p.waitForTimeout(500);
mark("  Home settle", 0, await longs());
// Typing into the Leads search.
await go("#/leads", () => location.hash === "#/leads" && document.querySelectorAll("[data-lead-id]").length > 0);
t = Date.now();
await p.type('input[type="search"]', "Customer 12");
await p.waitForTimeout(400);
mark("Leads search (11 keystrokes)", Date.now() - t, await longs());
const dom = await p.evaluate(() => document.querySelectorAll("*").length);
mark("  Leads DOM nodes", dom);

console.log("\n" + rows.map(([w, ms, x]) => `${w.padEnd(34)} ${String(ms).padStart(6)}  ${x}`).join("\n"));
if (errs.length) console.log("PAGE ERRORS: " + errs.join(" | "));
await b.close();
})();
