// The same list, said to the Home mic. "Rogue owners with equity, highest
// rate first, call it Rogue equity" goes to Outreach whole — the chip, the
// cuts, the order, the saved name — with the count spoken back, and the
// count is the one on the screen. A plain owner question still takes the
// old road; a question about the lot or a payment on a car is not a list.
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
    currentPayment: 380 + i * 5, payoff: 12000 + i * 100, currentValue: i % 2 === 0 ? 20000 + i * 100 : 11000, currentApr: i % 5 === 0 ? 11.9 : 5.9, currentTerm: 84,
    purchaseDate: i % 3 === 0 ? "2020-03-10" : "2024-03-10", ...(i % 4 === 1 ? { lastContacted: "2026-10-20T10:00:00.000Z" } : {}), ...x });
  leads.push({ id: "nn1", name: "Nonum One", vehicleInterest: models[0], currentPayment: 400, payoff: 9000, currentValue: 16000, purchaseDate: "2021-01-01", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [
    { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x },
  ], settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 10, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72 } }));
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
});
await p.goto(APP + "/#/");
await p.waitForTimeout(800);

// --- Routing: the offline voice parser sends a list with a reason, a chip or
// a name to the owners path; a lot question and a payment question don't go there.
const routed = await p.evaluate(async () => {
  const v = await import("/js/voice.js");
  const r = (s) => v.parseCommand(s).action;
  return {
    reason: r("make me a list of Rogue owners with equity, highest rate first"),
    chip: r("show me my follow ups who drive a Sentra"),
    named: r("everyone with a high rate, call it Rate relief"),
    plain: r("show me my Sentra owners"),
    lot: r("do we have any Rogue SVs on the lot"),
    payment: r("what's the payment on a 2026 Rogue"),
    blast: r("text everyone who owns a Sentra that the new one is in"),
  };
});
console.log("routed:", JSON.stringify(routed));
if (routed.reason !== "owners" || routed.chip !== "owners" || routed.named !== "owners" || routed.plain !== "owners") fail("lists should route to the owners path: " + JSON.stringify(routed));
if (routed.lot === "owners" || routed.payment === "owners" || routed.blast !== "outreach") fail("a lot question, a payment question or a blast is not a list: " + JSON.stringify(routed));

// --- Said from Home: the whole sentence lands on Outreach, saved, with the count spoken.
const spoken = await p.evaluate(async () => { const m = await import("/js/agent.js"); const out = m.ownersOnScreen("Rogue owners with equity I haven't contacted, highest rate first, call it Rogue equity"); return out && out.result; });
console.log("spoken:", JSON.stringify({ count: spoken.count, audience: spoken.audience, answer: spoken.answer, saved: spoken.saved }));
if (!spoken || spoken.count < 1 || spoken.saved !== "Rogue equity") fail("the Home mic should count them and save the name: " + JSON.stringify(spoken));
if (!/^\d+ match — Rogue owners · Equity on Best now, highest rate first\. They're all on the screen\. Saved as "Rogue equity"/.test(spoken.answer)) fail("the spoken answer: " + spoken.answer);
await p.waitForFunction(() => location.hash === "#/leads" && document.querySelector(".cut-bar .aud-count"), null, { timeout: 15000 }).catch(() => fail("Outreach should open with the cut bar"));
await p.waitForTimeout(400);
let s = await p.evaluate(() => ({
  chip: document.querySelector(".lead-seg-btn.btn-primary")?.dataset.filter,
  lit: [...document.querySelectorAll(".cut-row .cut-chip.btn-primary")].map((c) => c.dataset.cut || "list:" + c.textContent.trim()),
  sort: document.querySelector('[data-act="sort"]')?.dataset.sort,
  bar: Number(document.querySelector(".cut-bar .aud-count")?.textContent),
  barLabel: document.querySelector(".cut-bar .small")?.textContent.replace(/\s+/g, " ").trim(),
}));
console.log("on screen:", JSON.stringify(s));
if (s.chip !== "tocontact" || !s.lit.includes("model:rogue") || !s.lit.includes("equity") || s.sort !== "rate") fail("the screen should carry the chip, the cuts and the order: " + JSON.stringify(s));
if (!s.lit.some((x) => /Rogue equity/.test(x)) || !/Rogue equity/.test(s.barLabel)) fail("the list should be saved and lit: " + JSON.stringify(s));
if (s.bar !== spoken.count) fail(`the count spoken (${spoken.count}) should be the count on the screen (${s.bar})`);

// --- Said again without a chip: lands on All, nothing saved, order best.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
const again = await p.evaluate(async () => { const m = await import("/js/agent.js"); return m.ownersOnScreen("people with a contract ending or warranty ending").result; });
await p.waitForFunction(() => location.hash === "#/leads" && document.querySelector(".cut-bar .aud-count"), null, { timeout: 15000 }).catch(() => fail("Outreach should open again"));
await p.waitForTimeout(400);
s = await p.evaluate(() => ({ chip: document.querySelector(".lead-seg-btn.btn-primary")?.dataset.filter, lit: [...document.querySelectorAll(".cut-row .cut-chip.btn-primary")].map((c) => c.dataset.cut || "list"), sort: document.querySelector('[data-act="sort"]')?.dataset.sort, bar: Number(document.querySelector(".cut-bar .aud-count")?.textContent) }));
console.log("again:", JSON.stringify(s), "spoken", again.count);
if (s.chip !== "all" || s.lit.join() !== "ending,warranty" || s.sort !== "best" || s.bar !== again.count) fail("no chip said means All, the two cuts, best first, same count: " + JSON.stringify(s) + " vs " + again.count);

// --- A plain owner question still takes the old road, word for word.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
const plain = await p.evaluate(async () => { const m = await import("/js/agent.js"); return m.ownersOnScreen("make me a list of everyone who owns a Nissan Sentra").result; });
if (!/^\d+ Sentra owners on file/.test(plain.answer)) fail("the plain owner answer should read as before: " + plain.answer);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nhomelist.test.js FAILED" : "\nhomelist.test.js passed");
})();
