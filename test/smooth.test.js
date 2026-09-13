// "It isn't smooth anymore and takes a long time to load" — after 2,923
// customers with financials came in.
//
// Measured, the app was not hanging: a cold launch painted Home in about a
// second on a desktop. What made it feel broken on a phone was work repeated
// for no new answer. The Deal Radar — every customer priced against every
// vehicle — ran on every visit to Home, ~200ms here and a second there, for the
// same result each time. And the Leads list had no cap: tapping "All" built a
// card for every one of 2,984 customers before the first one appeared, and did
// it again on every add, delete, undo and keystroke.
//
// So the properties to hold: the radar is computed once per change to what it
// reads and not at all for unrelated changes; Home paints before it computes;
// and a long list shows its first screenful immediately.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Parm", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72 } }));
});
await p.goto(APP + "/#/settings");
await p.evaluate(async () => {
  const store = await import("/js/store.js"); await store.ready;
  store.bulk(() => {
    for (let i = 0; i < 2923; i++) store.create("leads", { name: "Customer " + i, phone: "902555" + String(1000 + i).slice(-4), stage: "delivered",
      vehicleInterest: ["2019 Nissan Rogue SV", "2020 Nissan Sentra", "2018 Nissan Pathfinder SL", "2021 Nissan Kicks"][i % 4],
      purchaseDate: "2021-0" + (i % 9 + 1) + "-11", currentPayment: 380 + (i % 300), payoff: 8000 + (i % 15000), currentValue: 14000 + (i % 9000), currentApr: 5.9 + (i % 4) });
    for (let i = 0; i < 61; i++) store.create("leads", { name: "Active " + i, stage: i % 2 ? "working" : "new", followUp: "2026-09-10" });
    for (let i = 0; i < 19; i++) store.create("texts", { leadId: "x", dir: "in", body: "hi", at: new Date().toISOString(), read: false });
  });
});

// --- The radar is computed once, and only recomputed for a relevant change.
console.log("radar caching:");
{
  const r = await p.evaluate(async () => {
    const db = await import("/js/views/dealbuilder.js");
    const store = await import("/js/store.js");
    const time = (fn) => { const t0 = performance.now(); const v = fn(); return { ms: Math.round((performance.now() - t0) * 10) / 10, v }; };
    const first = time(() => db.topOpportunities(50).length);
    const second = time(() => db.topOpportunities(50).length);
    // An unrelated change: mark a thread read. Must NOT cost a radar run.
    store.markThreadRead("x");
    const afterText = time(() => db.topOpportunities(50).length);
    // A relevant change: a customer's payment. MUST recompute, and the answer
    // must reflect it.
    const top = db.topOpportunities(1)[0];
    store.update("leads", top.lead.id, { currentPayment: 5 });
    const afterLead = time(() => db.topOpportunities(1)[0].lead.id);
    return { first, second, afterText, afterLead, changedId: top.lead.id };
  });
  console.log("  first run:", r.first.ms, "ms | cached:", r.second.ms, "ms | after a text was read:", r.afterText.ms, "ms | after a lead changed:", r.afterLead.ms, "ms");
  if (r.first.ms < 20) console.log("  (note: first run was fast on this machine; the cache still has to be exercised below)");
  if (r.second.ms > Math.max(5, r.first.ms / 10)) fail(`the second call recomputed the radar (${r.second.ms}ms vs ${r.first.ms}ms first)`);
  if (r.afterText.ms > Math.max(5, r.first.ms / 10)) fail(`marking a text read invalidated the radar (${r.afterText.ms}ms)`);
  if (r.afterLead.ms < r.second.ms) fail("a change to a customer did NOT recompute the radar");
  if (r.afterLead.v === r.changedId) fail("the radar still ranks a customer first whose payment just dropped to $5 — it served a stale answer");
}

// --- Home paints the day before it computes the play sheet.
console.log("\nHome:");
{
  await p.evaluate(() => { location.hash = "#/settings"; }); await p.waitForTimeout(150);
  const r = await p.evaluate(() => new Promise((res) => {
    location.hash = "#/";
    // Immediately after the synchronous mount: the hero should be there and
    // the play rows should not be yet.
    setTimeout(() => {
      const hero = !!document.querySelector(".hero");
      const rowsNow = document.querySelectorAll(".plays-slot .row").length;
      const t0 = performance.now();
      const poll = () => {
        const rows = document.querySelectorAll(".plays-slot .row").length;
        if (rows || performance.now() - t0 > 5000) return res({ hero, rowsNow, rowsLater: rows, filledInMs: Math.round(performance.now() - t0) });
        requestAnimationFrame(poll);
      };
      poll();
    }, 0);
  }));
  console.log("  " + JSON.stringify(r));
  if (!r.hero) fail("Home mounted without its hero");
  if (!r.rowsLater) fail("the play sheet never filled in");
  if (r.filledInMs > 3000) fail(`the play sheet took ${r.filledInMs}ms to appear`);
}

// --- Leads "All": the first screenful appears at once, the rest follow, and a
// newer render cancels an older one.
console.log("\nLeads, All:");
{
  await p.evaluate(() => { location.hash = "#/settings"; sessionStorage.setItem("leads-filter", "all"); }); await p.waitForTimeout(150);
  const r = await p.evaluate(() => new Promise((res) => {
    const t0 = performance.now();
    location.hash = "#/leads";
    setTimeout(() => {
      const firstPaint = { ms: Math.round(performance.now() - t0), cards: document.querySelectorAll(".lead-list .card").length };
      const poll = () => {
        const n = document.querySelectorAll(".lead-list .card").length;
        if (n >= 2984 || performance.now() - t0 > 15000) return res({ firstPaint, all: n, allInMs: Math.round(performance.now() - t0) });
        requestAnimationFrame(poll);
      };
      poll();
    }, 0);
  }));
  console.log("  " + JSON.stringify(r));
  if (r.firstPaint.cards < 20) fail(`only ${r.firstPaint.cards} cards on first paint`);
  if (r.firstPaint.cards >= 2984) fail("every card was built before the first paint — that's the freeze");
  if (r.firstPaint.ms > 500) fail(`first screenful took ${r.firstPaint.ms}ms`);
  if (r.all < 2984) fail(`the list stopped at ${r.all} of 2984`);

  // Typing cancels the in-flight render instead of racing it.
  const typed = await p.evaluate(() => new Promise((res) => {
    const sb = document.querySelector('.searchbar input[type="search"]');
    sb.value = "Customer 12"; sb.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => {
      const poll = (n0, t0) => {
        const n = document.querySelectorAll(".lead-list .card").length;
        const names = [...document.querySelectorAll(".lead-list .card")].map((c) => c.textContent).filter((t) => !/Customer 12/.test(t)).length;
        if (performance.now() - t0 > 3000) return res({ cards: n, offFilter: names });
        requestAnimationFrame(() => poll(n, t0));
      };
      poll(0, performance.now());
    }, 0);
  }));
  console.log("  after typing a search:", JSON.stringify(typed));
  if (typed.offFilter) fail(`${typed.offFilter} cards from the cancelled render leaked into the search results`);
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsmooth.test.js FAILED" : "\nsmooth.test.js passed");
})();
