// Outreach as a mining tool. Best now opens on today's batch — the handful
// the book brings up each morning, fresh every day, nobody twice in three
// weeks — with a count against the day and the next handful on tap; the
// rest of the book sits under its reasons beneath. A Dig row cuts any chip
// by what the read found (equity, a contract ending, years in the car,
// silence…), each with its count, and combines with the search.
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
  // Forty owners with the makings of a reason each: a payment, a payoff and a
  // value (equity for the even ones), years in the car, a lease end for a few.
  const leads = [];
  for (let i = 0; i < 40; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 6],
    currentPayment: 380 + i * 5, payoff: 12000 + i * 100, currentValue: i % 2 === 0 ? 20000 + i * 100 : 11000, currentApr: i % 5 === 0 ? 11.9 : 5.9,
    purchaseDate: i % 3 === 0 ? "2020-03-10" : "2024-03-10", ...(i % 8 === 0 ? { leaseEnd: new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 10) } : {}), ...x });
  // Two with no number, and one reached long ago.
  leads.push({ id: "nn1", name: "Nonum One", vehicleInterest: models[0], currentPayment: 400, payoff: 9000, currentValue: 16000, purchaseDate: "2021-01-01", ...x });
  leads.push({ id: "nn2", name: "Nonum Two", vehicleInterest: models[1], currentPayment: 420, payoff: 9000, currentValue: 16000, purchaseDate: "2021-01-01", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [
    { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x },
    { id: "v2", year: 2026, make: "Nissan", model: "Kicks", trim: "SR", price: 29900, stock: "N2", condition: "new", ...x },
  ], settings: { salesperson: "Parm", cloudAutoSync: false, dailyProspects: 10, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 150 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".today-block", { timeout: 30000 }).catch(() => fail("Best now didn't open on today's batch"));
await p.waitForTimeout(800);

const read = () => p.evaluate(() => ({
  head: document.querySelector(".today-block .strong")?.textContent.trim(),
  sub: document.querySelector(".today-block .small")?.textContent.trim(),
  bar: document.querySelector(".today-block .today-bar > span")?.style.width,
  more: document.querySelector('[data-act="more-today"]')?.textContent.trim() || null,
  picks: [...document.querySelectorAll(".today-list .swipe-card")].map((c) => c.dataset.leadId),
  fresh: document.querySelectorAll(".today-list .badge-new").length,
  rest: document.querySelector(".today-rest")?.textContent.replace(/\s+/g, " ").trim() || null,
  restCards: [...document.querySelectorAll(".lead-list .swipe-card")].map((c) => c.dataset.leadId).filter((id) => ![...document.querySelectorAll(".today-list .swipe-card")].map((c) => c.dataset.leadId).includes(id)),
  digs: [...document.querySelectorAll(".dig-chip")].map((c) => c.textContent.replace(/\s+/g, " ").trim()),
}));

// --- Day one: ten picks, all new, the rest of the book under them, nobody twice.
let t = await read();
console.log("today:", JSON.stringify({ head: t.head, sub: t.sub, more: t.more, picks: t.picks.length, fresh: t.fresh, rest: t.rest, digs: t.digs }));
if (t.head !== "Today's 10 · 0 reached" || t.picks.length !== 10 || t.fresh !== 10) fail("the day should open on ten fresh picks: " + JSON.stringify(t));
if (!/10 to go/.test(t.sub || "") || !/more ready behind them/.test(t.sub || "")) fail("the line should say what's left and what's behind: " + t.sub);
if (!/The rest of the book/.test(t.rest || "")) fail("the rest of the book should sit under the batch: " + t.rest);
if (t.picks.some((id) => t.restCards.includes(id))) fail("a pick is listed twice");
const stamped = await p.evaluate(async () => { const s = await import("/js/store.js"); return s.all("leads").filter((l) => l.lastProspectedAt && l.firstProspectedAt).length; });
if (stamped !== 10) fail("the picks should be stamped as surfaced, first time and all: " + stamped);

// --- Reaching one from its tray moves the count at once; on the next draw it
// has left the batch (it's on Contacted now).
const first = t.picks[0];
await p.evaluate((id) => { const w = document.querySelector(`.today-list .swipe-card[data-lead-id="${id}"]`).closest(".swipe-wrap"); const tap = (label) => [...w.querySelectorAll(".swipe-act")].find((x) => x.textContent.trim() === label).click(); tap("Contacted"); setTimeout(() => { tap("Call"); setTimeout(() => tap("Spoke"), 50); }, 50); }, first);
await p.waitForTimeout(600);
t = await read();
console.log("after one reached:", JSON.stringify({ head: t.head, bar: t.bar, picks: t.picks.length }));
if (t.head !== "Today's 10 · 1 reached" || t.bar !== "10%") fail("a contact should count against the day at once: " + JSON.stringify(t));
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(900);
t = await read();
if (t.picks.length !== 9 || t.picks.includes(first)) fail("the one reached should have left the batch: " + JSON.stringify(t.picks));

// --- Ten more: the next in line, stamped, none repeated.
await p.click('[data-act="more-today"]');
await p.waitForTimeout(700);
t = await read();
console.log("ten more:", JSON.stringify({ head: t.head, picks: t.picks.length }));
if (t.head !== "Today's 20 · 1 reached" || t.picks.length !== 19 || new Set(t.picks).size !== 19) fail("ten more should extend the day's batch without repeats: " + JSON.stringify(t));

// --- Tomorrow: a new batch, none of today's (three-week cooldown).
const todays = t.picks.slice();
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("viniva:prospects")); s.day = "2000-01-01"; localStorage.setItem("viniva:prospects", JSON.stringify(s)); });
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(900);
t = await read();
console.log("next day:", JSON.stringify({ head: t.head, picks: t.picks.length, repeats: t.picks.filter((id) => todays.includes(id)).length }));
if (t.picks.length < 1 || t.picks.some((id) => todays.includes(id))) fail("the next day should bring up new people, none of yesterday's: " + JSON.stringify(t));

// --- Dig: the cuts with their counts; one on narrows the list to people with that reason; off again clears.
if (!t.digs.some((d) => /^Equity \d+/.test(d)) || !t.digs.some((d) => /^Owned 3\+ yrs \d+/.test(d)) || !t.digs.some((d) => /^No number 2$/.test(d))) fail("the dig row should offer the cuts with counts: " + JSON.stringify(t.digs));
await p.click('.dig-chip[data-dig="equity"]'); await p.waitForTimeout(600);
const dug = await p.evaluate(() => ({
  on: document.querySelector('.dig-chip[data-dig="equity"]')?.getAttribute("aria-pressed"),
  today: !!document.querySelector(".today-block"),
  cards: [...document.querySelectorAll(".lead-list .swipe-card")].map((c) => c.querySelector(".row-reasons")?.textContent || ""),
}));
console.log("dig equity:", JSON.stringify({ on: dug.on, today: dug.today, n: dug.cards.length, sample: dug.cards[0] }));
if (dug.on !== "true" || dug.today) fail("a dig on should light its chip and set the batch aside: " + JSON.stringify(dug));
if (!dug.cards.length || !dug.cards.every((r) => /equity|Paid off/i.test(r))) fail("under Equity every card should carry an equity reason: " + JSON.stringify(dug.cards.slice(0, 3)));
await p.fill(".searchbar input", "Owner 0"); await p.waitForTimeout(400);
const both = await p.evaluate(() => [...document.querySelectorAll(".lead-list .swipe-card .row-title")].map((n) => n.textContent.trim()));
if (!both.length || !both.every((n) => /^Owner 0/.test(n))) fail("the dig should combine with the search: " + JSON.stringify(both));
await p.fill(".searchbar input", ""); await p.waitForTimeout(300);
await p.click('.dig-chip[data-dig="equity"]'); await p.waitForTimeout(500);
const cleared = await p.evaluate(() => ({ on: document.querySelector('.dig-chip[data-dig="equity"]')?.getAttribute("aria-pressed"), today: !!document.querySelector(".today-block") }));
if (cleared.on !== "false" || !cleared.today) fail("tapping the chip again should clear the dig and bring the batch back: " + JSON.stringify(cleared));
// The No number cut finds the two without a phone, on All.
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
await p.click('.dig-chip[data-dig="nonumber"]'); await p.waitForTimeout(500);
const nonum = await p.evaluate(() => [...document.querySelectorAll(".lead-list .swipe-card .row-title")].map((n) => n.textContent.trim()).sort());
if (nonum.join() !== "Nonum One,Nonum Two") fail("No number should find exactly the two without a phone: " + JSON.stringify(nonum));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndig.test.js FAILED" : "\ndig.test.js passed");
})();
