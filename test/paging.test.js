// The server answers with at most its page (Supabase: 1,000 rows) whatever a
// request asks for. A rep's book of 1,250 customers must still come back
// whole to the manager's board, and the Admin page's "Check the board" must
// say so in numbers — the stub caps responses at 1,000 like the real thing.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });

const now = new Date();
const iso = (d) => d.toISOString();
const ago = (m) => new Date(now.getTime() - m * 60000);
const month = iso(now).slice(0, 7);
const N = 1250;
const rows = [];
for (let i = 0; i < N; i++) rows.push({ id: "L" + String(i).padStart(5, "0"), collection: "leads", data: { id: "L" + String(i).padStart(5, "0"), name: "Customer " + i, phone: "902555" + String(i).padStart(4, "0"), stage: "working", createdAt: `${month}-02T12:00:00.000Z`, loggedAt: `${month}-02T12:00:00.000Z`, updatedAt: `${month}-02T12:00:00.000Z` } });
// Two texts ready, on the two newest customers — the ones a capped read loses.
rows.push({ id: "T1", collection: "tasks", data: { id: "T1", leadId: "L01249", cadence: true, channel: "text", intent: "intro", title: "Text Customer — Welcome text", readyAt: iso(ago(20)), done: false } });
rows.push({ id: "T2", collection: "tasks", data: { id: "T2", leadId: "L01248", cadence: true, channel: "text", intent: "value", title: "Text Customer — Value text", readyAt: iso(ago(40)), done: false } });
for (let i = 0; i < rows.length; i += 500) await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: rows.slice(i, i + 500) }) });

await page.goto(APP + "/#/team");
await page.waitForSelector('[data-act="board-check"]', { timeout: 20000 });
// The read itself, past the cap.
const got = await page.evaluate(async (U1) => { const bk = await import("/js/backend.js"); return { all: (await bk.readRecords(U1, "leads", {}, { select: "id", limit: 20000 })).length, capped: (await bk.readRecords(U1, "leads", {}, { select: "id", limit: 300 })).length, count: await bk.countFor(U1, "leads") }; }, U1);
console.log("read:", JSON.stringify(got));
if (got.all !== N) fail(`a book of ${N} came back as ${got.all}`);
if (got.capped !== 300) fail("a read's own limit isn't honoured: " + got.capped);
if (got.count !== N) fail("the server count is wrong: " + got.count);
// The Admin page's check says it in numbers.
await page.click('[data-act="board-check"]');
await page.waitForFunction(() => document.querySelector(".board-check-row"), null, { timeout: 30000 });
const check = await page.evaluate(() => [...document.querySelectorAll(".board-check-row")].map((n) => n.textContent.replace(/\s+/g, " ").trim()));
console.log("check:", JSON.stringify(check));
if (check.length !== 1 || !/^Parm · synced just now ?Customers: 1,250 on the server, 1,250 read ?Logged this month: 1,250 ?Plan steps: 2 · texts due now: 2 · held: 0$/.test(check[0])) fail("the board check is wrong: " + JSON.stringify(check));
// And the Floor has the two texts, on customers past the thousandth.
await page.goto(APP + "/#/floor");
await page.waitForFunction(() => document.querySelector(".mg-due") && !/reading…|Reading every rep/.test(document.querySelector("#view").textContent), null, { timeout: 30000 });
const due = await page.evaluate(() => document.querySelector(".mg-due").textContent.replace(/\s+/g, " ").trim());
console.log("due:", due);
if (!/Parm 2 texts ready ?oldest waiting 40 min · Customer, Customer/.test(due)) fail("the texts on the newest customers aren't on the Floor: " + due);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\npaging.test.js FAILED" : "\npaging.test.js passed");
})();
