// "Find me some people I can reach out to so I can set some appointments,
// I'm falling behind" — a goal, not a list. The day's plan answers it from
// the month: how far behind, how many appointments today, how many calls
// that is at this rep's own ratio, and who; then Home keeps count and
// Right now says what's left when the afternoon gets away.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "j@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Jordan Reid", dealership: "O'Regan's Nissan", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72, consentAtPurchase: true,
      goalUnits: 12, goalAppointments: 30, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", smsFrom: "+19025550123" } }));
});
await p.goto(APP + "/#/settings");

// The book: forty owners with their financials; four appointments set so
// far this month (behind on a 30-a-month goal unless it's the 1st); a
// couple of months of calls, one in four followed by an appointment.
const seeded = await p.evaluate(async () => {
  const store = await import("/js/store.js"); await store.ready;
  const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
  const ids = [];
  store.bulk(() => {
    for (let i = 0; i < 40; i++) {
      const l = store.create("leads", { name: "Owner " + i, phone: "902555" + String(2000 + i).slice(-4), stage: "delivered", source: "AutoAlert Import",
        vehicleInterest: ["2019 Nissan Rogue SV", "2020 Nissan Sentra SV", "2018 Nissan Pathfinder SL", "2021 Nissan Kicks SR"][i % 4],
        purchaseDate: "2021-0" + (i % 9 + 1) + "-11", currentPayment: 380 + (i % 12) * 20, payoff: 6000 + (i % 10) * 900, currentValue: 15000 + (i % 8) * 800, currentApr: 5.9 + (i % 4) });
      ids.push(l.id);
    }
    // Appointments set this month, dated earlier this month (never the future).
    const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1, 10, 0).toISOString();
    for (let i = 0; i < 4; i++) store.create("appointments", { leadId: ids[30 + i], customerName: "Owner " + (30 + i), type: "appointment", when: first.slice(0, 16), status: "scheduled", createdAt: first, updatedAt: first });
    // Calls: 24 dials over the last 60 days; six of them booked inside a day (last month, so they don't count as this month's sets).
    for (let i = 0; i < 24; i++) {
      const at = iso(-50 + i); const lead = ids[i];
      store.create("calls", { leadId: lead, dir: "out", at, outcome: i % 4 === 0 ? "reached" : "", notes: "", createdAt: at, updatedAt: at });
      if (i % 4 === 0) { const set = new Date(new Date(at).getTime() + 3600000).toISOString(); store.create("appointments", { leadId: lead, customerName: "Owner " + i, type: "appointment", when: set.slice(0, 16), status: "scheduled", outcome: "showed", createdAt: set, updatedAt: set }); }
    }
  });
  return store.all("leads").length;
});
console.log("book:", seeded, "owners");

// --- The plan itself, as the assistant's tool returns it.
const plan = await p.evaluate(async () => {
  const m = await import("/js/agent.js");
  const out = await m.execTool("appointment_plan", {});
  return { result: out.result, note: out.note, hash: location.hash };
});
console.log("plan:", JSON.stringify({ ...plan.result, people: plan.result.people.slice(0, 2) }).slice(0, 700));
const r = plan.result;
if (!(r.month.behind > 0) && new Date().getDate() > 2) fail("four set this month on a 30-a-month goal should read as behind: " + JSON.stringify(r.month));
if (!(r.today.appointmentsToSet >= 1) || r.today.callsToMake !== r.today.appointmentsToSet * r.today.callsPerAppointment) fail("today's calls should be appointments × the ratio: " + JSON.stringify(r.today));
if (r.today.callsPerAppointment !== 4 || r.today.ratioAssumed) fail("the ratio should be this rep's own, four to one: " + JSON.stringify(r.today));
// Everyone on the book is a month or more from their last call, so all forty
// are fair game; late in the month the day can need every one of them.
if (r.people.length !== Math.min(r.today.callsToMake, 40) || !r.people[0].reason) fail("the plan should name as many people as calls, each with a reason: " + r.people.length + " for " + r.today.callsToMake);
if (!/behind where the month should be/.test(r.answer) || !/to one, so that's \d+ calls today/.test(r.answer) || !/best first: Owner/.test(r.answer)) fail("the spoken answer should reason from the month to the calls to the names: " + r.answer);
// The reasons are the salesperson's own (a payment figure is fine in their
// ear — nothing here goes to a customer), and each name has one.
if (r.people.some((x) => !x.reason)) fail("someone on the plan has no reason: " + JSON.stringify(r.people.filter((x) => !x.reason)));
if (plan.hash !== "#/log") fail("the plan should land on the queue: " + plan.hash);

// --- Said the floor's way, into the blast tool by mistake: the plan answers.
const asBlast = await p.evaluate(async () => { const m = await import("/js/agent.js"); return (await m.execTool("mass_outreach", { sentence: "find me some people I can reach out to so I can set some appointments, I'm falling behind on appointments, I need more" })).result; });
if (!asBlast.notABlast || !asBlast.answer || !/behind/.test(asBlast.answer)) fail("the blast tool should hand a goal sentence to the plan: " + JSON.stringify(asBlast).slice(0, 200));

// --- Home keeps count: the card, then a call made against it.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(600);
const card = () => p.evaluate(() => document.querySelector(".plan-card")?.textContent.replace(/\s+/g, " ").trim() || "");
let c = await card();
console.log("home:", c);
if (!/^Today's plan · \d+ calls? → \d+ appointments?/.test(c) || !/0 calls made · 0 of \d+ set · \d+ still to call/.test(c)) fail("Home should show the plan with nothing made yet: " + c);
const first = r.people[0].name;
await p.evaluate(async (name) => { const s = await import("/js/store.js"); const l = s.all("leads").find((x) => x.name === name); s.logCall(l.id, { outcome: "reached" }); }, first);
await p.evaluate(() => { location.hash = "#/log"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(600);
c = await card();
console.log("after a call:", c);
if (!/1 call made/.test(c)) fail("a call logged should count on the plan: " + c);
const still = Number((/(\d+) still to call/.exec(c) || [])[1]);
if (still !== r.people.length - 1) fail(`one fewer still to call after one call: ${still} vs ${r.people.length - 1}`);

// --- Two hours on, with calls left: the line under Right now.
const nudge = await p.evaluate(async () => {
  const n = await import("/js/nudges.js");
  const soon = n.getNudges({ now: Date.now() + 30 * 60000, limit: 20 }).find((x) => x.kind === "plan");
  const later = n.getNudges({ now: Date.now() + 3 * 3600000, limit: 20 }).find((x) => x.kind === "plan");
  return { soon: !!soon, later: later ? { title: later.title, sub: later.sub, route: later.route } : null };
});
console.log("nudge:", JSON.stringify(nudge));
if (nudge.soon) fail("the plan shouldn't nag half an hour in");
if (!nudge.later || !/^\d+ calls left on today's plan$/.test(nudge.later.title) || !/1 made, 0 of \d+ appointments? set/.test(nudge.later.sub) || nudge.later.route !== "/log") fail("two hours on, Right now should say what's left on the plan: " + JSON.stringify(nudge));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "plan: FAILED" : "plan: ok");
})().catch((e) => { console.error(e); process.exit(1); });
