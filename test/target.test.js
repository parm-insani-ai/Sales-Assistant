// The store's monthly target sheet, on Home. Set new and used units and
// the closing ratio you expect; the sheet says how many customers to speak
// with (units ÷ ratio, rounded up), then counts from the book: spoken with
// (any outbound contact, once per customer), sold (the sold log, by new /
// used), closing ratio, remaining, pace, and this week's share. The
// customer log is the app itself — nothing is typed twice.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hourAgo = new Date(now.getTime() - 3600000).toISOString();
  const lead = (id, shopping, extra = {}) => ({ id, name: "Customer " + id, phone: "9025550" + id.padStart(3, "0"), stage: "working", vehicleInterest: "Rogue", shopping, ...x, ...extra });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      // Four new-car shoppers spoken with this month (a logged call, a sent text, an email out, Call tapped on the page).
      lead("1", "New"), lead("2", "New"), lead("3", "New"), lead("4", "New", { lastContacted: hourAgo, lastContactVia: "call" }),
      // Two used, one not marked — and one nobody has spoken with.
      lead("5", "Used"), lead("6", "Used"), lead("7", ""), lead("8", "New"),
      // A customer contacted twice counts once; one contacted last year doesn't count.
      lead("9", "New", { lastContacted: "2025-03-03T12:00:00.000Z" }),
    ],
    calls: [
      { id: "c1", leadId: "1", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c1b", leadId: "1", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c5", leadId: "5", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c7", leadId: "7", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c9", leadId: "9", dir: "out", via: "call", at: "2025-03-03T12:00:00.000Z", outcome: "reached", logged: true, ...x },
    ],
    texts: [{ id: "t2", leadId: "2", dir: "out", body: "Hi", at: hourAgo, ...x }, { id: "t8in", leadId: "8", dir: "in", body: "Hi", at: hourAgo, ...x }],
    emails: [{ id: "e3", leadId: "3", direction: "out", subject: "The SV", sentAt: hourAgo, ...x }, { id: "e6", leadId: "6", direction: "out", subject: "The Kicks", sentAt: hourAgo, ...x }],
    sales: [
      { id: "s1", leadId: "1", customerName: "Customer 1", vehicle: "2026 Rogue SV", saleDate: today, newUsed: "New", commission: 500, ...x },
      { id: "s2", leadId: "2", customerName: "Customer 2", vehicle: "2026 Kicks", saleDate: today, newUsed: "New", commission: 400, ...x },
      { id: "s3", leadId: "5", customerName: "Customer 5", vehicle: "2022 Sentra", saleDate: today, newUsed: "Used", commission: 300, ...x },
      { id: "s0", leadId: "9", customerName: "Customer 9", vehicle: "2024 Rogue", saleDate: "2025-03-05", newUsed: "New", commission: 300, ...x },
    ],
    appointments: [{ id: "a1", leadId: "3", customerName: "Customer 3", type: "appointment", when: today + "T15:00", status: "scheduled", ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false, targetNew: 6, targetUsed: 4, closingNew: 42, closingUsed: 42, goalUnits: 10, goalAppointments: 30, goalCommission: 8000 },
  }));
});

// --- The engine.
await p.goto(APP + "/#/");
await p.waitForSelector(".target-card", { timeout: 15000 });
const t = await p.evaluate(async () => { const m = await import("/js/target.js"); const r = m.salesTarget(); return { ...r, plan: r.plan }; });
console.log("sheet:", JSON.stringify({ plan: t.plan, spoke: [t.spoke, t.spokeNew, t.spokeUsed, t.spokeUnsplit], sold: [t.sold, t.soldNew, t.soldUsed], closing: t.closing, remaining: [t.remainingUnits, t.remainingTalks], week: [t.week, t.weeks, t.perWeek, t.spokeWeek], appts: t.appts }));
if (t.plan.needNew !== 15 || t.plan.needUsed !== 10 || t.plan.need !== 25 || t.plan.target !== 10) fail("units ÷ 42% rounded up should be 15 new, 10 used, 25: " + JSON.stringify(t.plan));
if (t.spoke !== 7 || t.spokeNew !== 4 || t.spokeUsed !== 2 || t.spokeUnsplit !== 1) fail("spoken with should count 7 customers once each (4 new, 2 used, 1 unmarked), not the inbound text or last year's call: " + JSON.stringify([t.spoke, t.spokeNew, t.spokeUsed, t.spokeUnsplit]));
if (t.sold !== 3 || t.soldNew !== 2 || t.soldUsed !== 1) fail("sold this month should be 3 (2 new, 1 used): " + JSON.stringify([t.sold, t.soldNew, t.soldUsed]));
if (Math.round(t.closing * 100) !== 43 || Math.round(t.closingNew * 100) !== 50 || Math.round(t.closingUsed * 100) !== 50) fail("closing ratios: " + JSON.stringify([t.closing, t.closingNew, t.closingUsed]));
if (t.remainingUnits !== 7 || t.remainingTalks !== 18) fail("remaining: " + JSON.stringify([t.remainingUnits, t.remainingTalks]));
if (t.perWeek !== Math.ceil(25 / t.weeks) || t.spokeWeek !== 7) fail("the week's share and this week's count: " + JSON.stringify([t.perWeek, t.spokeWeek, t.weeks]));
if (t.appts !== 1) fail("appointments set this month: " + t.appts);

// --- On Home: the sheet as a table, in a drop-down.
const home = await p.evaluate(() => ({
  fold: document.querySelector('[data-fold="home:target"]')?.open,
  head: [...document.querySelectorAll(".tgt thead th")].map((n) => n.textContent.trim()),
  rows: [...document.querySelectorAll(".tgt tbody tr")].map((r) => [...r.children].map((c) => c.textContent.trim()).join(" | ")),
  text: document.querySelector(".target-card").textContent.replace(/\s+/g, " ").trim(),
  goalCard: /Monthly goal/.test(document.querySelector("#view").textContent),
}));
console.log("home:", JSON.stringify(home, null, 1));
if (!home.fold) fail("the Sales target drop-down should start open");
if (home.head.join() !== ",Target,Talk to,Sold,Spoke to,Closing") fail("the sheet's columns: " + home.head.join());
if (home.rows.join(" / ") !== "New | 6 | 15 | 2 | 4 | 50% / Used | 4 | 10 | 1 | 2 | 50% / Total | 10 | 25 | 3 | 7 | 43%") fail("the sheet's rows: " + JSON.stringify(home.rows));
if (!/7 units to go · 18 more conversations · 30% of target/.test(home.text)) fail("the remaining line: " + home.text);
if (!/Week \d of \d: 7 of \d+ conversations · 1 appointment set of 30/.test(home.text)) fail("the week line: " + home.text);
if (!/1 spoken with not marked new or used/.test(home.text)) fail("the unmarked customer isn't called out: " + home.text);
if (!/Commission\s*\$1,200 \/ \$8,000/.test(home.text)) fail("the commission line: " + home.text);
if (home.goalCard) fail("the old Monthly goal card is still on Home");

// --- Set target: the sheet recalculates, and the unit goal follows the total.
await p.click('.target-card [data-act="set-target"]');
await p.waitForSelector('.modal input[name="targetNew"]', { timeout: 5000 });
await p.fill('.modal input[name="targetNew"]', "8");
await p.fill('.modal input[name="closingNew"]', "50");
await p.click(".modal button[type=submit]");
await p.waitForTimeout(500);
const after = await p.evaluate(async () => { const s = await import("/js/store.js"); return { goalUnits: s.getSettings().goalUnits, rows: [...document.querySelectorAll(".tgt tbody tr")].map((r) => [...r.children].map((c) => c.textContent.trim()).join(" | ")) }; });
console.log("after set:", JSON.stringify(after));
if (after.goalUnits !== 12 || after.rows[0] !== "New | 8 | 16 | 2 | 4 | 50%" || after.rows[2] !== "Total | 12 | 26 | 3 | 7 | 43%") fail("setting the target didn't recalculate: " + JSON.stringify(after));

// --- The assistant answers "how am I doing against my target?".
const voice = await p.evaluate(async () => { const a = await import("/js/agent.js"); const r = await a.execTool("sales_target", {}); return { r: r.result, note: r.note }; });
console.log("voice:", JSON.stringify(voice));
if (voice.r.customersToSpeakWith !== 26 || voice.r.spokenWith !== 7 || voice.r.sold !== 3 || voice.r.remainingUnits !== 9 || !/3 of 12 sold, 7 of 26/.test(voice.note)) fail("the assistant's target readout is wrong: " + JSON.stringify(voice));

// --- No target yet: the sheet asks for one and nothing is invented.
await p.evaluate(async () => { const s = await import("/js/store.js"); s.updateSettings({ targetNew: 0, targetUsed: 0, goalUnits: 0 }); location.hash = "#/leads"; });
await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
const empty = await p.evaluate(() => ({ table: !!document.querySelector(".tgt"), btn: document.querySelector('.target-card [data-act="set-target"]')?.textContent.trim(), text: document.querySelector(".target-card")?.textContent.replace(/\s+/g, " ").trim() }));
if (empty.table || empty.btn !== "Set your target" || !/how many customers you need to speak with/.test(empty.text || "")) fail("with no target the sheet should ask for one: " + JSON.stringify(empty));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ntarget.test.js FAILED" : "\ntarget.test.js passed");
})();
