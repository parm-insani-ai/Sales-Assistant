// The drive comes first, the day knows its windows, and the scoreboard
// reads the funnel against the industry's benchmarks. People booked into
// service today or tomorrow sit above the batch as a walk-over; the batch
// block and the session say which call window it is; Coach shows reached /
// set / showed / sold against average, strong and top — the benchmark
// standing in until the rep has enough of their own — and the weeks.
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
  const pad = (n) => String(n).padStart(2, "0");
  const k = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date(), tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
  const leads = [];
  for (let i = 0; i < 40; i++) leads.push({ id: "o" + i, name: `Owner ${pad(i)} Example`, phone: "90255" + String(10000 + i), vehicleInterest: "2019 Nissan Rogue SV", currentPayment: 400 + i, payoff: 12000, currentValue: 20000, currentTerm: 84, purchaseDate: "2021-03-10", ...x });
  leads[1].serviceAppt = k(today); leads[2].serviceAppt = k(today); leads[3].serviceAppt = k(tomorrow); leads[4].serviceAppt = k(nextWeek);
  // Eight weeks of calls: 40 people attempted, 26 reached (65%), 6 set within two weeks of a reach (23%); of 6 past appointments 4 showed, 2 sold.
  const calls = [], appointments = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(); d.setDate(d.getDate() - 1 - (i % 20)); d.setHours(10, 0, 0, 0);
    calls.push({ id: "c" + i, leadId: "o" + i, dir: "out", via: "call", at: d.toISOString(), outcome: i < 26 ? "reached" : "no_answer", ...x });
    if (i < 6) { const a = new Date(d.getTime() + 3600000); const w = new Date(d.getTime() - 0); appointments.push({ ...x, id: "a" + i, leadId: "o" + i, customerName: `Owner ${pad(i)} Example`, when: new Date(d.getTime() + 86400000 * 0.5).toISOString().slice(0, 16), createdAt: a.toISOString(), status: "scheduled", type: "appointment", outcome: i < 4 ? (i < 2 ? "sold" : "showed") : "no_show" }); void w; }
  }
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, calls, appointments, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 10, goalDaily: 2, hoursFrom: 8, hoursTo: 20, hoursDays: [0, 1, 2, 3, 4, 5, 6], taxRate: 14 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".today-block", { timeout: 30000 }).catch(() => fail("the batch should draw"));
await p.waitForTimeout(600);

// --- The drive block: the three in today and tomorrow, above the batch, and not in it.
const drive = await p.evaluate(() => ({
  head: document.querySelector(".drive-block .strong")?.textContent.replace(/\s+/g, " ").trim(),
  ids: [...document.querySelectorAll(".drive-list .swipe-card")].map((c) => c.dataset.leadId),
  before: document.querySelector(".drive-block")?.compareDocumentPosition(document.querySelector(".today-block")) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
  inBatch: [...document.querySelectorAll(".today-list .swipe-card, .lead-list .swipe-card")].map((c) => c.dataset.leadId).filter((id) => ["o1", "o2", "o3"].includes(id) && !document.querySelector(`.drive-list .swipe-card[data-lead-id="${id}"]`)),
  window: document.querySelector(".today-window")?.textContent.trim(),
}));
console.log("drive:", JSON.stringify(drive));
if (!/^In the drive today and tomorrow · 3$/.test(drive.head || "")) fail("the drive block should name the three: " + drive.head);
if (drive.ids.join() !== "o1,o2,o3" || !drive.before) fail("today's first, then tomorrow's, above the batch: " + JSON.stringify(drive.ids));
if (drive.inBatch.length) fail("someone in the drive shouldn't also be in the batch or the list: " + JSON.stringify(drive.inBatch));
if (!/window|Today's windows/.test(drive.window || "")) fail("the block should say which call window it is: " + drive.window);

// --- The windows, by the clock.
const win = await p.evaluate(async () => { const f = await import("/js/funnel.js"); const at = (h) => { const d = new Date(); d.setHours(h, 30, 0, 0); return f.callWindow(d); }; return { nine: at(9), one: at(13), five: at(17), nine_pm: at(21) }; });
console.log("windows:", JSON.stringify({ nine: win.nine.line, one: win.one.line, five: win.five.line, late: win.nine_pm.line }));
if (!win.nine.inWindow || !/morning window \(8–11\)/.test(win.nine.line)) fail("9:30 is the morning window: " + win.nine.line);
if (win.one.inWindow || !/Next window 4–6/.test(win.one.line)) fail("1:30 is between windows, the next at four: " + win.one.line);
if (!win.five.inWindow || !/late-afternoon window \(4–6\)/.test(win.five.line)) fail("5:30 is the afternoon window: " + win.five.line);
if (win.nine_pm.inWindow || !/tomorrow 8–11 and 4–6/.test(win.nine_pm.line)) fail("9:30 pm: tomorrow's windows: " + win.nine_pm.line);

// --- The funnel: enough of the rep's own on the first two stages; the
// benchmark stands in on show and sold.
const f = await p.evaluate(async () => { const m = await import("/js/funnel.js"); const f = m.funnel(); const pick = (s) => ({ n: s.n, of: s.of, rate: Math.round(s.rate * 1000) / 1000, own: s.own, tier: s.tier }); return { reach: pick(f.reach), set: pick(f.set), show: pick(f.show), sold: pick(f.sold) }; });
console.log("funnel:", JSON.stringify(f));
if (!f.reach.own || f.reach.n !== 26 || f.reach.of !== 40 || f.reach.tier !== "strong") fail("reached 26 of 40 is the rep's own, strong: " + JSON.stringify(f.reach));
if (!f.set.own || f.set.n !== 6 || f.set.of !== 26 || f.set.tier !== "strong") fail("set 6 of 26 is strong: " + JSON.stringify(f.set));
if (f.show.own || f.show.n !== 4 || f.show.of !== 6 || f.show.rate !== 0.55) fail("six appointments isn't enough to say a show rate — the average stands in: " + JSON.stringify(f.show));

// --- Coach shows it.
await p.evaluate(() => { location.hash = "#/coach"; });
await p.waitForSelector(".sb-card", { timeout: 15000 }).catch(() => fail("Coach should show the scoreboard"));
const sb = await p.evaluate(() => ({
  rows: [...document.querySelectorAll(".sb-row")].map((r) => ({ label: r.querySelector(".sb-label").textContent.replace(/\s+/g, " ").trim(), rate: r.querySelector(".sb-rate").textContent.trim(), you: !!r.querySelector(".sb-you"), sub: r.querySelector(".sb-sub").textContent.trim() })),
  weeks: document.querySelectorAll(".sb-weeks tbody tr").length,
  perHundred: [...document.querySelectorAll(".sb-weeks tbody tr")].map((tr) => tr.lastElementChild.textContent.trim()),
}));
console.log("scoreboard:", JSON.stringify(sb));
if (sb.rows.length !== 4 || sb.rows[0].rate !== "65%" || !sb.rows[0].you || !/strong/.test(sb.rows[0].sub)) fail("the reached row: " + JSON.stringify(sb.rows[0]));
if (sb.rows[1].rate !== "23%" || !sb.rows[1].you) fail("the set row: " + JSON.stringify(sb.rows[1]));
if (!/avg$/.test(sb.rows[2].rate) || sb.rows[2].you || !/stands in/.test(sb.rows[2].sub)) fail("the show row should say the average stands in: " + JSON.stringify(sb.rows[2]));
if (sb.weeks !== 6 || !sb.perHundred.some((x) => Number(x) > 0)) fail("six weeks with appointments per hundred dials: " + JSON.stringify(sb));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndrive.test.js FAILED" : "\ndrive.test.js passed");
})();
