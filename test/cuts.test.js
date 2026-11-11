// Outreach as a mining tool. Best now opens on today's batch — the handful
// the book brings up each morning, fresh every day, nobody twice in three
// weeks — with a count against the day and the next handful on tap; the
// rest of the book sits under its reasons beneath. Under the four chips one
// Cut row: the book's own vehicles first, then the reasons, any number on
// at once (AND-ed) each with the count it would leave; More… for ranges; a
// cut can be saved as a named list, called as a session or blasted. An
// order select beside the search; a hygiene line for the people with no
// number. The list card is laid out like the customer's page.
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
    currentPayment: 380 + i * 5, payoff: 12000 + i * 100, currentValue: i % 2 === 0 ? 20000 + i * 100 : 11000, currentApr: i % 5 === 0 ? 11.9 : 5.9, currentTerm: 84,
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
  chips: [...document.querySelectorAll(".lead-seg [data-filter]")].map((c) => c.dataset.filter),
  cuts: [...document.querySelectorAll(".cut-row .cut-chip")].map((c) => ({ key: c.dataset.cut || c.dataset.list || "more", text: c.textContent.replace(/\s+/g, " ").trim(), on: c.classList.contains("btn-primary"), kind: [...c.classList].find((k) => /^cut-(vehicle|reason|list|more)$/.test(k)) })),
  bar2: document.querySelector(".cut-bar")?.textContent.replace(/\s+/g, " ").trim() || null,
  hygiene: document.querySelector(".lead-hygiene")?.textContent.replace(/\s+/g, " ").trim() || null,
  sort: document.querySelector('[data-act="sort"]')?.dataset.sort,
}));

// --- Day one: ten picks, all new, the rest of the book under them, nobody twice.
let t = await read();
console.log("today:", JSON.stringify({ head: t.head, sub: t.sub, more: t.more, picks: t.picks.length, fresh: t.fresh, rest: t.rest }));
if (t.head !== "Today's 10 · 0 tried · 0 spoken with" || t.picks.length !== 10 || t.fresh !== 10) fail("the day should open on ten fresh picks: " + JSON.stringify(t));
if (!/10 to go/.test(t.sub || "") || !/more behind them/.test(t.sub || "") || !/never spoken with/.test(t.sub || "")) fail("the line should say what's left, what's behind and how many have never been spoken with: " + t.sub);
if (!/The rest of the book/.test(t.rest || "")) fail("the rest of the book should sit under the batch: " + t.rest);
if (t.picks.some((id) => t.restCards.includes(id))) fail("a pick is listed twice");
const stamped = await p.evaluate(async () => { const s = await import("/js/store.js"); return s.all("leads").filter((l) => l.lastProspectedAt && l.firstProspectedAt).length; });
if (stamped !== 10) fail("the picks should be stamped as surfaced, first time and all: " + stamped);

// --- Four chips, the order select, and the Cut row: the vehicles first,
// then the reasons with their counts; no Timing chip, no "Reached out",
// no "No number" on the row.
console.log("chips:", JSON.stringify(t.chips), "sort:", t.sort);
console.log("cuts:", JSON.stringify(t.cuts.map((c) => `${c.kind}:${c.text}`)));
if (t.chips.join() !== "tocontact,due,contacted,all") fail("four work-state chips: " + JSON.stringify(t.chips));
if (t.sort !== "best") fail("the order should start on Best first: " + t.sort);
const kinds = t.cuts.map((c) => c.kind);
if (kinds[0] !== "cut-vehicle" || kinds.indexOf("cut-reason") < kinds.lastIndexOf("cut-vehicle") || kinds.includes("cut-more")) fail("the row should run vehicles, then reasons: " + JSON.stringify(kinds));
const tools = await p.evaluate(() => ({ sort: !!document.querySelector('.lead-seg [data-act="sort"]'), filter: !!document.querySelector('.cut-line > [data-act="audience"]'), w: document.querySelector('.lead-seg [data-act="sort"]')?.getBoundingClientRect().width }));
if (!tools.sort || !tools.filter || !(tools.w < 48)) fail("a small sort button on the chips row and a small filter button at the head of the Cut row: " + JSON.stringify(tools));
const texts = t.cuts.map((c) => c.text);
if (!texts.some((x) => /^Rogue \d+$/.test(x)) || !texts.some((x) => /^SUVs \d+$/.test(x)) || !texts.some((x) => /^Trucks \d+$/.test(x))) fail("the book's vehicles should be cuts, with counts: " + JSON.stringify(texts));
if (!texts.some((x) => /^Equity \d+$/.test(x)) || !texts.some((x) => /^Owned 3\+ yrs \d+$/.test(x))) fail("the reasons should be cuts with counts: " + JSON.stringify(texts));
if (texts.some((x) => /Reached out|No number/.test(x))) fail("Reached out and No number don't belong on the row: " + JSON.stringify(texts));
if (!/2 with no number/.test(t.hygiene || "")) fail("the two without a number are a line on Best now too: " + t.hygiene);

// --- Reaching one from its tray moves the count at once; on the next draw it
// has left the batch (it's on Contacted now).
const first = t.picks[0];
await p.evaluate((id) => { const w = document.querySelector(`.today-list .swipe-card[data-lead-id="${id}"]`).closest(".swipe-wrap"); const tap = (label) => [...w.querySelectorAll(".swipe-act")].find((x) => x.textContent.trim() === label).click(); tap("Contacted"); setTimeout(() => { tap("Call"); setTimeout(() => tap("Spoke"), 50); }, 50); }, first);
await p.waitForTimeout(600);
t = await read();
if (t.head !== "Today's 10 · 1 tried · 1 spoken with" || t.bar !== "10%") fail("a conversation should count against the day at once: " + JSON.stringify({ head: t.head, bar: t.bar }));
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(900);
t = await read();
if (t.picks.length !== 9 || t.picks.includes(first)) fail("the one reached should have left the batch: " + JSON.stringify(t.picks));

// --- Ten more: the next in line, stamped, none repeated.
await p.click('[data-act="more-today"]'); await p.waitForTimeout(700);
t = await read();
if (t.head !== "Today's 20 · 1 tried · 1 spoken with" || t.picks.length !== 19 || new Set(t.picks).size !== 19) fail("ten more should extend the day's batch without repeats: " + JSON.stringify({ head: t.head, picks: t.picks.length }));

// --- Cuts AND together: Equity, then High rate on top; every card
// carries both; the counts narrow; the bar says what and offers what to do.
await p.click('.cut-chip[data-cut="equity"]'); await p.waitForTimeout(500);
let c = await read();
const eqOn = c.cuts.find((x) => x.key === "equity");
console.log("equity on:", JSON.stringify({ bar: c.bar2, today: !!c.head, on: eqOn && eqOn.on }));
if (!eqOn || !eqOn.on || c.head) fail("a cut on should light its chip and set the batch aside: " + JSON.stringify({ eqOn, head: c.head }));
if (!/match · Equity/.test(c.bar2 || "") || !/Call/.test(c.bar2) || !/Save/.test(c.bar2)) fail("the bar should say the cut and offer Call and Save: " + c.bar2);
const eqN = Number((c.bar2.match(/^(\d+) match/) || [])[1]);
// Search combines.
await p.fill(".searchbar input", "Owner 0"); await p.waitForTimeout(400);
const searched = await p.evaluate(() => [...document.querySelectorAll(".lead-list .swipe-card .row-title")].map((n) => n.textContent.trim()));
if (!searched.length || !searched.every((n) => /^Owner 0/.test(n))) fail("the cuts should combine with the search: " + JSON.stringify(searched));
await p.fill(".searchbar input", ""); await p.waitForTimeout(300);
await p.click('.cut-chip[data-cut="rate"]'); await p.waitForTimeout(500);
c = await read();
const both = await p.evaluate(() => [...document.querySelectorAll(".lead-list .swipe-card")].map((x) => x.querySelector(".row-reasons")?.textContent || ""));
const bothN = Number((c.bar2.match(/^(\d+) match/) || [])[1]);
console.log("equity + rate:", JSON.stringify({ bar: c.bar2, n: both.length }));
if (!/Equity · High rate/.test(c.bar2 || "") || !(bothN < eqN) || !both.length) fail("two cuts should AND, narrowing the list: " + JSON.stringify({ bar: c.bar2, eqN, bothN }));
if (!both.every((r) => /equity|Paid off/i.test(r) && /%|Rate/.test(r))) fail("under both cuts every card should carry both reasons: " + JSON.stringify(both.slice(0, 3)));
const rateChip = c.cuts.find((x) => x.key === "rate");
if (!rateChip || !rateChip.on || rateChip.text !== `High rate ${bothN}`) fail("a cut on carries the count it leaves: " + JSON.stringify(rateChip));

// --- Save as a list: a named chip at the front of the row; × clears the
// cuts; the chip brings them back; the bar names the list; Forget removes it.
await p.click('[data-act="list-save"]'); await p.waitForSelector('.modal [name="name"]', { timeout: 5000 });
await p.fill('.modal [name="name"]', "Equity at a high rate");
await p.click('.modal button[type="submit"]'); await p.waitForTimeout(500);
c = await read();
const listChip = c.cuts.find((x) => x.kind === "cut-list");
console.log("saved:", JSON.stringify({ chip: listChip, bar: c.bar2 }));
if (!listChip || !listChip.on || listChip.text !== "Equity at a high rate" || c.cuts[0].kind !== "cut-list") fail("a saved list should be a lit chip at the front: " + JSON.stringify(c.cuts.slice(0, 2)));
if (!/match · Equity at a high rate/.test(c.bar2 || "")) fail("the bar should name the list: " + c.bar2);
await p.click('.cut-bar [data-act="aud-clear"]'); await p.waitForTimeout(500);
c = await read();
if (c.bar2 || c.cuts.some((x) => x.on) || !c.head) fail("× should clear every cut and bring the batch back: " + JSON.stringify({ bar: c.bar2, on: c.cuts.filter((x) => x.on) }));
await p.click(".cut-chip.cut-list"); await p.waitForTimeout(500);
c = await read();
if (!(c.cuts.find((x) => x.key === "equity") || {}).on || !(c.cuts.find((x) => x.key === "rate") || {}).on) fail("the list chip should bring its cuts back: " + JSON.stringify(c.cuts.filter((x) => x.on)));
if (!/match · Equity at a high rate/.test(c.bar2 || "") || !/Call/.test(c.bar2)) fail("the list's bar: " + c.bar2);

// --- Call these: a session over the cut's people, not today's batch.
await p.click('[data-act="cut-call"]'); await p.waitForTimeout(800);
const sess = await p.evaluate(async () => { const s = await import("/js/session.js"); const cur = s.currentSession(); return { hash: location.hash, kind: cur && cur.kind, name: cur && cur.name, n: cur && cur.ids.length, card: !!document.querySelector(".cs-card") }; });
console.log("call these:", JSON.stringify(sess));
if (sess.hash !== "#/session" || sess.kind !== "list" || sess.n !== bothN || !sess.card) fail("Call these should open a session over the cut: " + JSON.stringify(sess));
await p.evaluate(async () => { (await import("/js/session.js")).endSession(); });
await p.goBack(); await p.waitForTimeout(800);
c = await read();
if (!/Equity at a high rate/.test(c.bar2 || "")) fail("stepping back should land on the list: " + c.bar2);

// --- Text these: Mass outreach gets the cut's people themselves.
await p.click('.cut-bar [data-act="aud-text"]'); await p.waitForTimeout(900);
// (Consent can keep someone out of a text — they're counted as left out,
// not texted; nobody outside the cut is in either way.)
const mo = await p.evaluate(() => ({ hash: location.hash, line: [...document.querySelectorAll(".strong")].map((n) => n.textContent.trim()).find((x) => /will be texted/.test(x)) || null, out: (document.body.textContent.match(/(\d+) left out/) || [])[1] || "0" }));
console.log("text these:", JSON.stringify(mo));
const texted = Number((mo.line || "").match(/^(\d+) will be texted/)?.[1] ?? -1);
if (mo.hash !== "#/outreach" || texted < 0 || texted + Number(mo.out) !== bothN) fail("Text these should carry the cut's people and nobody else: " + JSON.stringify({ mo, bothN }));
await p.goBack(); await p.waitForTimeout(800);

// --- Forget the list.
await p.click('.cut-bar [data-act="list-forget"]'); await p.waitForTimeout(500);
c = await read();
if (c.cuts.some((x) => x.kind === "cut-list")) fail("Forget should take the list chip off the row");

// --- A vehicle cut: Sentra owners, every card a Sentra.
await p.click('.cut-bar [data-act="aud-clear"]').catch(() => {}); await p.waitForTimeout(300);
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
const sentraChip = await p.evaluate(() => [...document.querySelectorAll(".cut-row .cut-chip")].find((x) => /^Sentra /.test(x.textContent.trim()))?.dataset.cut);
await p.click(`.cut-chip[data-cut="${sentraChip}"]`); await p.waitForTimeout(500);
const sentras = await p.evaluate(() => [...document.querySelectorAll(".lead-list .swipe-card .row-sub")].map((n) => n.textContent));
if (!sentras.length || !sentras.every((v) => /Sentra/.test(v))) fail("the Sentra cut should leave only Sentras: " + JSON.stringify(sentras.slice(0, 3)));
await p.click(`.cut-chip[data-cut="${sentraChip}"]`); await p.waitForTimeout(400);

// --- The order: Soonest window puts the windowed people first with the
// month on each; Longest quiet puts the never-contacted first.
const setSort = async (v) => { await p.click('[data-act="sort"]'); await p.waitForSelector(`.modal [data-sort-pick="${v}"]`, { timeout: 5000 }); await p.click(`.modal [data-sort-pick="${v}"]`); };
await setSort("timing"); await p.waitForTimeout(900);
const timing = await p.evaluate(() => ({ hz: document.querySelectorAll(".lead-list .hz-line").length, firstHz: !!document.querySelector(".lead-list .swipe-card .hz-line"), summary: document.querySelector(".lead-summary")?.textContent || "" }));
console.log("soonest window:", JSON.stringify(timing));
if (!timing.hz || !timing.firstHz || !/ready now/.test(timing.summary)) fail("the timing order should show windows, soonest first: " + JSON.stringify(timing));
await setSort("quiet"); await p.waitForTimeout(500);
// (The list is windowed, so the reached one may not be drawn yet — but
// they're never near the top.)
const quiet = await p.evaluate(async () => { const st = await import("/js/store.js"); const ids = [...document.querySelectorAll(".lead-list .swipe-card")].map((c) => c.dataset.leadId); return { firstContacted: !!st.get("leads", ids[0]).lastContacted, contactedAt: ids.findIndex((id) => !!st.get("leads", id).lastContacted), n: ids.length }; });
if (quiet.firstContacted || (quiet.contactedAt >= 0 && quiet.contactedAt < quiet.n - 1)) fail("longest quiet: the never-contacted first, the reached last: " + JSON.stringify(quiet));
await setSort("rate"); await p.waitForTimeout(500);
const rates = await p.evaluate(async () => { const st = await import("/js/store.js"); return [...document.querySelectorAll(".lead-list .swipe-card")].map((c) => st.get("leads", c.dataset.leadId).currentApr ?? null); });
const known = rates.filter((x) => x != null);
console.log("highest rate:", JSON.stringify(rates.slice(0, 6)));
if (known.length < 2 || known.some((x, i) => i && Number(x) > Number(known[i - 1])) || rates.findIndex((x) => x == null) >= 0 && rates.findIndex((x) => x == null) < known.length) fail("highest rate should run high to low with no-rate last: " + JSON.stringify(rates.slice(0, 8)));
await setSort("best"); await p.waitForTimeout(400);

// --- Hygiene: on All, the two with no number are a line with a fix; Fix
// shows them, and the bar says so.
c = await read();
console.log("hygiene:", c.hygiene);
if (!/2 with no number/.test(c.hygiene || "")) fail("All should say who can't be called: " + c.hygiene);
await p.click('[data-act="fix-numbers"]'); await p.waitForTimeout(500);
const nonum = await p.evaluate(() => [...document.querySelectorAll(".lead-list .swipe-card .row-title")].map((n) => n.textContent.trim()).sort());
c = await read();
if (nonum.join() !== "Nonum One,Nonum Two" || !/2 match · No number/.test(c.bar2 || "")) fail("Fix should list exactly the two without a number: " + JSON.stringify({ nonum, bar: c.bar2 }));
const acts = await p.evaluate(() => [...document.querySelectorAll(".lead-list .lc-act")].map((b) => b.textContent.trim()));
if (!acts.every((a) => /Add number/.test(a))) fail("their action should be adding the number: " + JSON.stringify(acts));

// --- The card: name and verdict, reasons as pills, the contact line with
// the action, the contract across the foot.
await p.click('.cut-bar [data-act="aud-clear"]'); await p.waitForTimeout(500);
const card = await p.evaluate(() => { const el = document.querySelector('.lead-list .swipe-card[data-lead-id="o1"]') || document.querySelector(".lead-list .swipe-card"); return { pills: el.querySelectorAll(".lc-why li").length, caution: el.querySelectorAll(".lc-why li.lc-caution").length, foot: !!el.querySelector(".lc-foot .lc-act"), contact: (el.querySelector(".lc-foot .row-contact") || el.querySelector(".lc-foot .lc-none"))?.textContent.trim(), banner: el.querySelector(".contract-banner.lc-contract")?.textContent.replace(/\s+/g, " ").trim() || null, tier: el.querySelector(".row-meta .badge")?.textContent.trim() || null }; });
console.log("card:", JSON.stringify(card));
if (!card.pills || !card.foot || !card.contact || !card.banner || !/Payment/.test(card.banner) || !/Payments left/.test(card.banner)) fail("the card should be laid out like the customer's page: " + JSON.stringify(card));

// --- Tomorrow: a new batch, none of today's (three-week cooldown).
t = await read();
const todays = t.picks.slice();
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("viniva:prospects")); s.day = "2000-01-01"; localStorage.setItem("viniva:prospects", JSON.stringify(s)); });
await p.click('[data-filter="tocontact"]'); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(900);
t = await read();
console.log("next day:", JSON.stringify({ head: t.head, picks: t.picks.length, repeats: t.picks.filter((id) => todays.includes(id)).length }));
if (t.picks.length < 1 || t.picks.some((id) => todays.includes(id))) fail("the next day should bring up new people, none of yesterday's: " + JSON.stringify(t.picks));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncuts.test.js FAILED" : "\ncuts.test.js passed");
})();
