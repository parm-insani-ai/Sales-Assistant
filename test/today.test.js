// Today in drop-downs: the queue, the reminders and the to-dos, each with
// its count, each remembering whether it was left open. A reminder is a
// to-do with a time: it lands as a notification at that moment, sits under
// "Right now" on Home until it's ticked off, and never leaks into the
// queue or the to-dos.
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
    leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2021 Nissan Rogue SV", followUp: "2026-09-01", ...x }],
    tasks: [
      { id: "t1", title: "Order the plates", due: key(ago).slice(0, 10), done: false, ...x },
      { id: "t2", title: "Call the bank about Dana", due: key(ago).slice(0, 10), leadId: "a", channel: "call", done: false, ...x },
      { id: "r1", title: "Ring Dana back", due: key(ago).slice(0, 10), remindAt: key(ago), channel: "reminder", done: false, ...x },
      { id: "r2", title: "Check the SV came in", due: key(later).slice(0, 10), remindAt: key(later), channel: "reminder", leadId: "a", done: false, ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});

// --- Today: three drop-downs with counts; reminders are their own list.
await p.goto(APP + "/#/today");
await p.waitForFunction(() => document.querySelectorAll('#view details.fold').length === 3 && document.querySelector(".plays-slot .row"), null, { timeout: 20000 });
await p.waitForTimeout(300);
const today = await p.evaluate(() => ({
  folds: [...document.querySelectorAll("#view details.fold")].map((d) => ({ key: d.dataset.fold, open: d.open, title: d.querySelector(".fold-title").textContent.replace(/\s+/g, " ").trim() })),
  reminders: [...document.querySelectorAll('[data-fold="today:reminders"] .check-item')].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  todos: [...document.querySelectorAll('[data-fold="today:todos"] .check-item')].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  queue: [...document.querySelectorAll(".plays-slot .row .strong")].map((n) => n.textContent.trim()),
  note: document.querySelector('[data-fold="today:reminders"] .hint')?.textContent,
}));
console.log("today:", JSON.stringify(today, null, 1));
if (today.folds.map((f) => f.key).join() !== "today:queue,today:reminders,today:todos") fail("the three drop-downs aren't there in order: " + JSON.stringify(today.folds));
if (!today.folds.every((f) => f.open)) fail("the drop-downs should start open");
if (!/Today's queue · \d/.test(today.folds[0].title) || !/Reminders · 2/.test(today.folds[1].title) || !/To-dos · 2/.test(today.folds[2].title)) fail("the counts aren't on the headings: " + JSON.stringify(today.folds.map((f) => f.title)));
if (today.reminders.length !== 2 || !/Ring Dana back.*Today.*now/.test(today.reminders[0]) || !/Check the SV came in/.test(today.reminders[1])) fail("the reminders aren't listed soonest first with the due one marked: " + JSON.stringify(today.reminders));
if (today.todos.length !== 2 || today.todos.some((t) => /Ring Dana|Check the SV/.test(t))) fail("a reminder leaked into the to-dos: " + JSON.stringify(today.todos));
if (today.queue.some((t) => /Ring Dana|Check the SV/.test(t))) fail("a reminder leaked into the queue: " + JSON.stringify(today.queue));
if (!/Settings → Notifications/.test(today.note || "")) fail("the reminders don't say how to get them with the app closed: " + today.note);

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

// --- Adding a reminder from the drop-down's + Add; ticking one off.
await p.evaluate(() => { location.hash = "#/today"; }); await p.waitForTimeout(400);
await p.click('[data-fold="today:reminders"] [data-act="add-reminder"]');
await p.waitForSelector('.modal input[name="title"]', { timeout: 5000 });
const stillOpen = await p.evaluate(() => document.querySelector('[data-fold="today:reminders"]').open);
if (!stillOpen) fail("+ Add toggled the drop-down shut");
await p.fill('.modal input[name="title"]', "Appraise the trade");
await p.fill('.modal input[name="time"]', "16:30");
await p.click(".modal button[type=submit]");
await p.waitForTimeout(500);
const added = await p.evaluate(async () => { const s = await import("/js/store.js"); const t = s.all("tasks").find((x) => x.title === "Appraise the trade"); return { remindAt: t && t.remindAt, channel: t && t.channel, count: document.querySelector('[data-fold="today:reminders"] .fold-title').textContent.replace(/\s+/g, " ").trim() }; });
console.log("added:", JSON.stringify(added));
if (!/T16:30$/.test(added.remindAt || "") || added.channel !== "reminder" || !/Reminders · 3/.test(added.count)) fail("the reminder wasn't set with its time, or the count didn't move: " + JSON.stringify(added));
await p.evaluate(() => [...document.querySelectorAll('[data-fold="today:reminders"] .check-item')].find((r) => /Ring Dana back/.test(r.textContent)).querySelector("input").click());
await p.waitForTimeout(300);
const ticked = await p.evaluate(async () => { const s = await import("/js/store.js"); return { done: s.get("tasks", "r1").done, count: document.querySelector('[data-fold="today:reminders"] .fold-title').textContent.replace(/\s+/g, " ").trim() }; });
if (!ticked.done || !/Reminders · 2/.test(ticked.count)) fail("ticking the reminder off didn't take: " + JSON.stringify(ticked));

// --- A closed drop-down stays closed on the next visit.
await p.evaluate(() => { const d = document.querySelector('[data-fold="today:todos"]'); d.open = false; d.dispatchEvent(new Event("toggle")); });
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/today"; }); await p.waitForTimeout(400);
const back = await p.evaluate(() => ({ todos: document.querySelector('[data-fold="today:todos"]').open, queue: document.querySelector('[data-fold="today:queue"]').open }));
if (back.todos || !back.queue) fail("the drop-downs didn't come back as they were left: " + JSON.stringify(back));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ntoday.test.js FAILED" : "\ntoday.test.js passed");
})();
