// Back on every page: the arrow is there whenever a page sits behind this
// one, and it goes to the page you were just on — tab to tab, a customer
// to the list it came from, a thread to the customer. The first page of a
// visit has no arrow; a page opened cold falls back to its parent. An old
// address that only sends you on leaves no footprint to bounce off.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", source: "Walk-in" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [{ id: "a", name: "Dana Example", phone: "9025551111", stage: "working", vehicleInterest: "2026 Nissan Rogue SV", loggedAt: new Date().toISOString(), ...x }], sales: [{ id: "s1", customerName: "Dana Example", vehicle: "2026 Nissan Rogue SV", saleDate: new Date().toISOString().slice(0, 10), leadId: "a", frontGross: 1, backGross: 0, commission: 1, ...x }], settings: { salesperson: "Parm", cloudAutoSync: false } }));
});
const state = () => p.evaluate(() => ({ hash: location.hash, back: document.getElementById("topbar-back").hidden === false }));
const back = async () => { await p.click("#topbar-back"); await p.waitForTimeout(500); return state(); };

await p.goto(APP + "/#/");
await p.waitForSelector("#view .card", { timeout: 30000 });
let s = await state();
if (s.back) fail("the first page of a visit has nothing behind it — no arrow: " + JSON.stringify(s));
// Tab to tab: Outreach, then the customer, then the thread.
await p.click('.tabbar .tab[data-route="/leads"]'); await p.waitForFunction(() => location.hash === "#/leads" && document.querySelector('[data-filter="all"]'), null, { timeout: 15000 }); await p.waitForTimeout(300);
s = await state(); if (!s.back || s.hash !== "#/leads") fail("Outreach from Home has an arrow: " + JSON.stringify(s));
await p.evaluate(() => { location.hash = "#/leads/a"; }); await p.waitForSelector(".lead-head", { timeout: 10000 }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/inbox/a"; }); await p.waitForSelector("#ib-thread", { timeout: 10000 }); await p.waitForTimeout(300);
s = await back(); if (s.hash !== "#/leads/a") fail("back from the thread is the customer, not Comms: " + JSON.stringify(s));
s = await back(); if (s.hash !== "#/leads") fail("back from the customer is Outreach: " + JSON.stringify(s));
s = await back(); if (s.hash !== "#/" || s.back) fail("back from Outreach is Home, with nothing behind it: " + JSON.stringify(s));
// An old address sends you on and leaves no footprint.
await p.evaluate(() => { location.hash = "#/sold"; }); await p.waitForFunction(() => location.hash === "#/soldlog" && document.querySelector("#sl-list"), null, { timeout: 10000 }); await p.waitForTimeout(300);
s = await back(); if (s.hash !== "#/") fail("back from a redirected page skips the redirect: " + JSON.stringify(s));
// A page opened cold (a fresh tab, a notification) falls back to its parent.
const p2 = await p.context().newPage();
await p2.goto(APP + "/#/leads/a"); await p2.waitForSelector(".lead-head", { timeout: 15000 }); await p2.waitForTimeout(300);
let s2 = await p2.evaluate(() => ({ hash: location.hash, back: document.getElementById("topbar-back").hidden === false }));
if (!s2.back) fail("a customer page opened cold still has an arrow (to its parent): " + JSON.stringify(s2));
await p2.click("#topbar-back"); await p2.waitForTimeout(600);
s2 = await p2.evaluate(() => ({ hash: location.hash }));
if (s2.hash !== "#/leads") fail("opened cold, back is the parent: " + JSON.stringify(s2));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nbacknav.test.js FAILED" : "\nbacknav.test.js passed");
})();
