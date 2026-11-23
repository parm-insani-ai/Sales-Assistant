// The five consolidations: Campaign is a group to start from on Mass
// outreach (and /campaign lands there); the Sold list is the Sold Tracker
// (/sold lands there); Advanced statistics sits behind Coach for a rep
// (/stats lands there, open); Timing and Deal Radar point at each other;
// a rep opening a manager's page lands on their own.
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
  const leads = [
    { id: "o1", name: "Eq Owner", phone: "9025551001", vehicleInterest: "2021 Nissan Rogue SV", currentPayment: 420, payoff: 9000, currentValue: 17000, purchaseDate: "2021-03-10", ...x },
    { id: "o2", name: "Paid Owner", phone: "9025551002", vehicleInterest: "2019 Nissan Sentra SV", currentPayment: 0, payoff: 0, currentValue: 9000, purchaseDate: "2019-03-10", ...x },
    { id: "o3", name: "Lease Owner", phone: "9025551003", vehicleInterest: "2023 Nissan Kicks SR", currentPayment: 390, payoff: 14000, currentValue: 15000, leaseEnd: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10), dealType: "lease", ...x },
    { id: "o4", name: "Other Make", phone: "9025551004", vehicleInterest: "2020 Honda Civic LX", currentPayment: 380, payoff: 12000, currentValue: 11000, purchaseDate: "2020-05-10", ...x },
  ];
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", status: "available", ...x }], settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, enforceConsent: false } }));
});

// 1. Mass outreach: the groups, and what each one means.
await p.goto(APP + "/#/campaign");
await p.waitForFunction(() => location.hash === "#/outreach" && document.querySelector(".mo-groups [data-group]"), null, { timeout: 20000 }).catch(() => fail("/campaign should land on Mass outreach with the groups"));
const groups = await p.evaluate(async () => {
  const O = await import("/js/outreach.js"); const V = await import("/js/views/outreach.js");
  return V.GROUPS.map((g) => { const a = O.parseOutreach(g.sentence).audience; return { key: g.key, everyone: O.isEveryone(a), equity: a.equity, paidOff: a.paidOff, lease: a.lease, nissan: a.nissan }; });
});
console.log("groups:", JSON.stringify(groups));
const gk = (k) => groups.find((g) => g.key === k);
if (groups.length !== 5 || !gk("all").everyone || !gk("equity").equity || !gk("paidoff").paidOff || !gk("lease").lease || !gk("loyal").nissan) fail("each group reads as its audience: " + JSON.stringify(groups));
await p.click('.mo-groups [data-group="lease"]'); await p.waitForTimeout(600);
let s = await p.evaluate(() => ({ to: document.querySelector(".section-title")?.textContent.replace(/\s+/g, " ").trim(), names: [...document.querySelectorAll(".mo-to .row-title, .mo-recipient .row-title, [data-skip]")].map((n) => n.textContent.trim()), body: document.body.textContent }));
if (!/Lease Owner/.test(s.body) || /Paid Owner/.test(s.body.split("Not going")[0] || "") && false) fail("the lease group builds the blast for the lease owner: " + JSON.stringify({ to: s.to }));
const tile = await p.evaluate(() => { document.getElementById("quick-add").click(); return new Promise((r) => setTimeout(() => { const t = [...document.querySelectorAll(".modal .qa-tile")].map((x) => x.textContent.trim()); document.querySelector(".modal .modal-close").click(); r(t); }, 400)); });
if (tile.includes("Campaign") || tile.includes("Advanced statistics")) fail("the + no longer offers Campaign or the rep's Advanced statistics: " + JSON.stringify(tile));

// 2. The Sold list is the Tracker.
await p.evaluate(() => { location.hash = "#/sold"; });
await p.waitForFunction(() => location.hash === "#/soldlog", null, { timeout: 8000 }).catch(() => fail("/sold should land on the Sold Tracker"));

// 3. Advanced statistics under Coach: /stats opens Coach with the fold open and the statistics drawn.
await p.evaluate(() => { location.hash = "#/stats"; });
await p.waitForFunction(() => location.hash === "#/coach" && document.querySelector('[data-fold="coach:stats"]') && document.querySelector('[data-fold="coach:stats"]').open && document.querySelector('[data-fold="coach:stats"] .st-count'), null, { timeout: 15000 }).catch(() => fail("/stats should open Coach on the statistics fold"));
const st = await p.evaluate(() => ({ hero: !!document.querySelector('[data-fold="coach:stats"] .hero'), days: document.querySelectorAll('[data-fold="coach:stats"] [data-days]').length }));
if (st.hero || st.days !== 3) fail("embedded statistics: no page hero, the window chips: " + JSON.stringify(st));

// 4. Timing ↔ Deal Radar.
await p.evaluate(() => { location.hash = "#/horizon"; });
await p.waitForSelector('a[href="#/deals"]', { timeout: 10000 }).catch(() => fail("Timing should point at Deal Radar"));
await p.evaluate(() => { location.hash = "#/deals"; });
await p.waitForSelector('a[href="#/horizon"]', { timeout: 10000 }).catch(() => fail("Deal Radar should point at Timing"));

// 5. A rep on a manager's page lands on their own.
for (const [from, to] of [["#/appointments", "#/calendar"], ["#/customers", "#/leads"], ["#/insights", "#/coach"]]) {
  await p.evaluate((h) => { location.hash = h; }, from);
  await p.waitForFunction((t) => location.hash === t, to, { timeout: 8000 }).catch(() => fail(`${from} should land a rep on ${to}, not "No store yet"`));
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nconsolidate.test.js FAILED" : "\nconsolidate.test.js passed");
})();
