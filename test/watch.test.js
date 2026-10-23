// A stock watch: a customer wants a vehicle the lot doesn't have, the lot is
// watched for it, and the moment one lands the salesperson is told — a line
// under Right now, and the unit on the customer's page. Set by voice or from
// the customer's page; nothing is watched for when one is already here.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "k", name: "Ken Jones", phone: "9025551111", stage: "working", vehicleInterest: "2019 Nissan Rogue SV", createdAt: "x", updatedAt: "x" },
      { id: "d", name: "Dana Muise", phone: "9025552222", stage: "new", vehicleInterest: "Sentra", createdAt: "x", updatedAt: "x" },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, mileage: 14, color: "Pearl White", condition: "New", stock: "N26011", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v3", year: 2022, make: "Honda", model: "Civic", trim: "Sport", price: 24990, mileage: 94573, color: "Black", condition: "Used", stock: "NHP1868", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(600);

// --- Reading what they want.
const parsed = await p.evaluate(async () => {
  const w = await import("/js/watch.js");
  const r = (s) => { const x = w.parseWant(s); return { useful: w.isUseful(x), said: w.describeWant(x), models: x.models, trim: x.trim, colour: x.colour, condition: x.condition, yearMin: x.yearMin, maxPrice: x.maxPrice, maxKm: x.maxKm, body: x.body }; };
  return {
    rogue: r("a white Rogue Platinum, 2024 or newer, under 45"),
    frontier: r("a used Frontier under 40 with less than 50,000 km"),
    suv: r("any SUV under 30"),
    vague: r("something nice"),
  };
});
console.log("parsed:", JSON.stringify(parsed));
if (!parsed.rogue.useful || parsed.rogue.models.join() !== "rogue" || parsed.rogue.trim !== "platinum" || parsed.rogue.colour !== "white" || parsed.rogue.yearMin !== 2024 || parsed.rogue.maxPrice !== 45000 || parsed.rogue.said !== "white 2024+ Rogue Platinum, under $45,000") fail("the Rogue want wasn't read: " + JSON.stringify(parsed.rogue));
if (parsed.frontier.condition !== "Used" || parsed.frontier.maxPrice !== 40000 || parsed.frontier.maxKm !== 50000 || parsed.frontier.models.join() !== "frontier") fail("the Frontier want wasn't read: " + JSON.stringify(parsed.frontier));
if (parsed.suv.body !== "suv" || !parsed.suv.useful || parsed.suv.maxPrice !== 30000) fail("an SUV under 30 should be a usable want: " + JSON.stringify(parsed.suv));
if (parsed.vague.useful) fail("'something nice' can't be watched for");

// --- Set by voice. One already on the lot is said, not watched for.
const set = await p.evaluate(async () => {
  const m = await import("/js/agent.js"); const s = await import("/js/store.js");
  const ken = await m.execTool("watch_for_vehicle", { customer: "Ken Jones", vehicle: "a white Rogue Platinum under 45" });
  const dana = await m.execTool("watch_for_vehicle", { customer: "Dana Muise", vehicle: "a Rogue SV" });
  const vague = await m.execTool("watch_for_vehicle", { customer: "Dana Muise", vehicle: "something nice" });
  return { ken: ken.result, dana: dana.result, vague: vague.result, watches: s.all("watches").map((w) => ({ leadId: w.leadId, text: w.text, done: w.done, matched: !!w.matchedVehicleId })) };
});
console.log("set:", JSON.stringify(set).slice(0, 500));
if (set.ken.watching !== "white Rogue Platinum, under $45,000" || set.watches.length !== 1 || set.watches[0].leadId !== "k") fail("Ken's watch should be set as said: " + JSON.stringify(set));
if (!set.dana.alreadyOnTheLot || set.dana.count !== 1 || set.watches.length !== 1) fail("a Rogue SV is on the lot: say so, don't watch: " + JSON.stringify(set.dana));
if (!set.vague.needs) fail("a vague want should ask which vehicle: " + JSON.stringify(set.vague));

// --- Nothing yet; then a Rogue Platinum lands, and Ken is the first call.
const landed = await p.evaluate(async () => {
  const w = await import("/js/watch.js"); const s = await import("/js/store.js"); const n = await import("/js/nudges.js");
  const before = w.checkWatches().length;
  s.create("vehicles", { id: "v9", year: 2026, make: "Nissan", model: "Rogue", trim: "Platinum", price: 44990, mileage: 9, color: "Pearl White", condition: "New", stock: "N26099", status: "available", source: "web" });
  const hits = w.checkWatches();
  const nudge = n.getNudges({ limit: 20 }).find((x) => x.kind === "watch");
  const watch = s.all("watches")[0];
  return { before, hits: hits.map((h) => ({ lead: h.lead && h.lead.name, stock: h.vehicle.stock })), nudge: nudge ? { title: nudge.title, sub: nudge.sub, route: nudge.route } : null, matched: watch.matched, again: w.checkWatches().length };
});
console.log("landed:", JSON.stringify(landed));
if (landed.before !== 0 || landed.hits.length !== 1 || landed.hits[0].lead !== "Ken Jones" || landed.hits[0].stock !== "N26099" || landed.again !== 0) fail("the Rogue Platinum should match Ken's watch once: " + JSON.stringify(landed));
if (!landed.nudge || landed.nudge.title !== "Ken's white Rogue Platinum, under $45,000 is in" || !/2026 Nissan Rogue Platinum · stock N26099 · \$44,990/.test(landed.nudge.sub) || landed.nudge.route !== "/inbox/k") fail("Right now should say Ken's vehicle is in, with the unit, and open his thread: " + JSON.stringify(landed.nudge));
if (!landed.matched || landed.matched.label !== "2026 Nissan Rogue Platinum") fail("the unit should be kept on the watch: " + JSON.stringify(landed.matched));

// --- On Ken's page: the unit that landed, with Done; a new watch from the page; Stop.
await p.evaluate(() => { location.hash = "#/leads/k"; }); await p.waitForTimeout(500);
await p.evaluate(() => { document.querySelector('[data-fold="lead:actions"]').open = true; });
const page = await p.evaluate(() => ({ row: document.querySelector(".lead-watch-in")?.textContent.replace(/\s+/g, " ").trim() || "", add: !!document.querySelector('[data-act="watch-add"]') }));
console.log("page:", JSON.stringify(page));
if (!/In: 2026 Nissan Rogue Platinum · stock N26099 · \$44,990/.test(page.row) || !/They asked for white Rogue Platinum, under \$45,000/.test(page.row) || !page.add) fail("the customer's page should show the unit that landed: " + JSON.stringify(page));
await p.click('[data-act="watch-done"]'); await p.waitForTimeout(400);
const closed = await p.evaluate(async () => { const s = await import("/js/store.js"); const n = await import("/js/nudges.js"); return { done: s.all("watches")[0].done, nudges: n.getNudges({ limit: 20 }).filter((x) => x.kind === "watch").length, rows: document.querySelectorAll(".lead-watch").length }; });
if (!closed.done || closed.nudges !== 0 || closed.rows !== 0) fail("Done should close the watch and clear the line on Home: " + JSON.stringify(closed));
await p.evaluate(() => { document.querySelector('[data-fold="lead:actions"]').open = true; });
await p.click('[data-act="watch-add"]');
await p.waitForSelector('.modal input[name="want"]', { timeout: 5000 });
await p.fill('.modal input[name="want"]', "a used Frontier under 40");
await p.click(".modal button[type=submit]"); await p.waitForTimeout(500);
await p.evaluate(() => { document.querySelector('[data-fold="lead:actions"]').open = true; });
const added = await p.evaluate(() => ({ row: document.querySelector(".lead-watch:not(.lead-watch-in)")?.textContent.replace(/\s+/g, " ").trim() || "", toast: document.querySelector("#toast-root")?.textContent || "" }));
console.log("added:", JSON.stringify(added));
if (!/Watching the lot for Frontier, used, under \$40,000/.test(added.row)) fail("a watch set from the page should show on it: " + JSON.stringify(added));
await p.click('[data-act="watch-cancel"]'); await p.waitForTimeout(300);
const stopped = await p.evaluate(async () => { const s = await import("/js/store.js"); return { open: s.all("watches").filter((w) => !w.done).length, rows: document.querySelectorAll(".lead-watch").length }; });
if (stopped.open !== 0 || stopped.rows !== 0) fail("Stop should cancel the watch: " + JSON.stringify(stopped));

// --- The list of everyone waiting: Inventory → Wanted, and by voice.
const wantedList = await p.evaluate(async () => {
  const m = await import("/js/agent.js");
  await m.execTool("watch_for_vehicle", { customer: "Ken Jones", vehicle: "a used Frontier under 40" });
  await m.execTool("watch_for_vehicle", { customer: "Dana Muise", vehicle: "a 2024 or newer Kicks SR" });
  const r = await m.execTool("wanted_list", {});
  await new Promise((res) => setTimeout(res, 400));
  return { result: r.result, hash: location.hash, chip: document.querySelector('[data-filter="wanted"]')?.textContent.trim(), active: document.querySelector('[data-filter="wanted"]')?.classList.contains("btn-primary"), rows: [...document.querySelectorAll(".wanted-row")].map((x) => x.textContent.replace(/\s+/g, " ").trim()) };
});
console.log("wanted:", JSON.stringify(wantedList).slice(0, 600));
if (wantedList.result.count !== 2 || wantedList.result.waiting.map((x) => x.customer).sort().join() !== "Dana Muise,Ken Jones" || !/Frontier, used, under \$40,000/.test(JSON.stringify(wantedList.result.waiting))) fail("the voice list should name everyone waiting and what for: " + JSON.stringify(wantedList.result));
if (wantedList.hash !== "#/inventory" || wantedList.chip !== "Wanted · 2" || !wantedList.active || wantedList.rows.length !== 2 || !wantedList.rows.some((r) => /Dana Muise · 2024\+ Kicks SR.*Watching since/.test(r))) fail("Inventory → Wanted should list them, newest first, with the chip counted: " + JSON.stringify({ hash: wantedList.hash, chip: wantedList.chip, rows: wantedList.rows }));
await p.click(".wanted-row"); await p.waitForTimeout(400);
if (!/^#\/leads\//.test(await p.evaluate(() => location.hash))) fail("a Wanted row should open the customer");
// The chip is there even with nobody waiting.
await p.evaluate(async () => { const s = await import("/js/store.js"); s.all("watches").forEach((w) => s.update("watches", w.id, { done: true })); location.hash = "#/inventory"; }); await p.waitForTimeout(400);
await p.click('[data-filter="wanted"]'); await p.waitForTimeout(200);
const none = await p.evaluate(() => ({ chip: document.querySelector('[data-filter="wanted"]')?.textContent.trim(), empty: document.querySelector(".veh-list")?.textContent.replace(/\s+/g, " ").trim() }));
if (none.chip !== "Wanted" || !/Nobody's waiting/.test(none.empty || "")) fail("with nobody waiting the chip should still be there, uncounted, with a plain empty state: " + JSON.stringify(none));
await p.evaluate(async () => { const s = await import("/js/store.js"); s.all("watches").forEach((w) => s.update("watches", w.id, { done: true })); });

// --- "Stop watching for Ken", by voice.
const cancelled = await p.evaluate(async () => { const m = await import("/js/agent.js"); await m.execTool("watch_for_vehicle", { customer: "Ken Jones", vehicle: "a Kicks SR" }); const r = await m.execTool("watch_for_vehicle", { customer: "Ken Jones", cancel: true }); const s = await import("/js/store.js"); return { cancelled: r.result.cancelled, open: s.all("watches").filter((w) => !w.done).length }; });
if (cancelled.cancelled !== 1 || cancelled.open !== 0) fail("cancelling by voice should close Ken's open watch: " + JSON.stringify(cancelled));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "watch: FAILED" : "watch: ok");
})().catch((e) => { console.error(e); process.exit(1); });
