// Pick up where you left off: on a long Outreach list, the customer last
// acted on — contacted from the tray, opened, reviewed, put off — is a pill
// at the foot of the screen once the list is scrolled and their card is off
// screen. A tap scrolls back to the card and lights it; when the card isn't
// in the list, it opens their page. × keeps it away for the visit.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z" };
  // Sixty owners from a file, all still to contact; the eighth is the one worked.
  const leads = Array.from({ length: 60 }, (_, i) => ({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), stage: "delivered", vehicleInterest: "2021 Nissan Rogue SV", currentPayment: 400 + i, purchaseDate: "2023-03-10", ...x }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector('[data-filter="all"]', { timeout: 20000 });
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
await p.waitForFunction(() => document.querySelectorAll(".lead-list .swipe-card").length >= 20, null, { timeout: 15000 }).catch(() => fail("the list didn't draw"));

const state = () => p.evaluate(() => {
  const pill = document.querySelector(".resume-pill");
  const card = document.querySelector('.swipe-card[data-lead-id="o7"]');
  const v = document.getElementById("view").getBoundingClientRect();
  const r = card ? card.getBoundingClientRect() : null;
  return { pill: pill && !pill.hidden ? pill.textContent.replace(/\s+/g, " ").trim() : null, cardInView: !!(r && r.bottom > v.top && r.top < v.bottom), lit: !!(card && card.classList.contains("card-resume")), top: document.getElementById("view").scrollTop };
});
const scrollTo = (y) => p.evaluate((y) => { const v = document.getElementById("view"); v.scrollTop = y; v.dispatchEvent(new Event("scroll")); }, y);

// --- Nothing worked yet: scrolling shows no pill.
await scrollTo(1500); await p.waitForTimeout(150);
let s = await state();
console.log("no one worked yet:", JSON.stringify(s));
if (s.pill) fail("a pill showed before anyone was acted on: " + s.pill);

// --- Open the eighth owner, come back: scrolled past them, the pill offers the way back.
await scrollTo(0); await p.waitForTimeout(150);
await p.evaluate(() => document.querySelector('.swipe-card[data-lead-id="o7"]').click());
await p.waitForFunction(() => location.hash === "#/leads/o7", null, { timeout: 5000 });
await p.waitForTimeout(300);
await p.goBack(); await p.waitForTimeout(600);
await p.waitForFunction(() => document.querySelectorAll(".lead-list .swipe-card").length >= 20, null, { timeout: 15000 });
await scrollTo(1800); await p.waitForTimeout(200);
s = await state();
console.log("scrolled past them:", JSON.stringify(s));
if (!s.pill || !/Pick up at Owner/.test(s.pill)) fail("the pill should offer the last customer acted on: " + JSON.stringify(s));
if (s.cardInView) fail("the test should have scrolled their card off screen");

// --- Tap it: back to the card, lit; the pill goes.
await p.click(".resume-pill");
await p.waitForTimeout(700);
s = await state();
console.log("tapped:", JSON.stringify(s));
if (!s.cardInView || !s.lit || s.pill) fail("the pill should scroll back to the card and light it: " + JSON.stringify(s));

// --- While the card is on screen there's no pill; scrolled away again, it's back.
await scrollTo(s.top); await p.waitForTimeout(150);
if ((await state()).pill) fail("the pill shouldn't show while the card is on screen");
await scrollTo(2400); await p.waitForTimeout(200);
s = await state();
if (!s.pill) fail("scrolled away again, the pill should come back");

// --- A contact logged from the tray makes that customer the one to pick up at.
await scrollTo(0); await p.waitForTimeout(200);
await p.evaluate(async () => {
  const m = await import("/js/views/leads.js");
  m.noteWorked("o2", "contacted");
});
await scrollTo(2000); await p.waitForTimeout(200);
s = await p.evaluate(() => document.querySelector(".resume-pill")?.textContent.replace(/\s+/g, " ").trim());
if (!/Owner 02/.test(s || "")) fail("the pill should follow the latest action: " + s);

// --- × keeps it away for the visit.
await p.click(".resume-pill .resume-x"); await p.waitForTimeout(100);
await scrollTo(2600); await p.waitForTimeout(200);
if ((await state()).pill) fail("× should keep the pill away");

// --- Not in this list (a different chip): the pill opens their page instead.
// Owner 02 joins the log (off the Contacted chip); fifty others were reached,
// so the Contacted list is long enough to scroll.
await p.evaluate(() => sessionStorage.removeItem("viniva:outreach:resume-off"));
await p.evaluate(async () => { const st = await import("/js/store.js"); const now = new Date().toISOString(); st.update("leads", "o2", { lastContacted: now, loggedAt: now }); for (let i = 10; i < 60; i++) st.update("leads", "o" + i, { lastContacted: now, lastContactVia: "text" }); });
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(500);
await p.click('[data-filter="contacted"]'); await p.waitForTimeout(600);
await p.waitForFunction(() => document.querySelectorAll(".lead-list .swipe-card").length >= 20, null, { timeout: 15000 }).catch(() => fail("the Contacted list didn't draw"));
const absent = await p.evaluate(() => !document.querySelector('.swipe-card[data-lead-id="o2"]'));
await scrollTo(1500); await p.waitForTimeout(200);
const gone = await p.evaluate(() => document.querySelector(".resume-pill")?.hidden === false);
if (!absent || !gone) fail("with the customer off this list the pill should still show: " + JSON.stringify({ absent, gone }));
await p.click(".resume-pill");
await p.waitForFunction(() => location.hash === "#/leads/o2", null, { timeout: 5000 }).catch(() => fail("the pill should open the customer's page when their card isn't in the list"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nresume.test.js FAILED" : "\nresume.test.js passed");
})();
