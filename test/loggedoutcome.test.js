// The Log's Logged chip: who you logged this month, or all time, each with
// what came of it — read from the file (a sale, an appointment, the stage,
// the last conversation) or set by hand from a sheet; the ones with no
// outcome yet are counted, and can be shown alone.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const now = Date.now();
const d = new Date(); const lastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 10, 12).getTime();
await p.addInitScript(([now, lastMonth]) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const iso = (t) => new Date(t).toISOString();
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", source: "Walk-in" };
  const thisMonth = iso(now - 2 * 86400000);
  const leads = [
    { id: "a", name: "Sold Sam", phone: "9025550001", stage: "sold", vehicleInterest: "2026 Nissan Rogue SV", loggedAt: thisMonth, ...x },
    { id: "b", name: "Booked Bea", phone: "9025550002", stage: "appointment", vehicleInterest: "2026 Nissan Kicks SR", loggedAt: thisMonth, ...x },
    { id: "c", name: "Working Wes", phone: "9025550003", stage: "working", vehicleInterest: "2026 Nissan Sentra SV", loggedAt: thisMonth, ...x },
    { id: "d", name: "Quiet Quinn", phone: "9025550004", stage: "new", vehicleInterest: "2026 Nissan Frontier", loggedAt: thisMonth, ...x },
    { id: "e", name: "Old Olly", phone: "9025550005", stage: "new", vehicleInterest: "2025 Nissan Murano", loggedAt: iso(lastMonth), ...x },
    { id: "f", name: "Elsewhere Eli", phone: "9025550006", stage: "working", vehicleInterest: "2026 Nissan Pathfinder", loggedAt: iso(lastMonth), lastConversationOutcome: "bought_elsewhere", boughtElsewhereAt: iso(lastMonth + 86400000), ...x },
    { id: "g", name: "Import Ivy", phone: "9025550007", stage: "delivered", vehicleInterest: "2021 Nissan Rogue", importedAt: "2026-01-05T00:00:00.000Z", ...x },
  ];
  const appointments = [{ id: "ap1", leadId: "b", customerName: "Booked Bea", type: "testdrive", when: iso(now + 2 * 86400000).slice(0, 16), status: "scheduled", ...x }];
  const sales = [{ id: "s1", leadId: "a", customerName: "Sold Sam", vehicle: "2026 Nissan Rogue SV", saleDate: thisMonth.slice(0, 10), frontGross: 1000, backGross: 500, commission: 400, ...x }];
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, appointments, sales, settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false } }));
}, [now, lastMonth]);

await p.goto(APP + "/#/log");
await p.waitForSelector('[data-panel="logged"] .log-row', { timeout: 30000 }).catch(() => fail("the Logged panel didn't draw"));
await p.evaluate(() => { const t = document.querySelector('.log-tabs [data-tab="logged"]'); if (t && !t.classList.contains("btn-primary")) t.click(); });
await p.waitForTimeout(300);
const read = () => p.evaluate(() => ({
  chip: document.querySelector('.log-tabs [data-tab="logged"]')?.textContent.replace(/\s+/g, " ").trim(),
  line: document.querySelector(".lg-logline")?.textContent.replace(/\s+/g, " ").trim(),
  rows: [...document.querySelectorAll('[data-panel="logged"] .log-row')].map((r) => [r.querySelector(".row-title").textContent.trim(), r.querySelector(".lg-outcome").dataset.outcome]),
  scope: [...document.querySelectorAll(".lg-scope [data-scope]")].filter((b) => b.classList.contains("btn-primary")).map((b) => b.dataset.scope),
  noneBtn: document.querySelector(".lg-none")?.textContent.trim(),
}));
let c = await read();
console.log("month:", JSON.stringify(c));
if (!/^Logged\s?4$/.test(c.chip) || c.rows.length !== 4 || c.scope.join() !== "month") fail("this month: the four logged this month, the chip counting them: " + JSON.stringify(c));
const o = Object.fromEntries(c.rows);
if (o["Sold Sam"] !== "sold" || o["Booked Bea"] !== "booked" || o["Working Wes"] !== "working" || o["Quiet Quinn"] !== "none") fail("each has its outcome read from the file: " + JSON.stringify(o));
if (!/4 logged this month · 1 with no outcome yet/.test(c.line) || c.noneBtn !== "No outcome · 1") fail("the line and the chip count the ones without: " + JSON.stringify([c.line, c.noneBtn]));

// All time: the two from last month join; the imported owner never logged doesn't.
await p.click('.lg-scope [data-scope="all"]'); await p.waitForTimeout(300);
c = await read();
console.log("all:", JSON.stringify(c));
if (c.rows.length !== 6 || c.rows.some(([n]) => /Import Ivy/.test(n)) || Object.fromEntries(c.rows)["Elsewhere Eli"] !== "bought_elsewhere" || Object.fromEntries(c.rows)["Old Olly"] !== "none" || !/^Logged\s?4$/.test(c.chip) || !/6 logged all time · 2 with no outcome yet/.test(c.line)) fail("all time: six, the imported owner out, the chip still the month: " + JSON.stringify(c));
// Just the ones without.
await p.click('.lg-scope [data-scope="none"]'); await p.waitForTimeout(300);
c = await read();
if (c.rows.length !== 2 || !c.rows.every(([, k]) => k === "none") || c.scope.join() !== "all,none") fail("No outcome shows the two: " + JSON.stringify(c));

// Set one by hand: Quinn said not now. The badge turns, the file is patched, the count drops.
await p.evaluate(() => { [...document.querySelectorAll('[data-panel="logged"] .log-row')].find((r) => /Quiet Quinn/.test(r.textContent)).querySelector(".lg-outcome").click(); });
await p.waitForSelector(".modal .lo-sheet [data-key]", { timeout: 5000 }).catch(() => fail("the outcome sheet didn't open"));
const keys = await p.evaluate(() => [...document.querySelectorAll(".modal .lo-sheet [data-key]")].map((b) => b.dataset.key));
if (keys.join() !== "sold,booked,showed,working,not_now,not_interested,bought_elsewhere,lost") fail("the sheet's outcomes: " + keys.join());
await p.click('.modal .lo-sheet [data-key="not_now"]'); await p.waitForTimeout(400);
const quinn = await p.evaluate(async () => { const st = await import("/js/store.js"); const l = st.get("leads", "d"); return { logOutcome: l.logOutcome, conv: l.lastConversationOutcome, parked: l.prospectSnoozedUntil, fu: l.followUp }; });
c = await read();
console.log("quinn:", JSON.stringify(quinn), JSON.stringify(c.rows));
if (quinn.logOutcome !== "not_now" || quinn.conv !== "not_now" || !quinn.parked || quinn.fu !== quinn.parked) fail("not now parks them with a check-back: " + JSON.stringify(quinn));
if (c.rows.length !== 1 || !/Old Olly/.test(c.rows[0][0]) || !/6 logged all time · 1 with no outcome yet/.test(c.line)) fail("one left without: " + JSON.stringify(c));
// Olly bought: the Sold sheet opens the deal form with the customer in; logging it makes the sale on their lead.
await p.evaluate(() => { document.querySelector('[data-panel="logged"] .log-row .lg-outcome').click(); });
await p.waitForSelector('.modal .lo-sheet [data-key="sold"]', { timeout: 5000 });
await p.click('.modal .lo-sheet [data-key="sold"]');
await p.waitForSelector('.modal input[name="customerName"]', { timeout: 5000 }).catch(() => fail("Sold should open the deal form"));
const pre = await p.evaluate(() => document.querySelector('.modal input[name="customerName"]').value);
if (pre !== "Old Olly") fail("the deal form carries the customer: " + pre);
await p.fill('.modal input[name="frontComm"]', "300").catch(() => {});
await p.click(".modal button[type=submit]"); await p.waitForTimeout(500);
const olly = await p.evaluate(async () => { const st = await import("/js/store.js"); return { sale: st.all("sales").find((s) => s.leadId === "e") ? 1 : 0, stage: st.get("leads", "e").stage, leads: st.all("leads").filter((l) => /Olly/.test(l.name)).length }; });
c = await read();
if (olly.sale !== 1 || olly.leads !== 1 || c.rows.length !== 0 || !/every one has an outcome/.test(c.line)) fail("the sale lands on Olly's lead, not a new one; nobody is left without: " + JSON.stringify({ olly, rows: c.rows, line: c.line }));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nloggedoutcome.test.js FAILED" : "\nloggedoutcome.test.js passed");
})();
