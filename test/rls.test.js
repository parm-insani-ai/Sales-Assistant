// A manager can read every rep's rows, and the sync must never mistake
// them for the manager's own: after a manager's first sync, their local
// book holds only their own customers, and nothing of a rep's has been
// copied into the manager's account. And when a different account signs
// in on the phone, nothing of the last account's standing — the store, the
// admin flag, the chosen app — is left behind for them.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const UM = "00000000-0000-4000-8000-000000000003";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
const seed = (user_id, rows) => fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id, rows }) });
await seed(U1, [
  { id: "r1", collection: "leads", data: { id: "r1", name: "Reps Customer", phone: "9025551111", stage: "working", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" } },
  { id: "r2", collection: "leads", data: { id: "r2", name: "Reps Other", phone: "9025552222", stage: "new", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" } },
]);
await seed(UM, [{ id: "m1", collection: "leads", data: { id: "m1", name: "Managers Own", phone: "9025553333", stage: "working", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" } }]);
// The real policy: a manager's unfiltered read returns the reps' rows too.
const raw = await (await fetch(APP + "/rest/v1/records?select=id", { headers: { Authorization: "Bearer tm" } })).json();
if (raw.length !== 3) fail("the stub should let a manager read their reps' rows unfiltered, like the real policy: " + raw.length);

// --- The manager's phone syncs: only their own book comes down, nothing goes up as theirs.
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/");
await p.waitForFunction(async () => { const s = await import("/js/store.js"); return s.all("leads").some((l) => l.id === "m1"); }, null, { timeout: 20000 }).catch(() => fail("the manager's own customer never came down"));
await p.waitForTimeout(1500);
const local = await p.evaluate(async () => { const s = await import("/js/store.js"); return s.all("leads").map((l) => l.id).sort(); });
console.log("manager's local book:", JSON.stringify(local));
if (local.join() !== "m1") fail("a rep's customers landed in the manager's own book: " + JSON.stringify(local));
const recs = await (await fetch(APP + "/__records")).json();
const asManager = recs.filter((r) => r.user_id === UM && r.collection === "leads").map((r) => r.id).sort();
console.log("leads under the manager's account:", JSON.stringify(asManager));
if (asManager.join() !== "m1") fail("a rep's customers were copied into the manager's account: " + JSON.stringify(asManager));
// The Storage check's cloud count is the manager's own rows (their customer
// plus the settings mirrors the first sync wrote), never the reps'.
const cloud = await p.evaluate(async () => { const b2 = await import("/js/backend.js"); return b2.countRecords(); });
const own = recs.filter((r) => r.user_id === UM && !r.deleted).length;
if (cloud !== own || cloud >= own + 2) fail(`the cloud count should be the manager's own rows only: ${cloud} vs ${own} own`);

// --- A different account signs in on this phone: the store, the admin flag
// and the chosen app go with the last one.
await p.evaluate(async () => {
  localStorage.setItem("viniva:store:admin", "1");
  localStorage.setItem("viniva:mode", "manage");
  localStorage.setItem("viniva:store", JSON.stringify({ id: "x", name: "Old", role: "manager", admin: true }));
  const a = await import("/js/account.js");
  window.__switched = a.claimDevice({ id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" });
});
const after = await p.evaluate(() => ({ switched: window.__switched, admin: localStorage.getItem("viniva:store:admin"), mode: localStorage.getItem("viniva:mode"), store: localStorage.getItem("viniva:store"), sync: localStorage.getItem("viniva:sync") }));
console.log("after switch:", JSON.stringify(after));
if (!after.switched || after.admin || after.mode || after.store || after.sync) fail("the last account's standing survived the switch: " + JSON.stringify(after));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nrls.test.js FAILED" : "\nrls.test.js passed");
})();
