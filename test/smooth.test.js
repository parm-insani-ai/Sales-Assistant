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
// Then, with the first paint fixed, the lag moved: tabs, scrolling, and tapping
// into a customer all stuttered. Streaming the whole list in had left 45,000
// nodes and 15,000 pointer listeners in the document, and Home was drawing
// all 618 open follow-up tasks under the fold. The browser carried all of it
// through every scroll frame and tore it all down on every tab change.
//
// So the properties to hold: the radar is computed once per change to what it
// reads and not at all for unrelated changes; Home paints before it computes
// and shows a screenful of tasks, not the book's worth; and a long list shows
// its first screenful immediately, holds only what has been scrolled to, and
// still reaches the end.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
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
    for (let i = 0; i < 618; i++) store.create("tasks", { leadId: "x", title: "Follow up " + i, due: "2026-09-1" + (i % 9), channel: i % 2 ? "call" : "message", done: false });
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

  // A screenful of tasks, the rest behind a button that works.
  const t = await p.evaluate(() => {
    const rows = () => document.querySelectorAll(".tasks-slot .check-item").length;
    const before = rows();
    const more = document.querySelector(".tasks-slot .list-more");
    const label = more ? more.textContent : "";
    if (more) more.click();
    return { before, label, after: rows(), nodes: document.querySelector("#view").querySelectorAll("*").length };
  });
  console.log("  tasks on Home:", JSON.stringify(t));
  if (t.before > 12) fail(`Home drew ${t.before} tasks — the whole book's worth again`);
  if (!/610 more/.test(t.label)) fail(`the "show more" row says "${t.label}", not how many are hidden`);
  if (t.after <= t.before) fail("tapping the show-more row showed nothing more");
}

// --- Leads "All": the first screenful appears at once, the document holds
// only what has been scrolled to, scrolling reaches the end, and a newer
// render cancels an older one.
console.log("\nLeads, All:");
{
  // The list is sorted by the read of the book (assess.js). The app warms
  // that read shortly after launch; here the book was just seeded, so warm it
  // the same way — and hold the cold read itself to a bound while at it.
  const cold = await p.evaluate(async () => {
    const a = await import("/js/assess.js");
    const t0 = performance.now(); a.assessAll(); return Math.round(performance.now() - t0);
  });
  console.log("  cold read of the book:", cold, "ms");
  if (cold > 1500) fail(`reading 2,984 people took ${cold}ms`);
  await p.evaluate(() => { location.hash = "#/settings"; sessionStorage.setItem("leads-filter", "all"); }); await p.waitForTimeout(150);
  const r = await p.evaluate(() => new Promise((res) => {
    const t0 = performance.now();
    location.hash = "#/leads";
    setTimeout(() => {
      const firstPaint = { ms: Math.round(performance.now() - t0), cards: document.querySelectorAll(".lead-list .card").length };
      // Left alone (no scrolling), the list must settle well short of everything.
      setTimeout(() => {
        const sentinel = document.querySelector(".lead-list .lead-more");
        res({ firstPaint, settled: document.querySelectorAll(".lead-list .card").length,
          nodes: document.querySelector("#view").querySelectorAll("*").length, sentinel: sentinel ? sentinel.textContent : null });
      }, 800);
    }, 0);
  }));
  console.log("  " + JSON.stringify(r));
  if (r.firstPaint.cards < 20) fail(`only ${r.firstPaint.cards} cards on first paint`);
  if (r.firstPaint.ms > 500) fail(`first screenful took ${r.firstPaint.ms}ms`);
  if (r.settled > 400) fail(`${r.settled} cards in the document without anyone scrolling — the whole list is back in the DOM`);
  if (!/of 2,984/.test(r.sentinel || "")) fail(`the end of the list doesn't say how many are shown: ${JSON.stringify(r.sentinel)}`);

  // Scrolling to the bottom keeps bringing more, all the way to the last one.
  const s = await p.evaluate(() => new Promise((res) => {
    const view = document.querySelector("#view");
    const cards = () => document.querySelectorAll(".lead-list .card").length;
    const t0 = performance.now();
    let steps = 0, stuck = 0, last = cards();
    const tick = () => {
      view.scrollTop = view.scrollHeight;
      steps++;
      setTimeout(() => {
        const n = cards();
        stuck = n === last ? stuck + 1 : 0; last = n;
        if (n >= 2984 || stuck > 20 || performance.now() - t0 > 30000) {
          const sentinel = document.querySelector(".lead-list .lead-more");
          return res({ reached: n, steps, ms: Math.round(performance.now() - t0), sentinel: sentinel ? sentinel.textContent : null });
        }
        tick();
      }, 60);
    };
    tick();
  }));
  console.log("  scrolled to the bottom:", JSON.stringify(s));
  if (s.reached < 2984) fail(`scrolling stopped at ${s.reached} of 2984 — the rest of the book is unreachable`);
  if (!/All 2,984 shown/.test(s.sentinel || "")) fail(`the end of the list doesn't say it's the end: ${JSON.stringify(s.sentinel)}`);

  // Search spans the whole book, not just what was scrolled to.
  await p.evaluate(() => { location.hash = "#/settings"; sessionStorage.setItem("leads-filter", "all"); }); await p.waitForTimeout(150);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(200);
  const deep = await p.evaluate(() => new Promise((res) => {
    const sb = document.querySelector('.searchbar input[type="search"]');
    sb.value = "Customer 2900"; sb.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => res([...document.querySelectorAll(".lead-list .card .row-title")].map((n) => n.textContent)), 100);
  }));
  console.log("  search for a customer far down the book:", JSON.stringify(deep));
  if (!deep.includes("Customer 2900")) fail("a customer beyond the rendered window can't be found by search");
  await p.evaluate(() => { const sb = document.querySelector('.searchbar input[type="search"]'); sb.value = ""; sb.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.waitForTimeout(100);

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

// --- Back from a customer lands where you left off, not at the top. The
// list is windowed, so "where you left off" means the same cards AND the
// same scroll.
console.log("\nback from a customer:");
{
  await p.evaluate(() => { location.hash = "#/settings"; sessionStorage.setItem("leads-filter", "all"); }); await p.waitForTimeout(150);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(200);
  // Scroll a good way down and let the list catch up.
  const before = await p.evaluate(() => new Promise((res) => {
    const view = document.querySelector("#view");
    let n = 0;
    const step = () => { view.scrollTop += 2500; if (++n < 6) return setTimeout(step, 120); setTimeout(() => {
      const cards = [...document.querySelectorAll(".lead-list .card")];
      // Tap something that is actually on screen, as a thumb would.
      const v = view.getBoundingClientRect();
      const pick = cards.find((c) => { const r = c.getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom; }) || cards[cards.length - 1];
      res({ top: view.scrollTop, cards: cards.length, name: pick.querySelector(".row-title").textContent });
    }, 200); };
    step();
  }));
  await p.evaluate((name) => { [...document.querySelectorAll(".lead-list .card")].find((c) => c.querySelector(".row-title").textContent === name).click(); }, before.name);
  await p.waitForTimeout(300);
  const onDetail = await p.evaluate(() => /^#\/leads\/lea_/.test(location.hash));
  await p.evaluate(() => document.querySelector('[data-act="back"]').click());
  await p.waitForTimeout(400);
  const after = await p.evaluate((name) => {
    const view = document.querySelector("#view");
    const card = [...document.querySelectorAll(".lead-list .card")].find((c) => c.querySelector(".row-title").textContent === name);
    const r = card ? card.getBoundingClientRect() : null, v = view.getBoundingClientRect();
    return { top: view.scrollTop, cards: document.querySelectorAll(".lead-list .card").length, visible: !!r && r.bottom > v.top && r.top < v.bottom };
  }, before.name);
  console.log("  left at", JSON.stringify(before), "→ back at", JSON.stringify(after));
  if (!onDetail) fail("tapping the card didn't open the customer");
  if (before.top < 2000) fail("the test didn't scroll far enough to prove anything");
  if (Math.abs(after.top - before.top) > 60) fail(`came back at ${after.top}, left at ${before.top}`);
  if (after.cards < before.cards) fail(`came back with ${after.cards} cards, had ${before.cards}`);
  if (!after.visible) fail("the customer you tapped isn't on screen when you come back");

  // A fresh visit from another screen starts at the top again.
  await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(150);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(250);
  const fresh = await p.evaluate(() => ({ top: document.querySelector("#view").scrollTop, cards: document.querySelectorAll(".lead-list .card").length }));
  console.log("  fresh visit:", JSON.stringify(fresh));
  if (fresh.top !== 0 || fresh.cards > 60) fail("a fresh visit didn't start at the top");
}

// --- The filter: All first and by default, and the chip you tapped last is
// the one you're on when you come back — a jump from Home doesn't change it.
console.log("\nLeads filter memory:");
{
  const chips = () => p.evaluate(() => ({
    order: [...document.querySelectorAll("[data-filter]")].slice(0, 3).map((b) => b.dataset.filter),
    on: document.querySelector("[data-filter].btn-primary")?.dataset.filter,
  }));
  await p.evaluate(() => { localStorage.removeItem("viniva:leads-filter"); location.hash = "#/settings"; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(150);
  const fresh = await chips();
  console.log("  fresh:", JSON.stringify(fresh));
  if (fresh.order.join(",") !== "all,active,due") fail(`chips are ordered ${fresh.order.join(", ")}`);
  if (fresh.on !== "all") fail(`the default filter is ${fresh.on}, not All`);

  await p.evaluate(() => document.querySelector('[data-filter="active"]').click()); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(150);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(150);
  const back = await chips();
  console.log("  after tapping Active, leaving and returning:", JSON.stringify(back));
  if (back.on !== "active") fail(`came back on ${back.on}, not the Active chip that was tapped`);

  // A stat card on Home presets "due" for one visit only.
  await p.evaluate(() => { sessionStorage.setItem("leads-filter", "due"); location.hash = "#/"; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(150);
  const jump = await chips();
  await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(150);
  const after = await chips();
  console.log("  jump from Home to Due:", jump.on, "| next visit:", after.on);
  if (jump.on !== "due") fail("a preset from Home didn't land on Due");
  if (after.on !== "active") fail(`the jump overwrote the remembered filter (now ${after.on})`);
}

// --- "By opportunity" is a button beside Add customer and Select, not a
// chip: a lens over the entire book, remembered on its own, and the old
// /deals address still lands on it.
console.log("\nBy opportunity:");
{
  const state = () => p.evaluate(() => {
    const row = document.querySelector('[data-act="opp"]')?.closest(".btn-row");
    return {
      chip: !!document.querySelector('[data-filter="opportunity"]'),
      row: row ? [...row.querySelectorAll("button")].map((b) => b.dataset.act) : null,
      lit: document.querySelector('[data-act="opp"]')?.classList.contains("btn-primary"),
      ranked: !!document.querySelector("#deals-controls"),
      chips: !!document.querySelector("[data-filter]"),
      cards: document.querySelectorAll(".lead-list .card").length,
    };
  });
  await p.evaluate(() => { localStorage.removeItem("viniva:leads-opp"); location.hash = "#/settings"; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(150);
  let s = await state();
  console.log("  off:", JSON.stringify(s));
  if (s.chip) fail("By opportunity is still a chip");
  if (!s.row || s.row.join(",") !== "add-lead,select,opp") fail(`the button row is ${JSON.stringify(s.row)}, not Add customer · Select · By opportunity`);
  if (s.lit || s.ranked) fail("the lens is on before anyone tapped it");

  await p.evaluate(() => document.querySelector('[data-act="opp"]').click()); await p.waitForTimeout(300);
  s = await state();
  console.log("  on:", JSON.stringify(s));
  if (!s.lit) fail("the button doesn't light up when the lens is on");
  if (!s.ranked) fail("tapping By opportunity didn't show the ranked view");
  if (s.chips) fail("the chips are still showing under the lens — it's over the whole book");
  if (!s.row || !s.row.includes("add-lead")) fail("Add customer disappeared under the lens");

  await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(300);
  s = await state();
  console.log("  after leaving and returning:", JSON.stringify({ lit: s.lit, ranked: s.ranked }));
  if (!s.lit || !s.ranked) fail("the lens wasn't remembered across visits");

  await p.evaluate(() => document.querySelector('[data-act="opp"]').click()); await p.waitForTimeout(300);
  s = await state();
  console.log("  tapped again:", JSON.stringify({ lit: s.lit, ranked: s.ranked, chips: s.chips, cards: s.cards }));
  if (s.lit || s.ranked || !s.chips || !s.cards) fail("tapping the button again didn't bring the plain list back");

  await p.evaluate(() => { location.hash = "#/deals"; }); await p.waitForTimeout(400);
  s = await state();
  console.log("  via /deals:", JSON.stringify({ hash: await p.evaluate(() => location.hash), lit: s.lit, ranked: s.ranked }));
  if (!s.ranked) fail("/deals no longer lands on the ranked view");
  await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(300);
  s = await state();
  if (s.ranked) fail("a jump via /deals switched the lens on permanently");
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsmooth.test.js FAILED" : "\nsmooth.test.js passed");
})();
