// The board, pointed at appointments: Home leads with today's plan per rep
// and what the manager's taps came to; the Floor leads with fresh leads and
// a running clock; each rep's row carries call conversion and the loop; a
// row that reads empty says why. On the rep's Home, today's appointments to
// set, worked from the month.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002", UM = "00000000-0000-4000-8000-000000000003";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const now = new Date();
const iso = (d) => d.toISOString();
const ago = (min) => new Date(now.getTime() - min * 60000);
const pad = (n) => String(n).padStart(2, "0");
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tmrw = new Date(now.getTime() + 86400000);
const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };

const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });

// Parm's cloud copy. A goal of 12 with nothing sold means appointments are
// needed every day. One set today (two hours ago, for tomorrow), one set
// three days ago. A fresh lead ten minutes old. Three calls in two weeks:
// one connected and booked within a day, one dial that didn't connect, one
// connect that didn't book. A text from the store that booked.
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "cfg", collection: "config", data: { id: "cfg", goalUnits: 12 } },
  { id: "l1", collection: "leads", data: { id: "l1", name: "Dana Muise", phone: "9025551111", stage: "working", ...x } },
  { id: "l2", collection: "leads", data: { id: "l2", name: "Ken Boudreau", phone: "9025552222", stage: "appointment", ...x } },
  { id: "f1", collection: "leads", data: { id: "f1", name: "Fay Fresh", phone: "9025553333", stage: "new", source: "Web", createdAt: iso(ago(10)), updatedAt: iso(ago(10)) } },
  { id: "ap1", collection: "appointments", data: { id: "ap1", leadId: "l1", customerName: "Dana Muise", type: "test drive", when: local(tmrw).slice(0, 11) + "14:00", status: "scheduled", confirmed: true, createdAt: iso(ago(120)) } },
  { id: "ap2", collection: "appointments", data: { id: "ap2", leadId: "l2", customerName: "Ken Boudreau", type: "appointment", when: local(tmrw).slice(0, 11) + "16:00", status: "scheduled", confirmed: true, createdAt: iso(ago(3 * 1440)) } },
  { id: "c1", collection: "calls", data: { id: "c1", leadId: "l1", dir: "out", at: iso(ago(180)), outcome: "reached" } },
  { id: "c2", collection: "calls", data: { id: "c2", leadId: "l2", dir: "out", at: iso(ago(5 * 1440)), outcome: "" } },
  { id: "c3", collection: "calls", data: { id: "c3", leadId: "l2", dir: "out", at: iso(ago(2 * 1440)), outcome: "reached" } },
  { id: "tx1", collection: "texts", data: { id: "tx1", leadId: "l2", dir: "out", via: "manager", body: "Hi Ken", at: iso(ago(3 * 1440 + 120)), read: true } },
] }) });

// --- The manager. Two taps already on record: a nudge about Dana three
// hours ago (booked), a hand-off about Ken yesterday (not booked).
const mgr = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(({ U1, n1, n2 }) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], mgractions: [
    { id: "m1", kind: "nudge", rep: U1, leadId: "l1", at: n1, createdAt: n1, updatedAt: n1 },
    { id: "m2", kind: "handoff", rep: U1, leadId: "l2", at: n2, createdAt: n2, updatedAt: n2 },
  ], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
}, { U1, n1: iso(ago(180)), n2: iso(ago(1440)) });
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.querySelector(".mg-today") && document.querySelector(".mg-loop"), null, { timeout: 30000 });
const home = await mgr.evaluate(() => ({
  today: document.querySelector(".mg-today").textContent.replace(/\s+/g, " ").trim(),
  reps: [...document.querySelectorAll(".mg-today-rep")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  loop: document.querySelector(".mg-loop").textContent.replace(/\s+/g, " ").trim(),
  notes: [...document.querySelectorAll(".mg-note")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  first: document.querySelector("#view .card")?.className,
}));
console.log("home:", JSON.stringify(home, null, 1));
if (!/To hit 12 units: \d+ more appointments set by month end — [\d.]+ a day/.test(home.today)) fail("Home doesn't lead with the plan: " + home.today);
if (!home.reps.some((r) => /^Parm 1 of \d+ set today ?1 fresh lead/.test(r))) fail("Parm's row doesn't show today's need, what's set, and the fresh lead: " + JSON.stringify(home.reps));
if (!home.reps.some((r) => /^Dana /.test(r))) fail("Dana's row is missing: " + JSON.stringify(home.reps));
if (!/2 of 3 actions had an appointment set within a day \(67%\)/.test(home.loop) || !/Nudges 1 of 1 · Texts from the store 1 of 1 · Hand-offs 0 of 1/.test(home.loop)) fail("the loop is wrong: " + home.loop);
if (home.notes.length !== 1 || !/^Dana: Nothing in their cloud copy yet/.test(home.notes[0])) fail("the empty-book note should name Dana and only Dana: " + JSON.stringify(home.notes));
if (!/mg-today/.test(home.first || "")) fail("today's plan isn't the first card: " + home.first);

// --- Reps: call conversion and the loop on Parm's row.
await mgr.goto(APP + "/#/reps");
await mgr.waitForFunction(() => document.querySelector(".mg-calls"), null, { timeout: 30000 });
const reps = await mgr.evaluate(() => [...document.querySelectorAll(".team-row")].map((r) => ({ name: r.querySelector(".row-title").textContent.trim(), calls: r.querySelector(".mg-calls")?.textContent.replace(/\s+/g, " ").trim(), note: r.querySelector(".mg-row-note")?.textContent.trim() })));
console.log("reps:", JSON.stringify(reps));
const parm = reps.find((r) => /^Parm/.test(r.name)), dana = reps.find((r) => /^Dana/.test(r.name));
if (!parm || parm.calls !== "14 days: 3 calls · 2 connected · 1 booked within a day · your taps: 2 of 3 booked") fail("Parm's call line is wrong: " + JSON.stringify(parm));
if (!dana || !/Nothing in their cloud copy yet/.test(dana.note || "")) fail("Dana's row doesn't say why it's empty: " + JSON.stringify(dana));

// --- The Floor: fresh leads first, with the clock; a nudge is recorded against the lead.
await mgr.goto(APP + "/#/floor");
await mgr.waitForFunction(() => document.querySelector(".mg-fresh") && !/reading…|Reading every rep/.test(document.querySelector("#view").textContent), null, { timeout: 30000 });
const floor = await mgr.evaluate(() => ({
  firstTitle: document.querySelector("#view .section-title")?.textContent.replace(/\s+/g, " ").trim(),
  fresh: document.querySelector(".mg-fresh").textContent.replace(/\s+/g, " ").trim(),
  clock: document.querySelector(".mg-fresh .mg-clock")?.dataset.at,
}));
console.log("floor:", JSON.stringify(floor));
if (!/^Fresh leads waiting · 1 untouched · the first hour books$/.test(floor.firstTitle || "")) fail("fresh leads aren't the first card: " + floor.firstTitle);
if (!/Fay Fresh 10 min ?Parm · Web.*Nudge/.test(floor.fresh) || !floor.clock) fail("the fresh lead row or its clock is wrong: " + JSON.stringify(floor));
await mgr.click(".mg-fresh [data-nudge]");
await mgr.waitForFunction(async () => (await import("/js/store.js")).all("mgractions").some((a) => a.kind === "nudge" && a.leadId === "f1"), null, { timeout: 10000 }).catch(() => fail("the nudge about Fay wasn't recorded for the loop"));

// --- The rep's Home: today's appointments to set, from the month.
const rep = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
rep.on("pageerror", (e) => errs.push(e.message));
await rep.addInitScript(({ apWhen, apAt }) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t4", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000004", email: "r@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", shopping: "New", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
    appointments: [{ id: "a1", leadId: "a", customerName: "Dana Muise", type: "test drive", when: apWhen, status: "scheduled", createdAt: apAt, updatedAt: apAt }],
    settings: { salesperson: "Parm", cloudAutoSync: false, targetNew: 8, targetUsed: 4, closingNew: 40, closingUsed: 40, goalUnits: 12 },
  }));
}, { apWhen: local(tmrw).slice(0, 11) + "14:00", apAt: iso(ago(120)) });
await rep.goto(APP + "/#/");
await rep.waitForSelector(".target-card .tg-today", { timeout: 20000 });
const daily = await rep.evaluate(() => document.querySelector(".target-card .tg-today").textContent.replace(/\s+/g, " ").trim());
console.log("daily:", daily);
if (!/^Today: 1 of \d+ appointments? set/.test(daily) || !/more to set this month to hit 12/.test(daily)) fail("the rep's daily target is wrong: " + daily);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nloop.test.js FAILED" : "\nloop.test.js passed");
})();
