// The lease maturity pipeline on the Timing screen: the line, the stage
// totals, a month with its bar, rows with their stage and the red mark, the
// month's Call button starting a session over the unspoken, and the
// assistant's answer.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const DAY = 86400000, now = Date.now();
  const ymd = (d) => new Date(now + d * DAY).toISOString().slice(0, 10);
  const iso = (d) => new Date(now + d * DAY).toISOString();
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import", dealType: "Lease", purchaseDate: "2023-11-01", currentPayment: 420, currentValue: 21000, payoff: 15000 };
  const leads = [
    { id: "a", name: "Ann Example", phone: "9025550001", vehicleInterest: "2023 Nissan Rogue SV", leaseEnd: ymd(40), ...x },
    { id: "b", name: "Bob Example", phone: "9025550002", vehicleInterest: "2023 Nissan Kicks SR", leaseEnd: ymd(45), ...x },
    { id: "c", name: "Cal Example", phone: "9025550003", vehicleInterest: "2023 Nissan Sentra SV", leaseEnd: ymd(50), ...x },
    { id: "d", name: "Dee Example", phone: "9025550004", vehicleInterest: "2022 Nissan Murano SL", leaseEnd: ymd(200), ...x },
  ];
  const calls = [{ id: "k1", leadId: "c", dir: "out", via: "call", at: iso(-5), outcome: "reached", conversationOutcome: "interested", createdAt: iso(-5), updatedAt: iso(-5) }];
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, calls, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", createdAt: x.createdAt, updatedAt: x.updatedAt, status: "available" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 150 } }));
  sessionStorage.setItem("horizon-tab", "leases");
});
await p.goto(APP + "/#/horizon");
await p.waitForSelector(".lp-head", { timeout: 30000 }).catch(() => fail("the pipeline didn't draw"));
await p.waitForTimeout(400);

const read = () => p.evaluate(() => ({
  line: document.querySelector(".lp-head .strong")?.textContent.trim() || "",
  stages: [...document.querySelectorAll(".lp-head .lp-stages span")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  months: [...document.querySelectorAll(".section-title")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).filter((t) => /20\d\d/.test(t)),
  bars: document.querySelectorAll(".lp-bar").length,
  rows: [...document.querySelectorAll(".lp-row")].map((r) => ({ name: r.querySelector(".row-title")?.textContent.replace(/\s+/g, " ").trim(), red: r.classList.contains("lp-red"), rep: r.querySelector(".row-reasons")?.textContent.trim() || "" })),
  callAll: document.querySelector('[data-act="lp-call-all"]')?.textContent.trim() || "",
  callMonth: [...document.querySelectorAll("[data-call-month]")].map((n) => n.textContent.trim()),
}));
let c = await read();
console.log("head:", c.line, "|", JSON.stringify(c.stages));
console.log("rows:", JSON.stringify(c.rows));
if (!/^4 leases end in the next 12 months · 2 inside 90 days with no conversation/.test(c.line)) fail("the line: " + c.line);
if (!c.stages.some((s) => /Not touched 3/.test(s)) || !c.stages.some((s) => /Spoken with 1/.test(s))) fail("stage totals: " + JSON.stringify(c.stages));
if (c.rows.length !== 4 || c.rows.filter((r) => r.red).length !== 2) fail("four rows, Ann and Bob red (Cal spoke, Dee is months out): " + JSON.stringify(c.rows));
const ann = c.rows.find((r) => /Ann/.test(r.name)), cal = c.rows.find((r) => /Cal/.test(r.name));
if (!ann || !/Not touched/.test(ann.name) || !/No conversation/.test(ann.name) || !/2026 Nissan Rogue SV/.test(ann.rep)) fail("Ann: not touched, red, with the replacement on the row: " + JSON.stringify(ann));
if (!cal || !/Spoken with/.test(cal.name) || cal.red) fail("Cal: spoken, not red: " + JSON.stringify(cal));
if (!c.bars) fail("a month draws its bar");
if (!/Call the 3 not spoken with/.test(c.callAll)) fail("the head offers the three: " + c.callAll);
if (!c.callMonth.length) fail("a month offers its own call");

// Call the month: a session over the month's unspoken, red first.
await p.click("[data-call-month]"); await p.waitForTimeout(700);
const sess = await p.evaluate(async () => { const s = await import("/js/session.js"); const cur = s.currentSession(); return { hash: location.hash, name: cur && cur.name, ids: cur && cur.ids }; });
console.log("session:", JSON.stringify(sess));
if (sess.hash !== "#/session" || !/^Lease ends · /.test(sess.name || "") || !sess.ids || sess.ids.includes("c") || sess.ids.includes("d")) fail("the month's session holds its unspoken only: " + JSON.stringify(sess));
await p.evaluate(async () => { (await import("/js/session.js")).endSession(); });

// The assistant.
const tool = await p.evaluate(async () => { const m = await import("/js/agent.js"); return (await m.execTool("lease_ends", { months: 12 })).result; });
console.log("tool:", JSON.stringify({ answer: tool.answer, totals: tool.pipeline && tool.pipeline.totals, first: tool.callFirst && tool.callFirst.map((x) => x.customer) }));
if (!tool.pipeline || tool.pipeline.totals.untouched !== 3 || tool.pipeline.totals.spoken !== 1 || tool.pipeline.redNoConversation !== 2 || !/Call first: Ann Example/.test(tool.answer)) fail("the assistant reads the pipeline: " + JSON.stringify(tool.pipeline));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nleasepipeui.test.js FAILED" : "\nleasepipeui.test.js passed");
})();
