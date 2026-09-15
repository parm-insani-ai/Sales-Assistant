// "The application needs to proactively go through all the leads that have
// been imported and bring me ones that should be reached out to because we
// can sell them a car."
//
// So: every day, a handful from the book, best first, each with the reason
// and a drafted opener that waits for a tap; nobody who was just contacted,
// opted out, or is already being worked; the same people not again for
// weeks; a dismissal is a month; sending the text takes them off the list;
// and the drafter never sees a figure.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const AGENT = APP + "/functions/v1/voice-agent";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
// The stub cloud remembers records between runs; a stale copy of this book
// would sync back in as duplicates.
await fetch(APP + "/__reset");

const prompts = [];
await p.route("**/functions/v1/voice-agent", async (route) => {
  const body = route.request().postDataJSON() || {};
  if (body.sms) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: true, sid: "SM1" }) });
  prompts.push(body);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "Hi there, it's Jordan at O'Regan's. Your Rogue may put you in a better spot to move than you'd think — want ten minutes this week to see what it looks like properly?" }], stop_reason: "end_turn" }) });
});

await p.addInitScript((agent) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "j@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    // Consent is taken at the desk here, so old purchases can be texted.
    settings: { salesperson: "Jordan Reid", dealership: "O'Regan's Nissan", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72, consentAtPurchase: true,
      supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: agent, smsFrom: "+19025550123" } }));
}, AGENT);
await p.goto(APP + "/#/settings");

// The book: forty imported owners with their financials, a few of them not
// to be touched for one reason or another.
const seeded = await p.evaluate(async () => {
  const store = await import("/js/store.js"); await store.ready;
  const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
  store.bulk(() => {
    for (let i = 0; i < 40; i++) {
      const l = { name: "Owner " + i, phone: "902555" + String(2000 + i).slice(-4), stage: "delivered", source: "AutoAlert Import",
        vehicleInterest: ["2019 Nissan Rogue SV", "2020 Nissan Sentra SV", "2018 Nissan Pathfinder SL", "2021 Nissan Kicks SR"][i % 4],
        purchaseDate: "2021-0" + (i % 9 + 1) + "-11", currentPayment: 380 + (i % 12) * 20, payoff: 6000 + (i % 10) * 900, currentValue: 15000 + (i % 8) * 800, currentApr: 5.9 + (i % 4) };
      if (i % 7 === 0) l.leaseEnd = iso(60).slice(0, 10);          // lease due in ~2 months
      if (i === 3) l.lastContacted = iso(-2);                        // reached the day before yesterday
      if (i === 5) l.smsOptOut = true;                               // asked us to stop
      if (i === 8) l.lastCampaignAt = iso(-10);                      // in a campaign last week
      if (i === 11) l.stage = "negotiating";                         // already at the table
      if (i === 13) l.prospectSnoozedUntil = iso(20).slice(0, 10);   // "not now" a while ago
      if (i === 17) { l.phone = ""; }                                // no way to reach them
      store.create("leads", l);
    }
  });
  return store.all("leads").length;
});
console.log("book:", seeded, "owners");

// --- 1. Today's picks.
console.log("\ntoday's prospects:");
const today = await p.evaluate(async () => {
  const pr = await import("/js/prospects.js"); const store = await import("/js/store.js");
  const rows = pr.getProspects();
  await new Promise((r) => setTimeout(r, 30)); // the surfaced-stamp lands after the paint
  const again = pr.getProspects();
  const lead = (n) => store.all("leads").find((l) => l.name === "Owner " + n);
  return {
    n: rows.length, names: rows.map((c) => c.lead.name), scores: rows.map((c) => c.score),
    reasons: rows.map((c) => c.reasons[0]), why: rows.map((c) => c.why.length),
    stable: JSON.stringify(again.map((c) => c.lead.id)) === JSON.stringify(rows.map((c) => c.lead.id)),
    stamped: rows.every((c) => !!store.get("leads", c.lead.id).lastProspectedAt),
    excluded: { contacted: lead(3).name, optedOut: lead(5).name, campaigned: lead(8).name, negotiating: lead(11).name, snoozed: lead(13).name, noPhone: lead(17).name },
    stats: pr.prospectStats(),
  };
});
console.log("  " + JSON.stringify({ n: today.n, names: today.names.slice(0, 4), scores: today.scores.slice(0, 4), reasons: today.reasons.slice(0, 3), stats: today.stats }));
if (today.n !== 10) fail(`${today.n} prospects today, not the ten asked for`);
if (!today.stable) fail("the day's picks changed between two looks");
if (!today.stamped) fail("surfaced customers weren't stamped as surfaced");
for (let i = 1; i < today.scores.length; i++) if (today.scores[i] > today.scores[i - 1]) fail("prospects aren't best first");
if (today.reasons.some((r) => !r)) fail("a prospect has no reason");
if (today.why.some((n) => !n)) fail("a prospect has no drafter-safe reasons");
for (const [k, name] of Object.entries(today.excluded)) if (today.names.includes(name)) fail(`${name} (${k}) should have been left alone`);

// --- 2. On Home, with a Review that drafts the opener and waits.
console.log("\nHome:");
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
const home = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".plays-slot .row")].map((r) => ({ title: r.querySelector(".strong")?.textContent || "", sub: r.querySelector(".small")?.textContent || "", btn: r.querySelector("button.btn, a.btn")?.textContent.trim() }));
  return rows.filter((r) => /^Owner/.test(r.title));
});
console.log("  " + JSON.stringify(home.slice(0, 2)), "…", home.length, "rows");
if (home.length !== 10) fail(`${home.length} prospects on the queue, not 10`);
if (!home.every((r) => r.btn === "Review")) fail("a prospect's button isn't Review");
if (!home.some((r) => /Pitch a /.test(r.sub))) fail("no prospect says what to pitch");

const firstName = home[0].title.split(":")[0];
await p.evaluate(() => document.querySelector("[data-play-prospect]").click());
await p.waitForTimeout(700);
const opened = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  return { hash: location.hash, compose: document.querySelector(".ib-compose textarea")?.value || "", sentOut: store.all("texts").filter((t) => t.dir === "out").length };
});
const sys = String((prompts.find((q) => /WHY YOU'RE REACHING OUT/.test(String(q.system || ""))) || {}).system || "");
console.log("  after Review:", JSON.stringify({ hash: opened.hash.slice(0, 12), drafted: !!opened.compose, sentOut: opened.sentOut, promptHasWhy: !!sys }));
if (!/^#\/inbox\//.test(opened.hash) || !opened.compose) fail("Review didn't open the conversation with a draft");
if (opened.sentOut) fail("something was sent without a tap");
if (!sys) fail("the drafter wasn't told why it's reaching out");
const whyLines = ((sys.split("WHY YOU'RE REACHING OUT")[1] || "").split("\nBooking link")[0]).split("\n").filter((l) => /^- /.test(l));
if (!whyLines.length) fail("the WHY section has no reasons in it");
// Money, rates, and thousands — a model year is not a figure.
if (whyLines.some((l) => /\$\s?\d|\d\s?%|\b\d{1,3}(,\d{3})+\b|\b\d+\s?(k|grand)\b/i.test(l))) fail("a figure reached the drafter's reasons: " + whyLines.join(" | "));
if (!/opener|already drives/.test(sys)) fail("the drafter wasn't told this is an opener to an owner");

// --- 3. Sending it takes them off today's list; dismissing is a month.
const worked = await p.evaluate(async (name) => {
  const store = await import("/js/store.js"); const sms = await import("/js/sms.js"); const pr = await import("/js/prospects.js"); const plays = await import("/js/plays.js");
  const lead = store.all("leads").find((l) => l.name === name);
  const r = await sms.sendText(lead, document.querySelector(".ib-compose textarea").value);
  const afterSend = pr.getProspects().map((c) => c.lead.name);
  const next = pr.getProspects()[0];
  plays.dismissPlay({ kind: "prospect", leadId: next.lead.id, key: "pr:" + next.lead.id });
  const afterDismiss = pr.getProspects().map((c) => c.lead.name);
  const inboxLead = store.get("leads", location.hash.replace("#/inbox/", ""));
  return { send: { ok: r.ok, error: r.error || "", contacted: store.get("leads", lead.id).lastContacted, id: lead.id, phone: lead.phone, inbox: location.hash, inboxLead: inboxLead && { name: inboxLead.name, phone: inboxLead.phone, source: inboxLead.source } }, sent: !afterSend.includes(name), n1: afterSend.length, dismissed: next.lead.name, snoozedUntil: store.get("leads", next.lead.id).prospectSnoozedUntil, n2: afterDismiss.length, gone: !afterDismiss.includes(next.lead.name) };
}, firstName);
console.log("\nworked:", JSON.stringify(worked));
if (!worked.sent || worked.n1 !== 9) fail("sending the opener didn't take them off today's list");
if (!worked.gone || worked.n2 !== 8) fail("dismissing didn't take them off today's list");
if (!worked.snoozedUntil || worked.snoozedUntil < new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10)) fail("a dismissed prospect isn't snoozed for about a month");

// --- 4. Tomorrow moves on: none of today's, and as many as the setting says.
const tomorrow = await p.evaluate(async (todayNames) => {
  const pr = await import("/js/prospects.js"); const store = await import("/js/store.js");
  store.updateSettings({ dailyProspects: 3 });
  const saved = JSON.parse(localStorage.getItem("viniva:prospects"));
  localStorage.setItem("viniva:prospects", JSON.stringify({ ...saved, day: "2000-01-01" })); // a new day dawns
  const rows = pr.getProspects();
  return { n: rows.length, names: rows.map((c) => c.lead.name), repeat: rows.filter((c) => todayNames.includes(c.lead.name)).map((c) => c.lead.name) };
}, today.names);
console.log("tomorrow:", JSON.stringify(tomorrow));
if (tomorrow.n !== 3) fail(`tomorrow brought ${tomorrow.n}, the setting says 3`);
if (tomorrow.repeat.length) fail(`tomorrow repeated today's: ${tomorrow.repeat.join(", ")}`);

// --- 5. The voice agent answers "who should I reach out to today".
const voice = await p.evaluate(async () => {
  const agent = await import("/js/agent.js");
  const r = await agent.execTool("get_prospects", {});
  return { n: r.result.prospects.length, first: r.result.prospects[0], note: r.result.note, hash: location.hash };
});
console.log("\nvoice:", JSON.stringify({ n: voice.n, first: voice.first && voice.first.customer, reasons: voice.first && voice.first.reasons, note: voice.note.slice(0, 60) }));
if (voice.n !== 3 || !voice.first || !voice.first.reasons.length) fail("the agent tool doesn't return today's prospects with reasons");
if (voice.hash !== "#/") fail("the agent tool didn't land on Home");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nprospects.test.js FAILED" : "\nprospects.test.js passed");
})();
