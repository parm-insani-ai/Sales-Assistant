// The store's book in the manager's app, and the assistant that reads it:
// every rep's customers searchable and filterable, the reach-outs ranked
// with reasons, one handed to its rep as a to-do (and a nudge), the top
// five on Home, and the rep finding the to-do in their own queue.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const pageAs = async (token, email, leads = []) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, email, leads }) => {
    const ids = { t: "00000000-0000-4000-8000-000000000001", t2: "00000000-0000-4000-8000-000000000002", tm: "00000000-0000-4000-8000-000000000003" };
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: ids[token], email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: token === "tm" ? "Sam" : "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: token === "t", supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
  }, { token, email, leads });
  return p;
};
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });
const now = new Date(); const iso = (d) => new Date(d).toISOString(); const ago = (n) => iso(now.getTime() - n * 86400000);
const seed = (user_id, rows) => fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id, rows }) });
await seed(U1, [
  { id: "p1", collection: "leads", data: { id: "p1", name: "Big Equity", phone: "9025551111", stage: "delivered", vehicleInterest: "2020 Nissan Frontier PRO-4X", currentValue: 31000, payoff: 18000, currentPayment: 610, purchaseDate: "2020-08-01", currentApr: 9.9, createdAt: ago(900) } },
  { id: "p2", collection: "leads", data: { id: "p2", name: "Lease Ending", phone: "9025552222", stage: "delivered", vehicleInterest: "2023 Nissan Sentra SR", dealType: "Lease", leaseEnd: iso(now.getTime() + 70 * 86400000).slice(0, 10), currentPayment: 420, purchaseDate: "2023-12-01", createdAt: ago(600) } },
  { id: "p3", collection: "leads", data: { id: "p3", name: "Just Sold", phone: "9025553333", stage: "sold", vehicleInterest: "Rogue", createdAt: ago(10) } },
  { id: "p4", collection: "leads", data: { id: "p4", name: "Old Kicks", phone: "9025554444", stage: "delivered", vehicleInterest: "2018 Nissan Kicks SV", purchaseDate: "2018-04-01", currentValue: 11000, createdAt: ago(1500) } },
]);
await seed(U2, [
  { id: "d1", collection: "leads", data: { id: "d1", name: "Fresh Untouched", phone: "9025559999", stage: "new", vehicleInterest: "Pathfinder", source: "Web", createdAt: ago(3) } },
  { id: "d2", collection: "leads", data: { id: "d2", name: "No Way To Reach", stage: "delivered", vehicleInterest: "2019 Nissan Rogue", currentValue: 15000, payoff: 4000, purchaseDate: "2019-05-01", createdAt: ago(900) } },
]);

// The store's shared lot, written by the manager (the importer does the same).
const lotWrite = await rpc("tm", "set_store_inventory", { store: st.id, rows: [
  { id: "web_n1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 41000, mileage: 12, condition: "New", status: "available", source: "web", updatedAt: new Date().toISOString() },
  { id: "web_u1", year: 2022, make: "Nissan", model: "Frontier", trim: "PRO-4X", price: 39900, mileage: 41000, condition: "Used", status: "available", source: "web", updatedAt: new Date().toISOString() },
  { id: "web_u2", year: 2021, make: "Honda", model: "Civic", trim: "Sport", price: 24990, mileage: 60000, condition: "Used", status: "available", source: "web", updatedAt: new Date().toISOString() },
], complete: true });
if (lotWrite.written !== 3) fail("the manager couldn't write the store's lot: " + JSON.stringify(lotWrite));
const repWrite = await rpc("t", "set_store_inventory", { store: st.id, rows: [{ id: "bogus", make: "X", model: "Y", price: 1 }] });
if (!repWrite.message || !/only a manager/.test(repWrite.message)) fail("a rep could write the store's lot: " + JSON.stringify(repWrite));

// --- The Customers tab: reach-outs first.
const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/customers");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelectorAll(".cu-row").length > 0, null, { timeout: 20000 });
const reach = await mgr.evaluate(() => ({
  tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()),
  title: document.querySelector(".hero-title")?.textContent.trim(),
  line: document.querySelector(".row .small.muted")?.textContent.replace(/\s+/g, " ").trim(),
  rows: [...document.querySelectorAll(".cu-row")].map((r) => ({ name: r.querySelector(".row-title").textContent.trim(), sub: r.querySelector(".row-sub").textContent.trim(), reasons: r.querySelector(".row-reasons")?.textContent.trim(), deal: r.querySelector(".cu-deal")?.textContent.replace(/\s+/g, " ").trim(), send: r.querySelector("[data-send]")?.textContent.trim() })),
}));
console.log("reach-outs:", JSON.stringify(reach, null, 1));
if (reach.tabs.join() !== "Home,Appts,Customers,Insights,Team") fail("the Customers tab is missing: " + reach.tabs.join());
if (!/6 customers · 4 worth a call/.test(reach.line || "") || !/priced against 3 units/.test(reach.line)) fail("the book line is wrong: " + reach.line);
const names = reach.rows.map((r) => r.name.replace(/\s*(Hot|Strong|Worth a call)$/, ""));
if (names.includes("Just Sold") || names.includes("No Way To Reach")) fail("excluded or unreachable customers are on the reach-out list: " + names.join(", "));
if (!names.includes("Big Equity") || !names.includes("Lease Ending") || !names.includes("Fresh Untouched") || !names.includes("Old Kicks")) fail("reach-outs are missing: " + names.join(", "));
const big = reach.rows.find((r) => /Big Equity/.test(r.name));
if (!/\$13,000 equity/.test(big.reasons) || !/Parm/.test(big.sub) || big.send !== "Send to Parm") fail("Big Equity's row is wrong: " + JSON.stringify(big));
if (!/\/mo less|Same payment/.test(big.reasons) || !/2022 Nissan Frontier PRO-4X ≈ \$\d{3}\/mo \(−\$\d+\/mo\)/.test(big.deal || "")) fail("Big Equity has no payment match against the store's lot: " + JSON.stringify(big));
const fresh = reach.rows.find((r) => /Fresh Untouched/.test(r.name));
if (!/Never touched/.test(fresh.reasons) || !/Dana/.test(fresh.sub)) fail("the untouched lead's row is wrong: " + JSON.stringify(fresh));

// Send Big Equity to Parm: a to-do in Parm's book, and a nudge.
await mgr.click('[data-send="p1"]');
await mgr.waitForFunction(() => document.querySelector('[data-send="p1"]')?.textContent.trim() === "Sent", null, { timeout: 10000 });
const recs = await (await fetch(APP + "/__records")).json();
const task = recs.find((r) => r.user_id === U1 && r.collection === "tasks");
console.log("task in Parm's book:", JSON.stringify(task && task.data));
if (!task || !/^Reach out to Big Equity — 2022 Nissan Frontier PRO-4X at ~\$\d{3}\/mo, .*\$13,000 equity/.test(task.data.title) || task.data.leadId !== "p1" || !task.data.fromManager || task.data.done) fail("the to-do didn't land in the rep's book: " + JSON.stringify(task));
const nudges = await (await fetch(APP + "/__nudges")).json();
if (!nudges.some((n) => n.to === U1 && /Reach out to Big Equity/.test(n.title))) fail("the rep wasn't nudged: " + JSON.stringify(nudges));

// All customers, searched and filtered.
await mgr.click('[data-mode="all"]');
await mgr.waitForFunction(() => document.querySelectorAll(".cu-row").length === 6, null, { timeout: 5000 });
await mgr.type('input[type="search"]', "kicks");
await mgr.waitForFunction(() => document.querySelectorAll(".cu-row").length === 1, null, { timeout: 5000 });
await mgr.evaluate(() => { const i = document.querySelector('input[type="search"]'); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); });
await mgr.waitForFunction(() => document.querySelectorAll(".cu-row").length === 6, null, { timeout: 5000 });
await mgr.click('[data-act="filter"]');
await mgr.waitForSelector("#af-models");
await mgr.fill("#af-models", "Rogue");
await mgr.click('.modal [data-act="apply"]');
await mgr.waitForFunction(() => document.querySelector(".lead-audience"), null, { timeout: 5000 });
const filtered = await mgr.evaluate(() => [...document.querySelectorAll(".cu-row .row-title")].map((n) => n.textContent.trim()));
if (filtered.sort().join() !== "Just Sold,No Way To Reach") fail("the store-wide filter is wrong: " + filtered.join(", "));
// A customer opens read-only.
await mgr.click(".cu-row .row-main");
await mgr.waitForSelector(".modal h2");
const sheet = await mgr.evaluate(() => document.querySelector(".modal")?.textContent.includes("Read-only"));
if (!sheet) fail("the customer sheet didn't open read-only");
await mgr.keyboard.press("Escape");

// --- Home: the assistant's card with the top five, and Send.
await mgr.click('.tabbar [data-route="/"]');
await mgr.waitForFunction(() => document.querySelector("[data-hand]"), null, { timeout: 20000 });
const home = await mgr.evaluate(() => ({ title: [...document.querySelectorAll(".section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).find((t) => /Who to reach out to/.test(t)), names: [...document.querySelectorAll("[data-hand]")].map((b) => b.closest(".row").querySelector(".row-title").textContent.trim()) }));
console.log("home card:", JSON.stringify(home));
if (!/4 worth a call/.test(home.title || "") || home.names.length !== 4) fail("the assistant's card on Home is wrong: " + JSON.stringify(home));
await mgr.click('[data-hand="d1"]');
await mgr.waitForFunction(() => document.querySelector('[data-hand="d1"]')?.textContent.trim() === "Sent", null, { timeout: 10000 });
const recs2 = await (await fetch(APP + "/__records")).json();
if (!recs2.some((r) => r.user_id === U2 && r.collection === "tasks" && /Fresh Untouched/.test(r.data.title) && r.data.channel === "call")) fail("the untouched lead wasn't handed to Dana as a call");

// --- A rep can't hand a task to another rep through the database.
const forged = await rpc("t2", "manager_add_task", { member: U1, task: { title: "hi" } });
if (!forged.message || !/only a manager/.test(forged.message)) fail("a rep could plant a task in another rep's book: " + JSON.stringify(forged));

// --- The rep sees the to-do in their own app after a sync.
const rep = await pageAs("t", "p@e.com", [{ id: "p1", name: "Big Equity", phone: "9025551111", stage: "delivered", vehicleInterest: "2020 Nissan Frontier PRO-4X", createdAt: "x", updatedAt: "x" }]);
await rep.goto(APP + "/#/");
await rep.waitForFunction(async () => { const s = await import("/js/store.js"); return s.all("tasks").some((t) => /Reach out to Big Equity/.test(t.title) && t.fromManager); }, null, { timeout: 20000 });
console.log("the rep has the to-do");
await rep.waitForFunction(async () => { const s = await import("/js/store.js"); return s.all("vehicles").filter((v) => v.shared).length === 3; }, null, { timeout: 20000 });
await rep.evaluate(async () => { const sy = await import("/js/sync.js"); await sy.syncNow({ reconcile: true }); });
const pushedLot = (await (await fetch(APP + "/__records")).json()).filter((r) => r.user_id === U1 && r.collection === "vehicles");
console.log("the rep has the store's lot; pushed back as their own:", pushedLot.length);
if (pushedLot.length) fail("the shared lot was pushed back into the rep's own records");
const radar = await rep.evaluate(async () => { const d = await import("/js/views/dealbuilder.js"); const s = await import("/js/store.js"); const l = s.all("leads")[0]; s.update("leads", l.id, { currentPayment: 610, currentValue: 31000, payoff: 18000 }); const opts = d.dealsForLead(s.get("leads", l.id)); const arr = Array.isArray(opts) ? opts : (opts.options || opts.deals || []); return arr.length; });
if (!radar) fail("the rep's radar doesn't price against the shared lot");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncustomers.test.js FAILED" : "\ncustomers.test.js passed");
})();
