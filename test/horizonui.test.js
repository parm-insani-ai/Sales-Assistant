// Timing on screen: the rep's Timing screen puts every owner in the month
// their window opens and sets the follow-up there; the lease list is by
// month of ending. The manager's Customers tab reads the store the same
// way and hands a customer to their rep as a to-do due in that month.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const now = new Date();
const iso = (d) => new Date(d).toISOString();
const ago = (days) => iso(now.getTime() - days * 86400000);
const plus = (months, day = 15) => { const d = new Date(now.getFullYear(), now.getMonth() + months, day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const label = (months) => new Date(now.getFullYear(), now.getMonth() + months, 15).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
const leads = [
  { id: "rich", name: "Rich Now", phone: "9025551111", stage: "delivered", vehicleInterest: "2020 Nissan Frontier PRO-4X", currentValue: 31000, payoff: 18000, currentPayment: 610, purchaseDate: "2020-08-01", createdAt: ago(900), updatedAt: ago(1) },
  { id: "later", name: "Finance Later", phone: "9025552222", stage: "delivered", vehicleInterest: "2024 Nissan Rogue SV", currentValue: 30000, payoff: 31000, currentPayment: 620, currentApr: 6.9, paymentsLeft: 58, paymentsLeftAsOf: ago(0), purchaseDate: "2024-08-01", createdAt: ago(700), updatedAt: ago(1) },
  { id: "lease", name: "Lease Next Year", phone: "9025553333", stage: "delivered", vehicleInterest: "2023 Nissan Rogue SV", dealType: "Lease", leaseEnd: plus(11), currentPayment: 520, purchaseDate: "2023-08-15", createdAt: ago(900), updatedAt: ago(1) },
  { id: "lease2", name: "Lease Soon", phone: "9025554444", stage: "delivered", vehicleInterest: "2024 Nissan Kicks", dealType: "Lease", leaseEnd: plus(2), currentPayment: 380, purchaseDate: "2022-01-15", createdAt: ago(900), updatedAt: ago(1) },
  { id: "live", name: "Live Lead", phone: "9025555555", stage: "new", vehicleInterest: "Kicks", createdAt: ago(2), updatedAt: ago(2) },
];

// --- The rep's Timing screen.
const rctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const rep = await rctx.newPage();
rep.on("pageerror", (e) => errs.push(e.message));
await rep.addInitScript((leads) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false } }));
}, leads);
await rep.goto(APP + "/#/horizon");
await rep.waitForSelector(".hz-row", { timeout: 20000 });
const timing = await rep.evaluate(() => ({
  title: document.querySelector("#page-title")?.textContent.trim(),
  plan: document.querySelector(".mg-plan .strong")?.textContent.trim(),
  sections: [...document.querySelectorAll(".section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  rows: [...document.querySelectorAll(".hz-row")].map((r) => ({ name: r.querySelector(".row-title").textContent.replace(/\s+/g, " ").trim(), why: r.querySelector(".row-reasons").textContent.trim(), btn: r.querySelector("button")?.textContent.trim() })),
}));
console.log("timing:", JSON.stringify(timing, null, 1));
if (timing.title !== "Timing") fail("the screen isn't titled Timing");
if (!/2 ready now · 1 open up in the next six months/.test(timing.plan || "")) fail("the plan line: " + timing.plan);
const byName = Object.fromEntries(timing.rows.map((r) => [r.name.replace(/\s*(Now|[A-Z][a-z]{2} \d{4})$/, ""), r]));
if (!byName["Rich Now"] || !/Now$/.test(byName["Rich Now"].name) || !/equity now/.test(byName["Rich Now"].why)) fail("Rich Now should be now: " + JSON.stringify(byName["Rich Now"]));
if (!byName["Lease Soon"] || !/Now$/.test(byName["Lease Soon"].name) || !/window is open/.test(byName["Lease Soon"].why)) fail("a lease two months out is now: " + JSON.stringify(byName["Lease Soon"]));
if (!byName["Lease Next Year"] || !new RegExp(label(5) + "$").test(byName["Lease Next Year"].name) || !/Follow up/.test(byName["Lease Next Year"].btn)) fail("the lease a year out opens six months before: " + JSON.stringify(byName["Lease Next Year"]));
if (!byName["Finance Later"] || !/Equity reaches/.test(byName["Finance Later"].why)) fail("the finance customer gets a month: " + JSON.stringify(byName["Finance Later"]));
if (timing.rows.some((r) => /Live Lead/.test(r.name))) fail("a live lead has no timing");
if (!timing.sections.some((s) => /^Now · 2/.test(s)) || !timing.sections.some((s) => /^In 4–6 months · 1/.test(s))) fail("the buckets: " + JSON.stringify(timing.sections));

// Set one follow-up, then the rest at once.
await rep.click('[data-fu="lease"]');
await rep.waitForFunction(() => document.querySelector('[data-fu="lease"]')?.textContent.trim() === "Follow-up set", null, { timeout: 5000 });
let fu = await rep.evaluate(async () => { const s = await import("/js/store.js"); return s.get("leads", "lease").followUp; });
if (fu !== plus(5, now.getDate() > 28 ? 28 : now.getDate())) fail("the follow-up should land the month the window opens: " + fu);
await rep.click('[data-act="fu-all"]');
await rep.waitForSelector(".modal", { timeout: 5000 });
await rep.$eval(".modal .btn-primary, .modal [data-act='confirm']", (n) => n.click());
await rep.waitForFunction(() => !document.querySelector('[data-act="fu-all"]'), null, { timeout: 5000 });
fu = await rep.evaluate(async () => { const s = await import("/js/store.js"); return { later: s.get("leads", "later").followUp, rich: s.get("leads", "rich").followUp || null }; });
console.log("follow-ups:", JSON.stringify(fu));
if (!fu.later || fu.rich) fail("all-at-once should set the finance customer's month and leave 'now' alone: " + JSON.stringify(fu));

// The lease list, by month.
await rep.click('[data-tab="leases"]');
await rep.waitForFunction(() => /leases on the book/.test(document.body.textContent), null, { timeout: 5000 });
const leasesTab = await rep.evaluate(() => ({ plan: document.querySelector(".mg-plan .strong")?.textContent.trim(), months: [...document.querySelectorAll(".section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()) }));
console.log("leases:", JSON.stringify(leasesTab));
if (!/2 leases on the book · 2 end in the next year/.test(leasesTab.plan || "")) fail("the lease line: " + leasesTab.plan);
const m2 = new Date(now.getFullYear(), now.getMonth() + 2, 15).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
if (!leasesTab.months[0].startsWith(m2)) fail("the soonest lease comes first: " + JSON.stringify(leasesTab.months));

// --- The manager's Customers tab: Timing and Lease ends, with the hand-off.
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: leads.map((l) => ({ id: l.id, collection: "leads", data: l })) }) });
const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const mgr = await mctx.newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});
await mgr.goto(APP + "/#/customers");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelector('[data-mode="timing"]') && /customers ·/.test(document.body.textContent), null, { timeout: 20000 });
await mgr.click('[data-mode="timing"]');
await mgr.waitForFunction(() => document.querySelectorAll(".cu-row").length >= 3, null, { timeout: 10000 });
const mt = await mgr.evaluate(() => ({ plan: document.querySelector(".mg-plan .strong")?.textContent.trim(), rows: [...document.querySelectorAll(".cu-row")].map((r) => ({ name: r.querySelector(".row-title").textContent.replace(/\s+/g, " ").trim(), why: r.querySelector(".row-reasons").textContent.trim(), send: r.querySelector("[data-send]")?.textContent.trim() })) }));
console.log("manager timing:", JSON.stringify(mt, null, 1));
if (!/2 ready now · 1 open up in the next six months/.test(mt.plan || "")) fail("the manager's plan line: " + mt.plan);
if (mt.rows[0].name.replace(/\s*Now$/, "") !== "Lease Soon" && mt.rows[0].name.replace(/\s*Now$/, "") !== "Rich Now") fail("the store's timing isn't soonest first: " + JSON.stringify(mt.rows.map((r) => r.name)));
await mgr.click('[data-send="lease"]');
await mgr.waitForFunction(() => document.querySelector('[data-send="lease"]')?.textContent.trim() === "Sent", null, { timeout: 10000 });
const recs = await (await fetch(APP + "/__records")).json();
const task = recs.find((r) => r.user_id === U1 && r.collection === "tasks");
console.log("task:", JSON.stringify(task && task.data));
if (!task || task.data.leadId !== "lease" || !/Lease ends/.test(task.data.title) || !task.data.fromManager || task.data.due.slice(0, 7) !== plus(5).slice(0, 7)) fail("the to-do should be due the month the window opens: " + JSON.stringify(task && task.data));
await mgr.click('[data-mode="leases"]');
await mgr.waitForFunction(() => /leases out/.test(document.body.textContent), null, { timeout: 10000 });
const ml = await mgr.evaluate(() => ({ plan: document.querySelector(".mg-plan .strong")?.textContent.trim(), rows: [...document.querySelectorAll(".cu-row .row-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()) }));
console.log("manager leases:", JSON.stringify(ml));
if (!/2 leases out · 2 end in the next year/.test(ml.plan || "") || !/^Lease Soon/.test(ml.rows[0])) fail("the store's leases: " + JSON.stringify(ml));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nhorizonui.test.js FAILED" : "\nhorizonui.test.js passed");
})();
