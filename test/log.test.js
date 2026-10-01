// Log in chips: Queue, Logged, Reminders, To-dos across the top, each with
// its count, one on screen at a time, and the chip you were on is the one
// you come back to. A reminder is a to-do with a time: it lands as a
// notification at that moment, sits under "Right now" on Home until it's
// ticked off, and never leaks into the queue or the to-dos.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ago = new Date(Date.now() - 5 * 60000), later = new Date(Date.now() + 3 * 3600000);
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2021 Nissan Rogue SV", followUp: "2026-09-01", loggedAt: new Date().toISOString(), ...x }],
    tasks: [
      { id: "t1", title: "Order the plates", due: key(ago).slice(0, 10), done: false, ...x },
      { id: "t2", title: "Call the bank about Dana", due: key(ago).slice(0, 10), leadId: "a", channel: "call", done: false, ...x },
      { id: "r1", title: "Ring Dana back", due: key(ago).slice(0, 10), remindAt: key(ago), channel: "reminder", done: false, ...x },
      { id: "r2", title: "Check the SV came in", due: key(later).slice(0, 10), remindAt: key(later), channel: "reminder", leadId: "a", done: false, ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});

// --- Log: four chips with counts; the queue first; reminders are their own list.
await p.goto(APP + "/#/log");
await p.waitForFunction(() => document.querySelectorAll('#view .log-seg .seg-btn').length === 4 && document.querySelector(".plays-slot .row"), null, { timeout: 20000 });
await p.waitForTimeout(300);
const visible = (sel) => `[...document.querySelectorAll("${sel}")].filter((n) => n.closest(".log-panel") && !n.closest(".log-panel").hidden)`;
const today = await p.evaluate(() => ({
  chips: [...document.querySelectorAll("#view .log-seg .seg-btn")].map((b) => ({ tab: b.dataset.tab, active: b.classList.contains("active"), label: b.textContent.replace(/\s+/g, " ").trim() })),
  shown: [...document.querySelectorAll("#view .log-panel")].filter((p) => !p.hidden).map((p) => p.dataset.panel),
  reminders: [...document.querySelectorAll('[data-panel="reminders"] .check-item')].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  todos: [...document.querySelectorAll('[data-panel="todos"] .check-item')].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  queue: [...document.querySelectorAll(".plays-slot .row .strong")].map((n) => n.textContent.trim()),
  note: document.querySelector('[data-panel="reminders"] .hint')?.textContent,
  log: [...document.querySelectorAll('[data-panel="logged"] .log-row .row-title')].map((n) => n.textContent.trim()),
}));
const document_log = (t) => t.log.join(",");
console.log("log:", JSON.stringify(today, null, 1));
if (today.chips.map((c) => c.tab).join() !== "queue,logged,reminders,todos") fail("the four chips aren't there in order: " + JSON.stringify(today.chips));
if (today.shown.join() !== "queue" || !today.chips[0].active) fail("the queue should be the chip on screen first: " + JSON.stringify(today));
if (!/^Queue\s?\d/.test(today.chips[0].label) || !/^Logged\s?1$/.test(today.chips[1].label) || !/^Reminders\s?2$/.test(today.chips[2].label) || !/^To-dos\s?2$/.test(today.chips[3].label)) fail("the counts aren't on the chips: " + JSON.stringify(today.chips.map((c) => c.label)));
if (!/Dana Muise/.test(document_log(today))) fail("the month's log doesn't list the customer logged this month");
if (today.reminders.length !== 2 || !/Ring Dana back.*Today.*now/.test(today.reminders[0]) || !/Check the SV came in/.test(today.reminders[1])) fail("the reminders aren't listed soonest first with the due one marked: " + JSON.stringify(today.reminders));
if (today.todos.length !== 2 || today.todos.some((t) => /Ring Dana|Check the SV/.test(t))) fail("a reminder leaked into the to-dos: " + JSON.stringify(today.todos));
if (today.queue.some((t) => /Ring Dana|Check the SV/.test(t))) fail("a reminder leaked into the queue: " + JSON.stringify(today.queue));
if (!/Settings → Notifications/.test(today.note || "")) fail("the reminders don't say how to get them with the app closed: " + today.note);

// --- Tapping a chip swaps the panel.
await p.click('.log-seg [data-tab="reminders"]');
const swapped = await p.evaluate(() => ({ shown: [...document.querySelectorAll("#view .log-panel")].filter((p) => !p.hidden).map((p) => p.dataset.panel), active: document.querySelector(".log-seg .seg-btn.active")?.dataset.tab, rows: [...document.querySelectorAll('[data-panel="reminders"] .check-item')].filter((r) => r.getBoundingClientRect().height > 0).length }));
if (swapped.shown.join() !== "reminders" || swapped.active !== "reminders" || swapped.rows !== 2) fail("tapping Reminders should show only the reminders: " + JSON.stringify(swapped));

// --- The due reminder is under Right now on Home.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(400);
const home = await p.evaluate(() => [...document.querySelectorAll(".nudge-slot .nudge-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
console.log("right now:", JSON.stringify(home));
if (!home.some((t) => /Ring Dana back/.test(t) && /Reminder for/.test(t))) fail("the due reminder isn't under Right now: " + JSON.stringify(home));
if (home.some((t) => /Check the SV/.test(t))) fail("a reminder that isn't due yet is under Right now");

// --- The watcher fires the due reminder once, as a toast (and a
// notification when the phone allows), and marks it so it doesn't repeat.
const fired = await p.evaluate(async () => {
  const r = await import("/js/reminders.js"); const s = await import("/js/store.js");
  const n1 = r.checkReminders();
  const n2 = r.checkReminders();
  return { n1, n2, notified: !!s.get("tasks", "r1").notifiedAt, later: !!s.get("tasks", "r2").notifiedAt, toast: document.querySelector("#toast-root")?.textContent || "" };
});
console.log("watcher:", JSON.stringify(fired));
if (fired.n1 !== 1 || fired.n2 !== 0 || !fired.notified || fired.later) fail("the due reminder didn't fire exactly once: " + JSON.stringify(fired));
if (!/Ring Dana back/.test(fired.toast)) fail("the reminder didn't show: " + fired.toast);

// --- Adding a reminder from the chip's + Add; ticking one off.
await p.evaluate(() => { location.hash = "#/log"; }); await p.waitForTimeout(400);
const cameBack = await p.evaluate(() => document.querySelector(".log-seg .seg-btn.active")?.dataset.tab);
if (cameBack !== "reminders") fail("the chip you were on should be the one you come back to: " + cameBack);
await p.click('[data-panel="reminders"] [data-act="add-reminder"]');
await p.waitForSelector('.modal input[name="title"]', { timeout: 5000 });
await p.fill('.modal input[name="title"]', "Appraise the trade");
await p.fill('.modal input[name="time"]', "16:30");
await p.click(".modal button[type=submit]");
await p.waitForTimeout(500);
const added = await p.evaluate(async () => { const s = await import("/js/store.js"); const t = s.all("tasks").find((x) => x.title === "Appraise the trade"); return { remindAt: t && t.remindAt, channel: t && t.channel, count: document.querySelector('.log-seg [data-count="reminders"]').textContent }; });
console.log("added:", JSON.stringify(added));
if (!/T16:30$/.test(added.remindAt || "") || added.channel !== "reminder" || added.count !== "3") fail("the reminder wasn't set with its time, or the count didn't move: " + JSON.stringify(added));
await p.evaluate(() => [...document.querySelectorAll('[data-panel="reminders"] .check-item')].find((r) => /Ring Dana back/.test(r.textContent)).querySelector("input").click());
await p.waitForTimeout(300);
const ticked = await p.evaluate(async () => { const s = await import("/js/store.js"); return { done: s.get("tasks", "r1").done, count: document.querySelector('.log-seg [data-count="reminders"]').textContent }; });
if (!ticked.done || ticked.count !== "2") fail("ticking the reminder off didn't take: " + JSON.stringify(ticked));

// --- The assistant can land on a chip: "what's on my plate" opens the to-dos.
await p.evaluate(() => { sessionStorage.setItem("viniva:log:open", "todos"); location.hash = "#/"; });
await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/log"; }); await p.waitForTimeout(400);
const asked = await p.evaluate(() => ({ active: document.querySelector(".log-seg .seg-btn.active")?.dataset.tab, remembered: localStorage.getItem("viniva:log:tab") }));
if (asked.active !== "todos" || asked.remembered !== "reminders") fail("a chip asked for should show without becoming the remembered one: " + JSON.stringify(asked));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlog.test.js FAILED" : "\nlog.test.js passed");
})();
