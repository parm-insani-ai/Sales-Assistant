// The day is sized from the goal and the ask is two real times. The session
// opens with the goal, what's booked and the dials that still needs at this
// rep's rates (the industry's averages until there's enough of their own);
// the script offers two open times from the calendar inside two days, clear
// of what's booked; one tap books it — the appointment on the calendar, the
// contact logged, the confirmation text and the reminders set — and the day
// counts it. With the goal met the day says so, and the batch stops feeding.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import" };
  const leads = [];
  for (let i = 0; i < 12; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: "2019 Nissan Rogue SV", currentPayment: 400 + i, payoff: 12000, currentValue: 20000, currentTerm: 84, purchaseDate: "2021-03-10", ...x });
  // One appointment already on the calendar tomorrow at 10:30: that time is taken.
  const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 30, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  const when = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T10:30`;
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x }],
    appointments: [{ id: "busy", customerName: "Someone Else", when, status: "scheduled", type: "appointment", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }],
    settings: { salesperson: "Parm Shokar", dealership: "O'Regan's Nissan", cloudAutoSync: false, dailyProspects: 4, goalDaily: 2, hoursFrom: 9, hoursTo: 18, hoursDays: [0, 1, 2, 3, 4, 5, 6], taxRate: 14 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector('[data-act="start-session"]', { timeout: 30000 }).catch(() => fail("the batch should offer the session"));
await p.waitForTimeout(500);

// --- The arithmetic, with nothing of the rep's own: two to book → 14
// conversations at 15% → 28 dials at 50%.
const plan = await p.evaluate(async () => { const f = await import("/js/funnel.js"); const d = f.dayPlan(); return { goal: d.goal, booked: d.booked, conversations: d.conversations, dials: d.dials, own: d.own, line: f.dayLine(d), onBlock: document.querySelector(".today-day")?.textContent.trim() }; });
console.log("plan:", JSON.stringify(plan));
if (plan.goal !== 2 || plan.booked !== 0 || plan.conversations !== 14 || plan.dials !== 28 || plan.own) fail("the day should be sized from the goal at the benchmark rates: " + JSON.stringify(plan));
if (plan.line !== "2 to book today · 0 booked · about 28 dials at average rates" || plan.onBlock !== plan.line) fail("the line, on the batch block too: " + JSON.stringify({ line: plan.line, onBlock: plan.onBlock }));

// --- The ask: two open times within two days, clear of the 10:30 booked.
await p.click('[data-act="start-session"]');
await p.waitForSelector(".cs-card", { timeout: 10000 });
await p.waitForTimeout(300);
const ask = await p.evaluate(() => ({ head: document.querySelector(".cs-head .cs-day")?.textContent.replace(/\s+/g, " ").trim(), ask: document.querySelector(".cs-ask")?.textContent.trim(), slots: [...document.querySelectorAll("[data-slot]")].map((b) => ({ at: b.dataset.slot, label: b.textContent.trim() })), other: !!document.querySelector(".cs-slot-other") }));
console.log("ask:", JSON.stringify(ask));
if (!/^0 of 2 booked · about 28 more dials at average rates$/.test(ask.head || "")) fail("the session head should carry the day: " + ask.head);
if (ask.slots.length !== 2 || !ask.other) fail("two times to offer, and another: " + JSON.stringify(ask.slots));
if (!/^I've got (today|tomorrow|[A-Z][a-z]+day) at [\d:]+ ?[ap]?m? or (today|tomorrow|[A-Z][a-z]+day) at [\d:]+ ?[ap]?m? — which is better for you\?$/.test(ask.ask || "")) fail("the ask should name the two times: " + ask.ask);
if (ask.slots.some((x) => /T10:30$/.test(x.at) && /tomorrow/.test(x.label))) fail("tomorrow 10:30 is taken and shouldn't be offered: " + JSON.stringify(ask.slots));
const within = await p.evaluate((slots) => slots.every((x) => { const t = new Date(x.at).getTime(); return t > Date.now() + 60 * 60000 && t < Date.now() + 3 * 86400000; }), ask.slots);
if (!within) fail("the times should be soon, not in the past and not far out: " + JSON.stringify(ask.slots));
if (ask.slots[0].at >= ask.slots[1].at) fail("soonest first: " + JSON.stringify(ask.slots));

// --- One tap books it.
const first = await p.evaluate(() => ({ name: document.querySelector(".cs-name")?.textContent.trim() }));
const firstId = await p.evaluate(async (name) => (await import("/js/store.js")).all("leads").find((l) => l.name === name)?.id, first.name);
const slotAt = ask.slots[0].at;
await p.click(`[data-slot="${slotAt}"]`); await p.waitForTimeout(700);
const booked = await p.evaluate(async (id) => {
  const st = await import("/js/store.js");
  const a = st.all("appointments").find((x) => x.leadId === id);
  const tasks = st.all("tasks").filter((t) => t.apptId === (a && a.id)).map((t) => t.apptPlan);
  const l = st.get("leads", id);
  return { when: a && a.when, status: a && a.status, type: a && a.type, tasks, logged: !!l.loggedAt, out: l.lastContactOutcome, stage: l.stage, toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ") };
}, firstId);
console.log("booked:", JSON.stringify(booked));
if (booked.when !== slotAt || booked.status !== "scheduled" || !booked.tasks.includes("confirm") || !(booked.tasks.includes("remind-morning") || booked.tasks.includes("remind-hour"))) fail("one tap should book the time with the confirmation text and reminders set: " + JSON.stringify(booked));
if (!booked.logged || booked.out !== "reached") fail("booking should log the conversation: " + JSON.stringify(booked));
if (!/Booked (today|tomorrow|[A-Z][a-z]+day) at .* — confirmation text and reminders set/.test(booked.toast)) fail("the toast should say it's booked and set: " + booked.toast);
const head2 = await p.evaluate(() => document.querySelector(".cs-head .cs-day")?.textContent.replace(/\s+/g, " ").trim());
console.log("after one:", head2);
if (!/^1 of 2 booked · about 1[0-4] more dials/.test(head2 || "")) fail("the day should count the booking and shrink what's left: " + head2);

// --- The second booking meets the goal: the head says done, and with the
// batch answered the session stops feeding and sums up.
const slot2 = ask.slots[1].at;
await p.click(`[data-slot="${slot2}"]`).catch(async () => { await p.click("[data-slot]"); }); await p.waitForTimeout(700);
const head3 = await p.evaluate(() => document.querySelector(".cs-head .cs-day")?.textContent.replace(/\s+/g, " ").trim());
console.log("after two:", head3);
if (!/^2 of 2 booked — done for the day$/.test(head3 || "")) fail("the goal met should say so: " + head3);
await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(500);
await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(700);
const end = await p.evaluate(async () => { const s = await import("/js/session.js"); const cur = s.currentSession(); return { summary: !!document.querySelector(".cs-summary"), ids: cur ? cur.ids.length : null, line: document.querySelector(".cs-summary .cs-day")?.textContent.trim() }; });
console.log("end:", JSON.stringify(end));
if (!end.summary || end.ids !== 4 || !/done for the day/.test(end.line || "")) fail("with the day booked the batch shouldn't feed more; the summary says done: " + JSON.stringify(end));

// --- Not booked yet: the batch feeds the next handful instead of stopping.
// (The day reset: the bookings gone, everyone untouched, a fresh batch drawn.)
await p.evaluate(async () => {
  const st = await import("/js/store.js");
  st.bulk(() => {
    st.all("appointments").forEach((a) => { if (a.leadId) st.remove("appointments", a.id); });
    st.all("calls").forEach((c) => st.remove("calls", c.id));
    st.all("leads").forEach((l) => st.update("leads", l.id, { lastContacted: null, lastContactVia: null, lastContactOutcome: null, loggedAt: null, followUp: null, lastProspectedAt: null }));
  });
  localStorage.removeItem("viniva:prospects");
  const s = await import("/js/session.js"); s.endSession(); s.startSession();
});
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/session"; }); await p.waitForTimeout(700);
const n0 = await p.evaluate(async () => (await import("/js/session.js")).currentSession()?.ids.length);
for (let i = 0; i < n0; i++) { await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(500); }
const fed = await p.evaluate(async () => { const s = await import("/js/session.js"); const cur = s.currentSession(); return { ids: cur ? cur.ids.length : null, card: !!document.querySelector(".cs-card"), summary: !!document.querySelector(".cs-summary") }; });
console.log("fed:", JSON.stringify({ n0, ...fed }));
if (!(fed.ids > n0) || !fed.card || fed.summary) fail("with the goal unmet the batch should feed the next handful: " + JSON.stringify({ n0, ...fed }));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nask.test.js FAILED" : "\nask.test.js passed");
})();
