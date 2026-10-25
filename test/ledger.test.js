// The ledger: every commitment as one kind of thing, and nothing overdue
// quietly. A reminder missed is counted; after the third reminder (or a day
// without an answer) Home stops reminding and asks — tomorrow, next week,
// or drop it — and the answer moves the real record.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 3600000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400000);
  const inTwoHours = new Date(now.getTime() + 2 * 3600000);
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "d", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2021 Nissan Rogue SV", followUp: key(now), ...x },
      { id: "k", name: "Ken Jones", phone: "9025552222", stage: "new", vehicleInterest: "Civic", ...x },
    ],
    tasks: [
      // A reminder three hours past its minute, reminded three times already.
      { id: "r1", title: "Call the bank about Dana", due: key(threeHoursAgo), remindAt: `${key(threeHoursAgo)}T${hm(threeHoursAgo)}`, channel: "reminder", leadId: "d", done: false, ...x },
      // A to-do from two days ago nobody has touched.
      { id: "t2", title: "Order Ken's plates", due: key(twoDaysAgo), leadId: "k", done: false, ...x },
      // One due today — on the list, not overdue.
      { id: "t3", title: "Wash the demo", due: key(now), done: false, ...x },
    ],
    pokes: [{ id: "poke:task:r1", key: "task:r1", count: 3, lastAt: threeHoursAgo.toISOString(), firstAt: threeHoursAgo.toISOString(), ...x }],
    appointments: [{ id: "a1", leadId: "k", customerName: "Ken Jones", type: "appointment", when: `${key(inTwoHours)}T${hm(inTwoHours)}`, status: "scheduled", ...x }],
    watches: [{ id: "w1", leadId: "k", text: "a Kicks SR", want: { text: "a Kicks SR", models: ["kicks"], makes: [], trim: "sr", colour: "", condition: "", body: "", yearMin: null, yearMax: null, maxPrice: null, maxKm: null }, done: false, matchedAt: now.toISOString(), matchedVehicleId: "v9", matched: { id: "v9", label: "2026 Nissan Kicks SR", price: 29450, stock: "K26" }, ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(700);

// --- One list, every kind, soonest first.
const list = await p.evaluate(async () => {
  const L = await import("/js/ledger.js");
  const c = L.commitments();
  const hour = new Date().getHours();
  return { kinds: c.map((x) => x.kind).sort(), keys: c.map((x) => x.key), sorted: c.every((x, i) => !i || x.due >= c[i - 1].due), summary: L.ledgerSummary(), hour };
});
console.log("commitments:", JSON.stringify(list));
const want = ["confirm", "followup", "reminder", "task", "task", "watch"];
if (list.kinds.join() !== want.join()) fail("every kind should be on the one list: " + JSON.stringify(list.kinds));
if (!list.sorted) fail("the list isn't soonest first");
if (list.summary.overdue < 1 || list.summary.dueToday < 1) fail("the summary should count overdue and due today: " + JSON.stringify(list.summary));

// --- Overdue: the missed reminder has its count; the two-day-old to-do gets
// one on sight; neither nags forever — both are "still open" on Home.
const home = await p.evaluate(() => [...document.querySelectorAll(".nudge-slot .nudge-row")].map((r) => ({ text: r.querySelector(".row-title")?.textContent || "", choices: [...r.querySelectorAll(".nudge-choices .btn")].map((b) => b.textContent) })));
console.log("right now:", JSON.stringify(home));
const stale = home.filter((r) => /^Still open:/.test(r.text));
if (stale.length !== 2 || !stale.some((r) => /Call the bank/.test(r.text)) || !stale.some((r) => /Order Ken's plates/.test(r.text))) fail("the twice-reminded reminder and the two-day-old to-do should be asked about, nothing else: " + JSON.stringify(stale));
if (!stale.every((r) => r.choices.join() === "Tomorrow,Next week,Drop")) fail("each should offer Tomorrow / Next week / Drop: " + JSON.stringify(stale));
if (home.some((r) => /Wash the demo/.test(r.text) && /^Still open/.test(r.text))) fail("a to-do due today is not 'still open'");
const poked = await p.evaluate(async () => { const s = await import("/js/store.js"); return { t2: (s.get("pokes", "poke:task:t2") || {}).count, r1: (s.get("pokes", "poke:task:r1") || {}).count }; });
if (poked.t2 !== 1 || poked.r1 !== 3) fail("seen overdue should count as the first reminder, and an existing count kept: " + JSON.stringify(poked));

// --- Tomorrow: the reminder moves a day, same minute; the count starts over; the line goes.
await p.evaluate(() => { const row = [...document.querySelectorAll(".nudge-slot .nudge-row")].find((r) => /Call the bank/.test(r.textContent)); [...row.querySelectorAll(".nudge-choices .btn")].find((b) => b.textContent === "Tomorrow").click(); });
await p.waitForTimeout(300);
const moved = await p.evaluate(async () => {
  const s = await import("/js/store.js"); const t = s.get("tasks", "r1"); const p = s.get("pokes", "poke:task:r1");
  const d = new Date(); const tm = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); const pad = (n) => String(n).padStart(2, "0");
  return { due: t.due, remindAt: t.remindAt, done: t.done, tomorrow: `${tm.getFullYear()}-${pad(tm.getMonth() + 1)}-${pad(tm.getDate())}`, count: p && p.count, snoozed: !!(p && p.snoozedUntil), still: [...document.querySelectorAll(".nudge-slot .nudge-row")].some((r) => /Call the bank/.test(r.textContent)), toast: document.querySelector("#toast-root")?.textContent || "" };
});
console.log("tomorrow:", JSON.stringify(moved));
if (moved.due !== moved.tomorrow || !moved.remindAt.startsWith(moved.tomorrow + "T") || moved.done) fail("Tomorrow should move the reminder a day, keeping its minute: " + JSON.stringify(moved));
if (moved.count !== 0 || !moved.snoozed || moved.still || !/Moved to tomorrow/.test(moved.toast)) fail("moving it should start the count over and clear the line: " + JSON.stringify(moved));

// --- Drop: the to-do is done as dropped, the poke gone.
await p.evaluate(() => { const row = [...document.querySelectorAll(".nudge-slot .nudge-row")].find((r) => /Order Ken's plates/.test(r.textContent)); [...row.querySelectorAll(".nudge-choices .btn")].find((b) => b.textContent === "Drop").click(); });
await p.waitForTimeout(300);
const dropped = await p.evaluate(async () => { const s = await import("/js/store.js"); const t = s.get("tasks", "t2"); return { done: t.done, by: t.doneBy, poke: !!s.get("pokes", "poke:task:t2"), still: [...document.querySelectorAll(".nudge-slot .nudge-row")].some((r) => /Order Ken's plates/.test(r.textContent)) }; });
if (!dropped.done || dropped.by !== "dropped" || dropped.poke || dropped.still) fail("Drop should close the to-do and its count: " + JSON.stringify(dropped));

// --- A follow-up date: Next week moves the customer's date.
const fu = await p.evaluate(async () => { const L = await import("/js/ledger.js"); const s = await import("/js/store.js"); const r = L.resolve(L.commitments().find((c) => c.kind === "followup").key, "nextweek"); return { movedTo: r.movedTo, followUp: s.get("leads", "d").followUp }; });
if (!fu.movedTo || fu.followUp !== fu.movedTo) fail("Next week should move the follow-up date on the customer: " + JSON.stringify(fu));

// --- Said, not typed: "I'll call him Thursday at ten" is a reminder with the customer on it.
const said = await p.evaluate(async () => {
  const m = await import("/js/agent.js"); const s = await import("/js/store.js");
  const d = new Date(); d.setDate(d.getDate() + 1); const pad = (n) => String(n).padStart(2, "0"); const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const r = await m.execTool("add_task", { title: "Call Ken about the Civic", remindAt: `${day}T10:00`, customer: "Ken Jones" });
  const t = s.all("tasks").find((x) => x.title === "Call Ken about the Civic");
  return { result: r.result, task: t && { remindAt: t.remindAt, channel: t.channel, leadId: t.leadId, due: t.due } };
});
console.log("said:", JSON.stringify(said));
if (!said.task || said.task.channel !== "reminder" || !/T10:00$/.test(said.task.remindAt) || said.task.leadId !== "k" || !said.result.reminds) fail("a time said should make a reminder on the customer: " + JSON.stringify(said));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "ledger: FAILED" : "ledger: ok");
})().catch((e) => { console.error(e); process.exit(1); });
