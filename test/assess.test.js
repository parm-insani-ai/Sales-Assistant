// "The whole job of the Leads page is to go through all the imported leads
// and determine the best candidates and why. The application needs to get
// way smarter and better at this."
//
// So: the list is best first; every card says why; every signal the export
// carries is read — the deal, equity, years in, contract end, warranty,
// mileage, rate, AutoAlert's own flag, the service drive, what they opened;
// the page explains it in full and names the next move; Home's prospects
// come from the same read; and reading three thousand people is quick.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "j@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Jordan Reid", dealership: "O'Regan's Nissan", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72,
      supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", smsFrom: "+19025550123" } }));
});
await p.goto(APP + "/#/settings");

// A book with one of everything.
const seeded = await p.evaluate(async () => {
  const store = await import("/js/store.js"); await store.ready;
  const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
  const day = (d) => iso(d).slice(0, 10);
  const yearsAgo = (y) => day(-Math.round(y * 365.25));
  const mk = (over) => ({ phone: "902555" + String(1000 + Math.floor(Math.random() * 8999)), stage: "delivered", source: "AutoAlert",
    vehicleInterest: "2021 Nissan Rogue SV", purchaseDate: yearsAgo(3.5), currentPayment: 520, payoff: 14000, currentValue: 16000, currentApr: 6.9, ...over });
  const people = {
    equity:    mk({ name: "Eq Uity", payoff: 9000, currentValue: 19500 }),                              // big equity + same-payment deal
    lease:     mk({ name: "Lea Send", leaseEnd: day(45), dealType: "lease", currentPayment: null, payoff: null, currentValue: null, purchaseDate: null }), // only a lease ending
    warranty:  mk({ name: "War Ranty", purchaseDate: yearsAgo(2.9), payoff: 15500, currentValue: 15000 }),  // basic warranty running out
    overkm:    mk({ name: "Ove Rkm", leaseEnd: day(300), dealType: "lease", odometer: 95000, purchaseDate: yearsAgo(3.0), payoff: 15500, currentValue: 15000 }), // 31k/yr on a lease
    service:   mk({ name: "Ser Vice", notes: `AutoAlert: Flex alert\nService appt ${day(4)} — meet them in the drive`, payoff: 15500, currentValue: 15000 }),
    opened:    mk({ name: "Ope Ned", payoff: 15500, currentValue: 15000 }),
    contacted: mk({ name: "Con Tacted", payoff: 9000, currentValue: 19500, lastContacted: iso(-3) }),     // same as Eq Uity, reached this week
    optout:    mk({ name: "Opt Out", payoff: 9000, currentValue: 19500, smsOptOut: true }),
    nodata:    { name: "No Data", phone: "9025550000", stage: "delivered", source: "Import", vehicleInterest: "2016 Honda Civic" },
    live:      { name: "Liv Elead", phone: "9025550001", stage: "new", source: "Internet", vehicleInterest: "Nissan Kicks", profile: { timeline: "this month" } },
  };
  const ids = {};
  store.bulk(() => { for (const [k, l] of Object.entries(people)) ids[k] = store.create("leads", l).id; });
  store.create("links", { id: "lnk_x", kind: "compare", opens: 3, createdAt: iso(-2), lastOpenAt: iso(-1), meta: { leadId: ids.opened, label: "Rogue vs CR-V" } });
  for (let i = 0; i < 2990; i++) store.create("leads", mk({ name: "Filler " + i, stage: "delivered", payoff: 10000 + (i % 9) * 700, currentValue: 14000 + (i % 7) * 900, purchaseDate: yearsAgo(1 + (i % 6)) }));
  return ids;
});
console.log("book seeded:", Object.keys(seeded).length, "named +", 2990, "filler");

// --- 1. The read: every signal, in order, with reasons.
console.log("\nthe read:");
const read = await p.evaluate(async (ids) => {
  const a = await import("/js/assess.js");
  const t0 = performance.now(); a.assessAll(); const first = Math.round(performance.now() - t0);
  const t1 = performance.now(); a.assessAll(); const second = Math.round((performance.now() - t1) * 10) / 10;
  const out = {};
  for (const [k, id] of Object.entries(ids)) { const x = a.assessment(id); out[k] = { score: x.score, tier: x.tier ? x.tier.label : null, reasons: x.reasons, next: x.next ? x.next.kind : null, why: x.why.length, safe: x.whySafe }; }
  return { first, second, out, summary: a.bookSummary(), top: a.ranked().slice(0, 3).map((x) => x.lead.name), cuts: a.assessAll().cuts };
}, seeded);
console.log(`  3,000 people read in ${read.first}ms, cached ${read.second}ms · summary ${JSON.stringify(read.summary)} · cuts ${JSON.stringify(read.cuts)}`);
for (const [k, v] of Object.entries(read.out)) console.log(`  ${k.padEnd(9)} ${String(v.score).padStart(3)} ${(v.tier || "—").padEnd(12)} ${v.reasons.join(" · ")}  → ${v.next}`);
const r = read.out;
if (read.first > 2500) fail(`reading the book took ${read.first}ms`);
if (read.second > 5) fail("the second read wasn't cached");
if (!r.equity.reasons.some((x) => /equity/.test(x)) || !r.equity.reasons.some((x) => /payment|\/mo/.test(x))) fail("equity + a deal weren't both read");
if (r.equity.tier !== "Hot") fail("big equity with a payment-matched deal isn't Hot");
if (!r.lease.reasons.some((x) => /Lease ends in [12] mo/.test(x))) fail("a lease ending in six weeks wasn't read: " + r.lease.reasons.join(", "));
if (!r.warranty.reasons.some((x) => /Warranty ending/.test(x))) fail("a basic warranty running out wasn't read: " + r.warranty.reasons.join(", "));
if (!r.overkm.reasons.some((x) => /Over km/.test(x))) fail("driving over a lease allowance wasn't read: " + r.overkm.reasons.join(", "));
if (!r.service.reasons.some((x) => /AutoAlert/.test(x)) || !r.service.reasons.some((x) => /In service/.test(x))) fail("the export's own flag and the service visit weren't read: " + r.service.reasons.join(", "));
if (r.service.next !== "service") fail("the next move for someone in the service drive isn't to meet them there");
if (!r.opened.reasons.some((x) => /Opened your link/.test(x)) || r.opened.next !== "hot") fail("a link opened yesterday isn't the top signal");
if (r.contacted.score >= r.equity.score) fail("someone reached this week ranks as high as their twin who wasn't");
if (r.optout.score !== 0) fail("an opted-out customer still scores");
if (r.nodata.tier) fail("a customer with nothing on file got a tier");
if (!r.live.reasons.some((x) => /Live lead/.test(x)) || !r.live.reasons.some((x) => /Shopping now/.test(x))) fail("a live enquiry with a timeline wasn't read");
if (Object.values(r).some((v) => v.safe.some((s) => /\$|\d\s?%|\b\d{1,3},\d{3}\b/.test(s)))) fail("a figure leaked into the message-writer's reasons");
// On a book where nearly everyone has a deal, Hot has to mean the top tenth
// or it means nothing; and the people with the most going on land in it.
if (read.summary.hot < 3 || read.summary.hot > 330) fail(`${read.summary.hot} hot of 3,000 — the bar is off`);
if (read.summary.strong > 1160) fail(`${read.summary.strong} of 3,000 are "Strong" — that word means nothing at that rate`);
for (const k of ["equity", "service", "opened"]) if (r[k].tier !== "Hot") fail(`${k} isn't Hot on this book (${r[k].score})`);
if (r.contacted.tier === "Hot") fail("someone reached this week is still Hot");
if (r.warranty.tier === "Hot" || r.lease.tier === "Hot") fail("a single modest signal made someone Hot");

// --- 2. The Leads page: best first, reasons on the card, a summary line.
console.log("\nLeads page:");
await p.evaluate(() => { localStorage.removeItem("viniva:leads-filter"); location.hash = "#/leads"; }); await p.waitForTimeout(400);
const page = await p.evaluate(() => {
  const cards = [...document.querySelectorAll(".lead-list .card")].slice(0, 5).map((c) => ({
    name: c.querySelector(".row-title")?.textContent, tier: c.querySelector(".row-meta .badge")?.textContent, reasons: c.querySelector(".row-reasons")?.textContent || "" }));
  return { summary: document.querySelector(".lead-summary")?.textContent || "", cards };
});
console.log("  " + page.summary);
page.cards.forEach((c) => console.log(`  ${c.name} [${c.tier}] ${c.reasons}`));
if (!/customers · \d+ hot/.test(page.summary)) fail("no summary of the read above the list");
if (!/Hot|Strong/.test(page.cards[0].tier || "")) fail("the first card doesn't carry a tier");
if (!page.cards[0].reasons) fail("the first card doesn't say why");
if (page.cards.some((c) => /No Data/.test(c.name))) fail("a customer with nothing on file is near the top");

// --- 3. The customer's page: why now, in full, with the next move.
const detail = await p.evaluate(async (id) => {
  location.hash = "#/leads/" + id; await new Promise((r) => setTimeout(r, 300));
  const card = document.querySelector(".why-card");
  return { has: !!card, text: card ? card.textContent.replace(/\s+/g, " ") : "", items: card ? card.querySelectorAll(".why-list li").length : 0,
    opener: !!document.querySelector('[data-act="opener"]'), snooze: !!document.querySelector('[data-act="snooze"]') };
}, seeded.equity);
console.log("\ncustomer page:", JSON.stringify({ items: detail.items, opener: detail.opener, snooze: detail.snooze }), "·", detail.text.slice(0, 120) + "…");
if (!detail.has || detail.items < 3) fail("the page doesn't explain why in full");
if (!/equity/.test(detail.text)) fail("the explanation leaves out the equity");
if (!detail.opener || !detail.snooze) fail("no way to act on the read from the page");

// --- 4. Home's prospects come from the same read.
const agree = await p.evaluate(async () => {
  const a = await import("/js/assess.js"); const pr = await import("/js/prospects.js");
  const top = a.ranked().filter((x) => pr.eligible(x.lead)).slice(0, 10).map((x) => x.lead.name);
  const picks = pr.getProspects().map((c) => c.lead.name);
  return { top, picks, same: JSON.stringify(top) === JSON.stringify(picks) };
});
console.log("\nHome agrees with Leads:", agree.same, agree.picks.slice(0, 3).join(", "));
if (!agree.same) fail(`Home's prospects (${agree.picks.slice(0, 3)}) aren't the Leads page's best eligible (${agree.top.slice(0, 3)})`);

// --- 5. The voice agent can say why.
const voice = await p.evaluate(async () => {
  const agent = await import("/js/agent.js");
  const r = await agent.execTool("get_customer", { name: "Eq Uity" });
  return r.result.assessment;
});
console.log("\nvoice, why Eq Uity:", JSON.stringify(voice).slice(0, 160) + "…");
if (!voice || !voice.why.length || !voice.next) fail("the agent isn't given the why");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nassess.test.js FAILED" : "\nassess.test.js passed");
})();
