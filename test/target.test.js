// The store's monthly target sheet, on Home. Set new and used units and
// the closing ratio you expect; the sheet says how many customers to speak
// with (units ÷ ratio, rounded up), then counts from the book: spoken with
// (any outbound contact, once per customer), sold (the sold log, by new /
// used), closing ratio, remaining, pace, and this week's share. The
// customer log is the app itself — nothing is typed twice.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hourAgo = new Date(now.getTime() - 3600000).toISOString();
  // Logged this month: leads 1–7 (8 is an owner nobody has logged; 9 was logged last year).
  const lead = (id, shopping, extra = {}) => ({ id, name: "Customer " + id, phone: "9025550" + id.padStart(3, "0"), stage: "working", vehicleInterest: "Rogue", shopping, loggedAt: Number(id) <= 7 ? hourAgo : Number(id) === 9 ? "2025-03-03T12:00:00.000Z" : null, ...x, ...extra });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      // Four new-car shoppers spoken with this month (a logged call, a sent text, an email out, Call tapped on the page).
      lead("1", "New"), lead("2", "New"), lead("3", "New"), lead("4", "New", { lastContacted: hourAgo, lastContactVia: "call" }),
      // Two used, one not marked — and an owner nobody has logged.
      lead("5", "Used"), lead("6", "Used"), lead("7", ""), lead("8", "New", { stage: "delivered" }),
      // A customer contacted twice counts once; one contacted last year doesn't count.
      lead("9", "New", { lastContacted: "2025-03-03T12:00:00.000Z" }),
    ],
    calls: [
      { id: "c1", leadId: "1", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c1b", leadId: "1", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c5", leadId: "5", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c7", leadId: "7", dir: "out", via: "call", at: hourAgo, outcome: "reached", logged: true, ...x },
      { id: "c9", leadId: "9", dir: "out", via: "call", at: "2025-03-03T12:00:00.000Z", outcome: "reached", logged: true, ...x },
    ],
    texts: [{ id: "t2", leadId: "2", dir: "out", body: "Hi", at: hourAgo, ...x }, { id: "t8in", leadId: "8", dir: "in", body: "Hi", at: hourAgo, ...x }],
    emails: [{ id: "e3", leadId: "3", direction: "out", subject: "The SV", sentAt: hourAgo, ...x }, { id: "e6", leadId: "6", direction: "out", subject: "The Kicks", sentAt: hourAgo, ...x }],
    sales: [
      { id: "s1", leadId: "1", customerName: "Customer 1", vehicle: "2026 Rogue SV", saleDate: today, newUsed: "New", commission: 500, ...x },
      { id: "s2", leadId: "2", customerName: "Customer 2", vehicle: "2026 Kicks", saleDate: today, newUsed: "New", commission: 400, ...x },
      { id: "s3", leadId: "5", customerName: "Customer 5", vehicle: "2022 Sentra", saleDate: today, newUsed: "Used", commission: 300, ...x },
      { id: "s0", leadId: "9", customerName: "Customer 9", vehicle: "2024 Rogue", saleDate: "2025-03-05", newUsed: "New", commission: 300, ...x },
    ],
    appointments: [{ id: "a1", leadId: "3", customerName: "Customer 3", type: "appointment", when: today + "T15:00", status: "scheduled", ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false, targetNew: 6, targetUsed: 4, closingNew: 42, closingUsed: 42, goalUnits: 10, goalAppointments: 30, goalCommission: 8000 },
  }));
});

// --- The engine.
await p.goto(APP + "/#/");
await p.waitForSelector(".target-card", { timeout: 15000 });
const t = await p.evaluate(async () => { const m = await import("/js/target.js"); const r = m.salesTarget(); return { ...r, plan: r.plan }; });
console.log("sheet:", JSON.stringify({ plan: t.plan, spoke: [t.spoke, t.spokeNew, t.spokeUsed, t.spokeUnsplit], sold: [t.sold, t.soldNew, t.soldUsed], closing: t.closing, remaining: [t.remainingUnits, t.remainingTalks], week: [t.week, t.weeks, t.perWeek, t.spokeWeek], appts: t.appts }));
if (t.plan.needNew !== 15 || t.plan.needUsed !== 10 || t.plan.need !== 25 || t.plan.target !== 10) fail("units ÷ 42% rounded up should be 15 new, 10 used, 25: " + JSON.stringify(t.plan));
if (t.spoke !== 7 || t.spokeNew !== 4 || t.spokeUsed !== 2 || t.spokeUnsplit !== 1) fail("spoken with should be the month's log: 7 customers (4 new, 2 used, 1 unmarked), not the owner nobody logged or last year's: " + JSON.stringify([t.spoke, t.spokeNew, t.spokeUsed, t.spokeUnsplit]));
if (t.sold !== 3 || t.soldNew !== 2 || t.soldUsed !== 1) fail("sold this month should be 3 (2 new, 1 used): " + JSON.stringify([t.sold, t.soldNew, t.soldUsed]));
if (Math.round(t.closing * 100) !== 43 || Math.round(t.closingNew * 100) !== 50 || Math.round(t.closingUsed * 100) !== 50) fail("closing ratios: " + JSON.stringify([t.closing, t.closingNew, t.closingUsed]));
if (t.remainingUnits !== 7 || t.remainingTalks !== 18) fail("remaining: " + JSON.stringify([t.remainingUnits, t.remainingTalks]));
if (t.perWeek !== Math.ceil(25 / t.weeks) || t.spokeWeek !== 7) fail("the week's share and this week's count: " + JSON.stringify([t.perWeek, t.spokeWeek, t.weeks]));
if (t.appts !== 1) fail("appointments set this month: " + t.appts);

// --- On Home: two big numbers, the same by new and used, and the read as
// chips — no grid. In a drop-down.
const home = await p.evaluate(() => ({
  fold: document.querySelector('[data-fold="home:target"]')?.open,
  table: !!document.querySelector(".target-card table"),
  head: document.querySelector(".target-card .row-main")?.textContent.replace(/\s+/g, " ").trim(),
  tiles: [...document.querySelectorAll(".tg-tile")].map((n) => ({ big: n.querySelector(".tg-big").textContent.trim(), label: n.querySelector(".tg-label").textContent.trim(), left: n.querySelector(".tg-left").textContent.trim(), bar: n.querySelector(".tg-bar > span").style.width })),
  cats: [...document.querySelectorAll(".tg-cat")].map((n) => [...n.querySelector(".tg-cat-head").children].map((c) => c.textContent.trim()).join(" ")),
  chips: [...document.querySelectorAll(".tg-chip")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  text: document.querySelector(".target-card").textContent.replace(/\s+/g, " ").trim(),
  goalCard: /Monthly goal/.test(document.querySelector("#view").textContent),
}));
console.log("home:", JSON.stringify(home, null, 1));
if (!home.fold) fail("the Sales target drop-down should start open");
if (home.table) fail("the target is drawn as a table");
if (!/10 units.*Speak with 25 customers/.test(home.head || "")) fail("the heading: " + home.head);
if (JSON.stringify(home.tiles) !== JSON.stringify([{ big: "3/10", label: "Sold ›", left: "7 to go", bar: "30%" }, { big: "7/25", label: "Spoken with ›", left: "18 to go", bar: "28%" }])) fail("the two big numbers: " + JSON.stringify(home.tiles));
if (home.cats.join(" / ") !== "New 2/6 sold · 4/15 spoken with / Used 1/4 sold · 2/10 spoken with") fail("by new and used: " + JSON.stringify(home.cats));
if (!home.chips.some((c) => /behind pace|On pace/.test(c)) || !home.chips.some((c) => /^Closing 43% · expect 42%/.test(c)) || !home.chips.some((c) => /^This week 7\/\d+/.test(c)) || !home.chips.some((c) => /^1 appt set of 30/.test(c))) fail("the read: " + JSON.stringify(home.chips));
if (!/1 spoken with aren't marked new or used/.test(home.text)) fail("the unmarked customer isn't called out: " + home.text);
if (!/Commission\s*\$1,200 \/ \$8,000/.test(home.text)) fail("the commission line: " + home.text);
if (home.goalCard) fail("the old Monthly goal card is still on Home");

// --- With a target set, the card's button is the way into Performance;
// the target is set from there. The sheet recalculates, and the unit goal
// follows the total.
const way = await p.evaluate(() => document.querySelector('.target-card [data-act="performance"]')?.textContent.trim());
if (way !== "Performance ›") fail("with a target set, the card's button should open Performance: " + way);
await p.click('.target-card [data-act="performance"]');
await p.waitForSelector('#pf-body .card', { timeout: 8000 });
await p.click('[data-act="target"]');
await p.waitForSelector('.modal input[name="targetNew"]', { timeout: 5000 });
await p.waitForTimeout(350); // the sheet's own focus lands after its slide-up
await p.fill('.modal input[name="targetNew"]', "8");
await p.fill('.modal input[name="closingNew"]', "50");
await p.click(".modal button[type=submit]");
await p.waitForTimeout(500);
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(600);
const after = await p.evaluate(async () => { const s = await import("/js/store.js"); return { goalUnits: s.getSettings().goalUnits, tiles: [...document.querySelectorAll(".tg-big")].map((n) => n.textContent.trim()), cats: [...document.querySelectorAll(".tg-cat-head")].map((n) => [...n.children].map((c) => c.textContent.trim()).join(" ")) }; });
console.log("after set:", JSON.stringify(after));
if (after.goalUnits !== 12 || after.tiles.join() !== "3/12,7/26" || after.cats[0] !== "New 2/8 sold · 4/16 spoken with") fail("setting the target didn't recalculate: " + JSON.stringify(after));

// --- Voice fills the sheet: telling the assistant about a customer logs
// the conversation and their new / used, with nothing else to type.
const spoken = await p.evaluate(async () => {
  const a = await import("/js/agent.js"); const s = await import("/js/store.js"); const m = await import("/js/target.js");
  await a.execTool("create_lead", { name: "Rae Test", phone: "9025550101", vehicle: "2022 Rogue SV", newUsed: "used", notes: "Looking at a used Rogue, wants a moonroof" });
  await a.execTool("create_lead", { name: "Sam Test", phone: "9025550102", vehicle: "2026 Kicks", notes: "Wants the new Kicks" });
  const rae = s.all("leads").find((l) => l.name === "Rae Test"), sam = s.all("leads").find((l) => l.name === "Sam Test");
  const t = m.salesTarget();
  return { rae: [rae.shopping, !!rae.lastContacted, rae.lastContactVia], sam: [sam.shopping, !!sam.lastContacted], spoke: [t.spoke, t.spokeNew, t.spokeUsed], infer: [m.inferShopping("add a customer Dana who wants a used Rogue"), m.inferShopping("new lead Ken looking for a 2026 Pathfinder"), m.inferShopping("add lead Jo interested in a Sentra")] };
});
console.log("by voice:", JSON.stringify(spoken));
if (spoken.rae.join() !== "Used,true,in person" || spoken.sam.join() !== "New,true") fail("adding customers by voice didn't mark them spoken with and new/used: " + JSON.stringify(spoken));
if (spoken.spoke.join() !== "9,5,3") fail("the sheet didn't count the customers added by voice: " + JSON.stringify(spoken.spoke));
if (spoken.infer.join() !== "Used,New,") fail("new/used isn't read from the sentence: " + JSON.stringify(spoken.infer));
const shown = await p.evaluate(() => { location.hash = "#/leads"; return new Promise((r) => setTimeout(() => { location.hash = "#/"; setTimeout(() => r([...document.querySelectorAll(".tg-big")].map((n) => n.textContent.trim())), 500); }, 200)); });
if (shown.join() !== "3/12,9/26") fail("Home doesn't show the customers added by voice: " + shown.join());

// --- The assistant answers "how am I doing against my target?".
const voice = await p.evaluate(async () => { const a = await import("/js/agent.js"); const r = await a.execTool("sales_target", {}); return { r: r.result, note: r.note }; });
console.log("voice:", JSON.stringify(voice));
if (voice.r.customersToSpeakWith !== 26 || voice.r.spokenWith !== 9 || voice.r.sold !== 3 || voice.r.remainingUnits !== 9 || !/3 of 12 sold, 9 of 26/.test(voice.note)) fail("the assistant's target readout is wrong: " + JSON.stringify(voice));

// --- No target yet: the sheet asks for one and nothing is invented.
await p.evaluate(async () => { const s = await import("/js/store.js"); s.updateSettings({ targetNew: 0, targetUsed: 0, goalUnits: 0 }); location.hash = "#/leads"; });
await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(500);
const empty = await p.evaluate(() => ({ table: !!document.querySelector(".tgt"), btn: document.querySelector('.target-card [data-act="set-target"]')?.textContent.trim(), text: document.querySelector(".target-card")?.textContent.replace(/\s+/g, " ").trim() }));
if (empty.table || empty.btn !== "Set your target" || !/how many customers to speak with/.test(empty.text || "")) fail("with no target the sheet should ask for one: " + JSON.stringify(empty));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ntarget.test.js FAILED" : "\ntarget.test.js passed");
})();
