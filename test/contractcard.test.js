// The current contract, clear on every customer: a line under the vehicle
// on the Leads card, and a card under the name on their page.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2021 Nissan Rogue SV", currentPayment: 532, paymentsLeft: 26, paymentsLeftAsOf: "2026-06-20", currentTerm: 72, payoff: 19455, currentValue: 21500, currentApr: 8.9, dealType: "Retail", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", name: "Ravi Anand", phone: "9025552222", stage: "working", vehicleInterest: "2019 Nissan Kicks", currentPayment: 299, purchaseDate: "2019-05-01", currentTerm: 60, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "c", name: "Lynn Chu", phone: "9025553333", stage: "new", vehicleInterest: "Sentra", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});
await p.goto(APP + "/#/leads");
await p.waitForFunction(() => document.querySelectorAll("[data-lead-id]").length >= 3, null, { timeout: 15000 });
const cards = await p.evaluate(() => [...document.querySelectorAll("[data-lead-id]")].map((c) => { const b = c.querySelector(".contract-banner"); return [c.querySelector(".row-title").textContent.trim(), b ? [...b.querySelectorAll(".cb-value")].map((v) => v.textContent.trim()) : null, b ? b.querySelectorAll(".cb-cell").length : 0]; }));
console.log("cards:", JSON.stringify(cards));
const dana = cards.find((c) => c[0] === "Dana Muise"), ravi = cards.find((c) => c[0] === "Ravi Anand"), lynn = cards.find((c) => c[0] === "Lynn Chu");
if (!dana || !dana[1] || dana[1][0] !== "$532/mo" || dana[1][1] !== "23" || dana[1][2] !== "8.9%" || dana[2] !== 3) fail("Dana's banner isn't payment, payments left and rate: " + JSON.stringify(dana));
if (!ravi || !ravi[1] || ravi[1][0] !== "$299/mo" || ravi[1][1] !== "Paid off") fail("Ravi's paid-off contract isn't on his banner: " + JSON.stringify(ravi));
if (!lynn || lynn[1]) fail("a customer with no contract got a banner: " + JSON.stringify(lynn));

// --- Her page: the banner under the name box, no Current contract card.
await p.evaluate(() => { location.hash = "#/leads/a"; });
await p.waitForFunction(() => document.querySelector("#view .contract-banner"), null, { timeout: 8000 });
const page = await p.evaluate(() => ({ titles: [...document.querySelectorAll(".section-title")].map((t) => t.textContent.trim().split(" ·")[0]), banner: [...document.querySelector("#view .contract-banner").querySelectorAll(".cb-value")].map((v) => v.textContent.trim()) }));
console.log("page:", JSON.stringify(page));
if (page.titles.includes("Current contract")) fail("the Current contract card is still on the page");
if (page.banner[0] !== "$532/mo" || page.banner[1] !== "23" || page.banner[2] !== "8.9%") fail("the name box banner is wrong: " + JSON.stringify(page.banner));

// --- Tap it: Their numbers, with payments left; saving counts from today.
await p.click("#view .contract-banner");
await p.waitForFunction(() => document.querySelector('input[name="paymentsLeft"]'), null, { timeout: 5000 });
await p.fill('input[name="paymentsLeft"]', "20");
await p.click('button[type="submit"]');
await p.waitForTimeout(500);
const after = await p.evaluate(async () => { const s = await import("/js/store.js"); const l = s.get("leads", "a"); return { left: l.paymentsLeft, asOf: l.paymentsLeftAsOf, shown: [...document.querySelector("#view .contract-banner").querySelectorAll(".cb-value")].map((v) => v.textContent.trim())[1] }; });
console.log("after edit:", JSON.stringify(after));
if (after.left !== 20 || after.asOf !== new Date().toISOString().slice(0, 10) || after.shown !== "20") fail("payments left didn't save as of today: " + JSON.stringify(after));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncontractcard.test.js FAILED" : "\ncontractcard.test.js passed");
})();
