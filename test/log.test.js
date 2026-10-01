// Log in chips: Queue, Logged, To-dos across the top, each with its count,
// one on screen at a time, and the chip you were on is the one you come
// back to. A reminder is a to-do with a time, on the same list: it lands
// as a notification at that moment and sits under "Right now" on Home
// until it's ticked off. The plan's own steps stay on the queue.
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
      // Two next moves the app filed from a note: one the assistant can run, one only the salesperson can.
      { id: "c1", title: "3 in stock under their budget", due: key(later).slice(0, 10), leadId: "a", source: "context", kind: "budget", done: false, ...x },
      { id: "c2", title: "Appraise the trade: 2019 Altima", due: key(later).slice(0, 10), leadId: "a", source: "context", kind: "trade", done: false, ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" },
  }));
});

// --- Log: three chips with counts; the queue first; to-dos and reminders one list.
await p.goto(APP + "/#/log");
await p.waitForFunction(() => document.querySelectorAll('#view .log-tabs [data-tab]').length === 3 && document.querySelector(".plays-slot .row"), null, { timeout: 20000 });
await p.waitForTimeout(300);
const today = await p.evaluate(() => ({
  chips: [...document.querySelectorAll("#view .log-tabs [data-tab]")].map((b) => ({ tab: b.dataset.tab, active: b.classList.contains("btn-primary"), label: b.textContent.replace(/\s+/g, " ").trim() })),
  shown: [...document.querySelectorAll("#view .log-panel")].filter((p) => !p.hidden).map((p) => p.dataset.panel),
  todos: [...document.querySelectorAll('[data-panel="todos"] .todo-card')].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  queue: [...document.querySelectorAll(".plays-slot .row .strong")].map((n) => n.textContent.trim()),
  note: document.querySelector('[data-panel="todos"] .hint')?.textContent,
  log: [...document.querySelectorAll('[data-panel="logged"] .log-row .row-title')].map((n) => n.textContent.trim()),
}));
const document_log = (t) => t.log.join(",");
console.log("log:", JSON.stringify(today, null, 1));
if (today.chips.map((c) => c.tab).join() !== "logged,todos,queue") fail("the three chips aren't there in order: " + JSON.stringify(today.chips));
if (today.shown.join() !== "logged" || !today.chips[0].active) fail("Logged should be the chip on screen first: " + JSON.stringify(today));
if (!/^Logged\s?1$/.test(today.chips[0].label) || !/^To-dos\s?6$/.test(today.chips[1].label) || !/^Queue\s?\d/.test(today.chips[2].label)) fail("the counts aren't on the chips: " + JSON.stringify(today.chips.map((c) => c.label)));
if (!/Dana Muise/.test(document_log(today))) fail("the month's log doesn't list the customer logged this month");
// One list, soonest first by when it's actually due: the reminder that's
// due now, the one later today at its minute, then the to-dos dated today.
if (today.todos.length !== 6 || !/^Ring Dana back.*now/i.test(today.todos[0]) || !/Check the SV came in/.test(today.todos[1])) fail("to-dos and reminders should be one list, soonest first, the due one marked: " + JSON.stringify(today.todos));
if (today.queue.some((t) => /Ring Dana|Check the SV/.test(t))) fail("a reminder leaked into the queue: " + JSON.stringify(today.queue));
if (!/Settings → Notifications/.test(today.note || "")) fail("the list doesn't say how a timed to-do reaches a closed app: " + today.note);

// --- Tapping a chip swaps the panel.
await p.click('.log-tabs [data-tab="todos"]');
const swapped = await p.evaluate(() => ({ shown: [...document.querySelectorAll("#view .log-panel")].filter((p) => !p.hidden).map((p) => p.dataset.panel), active: document.querySelector(".log-tabs .btn-primary")?.dataset.tab, rows: [...document.querySelectorAll('[data-panel="todos"] .todo-card')].filter((r) => r.getBoundingClientRect().height > 0).length }));
if (swapped.shown.join() !== "todos" || swapped.active !== "todos" || swapped.rows !== 6) fail("tapping To-dos should show only the to-dos: " + JSON.stringify(swapped));

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

// --- Adding from the chip's + Add: a time makes it a reminder; ticking one off.
await p.evaluate(() => { location.hash = "#/log"; }); await p.waitForTimeout(400);
const cameBack = await p.evaluate(() => document.querySelector(".log-tabs .btn-primary")?.dataset.tab);
if (cameBack !== "todos") fail("the chip you were on should be the one you come back to: " + cameBack);
await p.click('[data-panel="todos"] [data-act="add-task"]');
await p.waitForSelector('.modal input[name="title"]', { timeout: 5000 });
await p.fill('.modal input[name="title"]', "Appraise the trade");
await p.fill('.modal input[name="time"]', "16:30");
await p.click(".modal button[type=submit]");
await p.waitForTimeout(500);
const added = await p.evaluate(async () => { const s = await import("/js/store.js"); const t = s.all("tasks").find((x) => x.title === "Appraise the trade"); return { remindAt: t && t.remindAt, channel: t && t.channel, count: document.querySelector('.log-tabs [data-count="todos"]').textContent }; });
console.log("added:", JSON.stringify(added));
if (!/T16:30$/.test(added.remindAt || "") || added.channel !== "reminder" || added.count !== "7") fail("a to-do given a time should be a reminder, and the count should move: " + JSON.stringify(added));
// …and one without a time is just on the list.
await p.click('[data-panel="todos"] [data-act="add-task"]');
await p.waitForSelector('.modal input[name="title"]', { timeout: 5000 });
await p.fill('.modal input[name="title"]', "Wash the demo");
await p.click(".modal button[type=submit]");
await p.waitForTimeout(400);
const plain = await p.evaluate(async () => { const s = await import("/js/store.js"); const t = s.all("tasks").find((x) => x.title === "Wash the demo"); return { remindAt: t && t.remindAt, channel: t && t.channel, due: t && t.due }; });
if (plain.remindAt || plain.channel === "reminder" || !plain.due) fail("a to-do with no time should not be a reminder: " + JSON.stringify(plain));
await p.evaluate(() => [...document.querySelectorAll('[data-panel="todos"] .todo-card')].find((r) => /Ring Dana back/.test(r.textContent)).querySelector("input").click());
await p.waitForTimeout(300);
const ticked = await p.evaluate(async () => { const s = await import("/js/store.js"); return { done: s.get("tasks", "r1").done, count: document.querySelector('.log-tabs [data-count="todos"]').textContent }; });
if (!ticked.done || ticked.count !== "7") fail("ticking the reminder off didn't take: " + JSON.stringify(ticked));

// --- "Do it": the next move the assistant can run has the button; the one
// only the salesperson can do doesn't. Tapping it hands the to-do to the
// assistant, with the customer named, and says what came back.
const doit = await p.evaluate(() => {
  const rowOf = (t) => [...document.querySelectorAll('[data-panel="todos"] .todo-card')].find((r) => r.textContent.includes(t));
  return { budget: !!rowOf("3 in stock under their budget")?.querySelector("[data-do-it]"), trade: !!rowOf("Appraise the trade")?.querySelector("[data-do-it]"), plain: !!rowOf("Order the plates")?.querySelector("[data-do-it]") };
});
console.log("do it:", JSON.stringify(doit));
if (!doit.budget || doit.trade || doit.plain) fail("Do it should be on the move the assistant can run and nowhere else: " + JSON.stringify(doit));
const before = (await fetch(APP + "/__relays").then((r) => r.json())).length;
const cardOf = () => [...document.querySelectorAll('[data-panel="todos"] .todo-card')].find((r) => r.textContent.includes("3 in stock under their budget"));
await p.evaluate(() => { document.querySelector("#toast-root").innerHTML = ""; [...document.querySelectorAll('[data-panel="todos"] .todo-card')].find((r) => r.textContent.includes("3 in stock under their budget")).querySelector("[data-do-it]").click(); });
const working = await p.evaluate(`(${cardOf})().querySelector(".todo-banner").textContent`);
if (!/Working/.test(working)) fail("the card should read Working… while the assistant runs: " + working);
let relays = [];
for (let i = 0; i < 40 && relays.length <= before; i++) { await p.waitForTimeout(200); relays = await fetch(APP + "/__relays").then((r) => r.json()); }
if (relays.length <= before) fail("Do it never asked the assistant");
await p.waitForFunction(`!!(${cardOf})().querySelector(".todo-banner-done")`, null, { timeout: 8000 }).catch(() => fail("the card never said Done"));
const said = await p.evaluate(`(async () => { const s = await import("/js/store.js"); const c = (${cardOf})(); return { toast: document.querySelector("#toast-root")?.textContent || "", banner: c.querySelector(".todo-banner").textContent.replace(/\\s+/g, " ").trim(), done: !!c.querySelector(".todo-banner-done [data-check-it]"), kept: !!(s.get("tasks", "c1").assist || {}).at }; })()`);
console.log("do it said:", JSON.stringify(said));
if (/Couldn't do it|Set up the voice agent/.test(said.toast)) fail("Do it should have run: " + said.toast);
if (/Happy to go through it/.test(said.toast)) fail("the reply shouldn't be shouted as a toast — it belongs on the work page");
if (!said.done || !/Done — check it out/.test(said.banner) || !said.kept) fail("once it's run the card should say Done — check it out, and remember so on the to-do: " + JSON.stringify(said));
const sent = relays.length ? JSON.stringify(relays[relays.length - 1].messages) : "";
if (!/Dana Muise/.test(sent) || !/deal_options/.test(sent) || !/3 in stock under their budget/.test(sent)) fail("Do it should hand the assistant the customer and the to-do: " + sent.slice(0, 300));
const stillThere = await p.evaluate(async () => { const s = await import("/js/store.js"); return !s.get("tasks", "c1").done; });
if (!stillThere) fail("Do it shouldn't tick the to-do off — that's the salesperson's call");

// --- Check it out: the work on its own page — what it said, and the next
// things it can do, each a tap that runs in the same conversation.
await p.evaluate(`(${cardOf})().querySelector("[data-check-it]").click()`);
await p.waitForSelector(".td-page .td-action", { timeout: 8000 }).catch(() => fail("check it out didn't open the work page"));
const work = await p.evaluate(() => ({ hash: location.hash, say: document.querySelector(".td-page .td-say")?.textContent || "", title: document.querySelector(".td-page .hero-title")?.textContent || "", actions: [...document.querySelectorAll(".td-page .td-action")].map((b) => b.textContent.replace(/\s+/g, " ").trim()), back: !document.getElementById("topbar-back").hidden }));
console.log("work page:", JSON.stringify(work));
if (work.hash !== "#/todo/c1" || !/Happy to go through it/.test(work.say) || !/3 in stock under their budget/.test(work.title) || !work.back) fail("the work page should show the to-do and what the assistant said: " + JSON.stringify(work));
if (!work.actions.some((a) => /^Text Dana the options/.test(a)) || !work.actions.some((a) => /Compare the two best/.test(a)) || !work.actions.some((a) => /Book Dana a time/.test(a))) fail("the work page should list the next things it can do: " + JSON.stringify(work.actions));
const before2 = (await fetch(APP + "/__relays").then((r) => r.json())).length;
await p.evaluate(() => [...document.querySelectorAll(".td-page .td-action")].find((b) => /Text Dana the options/.test(b.textContent)).click());
let relays2 = [];
for (let i = 0; i < 40 && relays2.length <= before2; i++) { await p.waitForTimeout(200); relays2 = await fetch(APP + "/__relays").then((r) => r.json()); }
if (relays2.length <= before2) fail("a next action never reached the assistant");
await p.waitForFunction(() => { const r = document.querySelector(".td-turn-live .td-reply"); return r && !r.classList.contains("td-working"); }, null, { timeout: 8000 }).catch(() => fail("the action's reply never landed on the page"));
const sent2 = JSON.stringify(relays2[relays2.length - 1].messages);
if (!/Draft a text to Dana Muise/.test(sent2) || !/Earlier, for my to-do/.test(sent2) || !/Happy to go through it/.test(sent2)) fail("a next action should carry the earlier work in: " + sent2.slice(0, 300));
const turn = await p.evaluate(async () => { const s = await import("/js/store.js"); return { reply: document.querySelector(".td-turn-live .td-reply")?.textContent || "", logged: ((s.get("tasks", "c1").assist || {}).log || []).length }; });
if (!/Happy to go through it/.test(turn.reply) || turn.logged !== 1) fail("the reply should show on the page and be kept on the to-do: " + JSON.stringify(turn));
await p.evaluate(() => { location.hash = "#/log"; }); await p.waitForTimeout(400);

// --- The assistant can land on a chip: "what's on my plate" opens the to-dos
// without changing the one you chose.
await p.click('.log-tabs [data-tab="logged"]');
await p.evaluate(() => { sessionStorage.setItem("viniva:log:open", "todos"); location.hash = "#/"; });
await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/log"; }); await p.waitForTimeout(400);
const asked = await p.evaluate(() => ({ active: document.querySelector(".log-tabs .btn-primary")?.dataset.tab, remembered: localStorage.getItem("viniva:log:tab") }));
if (asked.active !== "todos" || asked.remembered !== "logged") fail("a chip asked for should show without becoming the remembered one: " + JSON.stringify(asked));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlog.test.js FAILED" : "\nlog.test.js passed");
})();
