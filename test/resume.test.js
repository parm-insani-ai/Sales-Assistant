// Pick up where you left off: Outreach opens fresh on today's batch, so the
// place the last scroll dropped off — the chip, the Dig cut, how far down the
// list — is kept, and coming back a pill at the foot of the screen offers the
// way back there. A tap puts the same chip and cards back and scrolls to the
// spot. × declines this one; the next place left off is a new offer. A list
// left near its top is nothing to pick up, and a step back from a customer
// already lands on the spot, so no pill then.
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
  // Sixty owners from a file, all still to contact.
  const leads = Array.from({ length: 60 }, (_, i) => ({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), stage: "delivered", vehicleInterest: "2021 Nissan Rogue SV", currentPayment: 400 + i, purchaseDate: "2023-03-10", ...x }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector('[data-filter="all"]', { timeout: 20000 });

const state = () => p.evaluate(() => {
  const pill = document.querySelector(".resume-pill");
  // Shown means drawn: an attribute the stylesheet ignores is no use.
  const drawn = pill && getComputedStyle(pill).display !== "none" && pill.getBoundingClientRect().width > 0;
  return {
    pill: drawn ? pill.textContent.replace(/\s+/g, " ").trim() : null,
    dot: !!drawn && !pill.textContent.trim(),
    chip: document.querySelector(".lead-seg .btn-primary")?.dataset.filter,
    dig: document.querySelector(".cut-chip.btn-primary[data-cut]")?.dataset.cut || null,
    top: document.getElementById("view").scrollTop,
    cards: document.querySelectorAll(".lead-list .swipe-card").length,
    kept: JSON.parse(localStorage.getItem("viniva:outreach:leftoff") || "null"),
  };
});
const scrollTo = (y) => p.evaluate((y) => { const v = document.getElementById("view"); v.scrollTop = y; v.dispatchEvent(new Event("scroll")); }, y);
const toHomeAndBack = async () => {
  await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(600);
};

// --- Nothing left off yet: no pill on a fresh visit.
let s = await state();
console.log("first visit:", JSON.stringify({ pill: s.pill, dot: s.dot, chip: s.chip }));
if (s.pill !== null || s.dot) fail("a pill (or an empty dot of one) showed before anywhere was left off: " + JSON.stringify({ pill: s.pill, dot: s.dot }));

// --- Scroll a long way down All, go to Home, come back: Outreach opens fresh
// on Best now, and the pill offers the place left off on All.
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
await p.waitForFunction(() => document.querySelectorAll(".lead-list .swipe-card").length >= 20, null, { timeout: 15000 }).catch(() => fail("the list didn't draw"));
await scrollTo(1800); await p.waitForTimeout(400);
s = await state();
console.log("scrolled on All:", JSON.stringify({ top: s.top, kept: s.kept && { filter: s.kept.filter, top: s.kept.top, shown: s.kept.shown } }));
if (!s.kept || s.kept.filter !== "all" || Math.abs(s.kept.top - 1800) > 2) fail("the place should be kept as you scroll: " + JSON.stringify(s.kept));
await toHomeAndBack();
s = await state();
console.log("back from Home:", JSON.stringify({ pill: s.pill, chip: s.chip, top: s.top }));
if (s.chip !== "tocontact" || s.top > 5) fail("a visit from Home should open fresh on Best now at the top: " + JSON.stringify(s));
if (!s.pill || !/Pick up where you left off · All/.test(s.pill)) fail("the pill should offer the place left off, naming the chip: " + JSON.stringify(s.pill));

// --- Tap it: All, the same cards back, the same scroll; the pill goes.
await p.click(".resume-pill"); await p.waitForTimeout(500);
s = await state();
console.log("tapped:", JSON.stringify({ pill: s.pill, chip: s.chip, top: s.top, cards: s.cards }));
if (s.chip !== "all" || Math.abs(s.top - 1800) > 40 || s.pill) fail("the pill should put All back and scroll to where you left off: " + JSON.stringify(s));

// --- Left near the top: nothing to pick up.
await scrollTo(0); await p.waitForTimeout(300);
await toHomeAndBack();
s = await state();
console.log("left at the top:", JSON.stringify({ pill: s.pill, kept: s.kept }));
if (s.pill || s.kept) fail("a list left at its top is nothing to pick up: " + JSON.stringify({ pill: s.pill, kept: s.kept }));

// --- A step back from a customer lands on the spot itself: no pill.
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
await scrollTo(1500); await p.waitForTimeout(300);
await p.evaluate(() => document.querySelectorAll(".lead-list .swipe-card")[12].click());
await p.waitForFunction(() => /^#\/leads\/o\d+$/.test(location.hash), null, { timeout: 5000 });
await p.waitForTimeout(300);
await p.goBack(); await p.waitForTimeout(800);
s = await state();
console.log("step back from a customer:", JSON.stringify({ pill: s.pill, chip: s.chip, top: s.top }));
if (s.chip !== "all" || Math.abs(s.top - 1500) > 40) fail("a step back should land on the spot: " + JSON.stringify(s));
if (s.pill) fail("no pill when the step back already landed on the spot");

// --- × declines this place; it stays declined until a new place is left off.
await toHomeAndBack();
s = await state();
if (!s.pill) fail("back from Home the pill should offer the place again: " + JSON.stringify(s));
await p.click(".resume-pill .resume-x"); await p.waitForTimeout(100);
if ((await state()).pill) fail("× should hide the pill");
await toHomeAndBack();
s = await state();
console.log("after ×, back again:", JSON.stringify({ pill: s.pill }));
if (s.pill) fail("the place declined shouldn't be offered again: " + s.pill);
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
await scrollTo(2200); await p.waitForTimeout(400);
await toHomeAndBack();
s = await state();
if (!s.pill) fail("a new place left off is a new offer");

// --- The cut comes back with the place. Owners all quiet: the Quiet cut
// on All, scrolled, left, and picked up again lights the cut and lands.
await p.click(".resume-pill"); await p.waitForTimeout(400);
await p.click('.cut-chip[data-cut="quiet"]'); await p.waitForTimeout(400);
await scrollTo(1200); await p.waitForTimeout(400);
s = await state();
if (s.dig !== "quiet" || !s.kept || !(s.kept.cuts || []).includes("quiet")) fail("the cut should be kept with the place: " + JSON.stringify({ dig: s.dig, kept: s.kept }));
await toHomeAndBack();
s = await state();
console.log("fresh again:", JSON.stringify({ pill: s.pill, chip: s.chip, dig: s.dig }));
if (s.dig) fail("a fresh visit shouldn't carry the cut");
await p.click(".resume-pill"); await p.waitForTimeout(500);
s = await state();
console.log("picked up with the cut:", JSON.stringify({ chip: s.chip, dig: s.dig, top: s.top }));
if (s.chip !== "all" || s.dig !== "quiet" || Math.abs(s.top - 1200) > 40) fail("picking up should bring back the chip, the cut and the place: " + JSON.stringify(s));

// --- Reaching the place yourself takes the offer away.
await scrollTo(0); await p.waitForTimeout(300);
await scrollTo(900); await p.waitForTimeout(400);
await toHomeAndBack();
await p.click('[data-filter="all"]'); await p.waitForTimeout(300);
await p.click('.cut-chip[data-cut="quiet"]'); await p.waitForTimeout(300);
if (!(await state()).pill) fail("the pill should still show on the way there");
await scrollTo(950); await p.waitForTimeout(300);
s = await state();
console.log("got there yourself:", JSON.stringify({ pill: s.pill, top: s.top }));
if (s.pill) fail("at the place already, there's nothing to offer: " + s.pill);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nresume.test.js FAILED" : "\nresume.test.js passed");
})();
