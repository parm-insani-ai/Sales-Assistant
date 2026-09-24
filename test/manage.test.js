// The store's app: an admin or a manager without a book gets the management
// Home — the store's day added up from the reps, who needs a word, today's
// appointments, the reps by units — with Home / Team / Settings tabs and no
// rep tools. A rep keeps the salesperson's app. A manager who also sells can
// switch between the two.
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
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
  }, { token, email, leads });
  return p;
};

// The store, made by the admin through the database functions; two reps in it.
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });
const now = new Date(); const iso = (d) => d.toISOString(); const day = (n) => new Date(now.getTime() + n * 86400000); const ymd = (d) => d.toISOString().slice(0, 10);
const first = ymd(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 8) + "01";
const seed = (user_id, rows) => fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id, rows }) });
await seed(U1, [
  { id: "config", collection: "config", data: { id: "config", goalUnits: 12 } },
  { id: "s1", collection: "sales", data: { id: "s1", saleDate: first, frontGross: 1000, backGross: 500 } },
  { id: "s2", collection: "sales", data: { id: "s2", saleDate: ymd(now), frontGross: 700, backGross: 300 } },
  { id: "a1", collection: "activity", data: { id: "a1", type: "touch", createdAt: iso(now) } },
  { id: "ap1", collection: "appointments", data: { id: "ap1", customerName: "Fresh Lead", type: "test drive", when: ymd(now) + "T15:30", status: "scheduled", confirmed: true } },
  { id: "ap2", collection: "appointments", data: { id: "ap2", customerName: "Old Appt", when: first + "T10:00", status: "scheduled", outcome: "showed" } },
  { id: "l1", collection: "leads", data: { id: "l1", name: "Fresh Lead", phone: "9025551111", stage: "new", vehicleInterest: "2026 Nissan Rogue SV", createdAt: iso(day(-3)) } },
]);
await seed(U2, [
  { id: "config", collection: "config", data: { id: "config", goalUnits: 10 } },
  { id: "m1", collection: "leads", data: { id: "m1", name: "Quiet Lead", phone: "9025559999", stage: "new", vehicleInterest: "Frontier", createdAt: iso(day(-2)) } },
  { id: "m2", collection: "leads", data: { id: "m2", name: "Late One", phone: "9025559998", stage: "working", vehicleInterest: "Kicks", followUp: ymd(day(-4)), createdAt: iso(day(-20)) } },
]);

// --- The admin's Home is the board.
const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelectorAll(".mg-rep").length > 0, null, { timeout: 20000 });
await mgr.waitForFunction(() => /As of/.test(document.body.textContent), null, { timeout: 20000 });
const home = await mgr.evaluate(() => ({
  title: document.querySelector(".hero-title")?.textContent.trim(),
  tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()),
  stats: [...document.querySelectorAll(".stat")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  word: [...document.querySelectorAll(".card .mg-rep.row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  today: [...document.querySelectorAll(".card .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()).filter((t) => /15:30/.test(t)),
  reps: [...document.querySelectorAll(".team-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  tiles: [...document.querySelectorAll(".qa-label")].map((n) => n.textContent.trim()),
}));
console.log("management home:", JSON.stringify(home, null, 1));
if (home.title !== "O'Regan's Nissan Halifax" || home.tabs.join() !== "Home,Team,Settings") fail("not the store's app: " + JSON.stringify([home.title, home.tabs]));
if (!home.stats.some((s) => /^2 \/ 22 ?Units in/.test(s)) || !home.stats.some((s) => /^\$2,500 ?Gross/.test(s)) || !home.stats.some((s) => /^2 ?Appointments set · 1 shown/.test(s)) || !home.stats.some((s) => /^2 ?Untouched/.test(s)) || !home.stats.some((s) => /^1 ?Overdue/.test(s))) fail("the store totals are wrong: " + JSON.stringify(home.stats));
if (!home.word.some((w) => /^Parm.*1 untouched lead/.test(w)) || !home.word.some((w) => /^Dana.*1 untouched lead/.test(w)) || home.word.some((w) => /^Sam/.test(w))) fail("'needs a word' misses a rep, or nags the manager: " + JSON.stringify(home.word));
if (!home.today.some((t) => /15:30 · Fresh Lead.*Parm.*test drive.*Confirmed/.test(t))) fail("today's appointment isn't on the store's list with the rep: " + JSON.stringify(home.today));
if (!home.reps[0].startsWith("Parm") || !/2 \/ 12/.test(home.reps[0])) fail("the reps aren't ordered by units: " + JSON.stringify(home.reps));
if (!home.tiles.includes("Team") || !home.tiles.includes("Admin") || !home.tiles.includes("Invite a rep") || !home.tiles.includes("Sales view")) fail("the store's tools are missing: " + JSON.stringify(home.tiles));

// Tap a rep: their day, then a customer, read-only.
await mgr.click('.team-row[data-rep="' + U2 + '"]');
await mgr.waitForSelector(".modal [data-lead]");
const sheet = await mgr.evaluate(() => ({ title: document.querySelector(".modal h2")?.textContent.trim(), leads: [...document.querySelectorAll(".modal [data-lead] .row-title")].map((n) => n.textContent.trim()) }));
if (sheet.title !== "Dana" || sheet.leads.join() !== "Quiet Lead,Late One") fail("the rep sheet from Home is wrong: " + JSON.stringify(sheet));
await mgr.keyboard.press("Escape");

// The Team tab is the members and admin screen; the Settings tab exists.
await mgr.click('.tabbar [data-route="/team"]');
await mgr.waitForSelector(".admin-store");
await mgr.click('.tabbar [data-route="/settings"]');
await mgr.waitForFunction(() => location.hash === "#/settings", null, { timeout: 5000 });

// --- A rep keeps the salesperson's app.
const rep = await pageAs("t", "p@e.com", [{ id: "x", name: "Someone", phone: "9025550000", stage: "working", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }]);
await rep.goto(APP + "/#/");
await rep.waitForSelector(".plays-slot", { timeout: 20000 });
await rep.waitForTimeout(800);
const repHome = await rep.evaluate(() => ({ mg: document.body.classList.contains("management"), tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()), voice: !!document.querySelector("#voice-btn") }));
console.log("rep home:", JSON.stringify(repHome));
if (repHome.mg || repHome.tabs.join() !== "Home,Leads,Voice,Tools,Comms" || !repHome.voice) fail("a rep got the store's app: " + JSON.stringify(repHome));
const repTools = await rep.evaluate(async () => { location.hash = "#/tools"; await new Promise((r) => setTimeout(r, 400)); return [...document.querySelectorAll(".qa-label")].map((n) => n.textContent.trim()); });
if (repTools.includes("Management view")) fail("a rep is offered the management view");

// --- A manager who also sells: sales app by default, with a switch each way.
await rpc("tm", "set_member_role", { member: U1, new_role: "manager", store: st.id });
const both = await pageAs("t", "p@e.com", [{ id: "x", name: "Someone", phone: "9025550000", stage: "working", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }]);
await both.goto(APP + "/#/tools");
await both.waitForFunction(() => [...document.querySelectorAll(".qa-label")].some((n) => n.textContent.trim() === "Management view"), null, { timeout: 15000 });
const stillSales = await both.evaluate(() => !document.body.classList.contains("management"));
if (!stillSales) fail("a manager with a book was switched to the store's app by default");
await both.evaluate(() => { [...document.querySelectorAll(".qa-tile")].find((t) => /Management view/.test(t.textContent)).click(); });
await both.waitForFunction(() => document.body.classList.contains("management") && document.querySelector(".hero-title"), null, { timeout: 20000 });
await both.waitForFunction(() => /As of/.test(document.body.textContent), null, { timeout: 20000 });
const switched = await both.evaluate(() => ({ title: document.querySelector(".hero-title")?.textContent.trim(), tabs: [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()) }));
if (switched.title !== "O'Regan's Nissan Halifax" || switched.tabs.length !== 3) fail("the switch to the management view didn't take: " + JSON.stringify(switched));
await both.evaluate(() => { [...document.querySelectorAll(".qa-tile")].find((t) => /Sales view/.test(t.textContent)).click(); });
await both.waitForSelector(".plays-slot", { timeout: 20000 });
const back = await both.evaluate(() => ({ mg: document.body.classList.contains("management"), tabs: document.querySelectorAll(".tabbar .tab").length }));
if (back.mg || back.tabs !== 5) fail("the switch back to the sales view didn't take: " + JSON.stringify(back));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmanage.test.js FAILED" : "\nmanage.test.js passed");
})();
