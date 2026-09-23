// The customer's page is the customer: the details, stage, texting consent,
// contact history and the actions sit behind the "i" on the name box.
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
await p.waitForFunction(() => document.querySelector(".info-btn"), null, { timeout: 15000 });
const page = await p.evaluate(() => ({ titles: [...document.querySelectorAll("#view .section-title")].map((t) => t.textContent.trim().split(" ·")[0]), badge: !!document.querySelector("#view > div > .card .badge"), info: !!document.querySelector(".info-btn") }));
console.log("page:", JSON.stringify(page));
for (const gone of ["Texting consent", "Quick stage update", "Details", "Email history", "Actions"]) if (page.titles.includes(gone)) fail(`"${gone}" is still on the page`);
if (!page.info) fail("no i button on the name box");

await p.click(".info-btn");
await p.waitForFunction(() => document.querySelector(".modal .hist-list"), null, { timeout: 5000 });
const sheet = await p.evaluate(() => ({ titles: [...document.querySelectorAll(".modal .section-title")].map((t) => t.textContent.trim().split(" ·")[0]), hist: [...document.querySelectorAll(".modal .hist-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()), phone: document.querySelector('.modal [data-edit="phone"]')?.textContent.replace(/\s+/g, " ").trim(), stages: document.querySelectorAll(".modal [data-stage]").length, actions: ["edit", "deliver", "delete", "logsale", "appointment", "cadence", "referral", "find-car", "log-email", "log-contact"].filter((a) => document.querySelector(`.modal [data-act="${a}"]`)).length }));
console.log("sheet:", JSON.stringify(sheet));
if (!["Details", "Stage", "Contact history", "Actions"].every((t) => sheet.titles.includes(t))) fail("the sheet is missing a section: " + JSON.stringify(sheet.titles));
if (!/555-1111/.test(sheet.phone || "")) fail("the details aren't in the sheet");
if (sheet.hist.length !== 2 || !/Can I come by Saturday/.test(sheet.hist[0]) || !/Logged call.*asked about the SV/.test(sheet.hist[1])) fail("the contact history isn't newest first with the text and the logged call: " + JSON.stringify(sheet.hist));
if (sheet.stages < 5 || sheet.actions !== 10) fail("stage chips or actions are missing from the sheet: " + JSON.stringify(sheet));

// A stage change from the sheet closes it and moves the customer.
await p.click('.modal [data-stage="appointment"]');
await p.waitForTimeout(400);
const after = await p.evaluate(async () => { const s = await import("/js/store.js"); return { stage: s.get("leads", "a").stage, modal: !!document.querySelector(".modal"), page: !!document.querySelector(".info-btn") }; });
console.log("after stage:", JSON.stringify(after));
if (after.stage !== "appointment" || after.modal || !after.page) fail("the stage change didn't close the sheet and redraw: " + JSON.stringify(after));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ninfosheet.test.js FAILED" : "\ninfosheet.test.js passed");
})();
