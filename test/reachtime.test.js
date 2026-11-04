// Best time to reach. Every call attempt carries its clock time and what came
// of it, so the app learns when a customer picks up and when the book does:
// the card says "tends to pick up mornings" once there's enough to say it
// (and not before), the calling session puts the people likely to answer in
// this part of the day first, and a retry after no answer lands in the part
// of the day that has worked for them — or, knowing nothing, the other half.
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
  for (let i = 0; i < 8; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: "2019 Nissan Rogue SV", currentPayment: 400 + i, payoff: 12000, currentValue: 20000, purchaseDate: "2021-03-10", ...x });
  // Attempts on file. Past days, so nobody is "contacted lately" today's
  // batch would skip — the stamps are what matter here.
  const at = (daysAgo, hh) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hh, 10, 0, 0); return d.toISOString(); };
  const calls = [];
  // Owner 00: answers mornings — three morning pickups, two afternoon misses.
  [[30, 9], [27, 10], [24, 11]].forEach(([dd, hh], i) => calls.push({ id: "c0" + i, leadId: "o0", dir: "out", via: "call", at: at(dd, hh), outcome: "reached", ...x }));
  [[29, 16], [26, 16]].forEach(([dd, hh], i) => calls.push({ id: "c0a" + i, leadId: "o0", dir: "out", via: "call", at: at(dd, hh), outcome: "no_answer", ...x }));
  // Owner 01: answers afternoons — mirror image.
  [[30, 16], [27, 15], [24, 17]].forEach(([dd, hh], i) => calls.push({ id: "c1" + i, leadId: "o1", dir: "out", via: "call", at: at(dd, hh), outcome: "reached", ...x }));
  [[29, 9], [26, 10]].forEach(([dd, hh], i) => calls.push({ id: "c1a" + i, leadId: "o1", dir: "out", via: "call", at: at(dd, hh), outcome: "no_answer", ...x }));
  // Owner 02: one lucky pickup at 4pm — not enough to say anything.
  calls.push({ id: "c20", leadId: "o2", dir: "out", via: "call", at: at(20, 16), outcome: "reached", ...x });
  // Owner 03: three tries, never answered — nothing to say either.
  [[30, 9], [27, 13], [24, 16]].forEach(([dd, hh], i) => calls.push({ id: "c3" + i, leadId: "o3", dir: "out", via: "call", at: at(dd, hh), outcome: "no_answer", ...x }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, calls, vehicles: [], settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 8, taxRate: 14 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".today-block", { timeout: 30000 }).catch(() => fail("Best now didn't open on today's batch"));
await p.waitForTimeout(500);

// --- The read of each customer.
const read = await p.evaluate(async () => {
  const r = await import("/js/reachtime.js");
  const pick = (id) => { const b = r.bestTime(id); return b ? { part: b.part, tried: b.tried } : null; };
  return { o0: pick("o0"), o1: pick("o1"), o2: pick("o2"), o3: pick("o3"), line0: r.reachLine("o0"), line2: r.reachLine("o2"), book: r.bookTimes().total };
});
console.log("read:", JSON.stringify(read));
if (!read.o0 || read.o0.part !== "morning" || read.o0.tried !== 3) fail("Owner 00 should read as a morning pickup: " + JSON.stringify(read.o0));
if (!read.o1 || read.o1.part !== "afternoon") fail("Owner 01 should read as an afternoon pickup: " + JSON.stringify(read.o1));
if (read.o2 || read.o3) fail("one lucky pickup, or three misses, is nothing to say: " + JSON.stringify({ o2: read.o2, o3: read.o3 }));
if (read.line0 !== "Tends to pick up mornings" || read.line2 !== "") fail("the card line: " + JSON.stringify({ line0: read.line0, line2: read.line2 }));
if (read.book !== 14) fail("the book should count every attempt: " + read.book);

// --- The card says it.
const cardLine = await p.evaluate(() => document.querySelector('.swipe-card[data-lead-id="o0"] .row-contact')?.textContent.replace(/\s+/g, " ").trim() || null);
console.log("card:", cardLine);
if (!/tends to pick up mornings/i.test(cardLine || "")) fail("Owner 00's card should say when they pick up: " + cardLine);

// --- The session's order: in the morning the morning person is first, the
// afternoon person last of those known; in the afternoon the reverse.
const order = await p.evaluate(async () => {
  const r = await import("/js/reachtime.js");
  const items = ["o0", "o1", "o2", "o3", "o4"].map((id) => ({ lead: { id } }));
  const m = new Date(); m.setHours(10, 0, 0, 0);
  const a = new Date(); a.setHours(16, 0, 0, 0);
  return { morning: r.orderForNow(items, { now: m }).map((x) => x.lead.id), afternoon: r.orderForNow(items, { now: a }).map((x) => x.lead.id) };
});
console.log("order:", JSON.stringify(order));
if (order.morning[0] !== "o0" || order.morning.indexOf("o1") < order.morning.indexOf("o4")) fail("in the morning the morning person leads and the afternoon person waits: " + JSON.stringify(order.morning));
if (order.afternoon[0] !== "o1" || order.afternoon.indexOf("o0") < order.afternoon.indexOf("o4")) fail("in the afternoon the reverse: " + JSON.stringify(order.afternoon));

// --- The retry after no answer: Owner 00 tried at 4pm goes to the morning
// (known); Owner 04, unknown, goes to the other half of the day.
const retry = await p.evaluate(async () => {
  const r = await import("/js/reachtime.js");
  const a = new Date(); a.setHours(16, 0, 0, 0);
  const m = new Date(); m.setHours(10, 0, 0, 0);
  return { known: r.retrySlot("o0", a), unknownPm: r.retrySlot("o4", a), unknownAm: r.retrySlot("o4", m) };
});
console.log("retry:", JSON.stringify(retry));
if (retry.known.key !== "morning" || !retry.known.known) fail("a known morning person tried in the afternoon is retried in the morning: " + JSON.stringify(retry.known));
if (retry.unknownPm.key !== "morning" || retry.unknownPm.known || retry.unknownAm.key !== "afternoon") fail("unknown: the other half of the day: " + JSON.stringify({ pm: retry.unknownPm, am: retry.unknownAm }));

// --- A session's No answer puts the retry where they tend to pick up.
await p.evaluate(async () => { const s = await import("/js/session.js"); s.startSession(["o0"]); });
await p.evaluate(() => { location.hash = "#/session"; }); await p.waitForTimeout(600);
const when = await p.evaluate(() => document.querySelector(".cs-when")?.textContent.replace(/\s+/g, " ").trim() || null);
if (!/Tends to pick up mornings/.test(when || "")) fail("the session card should say when they pick up: " + when);
const hourNow = new Date().getHours();
await p.click('[data-outcome="no_answer"]'); await p.waitForTimeout(500);
const task = await p.evaluate(async () => { const st = await import("/js/store.js"); return st.all("tasks").filter((t) => t.leadId === "o0" && !t.done).map((t) => ({ title: t.title, at: t.at })); });
console.log("retry task:", JSON.stringify(task), "now", hourNow + "h");
const inMorning = hourNow >= 8 && hourNow < 12;
if (task.length !== 1) fail("one retry: " + JSON.stringify(task));
else if (!inMorning && !/they tend to pick up mornings/.test(task[0].title)) fail("tried outside their time, the retry should name it: " + JSON.stringify(task[0]));
else if (inMorning && !/try the/.test(task[0].title)) fail("tried in their own time with no answer, the retry is the other half: " + JSON.stringify(task[0]));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nreachtime.test.js FAILED" : "\nreachtime.test.js passed");
})();
