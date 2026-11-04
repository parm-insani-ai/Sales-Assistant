// What the store learns from its calls. Every session outcome is on the
// event log with the reason the call was made and which phrasing of the
// opener it led with; read back against the calendar, Coach says which
// reasons and phrasings book, and the batch's order is nudged toward the
// reasons that book here — inside a band, never a takeover, and only once
// there's enough behind it.
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
  for (let i = 0; i < 32; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: "2019 Nissan Rogue SV", currentPayment: 400, payoff: 12000, currentValue: 20000, purchaseDate: "2021-03-10", ...x });
  // Three weeks of session calls: sixteen led with equity (eight booked),
  // sixteen with payment (one booked). Phrasing A of equity booked seven
  // of eight; B one of eight.
  const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
  const events = [], appointments = [];
  for (let i = 0; i < 32; i++) {
    const eq = i < 16;
    const opener = i % 2 ? "b" : "a";
    const booked = eq ? (opener === "a" ? i < 14 : i === 1) : i === 16;
    events.push({ id: "e" + i, kind: "session_outcome", leadId: "o" + i, name: `Owner ${i}`, by: "rep", at: at(20 - (i % 10)), meta: { outcome: booked ? "appointment" : "no_answer", reason: eq ? "equity" : "payment", opener }, ...x });
    if (booked) appointments.push({ ...x, id: "a" + i, leadId: "o" + i, customerName: `Owner ${i}`, when: at(-3), createdAt: at(20 - (i % 10) - 0.5), status: "scheduled", type: "appointment" });
  }
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, events, appointments, vehicles: [], settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 10 } }));
});
await p.goto(APP + "/#/coach");
await p.waitForSelector(".worked-card", { timeout: 20000 }).catch(() => fail("Coach should show what's working"));
await p.waitForTimeout(400);

// --- The readout.
const r = await p.evaluate(async () => {
  const o = await import("/js/outcomes.js");
  const c = o.callReport({ weeks: 4 });
  return { total: c.total, byReason: c.byReason.map((x) => ({ key: x.key, dials: x.dials, booked: x.booked })), byOpener: c.byOpener.map((x) => `${x.key}/${x.opener}:${x.booked}/${x.dials}`), insights: c.insights, weights: o.reasonWeights() };
});
console.log("calls:", JSON.stringify(r.byReason), JSON.stringify(r.byOpener));
console.log("insights:", JSON.stringify(r.insights));
console.log("weights:", JSON.stringify(r.weights));
if (r.total.dials !== 32 || r.total.booked !== 9) fail("32 calls, 9 booked: " + JSON.stringify(r.total));
const eq = r.byReason.find((x) => x.key === "equity"), pay = r.byReason.find((x) => x.key === "payment");
if (!eq || eq.dials !== 16 || eq.booked !== 8 || !pay || pay.booked !== 1) fail("the reasons should be read back: " + JSON.stringify(r.byReason));
if (!r.byOpener.includes("equity/a:7/8") || !r.byOpener.includes("equity/b:1/8")) fail("the phrasings should be read back: " + JSON.stringify(r.byOpener));
if (!r.insights.some((t) => /"Equity to trade" books best on the phone: 8 of 16/.test(t))) fail("Coach should name the reason that books: " + JSON.stringify(r.insights));
if (!r.insights.some((t) => /On "Equity to trade", phrasing A books at 88% against 13%/.test(t))) fail("Coach should name the phrasing that books: " + JSON.stringify(r.insights));
if (!(r.weights.equity > 1) || !(r.weights.payment < 1) || r.weights.equity > 1.25 || r.weights.payment < 0.85) fail("equity should weigh up and payment down, inside the band: " + JSON.stringify(r.weights));

// --- The weights nudge the order: a payment customer just ahead on score
// falls behind an equity one; a big gap stays a gap.
const order = await p.evaluate(async () => {
  const o = await import("/js/outcomes.js");
  const w = { equity: 1.2, payment: 0.9 };
  const list = [{ id: "P", cat: "payment", score: 62 }, { id: "E", cat: "equity", score: 60 }, { id: "P2", cat: "payment", score: 90 }, { id: "O", cat: "other", score: 61 }];
  return { nudged: o.applyWeights(list, w).map((x) => x.id), none: o.applyWeights(list, {}).map((x) => x.id) };
});
console.log("order:", JSON.stringify(order));
if (order.nudged.join() !== "P2,E,O,P") fail("the nudge should lift equity over a near payment score and leave the big gap: " + JSON.stringify(order.nudged));
if (order.none.join() !== "P,E,P2,O") fail("with nothing learned the order is as given: " + JSON.stringify(order.none));
const picks = await p.evaluate(async () => (await import("/js/prospects.js")).candidates().slice(0, 3).map((c) => c.cat));
console.log("batch cats:", JSON.stringify(picks));
if (!picks.length) fail("the batch should still be drawn with weights applied");

// --- Coach shows it.
const coach = await p.evaluate(() => ({ calls: !!document.querySelector(".calls-table"), rows: [...document.querySelectorAll(".calls-table tbody tr")].map((t) => [...t.querySelectorAll("td")].map((d) => d.textContent.replace(/\s+/g, " ").trim()).join(" ")), learned: [...document.querySelectorAll(".worked-card .small")].map((n) => n.textContent).find((t) => /^Learned:/.test(t)) || null }));
console.log("coach:", JSON.stringify(coach));
if (!coach.calls || !coach.rows.some((t) => /^Equity to trade 16 8 \(50%\) 8$/.test(t))) fail("Coach should table the calls by reason: " + JSON.stringify(coach.rows));
if (!coach.learned || !/Equity to trade up \d+%/.test(coach.learned) || !/Same payment or less down \d+%/.test(coach.learned)) fail("Coach should say what's been learned: " + coach.learned);

// --- A session outcome carries the reason and the phrasing from here on.
await p.evaluate(async () => { const s = await import("/js/session.js"); s.startSession(["o31"]); s.recordOutcome("o31", "voicemail"); });
const ev = await p.evaluate(async () => { const st = await import("/js/store.js"); const e = st.all("events").filter((e) => e.kind === "session_outcome" && e.leadId === "o31").pop(); return e && e.meta; });
console.log("new outcome:", JSON.stringify(ev));
if (!ev || !ev.reason || !/^[ab]$/.test(ev.opener || "")) fail("a session outcome should carry its reason and phrasing: " + JSON.stringify(ev));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlearn.test.js FAILED" : "\nlearn.test.js passed");
})();
