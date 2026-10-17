// The event log. Every act on the rep's phone is one record in "events":
// a new lead, a customer logged, a text out, an appointment set, confirmed,
// showed, a sale, a task done — each with the customer, the time, and what
// prompted it. Records arriving by sync don't log. A push the worker queued
// while the app was shut is drained on open; a push opened arrives as
// ?push=tag on the URL and is logged and stripped. The log syncs.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Test", phone: "9025551111", stage: "working", source: "Dealer Site", ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false, goalUnits: 10 },
  }));
});
await p.goto(APP + "/#/");
await p.waitForSelector("#page-title", { timeout: 20000 });
await p.waitForTimeout(800);

const kinds = await p.evaluate(async () => {
  const s = await import("/js/store.js");
  const { logCustomer } = await import("/js/logbook.js");
  const before = s.all("events").length;
  s.create("leads", { name: "New Lead", phone: "9025550002", stage: "new", source: "Web" });
  logCustomer("a");
  s.create("texts", { leadId: "a", dir: "out", body: "Hi Dana", at: new Date().toISOString(), intent: "intro" });
  const ap = s.create("appointments", { leadId: "a", customerName: "Dana Test", type: "test drive", when: "2026-10-20T10:00", status: "scheduled" });
  s.update("appointments", ap.id, { confirmed: true });
  s.update("appointments", ap.id, { outcome: "showed" });
  s.create("sales", { leadId: "a", customerName: "Dana Test", newUsed: "New", saleDate: "2026-10-17" });
  const t = s.create("tasks", { leadId: "a", title: "Call Dana", channel: "call", kind: "reach", done: false });
  s.update("tasks", t.id, { done: true, doneBy: "tap" });
  // Sync-arrived records don't log.
  s.applyRemote("appointments", "remote1", { id: "remote1", leadId: "a", customerName: "Dana Test", when: "2026-10-21T10:00", status: "scheduled" });
  const ev = s.all("events").slice(0, s.all("events").length - before).reverse();
  return { kinds: ev.map((e) => e.kind), first: ev[0], text: ev.find((e) => e.kind === "text_out"), task: ev.find((e) => e.kind === "task_done"), showed: ev.find((e) => e.kind === "appt_showed"), synced: s.SYNC_COLLECTIONS.includes("events") };
});
console.log("events:", JSON.stringify(kinds, null, 1));
if (kinds.kinds.join() !== "lead_new,logged,text_out,appt_set,appt_confirmed,appt_showed,sold,task_done") fail("the acts didn't log in order: " + kinds.kinds.join());
if (!kinds.first || kinds.first.name !== "New Lead" || !kinds.first.meta || kinds.first.meta.source !== "Web" || kinds.first.by !== "rep" || !kinds.first.at) fail("the lead event doesn't carry who, what, when: " + JSON.stringify(kinds.first));
if (!kinds.text || kinds.text.leadId !== "a" || kinds.text.name !== "Dana Test" || kinds.text.prompt !== "intro" || "body" in kinds.text) fail("the text event is wrong (and must never carry the body): " + JSON.stringify(kinds.text));
if (!kinds.task || !kinds.task.meta || kinds.task.meta.kind !== "reach" || kinds.task.meta.doneBy !== "tap") fail("the task event doesn't say what kind of task and how it was done: " + JSON.stringify(kinds.task));
if (!kinds.showed || kinds.showed.name !== "Dana Test") fail("the showed event is wrong: " + JSON.stringify(kinds.showed));
if (!kinds.synced) fail("the event log doesn't sync");

// A push opened: the worker's ?push= mark on the URL, logged and stripped.
await p.goto(APP + "/?push=lead%3Aa&act=showed#/");
await p.waitForSelector("#page-title", { timeout: 20000 });
await p.waitForTimeout(600);
const opened = await p.evaluate(async () => { const s = await import("/js/store.js"); const e = s.all("events").find((x) => x.kind === "push_open"); return { e, search: location.search, hash: location.hash }; });
console.log("push open:", JSON.stringify(opened));
if (!opened.e || opened.e.prompt !== "lead:a" || !opened.e.meta || opened.e.meta.action !== "showed") fail("the push open wasn't logged with its tag and button: " + JSON.stringify(opened.e));
if (opened.search !== "" || opened.hash !== "#/") fail("the push mark wasn't stripped from the URL: " + JSON.stringify(opened));

// Pushes received while the app was shut: queued by the worker, drained on open.
await p.evaluate(async () => { const c = await import("/js/cachedb.js"); await c.cacheSet("push:received", [{ tag: "lead:a", at: Date.now() - 60000 }, { tag: "outcome:ap1", at: Date.now() - 30000 }]); });
await p.reload();
await p.waitForSelector("#page-title", { timeout: 20000 });
await p.waitForFunction(async () => { const s = await import("/js/store.js"); return s.all("events").filter((x) => x.kind === "push_received").length === 2; }, null, { timeout: 8000 }).catch(() => fail("the queued pushes weren't drained into the log"));
const drained = await p.evaluate(async () => { const s = await import("/js/store.js"); const c = await import("/js/cachedb.js"); return { tags: s.all("events").filter((x) => x.kind === "push_received").map((x) => x.prompt).sort(), left: await c.cacheGet("push:received") }; });
console.log("push received:", JSON.stringify(drained));
if (drained.tags.join() !== "lead:a,outcome:ap1" || (Array.isArray(drained.left) && drained.left.length)) fail("the drained pushes are wrong, or the queue wasn't cleared: " + JSON.stringify(drained));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nevents.test.js FAILED" : "\nevents.test.js passed");
})();
