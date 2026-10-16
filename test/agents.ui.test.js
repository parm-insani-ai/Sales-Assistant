// The agents' screens: the Floor's unsold ups with a nudge and a manager
// text, the coach line on a rep whose rate is below the store's, booked
// by source on Home's ups table, and the plan's agent settings on Admin.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const now = new Date();
const iso = (d) => d.toISOString();
const ago = (min) => new Date(now.getTime() - min * 60000);
const pad = (n) => String(n).padStart(2, "0");
const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t2", "join_store", { code: st.code, display_name: "Dana" });
const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const D = 1440;
// Parm: six logged this month, three from the dealer site of which one booked; one unsold up quiet five days,
// one in play but in touch yesterday (not a be-back), one with a time booked (not a be-back).
const l = (id, name, source, extra = {}) => ({ id, collection: "leads", data: { id, name, phone: "902555" + id.padStart(4, "0"), stage: "working", source, loggedAt: iso(ago(10 * D)), ...x, ...extra } });
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  l("1", "Ann Up", "Dealer Site", { lastContacted: iso(ago(D)) }), l("2", "Bo Up", "Dealer Site", { lastContacted: iso(ago(D)) }), l("3", "Cy Up", "Dealer Site", { lastContacted: iso(ago(D)) }), l("7", "Dot Up", "Dealer Site", { lastContacted: iso(ago(D)) }),
  l("4", "Una Unsold", "Walk-in", { vehicleInterest: "Sentra", loggedAt: iso(ago(5 * D)), lastContacted: iso(ago(4 * D)) }),
  l("5", "Ben Booked", "Walk-in", { loggedAt: iso(ago(5 * D)), lastContacted: iso(ago(4 * D)) }),
  l("6", "Val Value", "Referral", { loggedAt: iso(ago(3 * D)), lastContacted: iso(ago(D)) }),
  { id: "a1", collection: "appointments", data: { id: "a1", leadId: "1", customerName: "Ann Up", when: month + "-28T10:00", status: "scheduled", confirmed: true, createdAt: iso(ago(3 * D)) } },
  { id: "a5", collection: "appointments", data: { id: "a5", leadId: "5", customerName: "Ben Booked", when: month + "-28T11:00", status: "scheduled", confirmed: true, createdAt: iso(ago(2 * D)) } },
  // Past appointments: Parm shows two of four (50%); Dana below.
  { id: "p1", collection: "appointments", data: { id: "p1", leadId: "2", customerName: "Bo Up", when: month + "-02T10:00", status: "scheduled", outcome: "showed", createdAt: iso(ago(12 * D)) } },
  { id: "p2", collection: "appointments", data: { id: "p2", leadId: "3", customerName: "Cy Up", when: month + "-03T10:00", status: "scheduled", outcome: "showed", createdAt: iso(ago(12 * D)) } },
  { id: "p3", collection: "appointments", data: { id: "p3", leadId: "6", customerName: "Val Value", when: month + "-04T10:00", status: "scheduled", outcome: "no_show", createdAt: iso(ago(12 * D)) } },
  { id: "p4", collection: "appointments", data: { id: "p4", leadId: "4", customerName: "Una Unsold", when: month + "-05T10:00", status: "scheduled", outcome: "no_show", createdAt: iso(ago(12 * D)) } },
] }) });
// Dana: three logged, four past appointments none shown — the show rate the coach flags.
const l2 = (id, name) => ({ id, collection: "leads", data: { id, name, phone: "902444" + id.padStart(4, "0"), stage: "working", source: "Walk-in", loggedAt: iso(ago(10 * D)), lastContacted: iso(ago(D)), ...x } });
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U2, rows: [
  l2("d1", "Dee One"), l2("d2", "Dee Two"), l2("d3", "Dee Three"),
  ...["d1", "d2", "d3", "d1"].map((id, i) => ({ id: "dp" + i, collection: "appointments", data: { id: "dp" + i, leadId: id, customerName: "Dee", when: month + "-0" + (2 + i) + "T10:00", status: "scheduled", outcome: "no_show", createdAt: iso(ago(12 * D)) } })),
] }) });

const mgr = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});

// --- Floor: the unsold ups, on the review day (today, for this store).
await rpc("tm", "store_config_set", { store: st.id, patch: { plan: { reviewDow: new Date().getDay() } } });
await mgr.goto(APP + "/#/floor");
await mgr.waitForFunction(() => document.querySelector(".mg-beback") && !/reading…|Reading every rep/.test(document.querySelector("#view").textContent), null, { timeout: 30000 });
const floor = await mgr.evaluate(() => ({
  title: [...document.querySelectorAll("#view .section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).find((t) => /^Act now/.test(t)),
  rows: [...document.querySelectorAll(".mg-beback")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  draft: document.querySelector(".mg-beback [data-mtext]")?.dataset.draft,
}));
console.log("floor:", JSON.stringify(floor));
if (!/^Act now · \d+ · costliest first/.test(floor.title || "")) fail("the unsold up isn't in the Act now list: " + floor.title);
if (floor.rows.length !== 1 || !/^Una Unsold quiet 4 d ?Parm · working · Sentra · in 5 d ago · no plan/.test(floor.rows[0])) fail("Una isn't the one unsold up: " + JSON.stringify(floor.rows));
if (!/^Hi Una, it's Sam at Store\. Parm mentioned you were in about the Sentra — is it still on your mind\?/.test(floor.draft || "")) fail("the be-back text isn't drafted: " + floor.draft);
await mgr.click(".mg-beback [data-bnudge]");
await mgr.waitForFunction(async () => (await (await fetch("/__nudges")).json()).some((n) => /Una Unsold has gone quiet/.test(n.title)), null, { timeout: 8000 }).catch(() => fail("the be-back nudge didn't go"));

// --- Reps: the coach line on Dana (show rate 0 against the store's), none on Parm.
await mgr.goto(APP + "/#/reps");
await mgr.waitForFunction(() => document.querySelector(".mg-calls"), null, { timeout: 30000 });
const reps = await mgr.evaluate(() => [...document.querySelectorAll(".team-row")].map((r) => ({ name: r.querySelector(".row-title").textContent.trim(), coach: r.querySelector(".mg-coach")?.textContent.replace(/\s+/g, " ").trim() || "" })));
console.log("reps:", JSON.stringify(reps));
const dana = reps.find((r) => /^Dana/.test(r.name)), parm = reps.find((r) => /^Parm/.test(r.name));
if (!dana || !/^Coach: show rate 0% against the store's 25% — confirm the night before/.test(dana.coach)) fail("Dana's coach line is wrong: " + JSON.stringify(dana));
if (!parm || parm.coach) fail("Parm, at the store's rates or above, shouldn't be coached: " + JSON.stringify(parm));

// --- Home: booked by source.
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.querySelector(".mg-math"), null, { timeout: 30000 });
const srcs = await mgr.evaluate(() => [...document.querySelectorAll(".mg-src")].map((n) => n.dataset.src + ": " + (n.querySelector(".mg-src-set")?.textContent.trim() || "")));
console.log("sources:", JSON.stringify(srcs));
if (!srcs.some((x) => /^dealer_site: 3 of \d+ booked$/.test(x)) || !srcs.some((x) => /^lot: 5 of \d+ booked$/.test(x))) fail("booked by source is wrong: " + JSON.stringify(srcs));

// --- Admin: the plan's agent settings save.
await mgr.goto(APP + "/#/team");
await mgr.waitForSelector("#pl-oa", { timeout: 20000 });
// The page redraws once its admin check and config read come back; fill after that.
await mgr.waitForFunction(() => !/checking…/.test(document.querySelector(".team-admin-check")?.textContent || "checking…"), null, { timeout: 20000 });
await mgr.fill("#pl-oa", "60"); await mgr.fill("#pl-osr", "5"); await mgr.fill("#pl-hmax", "8"); await mgr.selectOption("#pl-rdow", "2");
await mgr.click('[data-act="plan-save"]');
await mgr.waitForFunction(() => /Saved — Home shows the month's math/.test(document.body.textContent), null, { timeout: 8000 }).catch(() => fail("the plan didn't save"));
const saved = await rpc("tm", "store_config_get", { store: st.id });
if (!saved.plan || saved.plan.outreachAppts !== 60 || saved.plan.outreachSetRate !== 5 || saved.plan.handoutMax !== 8 || saved.plan.reviewDow !== 2 || saved.plan.autoRatios !== true) fail("the agent settings weren't saved: " + JSON.stringify(saved.plan));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nagents.ui.test.js FAILED" : "\nagents.ui.test.js passed");
})();
