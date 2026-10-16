// A cold open paints the last read. A home-screen app on a phone starts
// with empty session storage every launch; the board, the book and the lot
// are kept on the device, so the manager's Home draws the last read at once
// ("As of …") and re-reads behind it rather than saying "Reading the reps'
// books…" until every rep's book has been read again.
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
const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "l1", collection: "leads", data: { id: "l1", name: "Dana Muise", phone: "9025551111", stage: "working", source: "Dealer Site", loggedAt: new Date(Date.now() - 3600000).toISOString(), ...x } },
] }) });

const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const auth = () => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
};

// First open: the board is read and kept on the device.
const p1 = await ctx.newPage();
p1.on("pageerror", (e) => errs.push(e.message));
await p1.addInitScript(auth);
await p1.goto(APP + "/#/");
await p1.waitForFunction(() => document.querySelector(".mg-math") && /As of/.test(document.body.textContent) && !/reading…/.test(document.body.textContent), null, { timeout: 30000 });
const first = await p1.evaluate(() => document.querySelector(".mg-pace[data-k='Customers spoken with']")?.dataset.have);
if (first !== "1") fail("the first read didn't count the logged customer: " + first);
await p1.waitForTimeout(400);
await p1.close();

// A cold open: a new tab has no session storage; the reps' records are slow
// to read this time. The page must paint the last read, "As of", before the
// re-read lands.
const p2 = await ctx.newPage();
p2.on("pageerror", (e) => errs.push(e.message));
await p2.addInitScript(auth);
let held = 0;
await p2.route("**/rest/v1/records**", async (route) => { held++; await new Promise((r) => setTimeout(r, 4000)); await route.continue(); });
const t0 = Date.now();
await p2.goto(APP + "/#/");
const painted = await p2.waitForFunction(() => document.querySelector(".mg-math") && /As of/.test(document.body.textContent), null, { timeout: 3500 }).then(() => true).catch(() => false);
const ms = Date.now() - t0;
const cold = await p2.evaluate(() => ({
  text: document.querySelector("#view")?.textContent.replace(/\s+/g, " ").slice(0, 160),
  have: document.querySelector(".mg-pace[data-k='Customers spoken with']")?.dataset.have,
  reading: /reading…/.test(document.body.textContent),
  session: sessionStorage.getItem("viniva:team-board"),
}));
console.log("cold open:", JSON.stringify({ painted, ms, held, ...cold }));
if (!painted || cold.have !== "1") fail("the cold open didn't paint the last read before the re-read: " + JSON.stringify({ painted, ms, cold }));
if (cold.session) fail("the new tab had a session copy — the test isn't testing a cold open");
if (!cold.reading) fail("the cold open isn't re-reading behind the last read: " + cold.text);
// The re-read lands and the page says so.
await p2.waitForFunction(() => document.querySelector(".mg-math") && /As of/.test(document.body.textContent) && !/reading…/.test(document.body.textContent), null, { timeout: 30000 }).catch(() => fail("the re-read never landed"));
if (!(await p2.evaluate(() => !!sessionStorage.getItem("viniva:team-board")))) fail("the re-read didn't refresh the session copy");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncoldopen.test.js FAILED" : "\ncoldopen.test.js passed");
})();
