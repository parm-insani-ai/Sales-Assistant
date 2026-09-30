// Going back lands where you were. Leads scrolled deep, into a customer,
// "← Leads" — the same place. Home scrolled, over to Leads by the tab, back
// to Home by the tab — the same place. The browser's own back does it too.
// A fresh jump (a stat card, the assistant) still starts at the top, and
// tapping the tab you're on goes to the top.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const leads = []; for (let i = 0; i < 120; i++) leads.push({ id: "l" + i, name: "Customer " + i, phone: "902555" + String(1000 + i), stage: ["new", "working", "delivered"][i % 3], vehicleInterest: ["2019 Nissan Rogue", "2021 Nissan Sentra", "2020 Kicks"][i % 3], followUp: i % 5 === 0 ? "2026-10-" + String(1 + (i % 28)).padStart(2, "0") : "", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false } }));
});
const top = () => p.evaluate(() => document.getElementById("view").scrollTop);
const settle = async (ms = 700) => { await p.waitForTimeout(ms); };
// Scroll the view by wheel-ish steps so the windowed list fills in.
const scrollTo = async (y) => { await p.evaluate(async (y) => { const v = document.getElementById("view"); for (let k = 0; k < 8; k++) { v.scrollTop = y; await new Promise((r) => requestAnimationFrame(r)); } }, y); await settle(300); };

await p.goto(APP + "/#/leads");
await p.waitForSelector(".lead-list [data-lead-id]", { timeout: 20000 });
await settle(400);

// --- Deep in Leads, into a customer, "← Leads".
await scrollTo(2200);
const before = await top();
console.log("leads scrolled to", before);
if (before < 1500) fail("couldn't scroll the list deep enough to test: " + before);
const picked = await p.evaluate(() => { const cards = [...document.querySelectorAll(".lead-list [data-lead-id]")]; const v = document.getElementById("view").getBoundingClientRect(); const c = cards.find((x) => x.getBoundingClientRect().top > v.top + 80); c.click(); return c.dataset.leadId; });
await p.waitForSelector('[data-act="back"]', { timeout: 10000 });
await p.click('[data-act="back"]');
await p.waitForSelector(".lead-list [data-lead-id]", { timeout: 10000 });
await settle();
let after = await top();
console.log("back from customer", picked, "→", after);
if (Math.abs(after - before) > 40) fail(`"← Leads" didn't land where you were: ${before} → ${after}`);
if ((await p.evaluate(() => location.hash)) !== "#/leads") fail("back didn't go back to Leads");

// --- The browser's own back, from a customer opened by tapping a card.
await p.evaluate(() => document.querySelector(".lead-list [data-lead-id]").click());
await p.waitForSelector('[data-act="back"]', { timeout: 10000 });
await p.goBack();
await p.waitForSelector(".lead-list [data-lead-id]", { timeout: 10000 });
await settle();
after = await top();
console.log("browser back →", after);
if (Math.abs(after - before) > 40) fail(`the browser's back didn't land where you were: ${before} → ${after}`);

// --- Today scrolled, Leads by the tab, Today by the tab: the same place.
await p.click('.tabbar a[data-route="/log"]');
await p.waitForSelector(".plays-slot .row", { timeout: 10000 });
await settle(400);
await scrollTo(500);
const homeBefore = await top();
if (homeBefore < 200) fail("couldn't scroll Today to test: " + homeBefore);
await p.click('.tabbar a[data-route="/leads"]');
await p.waitForSelector(".lead-list [data-lead-id]", { timeout: 10000 });
await settle();
const leadsAgain = await top();
console.log("leads by tab →", leadsAgain, "(was", before + ")");
if (Math.abs(leadsAgain - before) > 40) fail(`the Leads tab didn't come back where it was: ${before} → ${leadsAgain}`);
await p.click('.tabbar a[data-route="/log"]');
await p.waitForSelector(".plays-slot .row", { timeout: 10000 });
await settle();
const homeAfter = await top();
console.log("today by tab →", homeAfter, "(was", homeBefore + ")");
if (Math.abs(homeAfter - homeBefore) > 40) fail(`the Today tab didn't come back where it was: ${homeBefore} → ${homeAfter}`);

// --- Tapping the tab you're on goes to the top; a fresh jump starts at the top.
await p.click('.tabbar a[data-route="/log"]');
await settle(900);
if ((await top()) > 5) fail("re-tapping the Today tab didn't go to the top: " + (await top()));
await p.evaluate(async () => { const r = await import("/js/router.js"); r.navigate("/leads"); });
await p.waitForSelector(".lead-list [data-lead-id]", { timeout: 10000 });
await settle();
if ((await top()) > 5) fail("a fresh navigation to Leads didn't start at the top: " + (await top()));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nbackscroll.test.js FAILED" : "\nbackscroll.test.js passed");
})();
