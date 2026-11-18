// The bookmark on Outreach: swipe a card right and that place is kept —
// the card marked, the chip and cut remembered — and Outreach opens there
// next time, the card in view. Swipe it again and it's gone; swipe another
// and it moves.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", hasTouch: false })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import" };
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2021 Nissan Kicks SR"];
  const leads = [];
  for (let i = 0; i < 40; i++) leads.push({ id: "o" + String(i).padStart(2, "0"), name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 4],
    currentPayment: 380 + i * 3, payoff: 12000 + i * 100, currentValue: 20000 + i * 100, purchaseDate: "2021-03-10", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x, status: "available" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, dailyProspects: 6, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 150 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".cut-row", { timeout: 30000 }).catch(() => fail("Outreach didn't open"));
await p.click('[data-filter="all"]'); await p.waitForTimeout(500);

// Scroll down so the list has drawn a good way, then swipe the 18th card right.
const target = await p.evaluate(async () => {
  const view = document.getElementById("view") || document.scrollingElement;
  for (let i = 0; i < 6; i++) { view.scrollTop += 900; await new Promise((r) => setTimeout(r, 250)); }
  const cards = [...document.querySelectorAll(".lead-list .card[data-lead-id]")];
  const c = cards[Math.min(17, cards.length - 1)];
  c.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 200));
  const r = c.getBoundingClientRect();
  return { id: c.dataset.leadId, x: r.left + 40, y: r.top + r.height / 2, drawn: cards.length };
});
console.log("target:", JSON.stringify(target));
if (!target.id || target.drawn < 18) fail("the list should have drawn past the 18th card: " + JSON.stringify(target));
const swipeRight = async (x, y) => { await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(x + i * 16, y + 1); await p.waitForTimeout(16); } await p.mouse.up(); await p.waitForTimeout(400); };
await swipeRight(target.x, target.y);
let st = await p.evaluate(async (id) => { const s = await import("/js/store.js"); const b = s.getSettings().outreachBookmark; const c = document.querySelector(`.card[data-lead-id="${id}"]`); return { bm: b && { leadId: b.leadId, filter: b.filter }, marked: !!(c && c.classList.contains("lc-marked")), ribbon: !!(c && c.querySelector(".lc-bookmark")) }; }, target.id);
console.log("after swipe:", JSON.stringify(st));
if (!st.bm || st.bm.leadId !== target.id || st.bm.filter !== "all" || !st.marked || !st.ribbon) fail("a right swipe bookmarks the card under the chip it's on: " + JSON.stringify(st));

// Leave for Inventory and come back fresh: Outreach opens on All with the card in view.
await p.evaluate(() => { location.hash = "#/inventory"; }); await p.waitForTimeout(500);
await p.evaluate(() => { localStorage.setItem("viniva:leads-filter", "tocontact"); location.hash = "#/leads"; }); await p.waitForTimeout(1400);
const landed = await p.evaluate((id) => {
  const c = document.querySelector(`.card[data-lead-id="${id}"]`);
  const r = c && c.getBoundingClientRect();
  const chip = document.querySelector('[data-filter].btn-primary')?.dataset.filter;
  return { chip, there: !!c, inView: !!(r && r.top >= 0 && r.bottom <= window.innerHeight + 2), top: r && Math.round(r.top), marked: !!(c && c.classList.contains("lc-marked")) };
}, target.id);
console.log("landed:", JSON.stringify(landed));
if (landed.chip !== "all" || !landed.there || !landed.inView || !landed.marked) fail("Outreach should open on the bookmark, its chip lit and the card in view: " + JSON.stringify(landed));

// Swipe another card right: the bookmark moves. Swipe it again: gone.
const other = await p.evaluate((id) => { const cards = [...document.querySelectorAll(".lead-list .card[data-lead-id]")].filter((c) => c.dataset.leadId !== id); const c = cards.find((x) => { const r = x.getBoundingClientRect(); return r.top > 60 && r.bottom < window.innerHeight - 120; }) || cards[0]; c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { id: c.dataset.leadId, x: r.left + 40, y: r.top + r.height / 2 }; }, target.id);
await p.waitForTimeout(200);
await swipeRight(other.x, other.y);
st = await p.evaluate(async (ids) => { const s = await import("/js/store.js"); const b = s.getSettings().outreachBookmark; return { bm: b && b.leadId, oldMarked: !!document.querySelector(`.card[data-lead-id="${ids[0]}"].lc-marked`), newMarked: !!document.querySelector(`.card[data-lead-id="${ids[1]}"].lc-marked`) }; }, [target.id, other.id]);
console.log("moved:", JSON.stringify(st));
if (st.bm !== other.id || st.oldMarked || !st.newMarked) fail("swiping another card moves the bookmark: " + JSON.stringify(st));
const again = await p.evaluate((id) => { const c = document.querySelector(`.card[data-lead-id="${id}"]`); c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; }, other.id);
await p.waitForTimeout(200);
await swipeRight(again.x, again.y);
st = await p.evaluate(async (id) => { const s = await import("/js/store.js"); return { bm: s.getSettings().outreachBookmark, marked: !!document.querySelector(`.card[data-lead-id="${id}"].lc-marked`) }; }, other.id);
if (st.bm || st.marked) fail("swiping the bookmarked card again takes the bookmark off: " + JSON.stringify(st));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nbookmark.test.js FAILED" : "\nbookmark.test.js passed");
})();
