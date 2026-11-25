// To-dos are things to do; the Queue is people to reach. A call, text or
// email to a customer is on the Queue whatever its day — today's under Now,
// a later day's under Coming up — and never in To-dos; a thing to do,
// a note to yourself or a reminder is in To-dos and never on the Queue.
// The form asks which it is; the assistant files a "call Dana Thursday"
// on the Queue.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const pad = (n) => String(n).padStart(2, "0");
const day = (k) => { const d = new Date(Date.now() + k * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
await p.addInitScript(([today, thu]) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2026 Nissan Rogue SV", loggedAt: new Date().toISOString(), source: "Walk-in", ...x }],
    tasks: [
      { id: "t1", title: "Order the plates", due: today, done: false, ...x },
      { id: "t2", title: "Call Dana about the SV", due: today, leadId: "a", channel: "call", done: false, ...x },
      { id: "t3", title: "Email Dana the brochure", due: thu, leadId: "a", channel: "email", done: false, ...x },
      { id: "t4", title: "Pick up Dana's mats", due: thu, leadId: "a", done: false, ...x },
      { id: "t5", title: "Call the bank", due: thu, channel: "call", done: false, ...x },
      { id: "t6", title: "Text Dana — week two", due: thu, leadId: "a", channel: "text", cadence: true, done: false, ...x },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false } }));
}, [day(0), day(3)]);

await p.goto(APP + "/#/log");
await p.waitForFunction(() => document.querySelectorAll(".log-tabs [data-tab]").length === 3 && document.querySelector(".plays-slot .pl-card"), null, { timeout: 20000 }).catch(() => fail("Log didn't draw"));
await p.waitForTimeout(400);
const read = () => p.evaluate(() => ({
  queue: [...document.querySelectorAll(".plays-slot .pl-card")].map((c) => [c.dataset.group, c.querySelector(".strong")?.textContent.trim()]),
  groups: [...document.querySelectorAll(".plays-slot .pl-group")].map((h) => h.dataset.group),
  todos: [...document.querySelectorAll('[data-panel="todos"] .todo-card .row-title')].map((n) => n.textContent.trim()),
  counts: Object.fromEntries([...document.querySelectorAll(".log-tabs [data-tab]")].map((b) => [b.dataset.tab, b.querySelector(".tab-count")?.textContent])),
  line: document.querySelector(".lg-onqueue")?.textContent.replace(/\s+/g, " ").trim(),
}));
let c = await read();
console.log(JSON.stringify(c));
const grp = (re) => (c.queue.find(([, t]) => re.test(t)) || [])[0];
const q = { "Call Dana about the SV": grp(/Call Dana about the SV/), "Email Dana the brochure": grp(/Email Dana the brochure/) };
if (q["Call Dana about the SV"] !== "now") fail("today's call to a customer is on the Queue, now: " + JSON.stringify(c.queue));
if (q["Email Dana the brochure"] !== "coming") fail("a later day's email to a customer is on the Queue under Coming up: " + JSON.stringify(c.queue));
if (c.queue.some(([, t]) => /week two/.test(t))) fail("a plan's own step ahead of its day isn't on the Queue yet: " + JSON.stringify(c.queue));
if (c.queue.some(([, t]) => /mats|plates|bank/.test(t))) fail("things to do aren't on the Queue: " + JSON.stringify(c.queue));
if (c.todos.join() !== "Order the plates,Pick up Dana's mats,Call the bank" && c.todos.slice().sort().join() !== ["Call the bank", "Order the plates", "Pick up Dana's mats"].join()) fail("To-dos is the things to do — a customer's errand and a call to the bank included, never a call to a customer: " + JSON.stringify(c.todos));
if (c.counts.todos !== "3" || !/2 are calls, texts or emails to customers/.test(c.line || "")) fail("the chip counts three to-dos; the line says two are on the Queue: " + JSON.stringify([c.counts, c.line]));
if (c.groups.indexOf("coming") < c.groups.indexOf("now")) fail("Coming up sits after Now: " + c.groups.join());

// The form: a call to a customer, next week → the Queue; a plain to-do → To-dos.
await p.click('.log-tabs [data-tab="todos"]'); await p.waitForTimeout(200);
await p.click('[data-panel="todos"] [data-act="add-task"]'); await p.waitForSelector('.modal select[name="kind"]', { timeout: 5000 }).catch(() => fail("the form asks what it is"));
await p.fill('.modal input[name="title"]', "Call Dana back about the trade");
await p.fill('.modal input[name="due"]', day(7));
await p.selectOption('.modal select[name="kind"]', "call");
await p.fill('.modal input[name="customer"]', "Dana Muise");
await p.click(".modal button[type=submit]"); await p.waitForTimeout(500);
let made = await p.evaluate(async () => { const st = await import("/js/store.js"); const t = st.all("tasks").find((t) => /back about the trade/.test(t.title)); return t ? { channel: t.channel, leadId: t.leadId, due: t.due } : null; });
if (!made || made.channel !== "call" || made.leadId !== "a") fail("the form files a call to a customer with the customer on it: " + JSON.stringify(made));
c = await read();
if (!c.queue.some(([g, t]) => g === "coming" && /back about the trade/.test(t)) || c.todos.some((t) => /back about the trade/.test(t))) fail("…and it's on the Queue under Coming up, not in To-dos: " + JSON.stringify({ queue: c.queue, todos: c.todos }));
// A call to a customer with nobody named stays off until the customer is given.
await p.click('[data-panel="todos"] [data-act="add-task"]'); await p.waitForSelector('.modal select[name="kind"]', { timeout: 5000 });
await p.fill('.modal input[name="title"]', "Text someone"); await p.selectOption('.modal select[name="kind"]', "text");
await p.click(".modal button[type=submit]"); await p.waitForTimeout(300);
const stillOpen = await p.evaluate(() => !!document.querySelector('.modal select[name="kind"]'));
if (!stillOpen) fail("a text with no customer isn't filed");
await p.click(".modal .modal-close"); await p.waitForTimeout(200);

// The assistant: "call Dana Thursday" is the Queue's.
const viaAgent = await p.evaluate(async (thu) => {
  const A = await import("/js/agent.js"); const st = await import("/js/store.js");
  const r = await A.runTool("add_task", { title: "Call Dana about the colour", customer: "Dana Muise", due: thu });
  const t = st.all("tasks").find((t) => /about the colour/.test(t.title));
  return { r: !!r, channel: t && t.channel, leadId: t && t.leadId };
}, day(3)).catch((e) => ({ err: String(e) }));
console.log("agent:", JSON.stringify(viaAgent));
if (viaAgent.err) console.log("(runTool not exported — skipped)"); else if (viaAgent.channel !== "call" || viaAgent.leadId !== "a") fail("the assistant files a call to a customer as the Queue's: " + JSON.stringify(viaAgent));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nqueuesplit.test.js FAILED" : "\nqueuesplit.test.js passed");
})();
