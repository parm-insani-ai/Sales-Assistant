// The customer's page is the customer: the name box with the ways to reach
// them, then everything else as drop-downs — the context and the next
// moves open, the read, the options, the plan, the details, the stage, the
// history and the actions closed until they're wanted. A drop-down
// remembers whether it was left open.
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
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", stage: "working", vehicleInterest: "2021 Nissan Rogue SV", currentPayment: 532, ...x }],
    calls: [{ id: "c1", leadId: "a", dir: "out", via: "call", at: "2026-09-18T15:00:00.000Z", outcome: "reached", notes: "asked about the SV", logged: true, ...x }],
    texts: [{ id: "t1", leadId: "a", dir: "in", body: "Can I come by Saturday?", at: "2026-09-20T12:00:00.000Z", read: true, ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});
await p.goto(APP + "/#/leads/a");
await p.waitForFunction(() => document.querySelector('[data-fold="lead:actions"]'), null, { timeout: 15000 });
const page = await p.evaluate(() => ({
  folds: [...document.querySelectorAll("#view details.fold")].map((d) => [d.dataset.fold, d.open]),
  titles: [...document.querySelectorAll("#view .fold-title")].map((t) => t.textContent.trim().split(" ·")[0]),
  badge: document.querySelector("#view .lead-head .badge")?.textContent.trim() || null,
  info: !!document.querySelector(".info-btn"),
  hist: [...document.querySelectorAll("#view .hist-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  phone: document.querySelector('#view [data-edit="phone"]')?.textContent.replace(/\s+/g, " ").trim(),
  stages: document.querySelectorAll("#view [data-stage]").length,
  actions: ["edit", "deliver", "delete", "logsale", "appointment", "cadence", "referral", "find-car", "log-email", "log-contact"].filter((a) => document.querySelector(`#view [data-act="${a}"]`)).length,
  // What's actually on screen: only the open drop-downs' bodies.
  visibleBodies: [...document.querySelectorAll("#view .fold-body")].filter((c) => (c.checkVisibility ? c.checkVisibility() : c.getBoundingClientRect().height > 0)).length,
}));
console.log("page:", JSON.stringify(page));
const open = Object.fromEntries(page.folds);
if (page.info) fail("the i button is still on the name box — its sections are drop-downs now");
if (!["Context", "Next moves", "Details", "Stage", "Contact history", "Actions"].every((t) => page.titles.includes(t))) fail("a section is missing: " + JSON.stringify(page.titles));
if (!open["lead:context"] || !open["lead:moves"]) fail("the context and the next moves should start open");
if (open["lead:details"] || open["lead:stage"] || open["lead:history"] || open["lead:actions"] || open["lead:plan"]) fail("the record's sections should start closed: " + JSON.stringify(page.folds));
if (page.badge) fail("a badge is on the name box — the stage lives in its own section: " + page.badge);
if (!/555-1111/.test(page.phone || "")) fail("the details aren't on the page");
if (page.hist.length !== 2 || !/Can I come by Saturday/.test(page.hist[0]) || !/Logged call.*asked about the SV/.test(page.hist[1])) fail("the contact history isn't newest first with the text and the logged call: " + JSON.stringify(page.hist));
if (page.stages < 5 || page.actions !== 10) fail("stage chips or actions are missing: " + JSON.stringify(page));
if (page.visibleBodies !== 2) fail(`${page.visibleBodies} drop-downs are open on arrival, not the two (context, next moves) — the page should read at a glance`);

// Opening the Stage drop-down and changing the stage from it moves the
// customer, and the page redraws with the drop-down still open.
await p.click('#view [data-fold="lead:stage"] > summary');
await p.waitForTimeout(300);
const opened = await p.evaluate(() => ({ open: document.querySelector('[data-fold="lead:stage"]').open, sub: document.querySelector('[data-fold="lead:stage"] .fold-sub')?.textContent.trim() }));
if (!opened.open) fail("tapping the Stage heading didn't open it");
if (!/Working/.test(opened.sub || "")) fail("the Stage heading doesn't say the stage: " + opened.sub);
await p.click('#view [data-stage="appointment"]');
await p.waitForTimeout(400);
const after = await p.evaluate(async () => { const s = await import("/js/store.js"); return { stage: s.get("leads", "a").stage, sub: document.querySelector('[data-fold="lead:stage"] .fold-sub')?.textContent.trim(), stageOpen: document.querySelector('[data-fold="lead:stage"]')?.open, contextOpen: document.querySelector('[data-fold="lead:context"]')?.open }; });
console.log("after stage:", JSON.stringify(after));
if (after.stage !== "appointment" || !/Appointment/.test(after.sub || "") || !after.stageOpen || !after.contextOpen) fail("the stage change didn't take, or the drop-downs didn't come back as they were: " + JSON.stringify(after));

// Closing a drop-down is remembered across visits.
await p.evaluate(() => { document.querySelector('[data-fold="lead:context"]').open = false; document.querySelector('[data-fold="lead:context"]').dispatchEvent(new Event("toggle")); });
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads/a"; }); await p.waitForTimeout(400);
const remembered = await p.evaluate(() => ({ context: document.querySelector('[data-fold="lead:context"]')?.open, stage: document.querySelector('[data-fold="lead:stage"]')?.open }));
console.log("remembered:", JSON.stringify(remembered));
if (remembered.context !== false || remembered.stage !== true) fail("the drop-downs didn't come back the way they were left: " + JSON.stringify(remembered));

// Sent here to record consent: the details open on arrival.
await p.evaluate(() => { sessionStorage.setItem("leads-open-info", "a"); location.hash = "#/leads"; });
await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/leads/a"; }); await p.waitForTimeout(500);
const details = await p.evaluate(() => ({ open: document.querySelector('[data-fold="lead:details"]')?.open, consent: !!document.querySelector('[data-act="consent-express"]') }));
if (!details.open || !details.consent) fail("arriving to record consent didn't open the details: " + JSON.stringify(details));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ninfosheet.test.js FAILED" : "\ninfosheet.test.js passed");
})();
