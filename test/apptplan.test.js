// "Change deliveries in prep to appointments and have a list where all my
// appointments are listed and reminders for myself and customer
// confirmation texts are preset."
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const pad = (n) => String(n).padStart(2, "0");
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
// Three days out at 3pm, and a couple of hours from now.
const far = new Date(); far.setDate(far.getDate() + 3); far.setHours(15, 0, 0, 0);
const soon = new Date(Date.now() + 2 * 3600e3); soon.setSeconds(0, 0);
const farDay = local(far).slice(0, 10);
const dayBefore = new Date(far); dayBefore.setDate(dayBefore.getDate() - 1);
const hourBefore = new Date(far.getTime() - 3600e3);

await p.addInitScript(({ far }) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025550101", stage: "working", vehicleInterest: "2026 Rogue SV", ...x }, { id: "k", name: "Ken Ito", phone: "9025550202", stage: "working", ...x }],
    // Booked before presets existed: it should get them on the next look.
    appointments: [{ id: "old", leadId: "k", customerName: "Ken Ito", type: "testdrive", title: "Test drive", vehicle: "Kicks SR", when: far, status: "scheduled", ...x }],
    deliveries: [{ id: "d1", customerName: "Someone", status: "prep", checklist: [], ...x }],
    settings: { salesperson: "Parm Shokar", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, hoursFrom: 9, hoursTo: 18, hoursDays: [0, 1, 2, 3, 4, 5, 6] },
  }));
}, { far: local(far) });

// --- Home: the tile is Appointments, and it opens the list.
await p.goto(APP + "/#/");
await p.waitForSelector(".stat-grid", { timeout: 15000 });
const tiles = await p.evaluate(() => [...document.querySelectorAll(".stat")].map((s) => s.textContent.replace(/\s+/g, " ").trim()));
console.log("tiles:", JSON.stringify(tiles));
if (!tiles.some((t) => /^1\s*Appointments/.test(t)) || tiles.some((t) => /Deliveries in prep/.test(t))) fail("the second tile should be Appointments with the count ahead: " + JSON.stringify(tiles));
await p.click('.stat[data-goto="/appts"]');
await p.waitForFunction(() => location.hash === "#/appts" && document.querySelector(".appt-row"), null, { timeout: 5000 }).catch(() => fail("the tile should open the appointments list"));

// The old appointment got its presets on that look.
const old = await p.evaluate(async () => { const m = await import("/js/apptplan.js"); return m.planStatus("old").map((i) => `${i.role}:${i.state}`); });
console.log("old appointment presets:", JSON.stringify(old));
if (old.join("|") !== "confirm:ready to send|remind-text:scheduled|remind-morning:scheduled|remind-hour:scheduled") fail("an appointment booked before presets existed should get the full set: " + JSON.stringify(old));

// --- Book one: the presets, exactly.
await p.evaluate(async () => { const c = await import("/js/views/calendar.js"); c.openAppointmentForm(null, { leadId: "a", customerName: "Dana Muise", vehicle: "2026 Rogue SV" }); });
await p.waitForSelector('.modal input[name="customerName"]', { timeout: 5000 });
await p.fill('.modal input[name="when"]', local(far));
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(400);
const plan = await p.evaluate(async () => {
  const s = await import("/js/store.js"); const m = await import("/js/apptplan.js");
  const a = s.all("appointments").find((x) => x.customerName === "Dana Muise");
  return { id: a && a.id, tasks: m.planTasks(a.id).map((t) => ({ role: t.apptPlan, channel: t.channel, at: t.at || t.remindAt, due: t.due, ready: t.readyAt, title: t.title, body: t.body || "", leadId: t.leadId, done: t.done })), toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join("|") };
});
console.log("plan:", JSON.stringify(plan, null, 1));
const by = Object.fromEntries(plan.tasks.map((t) => [t.role, t]));
if (!by.confirm || by.confirm.channel !== "text" || by.confirm.leadId !== "a" || !/^Hi Dana, it's Parm at O'Regan's Nissan Halifax\. You're booked for an appointment .* at 3:00 PM — I'll have the 2026 Rogue SV ready\. Reply here if anything changes — see you then!$/.test(by.confirm.body)) fail("the confirmation text should be preset from the template, ready now: " + JSON.stringify(by.confirm));
if (!by.confirm.ready || new Date(by.confirm.ready).getTime() > Date.now() + 1000) fail("the confirmation text should be ready right away");
if (!by["remind-text"] || by["remind-text"].at !== `${local(dayBefore).slice(0, 10)}T10:00` || !/reminder about your appointment tomorrow at 3:00 PM\. Reply YES to confirm/.test(by["remind-text"].body)) fail("the reminder text should go at 10 the day before: " + JSON.stringify(by["remind-text"]));
if (!by["remind-morning"] || by["remind-morning"].channel !== "reminder" || by["remind-morning"].at !== `${farDay}T08:30` || !/Dana Muise — appointment .* 3:00 PM · 2026 Rogue SV/.test(by["remind-morning"].title)) fail("your morning-of reminder should be at 8:30 that day: " + JSON.stringify(by["remind-morning"]));
if (!by["remind-hour"] || by["remind-hour"].at !== local(hourBefore) || !/Dana Muise in an hour \(3:00 PM\) — have the 2026 Rogue SV out front/.test(by["remind-hour"].title)) fail("your hour-before reminder should be an hour before: " + JSON.stringify(by["remind-hour"]));
if (!/confirmation text is ready on Log, reminders set/.test(plan.toast)) fail("the toast should say what was preset: " + plan.toast);

// It's on Log's queue as a one-tap send with the preset words, and in Reminders.
const queue = await p.evaluate(async () => {
  const pl = await import("/js/plays.js"); const r = await import("/js/reminders.js");
  const plays = pl.getPlays(20).filter((x) => /Dana/.test(x.title));
  return { plays: plays.map((x) => ({ title: x.title, href: x.href, drafted: !!x.taskId })), reminders: r.reminders().filter((t) => /Dana/.test(t.title)).length };
});
console.log("queue:", JSON.stringify(queue));
const cp = queue.plays.find((x) => /confirm the appointment/.test(x.title));
if (!cp || !/^sms:9025550101\?&body=Hi%20Dana/.test(cp.href) || cp.drafted) fail("the confirmation text should be on the queue as a one-tap send of the preset words, not a fresh draft: " + JSON.stringify(queue.plays));
if (queue.reminders !== 2) fail("both of your reminders should be in Reminders: " + queue.reminders);

// --- The list shows where each one stands; the page has them with Send.
await p.evaluate(() => { location.hash = "#/appts"; });
await p.waitForFunction(() => document.querySelectorAll(".appt-row").length === 2, null, { timeout: 5000 }).catch(() => fail("the list should show both appointments"));
const list = await p.evaluate(() => ({
  days: [...document.querySelectorAll(".appt-day")].map((d) => d.textContent),
  rows: [...document.querySelectorAll(".appt-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  folds: [...document.querySelectorAll(".fold .fold-title")].map((f) => f.textContent.trim().replace(/\s*·\s*\d+$/, "")),
}));
console.log("list:", JSON.stringify(list, null, 1));
if (list.folds.join("|") !== "Coming up|Past" || list.days.length !== 1) fail("the list should be Coming up (by day) then Past: " + JSON.stringify(list));
if (!list.rows.some((r) => /3:00 PM Dana Muise Not confirmed .*Appointment · 2026 Rogue SV Text ready to send · Reminds you .*8:30 AM & .*2:00 PM/.test(r))) fail("each row should show the time, the customer, confirmation, and where the presets stand: " + JSON.stringify(list.rows));
await p.evaluate(() => [...document.querySelectorAll(".appt-row")].find((r) => /Dana/.test(r.textContent)).click());
await p.waitForSelector(".plan-card", { timeout: 5000 });
const page = await p.evaluate(() => ({
  rows: [...document.querySelectorAll(".plan-row")].map((r) => ({ label: r.querySelector(".plan-label").textContent, sub: r.querySelector(".plan-sub").textContent, send: !!r.querySelector(".plan-send"), body: r.querySelector(".plan-body")?.textContent || "" })),
}));
console.log("page:", JSON.stringify(page, null, 1));
if (page.rows.length !== 4 || page.rows[0].label !== "Confirmation text" || page.rows[0].sub !== "Ready to send" || !page.rows[0].send || !/^Hi (Dana|Ken), it's Parm/.test(page.rows[0].body)) fail("the page should list the presets with Send on the texts: " + JSON.stringify(page.rows));
if (!/Goes on Log .*10:00 AM/.test(page.rows[1].sub) || page.rows[2].send || !/8:30 AM/.test(page.rows[2].sub)) fail("the scheduled ones should say when: " + JSON.stringify(page.rows));

// Sent marks it sent (the tap opens the phone's Messages, which headless
// Chromium can't, so it's marked here); an outcome clears the lot.
let st = await p.evaluate(async () => { const m = await import("/js/apptplan.js"); const id = document.location.hash.split("/").pop(); m.markPlanTaskDone(document.querySelector(".plan-row .plan-send").dataset.task); return m.planStatus(id).map((i) => `${i.role}:${i.state}`); });
if (st[0] !== "confirm:sent") fail("Send should mark the confirmation text sent: " + JSON.stringify(st));
await p.click('[data-o="showed"]');
await p.waitForTimeout(400);
st = await p.evaluate(async () => (await import("/js/apptplan.js")).planStatus(document.location.hash.split("/").pop()).map((i) => `${i.role}:${i.state}`));
if (!st.every((s) => /:(sent|done)$/.test(s))) fail("an outcome should clear every preset: " + JSON.stringify(st));

// --- Confirming clears the text without an outcome; moving it resets; deleting removes.
const moved = await p.evaluate(async ({ far }) => {
  const s = await import("/js/store.js"); const m = await import("/js/apptplan.js");
  const before = m.planTasks("old").filter((t) => !t.done).length;
  store_update: {
    s.update("appointments", "old", { confirmed: true }); m.onAppointmentConfirmed("old");
  }
  const afterConfirm = m.planStatus("old").map((i) => `${i.role}:${i.state}`);
  const d = new Date(far); d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  s.update("appointments", "old", { when }); m.replanAppointment("old");
  const afterMove = m.planTasks("old").map((t) => `${t.apptPlan}:${t.done ? "done" : (t.at || t.remindAt).slice(0, 10)}`);
  m.unplanAppointment("old"); s.remove("appointments", "old");
  return { before, afterConfirm, afterMove, left: s.all("tasks").filter((t) => t.apptId === "old" && !t.done).length, when };
}, { far: local(far) });
console.log("moved:", JSON.stringify(moved));
if (moved.before !== 4 || moved.afterConfirm[0] !== "confirm:sent" || moved.afterConfirm.slice(1).some((x) => /sent|done/.test(x))) fail("confirming should clear only the confirmation text: " + JSON.stringify(moved));
if (!moved.afterMove.every((x) => /done$/.test(x) || x.endsWith(moved.when.slice(0, 10)) || /remind-text|remind-hour/.test(x))) fail("moving should re-preset for the new time: " + JSON.stringify(moved));
if (moved.left !== 0) fail("deleting should take the open presets with it");

// --- Soon (two hours out): just the confirmation text and the hour-before reminder.
const soonPlan = await p.evaluate(async ({ when }) => {
  const s = await import("/js/store.js"); const c = await import("/js/connections.js"); const m = await import("/js/apptplan.js");
  const a = s.create("appointments", { leadId: "k", customerName: "Ken Ito", type: "appointment", title: "Appointment", when, status: "scheduled" });
  c.afterAppointmentBooked("k", when, a.id);
  return m.planStatus(a.id).map((i) => i.role);
}, { when: local(soon) });
// (Late in the evening two hours out is tomorrow morning, which earns the morning-of reminder.)
const expectSoon = soon.getDate() !== new Date().getDate() ? "confirm|remind-morning|remind-hour" : "confirm|remind-hour";
if (soonPlan.join("|") !== expectSoon) fail("two hours out there's no day-before text (and no morning reminder unless it's already tomorrow): " + JSON.stringify(soonPlan) + " expected " + expectSoon);

// --- The assistant books with the presets and says so.
const tool = await p.evaluate(async ({ when }) => { const a = await import("/js/agent.js"); const r = await a.execTool("book_appointment", { customer: "Dana Muise", when, type: "testdrive" }); return r.result; }, { when: local(new Date(far.getTime() + 86400e3)) });
if (!/Preset: a confirmation text to Dana Muise is ready on Log/.test(tool)) fail("the assistant should book with the presets and say so: " + tool);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\napptplan.test.js FAILED" : "\napptplan.test.js passed");
})();
