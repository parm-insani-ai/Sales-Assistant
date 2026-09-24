// The appointment engine's arithmetic, pinned: the funnel, what it takes
// to hit goal, speed to lead, sources, best times, the weekly trend, and
// the show-rate levers — and the findings a manager reads off them.
const path = require("path");
(async () => {
const I = await import("file://" + path.resolve(__dirname, "../js/insight.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const now = new Date("2026-09-24T15:00:00"); // a Thursday, day 24 of 30
const iso = (d) => new Date(d).toISOString();
const day = (n, h = 10) => { const d = new Date(now); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d; };

// --- The funnel.
const appts = [
  // past, this month
  { id: "a1", leadId: "l1", createdAt: iso(day(-10, 9)), when: iso(day(-8, 14)), confirmed: true, outcome: "sold" },
  { id: "a2", leadId: "l2", createdAt: iso(day(-9, 11)), when: iso(day(-7, 15)), confirmed: true, outcome: "showed" },
  { id: "a3", leadId: "l3", createdAt: iso(day(-6, 9)), when: iso(day(-5, 10)), confirmed: false, outcome: "no_show" },
  { id: "a4", leadId: "l4", createdAt: iso(day(-4, 16)), when: iso(day(-3, 11)), confirmed: true, outcome: "showed" },
  { id: "a5", leadId: "l5", createdAt: iso(day(-3, 9)), when: iso(day(-3, 16)), confirmed: false, outcome: "" }, // past, no outcome logged
  { id: "a6", leadId: "l6", createdAt: iso(day(-2, 9)), when: iso(day(-1, 13)), confirmed: true, outcome: "sold", status: "canceled" }, // canceled: ignored
  // future, this month
  { id: "a7", leadId: "l7", createdAt: iso(day(-1, 9)), when: iso(day(1, 10)), confirmed: true, outcome: "" },
  { id: "a8", leadId: "l8", createdAt: iso(day(0, 9)), when: iso(day(2, 10)), confirmed: false, outcome: "" },
];
const f = I.funnel(appts, now.getTime());
console.log("funnel:", JSON.stringify(f));
if (f.set !== 7 || f.past !== 5 || f.shown !== 3 || f.sold !== 1 || f.noShow !== 1 || f.upcoming !== 2 || f.confirmed !== 4) fail("funnel counts: " + JSON.stringify(f));
if (f.showRate !== 60 || f.closeRate !== 33 || f.setToSold !== 20) fail("funnel rates: " + JSON.stringify(f));

// --- What it takes. 12 units, 5 sold, 2 on the calendar, 60% show, 40% close.
let n = I.needs({ goal: 12, sold: 5, futureSet: 2, showRate: 60, closeRate: 40, now });
console.log("needs:", JSON.stringify(n));
// per appt 0.24; pipeline 0.5; units left 6.5; appts needed ceil(6.5/0.24)=28; 7 days left (24..30) → 4 a day
if (n.perAppt !== 0.24 || n.pipeline !== 0.5 || n.unitsLeft !== 6.5 || n.apptsNeeded !== 28 || n.daysLeft !== 7 || n.perDay !== 4 || n.assumed || n.onTrack) fail("the math: " + JSON.stringify(n));
n = I.needs({ goal: 12, sold: 12, futureSet: 0, showRate: 60, closeRate: 40, now });
if (!n.onTrack || n.apptsNeeded !== 0) fail("goal already hit should need nothing: " + JSON.stringify(n));
n = I.needs({ goal: 10, sold: 2, futureSet: 0, now });
if (!n.assumed || n.showRate !== 60 || n.closeRate !== 40 || n.apptsNeeded !== Math.ceil(8 / 0.24)) fail("assumed rates: " + JSON.stringify(n));
n = I.needs({ goal: 0, sold: 0, futureSet: 0, now });
if (!n.onTrack || n.apptsNeeded !== 0) fail("no goal, nothing needed");
n = I.needs({ goal: 10, sold: 0, futureSet: 0, showRate: 50, closeRate: 0, now });
if (n.perAppt !== 0.08 || n.apptsNeeded !== 125) fail("a zero close rate must floor the yield, not blow up the plan: " + JSON.stringify(n));
// Sales logged without the appointment marked sold: close rate from units against shown.
const unmarked = [];
for (let i = 0; i < 10; i++) unmarked.push({ id: "u" + i, leadId: "l" + i, createdAt: iso(day(-12 + i, 9)), when: iso(day(-11 + i, 14)), confirmed: true, outcome: i < 6 ? "showed" : "no_show" });
const um = I.repInsight({ appts: unmarked, leads: [], touches: 40, touchesByDay: {}, goalUnits: 10, sold: 3, now });
if (um.needs.closeRate !== 50 || um.needs.closeFrom !== "units" || um.needs.showRate !== 60 || um.needs.assumed) fail("close rate from units sold against shown: " + JSON.stringify(um.needs));
if (I.touchesPerAppt(84, 7) !== 12 || I.touchesPerAppt(5, 0) !== null) fail("touches per appointment");

// --- Speed to lead: fast leads set, slow ones don't.
const leads = [];
for (let i = 1; i <= 8; i++) leads.push({ id: "l" + i, source: i % 2 ? "Web" : "Walk-in", createdAt: iso(day(-20 + i, 9)), firstContacted: iso(day(-20 + i, i <= 4 ? 9 : 12)), stage: "working" }); // 1-4 within an hour, 5-8 within the day
for (let i = 9; i <= 14; i++) leads.push({ id: "l" + i, source: "Web", createdAt: iso(day(-30 + i, 9)), firstContacted: iso(day(-28 + i, 9)), stage: "working" }); // after a day, none set
for (let i = 15; i <= 18; i++) leads.push({ id: "l" + i, source: "Referral", createdAt: iso(day(-15, 9)), stage: "new" }); // never touched
const sp = I.speedToLead(leads, appts);
console.log("speed:", JSON.stringify(sp.buckets.map((b) => [b.key, b.leads, b.appts, b.setRate])), "median", sp.medianMinutes);
if (sp.buckets[0].leads !== 4 || sp.buckets[0].appts !== 4 || sp.buckets[0].setRate !== 100) fail("within an hour: " + JSON.stringify(sp.buckets[0]));
if (sp.buckets[1].leads !== 4 || sp.buckets[1].appts !== 3 || sp.buckets[1].setRate !== 75) fail("same day: " + JSON.stringify(sp.buckets[1]));
if (sp.buckets[2].leads !== 6 || sp.buckets[2].appts !== 0 || sp.buckets[2].setRate !== 0) fail("after a day: " + JSON.stringify(sp.buckets[2]));
if (sp.buckets[3].leads !== 4 || sp.buckets[3].setRate !== 0) fail("never: " + JSON.stringify(sp.buckets[3]));

// --- Sources.
const src = I.bySource(leads, appts);
console.log("sources:", JSON.stringify(src));
const web = src.find((s) => s.source === "Web"), walk = src.find((s) => s.source === "Walk-in"), ref = src.find((s) => s.source === "Referral");
if (!web || web.leads !== 10 || web.withAppt !== 4 || web.setRate !== 40) fail("web: " + JSON.stringify(web));
if (!walk || walk.leads !== 4 || walk.withAppt !== 3 || walk.setRate !== 75) fail("walk-in: " + JSON.stringify(walk));
if (!ref || ref.leads !== 4 || ref.setRate !== 0) fail("referral: " + JSON.stringify(ref));

// --- Best times: most sets at 9 am.
const tm = I.bestTimes(appts);
if (tm.bestHour !== 9 || tm.hour[9] !== 5) fail("best hour: " + JSON.stringify(tm));

// --- Weekly trend: 8 weeks, oldest first, the last week has this week's sets.
const wk = I.weekly(appts, { now: now.getTime(), touchesByDay: { [day(0).toISOString().slice(0, 10)]: 5, [day(-1).toISOString().slice(0, 10)]: 3 } });
if (wk.length !== 8 || wk[7].weekStart !== "2026-09-21" || wk[7].set !== 3 || wk[7].touches !== 8) fail("this week: " + JSON.stringify(wk[7]));
if (wk[6].set !== 4 || wk[6].shown !== 2) fail("last week: " + JSON.stringify(wk[6]));

// --- Show-rate levers.
const ce = I.confirmEffect(appts, now.getTime());
if (ce.confirmed.past !== 3 || ce.confirmed.shown !== 3 || ce.confirmed.showRate !== 100 || ce.unconfirmed.past !== 2 || ce.unconfirmed.showRate !== 0) fail("confirm effect: " + JSON.stringify(ce));
const lt = I.leadTimeEffect(appts, now.getTime());
if (lt[0].past !== 2 || lt[0].shown !== 1 || lt[1].past !== 3 || lt[1].shown !== 2) fail("lead time: " + JSON.stringify(lt));

// --- The whole picture for one rep, and the findings.
const ins = I.repInsight({ appts, leads, touches: 60, touchesByDay: {}, goalUnits: 12, sold: 5, now });
console.log("needs from insight:", JSON.stringify(ins.needs), "touches/appt", ins.touchesPerAppt, "touches/day", ins.touchesPerDay);
if (ins.setThisMonth !== 7 || ins.touchesPerAppt !== 8.6) fail("set this month / touches per appt: " + ins.setThisMonth + " " + ins.touchesPerAppt);
if (!ins.needs.assumed) fail("five past appointments isn't enough history to plan on — should use assumed rates");
if (ins.touchesPerDay !== Math.ceil(8.6 * ins.needs.perDay)) fail("touches per day: " + ins.touchesPerDay);
const fx = I.findings(ins);
console.log("findings:\n  " + fx.map((x) => x.kind + ": " + x.text).join("\n  "));
if (!fx.some((x) => x.kind === "untouched" && /4 leads/.test(x.text))) fail("the untouched finding is missing");
if (!fx.some((x) => x.kind === "needs" && /appointments set by month end/.test(x.text))) fail("the needs finding is missing");
if (fx.some((x) => x.kind === "speed")) fail("speed finding needs 5+ leads in both buckets; shouldn't fire on 4");

// The store rolls the reps up the same way.
const st = I.storeInsight([{ appts, leads, touches: 60, touchesByDay: {}, goalUnits: 12, sold: 5 }, { appts: [], leads: [], touches: 10, touchesByDay: {}, goalUnits: 10, sold: 1 }], { now });
if (st.needs.goal !== 22 || st.needs.sold !== 6 || st.funnel.set !== 7) fail("store rollup: " + JSON.stringify(st.needs));
console.log(process.exitCode ? "\ninsight.test.js FAILED" : "\ninsight.test.js passed");
})();
