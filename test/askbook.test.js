// The assistant's general question over the book, end to end on the phone:
// a list lands on Outreach as a lit cut with the same count the voice said,
// saved under a name when one was given; a number is answered in words
// with nothing opened; a bad field comes back as a correction, not a
// failure; and the row's own mic offers the assistant for a sentence it
// can't read itself.
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
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2021 Nissan Kicks SR", "2016 Nissan Pathfinder SL", "2022 Nissan Frontier PRO-4X"];
  const leads = [];
  for (let i = 0; i < 40; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 6],
    currentPayment: 300 + i * 10, payoff: 12000 + i * 100, currentValue: i % 2 === 0 ? 20000 + i * 100 : 11000, currentApr: i % 5 === 0 ? 11.9 : 5.9, currentTerm: 84,
    purchaseDate: i % 3 === 0 ? "2021-03-10" : "2024-03-10", ...(i % 4 === 1 ? { lastContacted: "2026-10-20T10:00:00.000Z" } : {}), ...(i % 8 === 2 ? { dob: `1980-${String(new Date().getMonth() + 1).padStart(2, "0")}-15` } : {}), ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [
    { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x },
  ], settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 10, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72 } }));
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
});
await p.goto(APP + "/#/");
await p.waitForTimeout(800);

// --- A list by fields the row has no chip for: payment over 500 and bought in 2021.
// Payments run 300..690 in steps of 10: over 500 is i >= 21 (19 people); bought 2021 is i % 3 === 0 → i in {21,24,...,39} = 7.
const list = await p.evaluate(async () => { const m = await import("/js/agent.js"); const out = await m.execTool("query_customers", { where: [{ field: "currentPayment", op: "gt", value: 500 }, { field: "purchaseDate", op: "inYear", value: 2021 }], name: "Big payment 2021" }); return { result: out.result, note: out.note, hash: location.hash }; });
console.log("list:", JSON.stringify({ count: list.result.count, label: list.result.label, answer: list.result.answer, saved: list.result.saved, first: list.result.customers[0] }));
if (list.result.count !== 7 || list.result.label !== "payment over $500 · purchase date in 2021" || list.result.saved !== "Big payment 2021") fail("seven match, labelled and saved: " + JSON.stringify(list.result));
if (!/^7 match — payment over \$500 · purchase date in 2021\. They're all on the screen\. Saved as "Big payment 2021"/.test(list.result.answer)) fail("the spoken answer: " + list.result.answer);
if (list.result.customers[0].currentPayment == null || list.result.customers[0].purchaseDate == null) fail("the rows carry the fields asked about: " + JSON.stringify(list.result.customers[0]));
await p.waitForFunction(() => location.hash === "#/leads" && document.querySelector(".cut-bar .aud-count"), null, { timeout: 15000 }).catch(() => fail("Outreach should open with the cut bar"));
await p.waitForTimeout(400);
let s = await p.evaluate(() => ({
  chip: document.querySelector(".lead-seg-btn.btn-primary")?.dataset.filter,
  lit: [...document.querySelectorAll(".cut-row .cut-chip.btn-primary")].map((c) => c.dataset.cut || c.dataset.act || "list:" + c.textContent.trim()),
  queryChip: document.querySelector('.cut-row [data-act="query-chip"]')?.textContent.trim(),
  bar: Number(document.querySelector(".cut-bar .aud-count")?.textContent),
  barLabel: document.querySelector(".cut-bar .small")?.textContent.replace(/\s+/g, " ").trim(),
  cards: document.querySelectorAll(".lead-card").length,
}));
console.log("on screen:", JSON.stringify(s));
if (s.chip !== "all" || s.bar !== 7 || s.queryChip !== "payment over $500 · purchase date in 2021") fail("Outreach should show the question as a lit cut on All with the same count: " + JSON.stringify(s));
if (!s.lit.some((x) => /Big payment 2021/.test(x)) || !/Big payment 2021/.test(s.barLabel)) fail("the list should be saved and lit: " + JSON.stringify(s));

// Tapping the question's chip clears it; the saved list brings it back.
await p.click('.cut-row [data-act="query-chip"]');
await p.waitForTimeout(300);
s = await p.evaluate(() => ({ bar: document.querySelector(".cut-bar .aud-count")?.textContent || null, lit: document.querySelectorAll(".cut-row .cut-chip.btn-primary").length }));
if (s.bar !== null || s.lit !== 0) fail("the chip should clear the question: " + JSON.stringify(s));
await p.click('.cut-row [data-list]');
await p.waitForTimeout(300);
s = await p.evaluate(() => ({ bar: Number(document.querySelector(".cut-bar .aud-count")?.textContent), query: !!document.querySelector('.cut-row [data-act="query-chip"]') }));
if (s.bar !== 7 || !s.query) fail("the saved list should bring the question back: " + JSON.stringify(s));

// --- With an order of its own, the screen keeps it: highest payment first.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
const ordered = await p.evaluate(async () => { const m = await import("/js/agent.js"); const out = await m.execTool("query_customers", { where: [{ field: "model", op: "is", value: "rogue" }], sort: { field: "currentPayment", dir: "desc" } }); return out.result; });
await p.waitForFunction(() => location.hash === "#/leads" && document.querySelector(".cut-bar .aud-count"), null, { timeout: 15000 }).catch(() => fail("Outreach should open for the ordered list"));
await p.waitForTimeout(400);
s = await p.evaluate(() => ({ bar: Number(document.querySelector(".cut-bar .aud-count")?.textContent), first: document.querySelector(".lead-card .row-title, .lead-card .lead-name, .lead-card h3, .lead-card .strong")?.textContent.trim() }));
console.log("ordered:", JSON.stringify({ count: ordered.count, first: ordered.customers[0].name, screen: s }));
if (ordered.count !== 7 || ordered.customers[0].name !== "Owner 36 Example" || s.bar !== 7) fail("Rogue owners, highest payment first: " + JSON.stringify({ ordered: ordered.customers.map((c) => c.name), s }));
if (s.first && !/Owner 36/.test(s.first)) fail("the screen should lead with the highest payment: " + s.first);

// --- A number: nothing opens, the answer is words.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
const avg = await p.evaluate(async () => { const m = await import("/js/agent.js"); const out = await m.execTool("query_customers", { where: [{ field: "model", op: "is", value: "sentra" }], measure: { op: "avg", field: "currentApr" } }); return { result: out.result, hash: location.hash }; });
console.log("avg:", JSON.stringify({ measure: avg.result.measure, answer: avg.result.answer, hash: avg.hash }));
if (avg.hash !== "#/" || avg.result.count !== 7 || !/^avg rate is [\d.]+% — Sentra owners\.$/.test(avg.result.answer)) fail("an average is said, nothing opens: " + JSON.stringify(avg));
const how = await p.evaluate(async () => { const m = await import("/js/agent.js"); return (await m.execTool("query_customers", { where: [{ field: "dob", op: "inMonth", value: new Date().getMonth() + 1 }], measure: { op: "count" } })).result; });
console.log("how many:", JSON.stringify({ answer: how.answer, have: how.haveOnFile }));
if (how.count !== 5 || !/^5 of 40 customers — birthday in /.test(how.answer) || how.haveOnFile.dob !== 5) fail("how many have a birthday this month, and how many have one on file: " + JSON.stringify(how));
const by = await p.evaluate(async () => { const m = await import("/js/agent.js"); return (await m.execTool("query_customers", { where: [], group: "model" })).result; });
console.log("by model:", by.answer);
if (!by.groups || by.groups.length !== 6 || !/^everyone, by model: /.test(by.answer)) fail("a breakdown by model: " + JSON.stringify(by));

// --- A field the assistant made up comes back as a correction with the fields.
const bad = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("query_customers", { where: [{ field: "shoeSize", op: "gt", value: 9 }] }); });
if (!bad.result.error || !/shoeSize/.test(bad.result.error) || !/currentPayment/.test(bad.result.fields)) fail("a bad field should be corrected: " + JSON.stringify(bad));

// --- The brief carries the book's profile, counts only.
const brief = await p.evaluate(async () => { const m = await import("/js/agent.js"); const r = m.agentRequest([{ role: "user", content: "hi" }]); return typeof r.system === "string" ? r.system : JSON.stringify(r.system); });
if (!/BOOK PROFILE/.test(brief) || !/40 customers/.test(brief) || !/THE BOOK'S FIELDS/.test(brief) || /Owner 00 Example/.test(brief)) fail("the brief should carry the field list and the profile, never a name");

// --- The row's own mic: a sentence it can't read offers the assistant.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(400);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(800);
await p.click('.cut-line [data-act="say-list"]');
await p.waitForSelector(".vl-sheet", { timeout: 5000 }).catch(() => fail("the sheet should open"));
await p.fill('.vl-sheet [data-f="say"]', "everyone with a payment over 500 who bought in 2021");
await p.click('.vl-sheet [data-act="read"]');
await p.waitForTimeout(300);
s = await p.evaluate(() => ({ ask: !document.querySelector('.vl-sheet [data-act="ask"]').hidden, status: document.querySelector(".vl-sheet .note-status")?.textContent.trim() }));
console.log("mic fallback:", JSON.stringify(s));
if (!s.ask) fail("a sentence the row can't read should offer the assistant: " + JSON.stringify(s));
await p.fill('.vl-sheet [data-f="say"]', "Rogue owners with equity");
await p.click('.vl-sheet [data-act="read"]');
await p.waitForTimeout(300);
s = await p.evaluate(() => ({ ask: !document.querySelector('.vl-sheet [data-act="ask"]').hidden, n: document.querySelector(".vl-sheet .vl-n")?.textContent }));
if (s.ask) fail("a sentence the row reads itself needs no assistant: " + JSON.stringify(s));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\naskbook.test.js FAILED" : "\naskbook.test.js passed");
})();
