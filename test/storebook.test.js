// The store's owner book: a manager loads a CSV of the dealership's
// customers, the Customers page ranks them with the reasons under a Store
// book chip, a tap hands one to a rep — a lead in the rep's book marked the
// store's, with the to-do — and the row is out of the pool so nobody else
// gets them. A second load updates rather than doubles.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
// Parm already has one of them (same phone): the book must not double her.
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "mine", collection: "leads", data: { id: "mine", name: "Eve Equity", phone: "9025550002", stage: "delivered", purchaseDate: "2024-01-01", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" } },
] }) });

const mgr = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", defaultApr: 7.9 } }));
});
const y = new Date().getFullYear();
const csv = [
  "Name,Phone,Vehicle,Purchase Date,Payment,Payoff,Value,Lease End,VIN",
  `Lee Lease,902-555-0001,2023 Nissan Rogue SV,2023-01-15,540,,,${y}-12-01,1N4LEASE000000001`,
  "Eve Equity,902-555-0002,2024 Nissan Kicks,2024-01-01,480,12000,21000,,",
  "Quiet Owner,902-555-0003,2025 Nissan Sentra,2025-06-01,420,,,,",
  ",902-555-0009,No Name,,,,,,",
].join("\n");

// --- Load the book from the quick add.
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.querySelector(".mg-math"), null, { timeout: 30000 });
await mgr.evaluate(() => import("/js/views/storebook.js").then((m) => m.openStoreBookUpload(JSON.parse(localStorage.getItem("viniva:store")))));
await mgr.waitForSelector(".sb-upload [data-file]", { state: "attached", timeout: 10000 });
await mgr.setInputFiles(".sb-upload [data-file]", { name: "owners.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await mgr.waitForSelector('.sb-upload [data-act="go"]', { timeout: 10000 });
const preview = await mgr.evaluate(() => document.querySelector(".sb-upload .card .strong").textContent.trim());
if (!/^3 customers read · 1 rows without a name skipped$/.test(preview)) fail("the preview is wrong: " + preview);
await mgr.click('.sb-upload [data-act="go"]');
await mgr.waitForFunction(() => /in the store's book/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => fail("the load didn't report"));
const book = await rpc("tm", "store_book", { store: st.id });
console.log("book:", JSON.stringify(book.map((c) => [c.id, c.status, c.data.name])));
if (book.length !== 3 || !book.some((c) => c.id === "vin:1N4LEASE000000001") || !book.some((c) => c.id === "ph:9025550002") || !book.every((c) => c.status === "new")) fail("the book isn't loaded with VIN or phone ids: " + JSON.stringify(book));

// --- Customers: the Store book chip, ranked, Eve left out (Parm has her).
await mgr.goto(APP + "/#/customers");
await mgr.waitForFunction(() => document.querySelector('[data-mode="pool"]'), null, { timeout: 30000 });
await mgr.click('[data-mode="pool"]');
await mgr.waitForFunction(() => /not yet handed out/.test(document.querySelector("#view").textContent), null, { timeout: 10000 });
const pool = await mgr.evaluate(() => ({
  head: document.querySelector(".mg-plan .strong").textContent.trim(),
  rows: [...document.querySelectorAll(".cu-row")].map((r) => ({ name: r.querySelector(".row-title").textContent.trim(), sub: r.querySelector(".row-sub").textContent.replace(/\s+/g, " ").trim(), reasons: r.querySelector(".row-reasons")?.textContent.replace(/\s+/g, " ").trim() || "", btn: r.querySelector("[data-hand]")?.textContent.trim() })),
}));
console.log("pool:", JSON.stringify(pool));
if (!/^3 in the store's book not yet handed out\.$/.test(pool.head)) fail("the pool count is wrong: " + pool.head);
if (pool.rows.length !== 2 || pool.rows.some((r) => /Eve/.test(r.name))) fail("Eve, already in Parm's book, should be left out; the two others shown: " + JSON.stringify(pool.rows));
if (!/Lee Lease/.test(pool.rows[0].name) || !/Lease ends/.test(pool.rows[0].reasons) || !/Store book not handed out/.test(pool.rows[0].sub) || pool.rows[0].btn !== "Hand to…") fail("the lease-end owner isn't first with the reason: " + JSON.stringify(pool.rows[0]));

// --- Hand Lee to Parm.
await mgr.click('.cu-row [data-hand="vin:1N4LEASE000000001"]');
await mgr.waitForSelector(".cu-pick", { timeout: 8000 });
await mgr.click('.cu-pick[data-rep="' + U1 + '"]');
await mgr.waitForFunction(() => !document.querySelector(".cu-pick"), null, { timeout: 8000 });
const after = await rpc("tm", "store_book", { store: st.id });
const lee = after.find((c) => c.id === "vin:1N4LEASE000000001");
if (!lee || lee.status !== "assigned" || lee.assigned_to !== U1) fail("Lee isn't marked handed to Parm: " + JSON.stringify(lee));
const parms = await (await fetch(APP + "/__records")).json();
const lead = parms.find((r) => r.user_id === U1 && r.collection === "leads" && r.data.storeCustomerId === "vin:1N4LEASE000000001");
const task = parms.find((r) => r.user_id === U1 && r.collection === "tasks" && lead && r.data.leadId === lead.id);
if (!lead || lead.data.name !== "Lee Lease" || !lead.data.importedAt || lead.data.source !== "Owner book" || lead.data.stage !== "delivered") fail("Lee isn't in Parm's book as the store's: " + JSON.stringify(lead && lead.data));
if (!task || !/^Reach out to Lee Lease — Lease ends/.test(task.data.title) || task.data.kind !== "reach") fail("Parm didn't get the to-do with the reason: " + JSON.stringify(task && task.data));
const handed = await mgr.evaluate(() => document.querySelector('.cu-row [data-hand="vin:1N4LEASE000000001"]')?.textContent.trim());
if (handed !== "Handed") fail("the row doesn't show as handed: " + handed);

// --- A second load of the same file updates, never doubles; Lee keeps her rep.
const r2 = await rpc("tm", "store_book_upsert", { store: st.id, rows: [{ id: "vin:1N4LEASE000000001", name: "Lee Lease", phone: "9025550001", odometer: 61000 }] });
const again = await rpc("tm", "store_book", { store: st.id });
const lee2 = again.find((c) => c.id === "vin:1N4LEASE000000001");
if (again.length !== 3 || !lee2 || lee2.status !== "assigned" || lee2.data.odometer !== 61000 || !lee2.data.purchaseDate) fail("a second load should update in place and keep the hand-off: " + JSON.stringify([r2, lee2]));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nstorebook.test.js FAILED" : "\nstorebook.test.js passed");
})();
