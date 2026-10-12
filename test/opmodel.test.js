// The operating model's arithmetic, pinned: 80 units at the store's ratios
// back to customers, appointments, ups by source, per rep, and the pace.
const path = require("path");
(async () => {
const M = await import("file://" + path.resolve(__dirname, "../js/opmodel.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

// October 2026: 31 days, starts on a Thursday; Mon–Sat gives 27 selling days.
const oct12 = new Date("2026-10-12T15:00:00");
const d = M.sellingDays(oct12, [1, 2, 3, 4, 5, 6]);
console.log("days:", JSON.stringify(d));
if (d.all !== 27 || d.gone !== 10 || d.left !== 17 || !d.isSellingDay || d.rep !== 23) fail("October's selling days, and a rep's 23: " + JSON.stringify(d));

const reps = [{ user_id: "a", name: "Parm" }, { user_id: "b", name: "Dana" }, { user_id: "c", name: "Ken" }, { user_id: "d", name: "Sam" }];
const plan = M.storePlan({}, { members: reps, now: oct12 });
console.log("plan:", JSON.stringify({ targets: plan.targets, closing: plan.closing, customers: plan.customers, appts: plan.appts, walkins: plan.walkins, upsNeeded: plan.upsNeeded, mixClose: plan.mixClose, lever: plan.lever, pace: plan.pace }));
if (plan.targets.units !== 80) fail("80 units");
// 50 ÷ 0.415 = 120.5 → 121; 30 ÷ 0.415 = 72.3 → 73; 194 customers, 7.2 a day.
if (plan.customers.new !== 121 || plan.customers.used !== 73 || plan.customers.total !== 194 || plan.customers.perDay !== 7.2) fail("customers: " + JSON.stringify(plan.customers));
// 60% of 80 = 48 through appointments; 48 ÷ 0.72 = 67 shows; 67 ÷ 0.6 = 112 set; 4.1 a day.
if (plan.appts.unitsVia !== 48 || plan.appts.shows !== 67 || plan.appts.set !== 112 || plan.appts.perDay !== 4.1) fail("appointments: " + JSON.stringify(plan.appts));
if (plan.walkins.units !== 32) fail("walk-in units: " + plan.walkins.units);
// The mix: 1300 ups → 540 units = 41.5%; 80 ÷ 0.415 = 193 ups; dealer site is 29% of them.
if (plan.mixClose !== 42 || plan.upsNeeded !== 193) fail("ups needed: " + plan.upsNeeded + " at " + plan.mixClose);
const ds = plan.sources.find((s) => s.key === "dealer_site"), ap = plan.sources.find((s) => s.key === "appointment");
if (!ds || ds.upsNeeded !== 57 || ds.close !== 26 || !ap || ap.upsNeeded !== 26 || ap.close !== 72) fail("sources: " + JSON.stringify([ds, ap]));
if (plan.sources[0].key !== "dealer_site") fail("the biggest source isn't first");
if (Math.abs(plan.sources.reduce((a, s) => a + s.unitsExpected, 0) - 80) > 1.5) fail("the sources don't add up to the target: " + plan.sources.reduce((a, s) => a + s.unitsExpected, 0));
if (!plan.lever || plan.lever.apptClose !== 72 || plan.lever.perUp !== 0.3) fail("the appointment lever: " + JSON.stringify(plan.lever));
// Four reps, an even 20 each: 49 customers, 28 appointments; 4.5 weeks; a rep's 23 working days.
const parm = plan.perRep.find((r) => r.member.user_id === "a");
if (!parm || parm.units !== 20 || parm.customers !== 49 || parm.appts !== 28 || parm.week.units !== 4.4 || parm.day.customers !== 2.1 || parm.day.appts !== 1.2) fail("Parm's share: " + JSON.stringify(parm));
// Pace on the 12th: 10 of 27 selling days gone = 37%.
if (plan.pace.frac !== 37 || plan.pace.units !== 29.6 || plan.pace.customers !== 71.9 || plan.pace.appts !== 41.5) fail("pace: " + JSON.stringify(plan.pace));

// An allocation: Parm carries 30, the rest split 50.
const p2 = M.storePlan({ alloc: { a: 30 } }, { members: reps, now: oct12 });
const shares = p2.perRep.map((r) => r.units);
if (JSON.stringify(shares) !== JSON.stringify([30, 16.7, 16.7, 16.7])) fail("allocation: " + JSON.stringify(shares));

// Sunday selling, and a measured month replacing the ratios.
const p3 = M.storePlan({ sellingDays: [0, 1, 2, 3, 4, 5, 6], closingNew: 35, closingUsed: 40, apptShare: 50, showRate: 65, closeOnShow: 70 }, { members: reps, now: oct12 });
if (p3.days.all !== 31 || p3.customers.new !== 143 || p3.customers.used !== 75 || p3.appts.unitsVia !== 40 || p3.appts.shows !== 58 || p3.appts.set !== 90) fail("a different month: " + JSON.stringify([p3.days, p3.customers, p3.appts]));

// The pace read.
const read = M.paceRead(plan, { units: 31, customers: 60, appts: 41.5 });
console.log("pace read:", JSON.stringify(read));
if (read[0].state !== "ahead" || read[0].text !== "1.4 ahead" || read[1].state !== "behind" || read[1].text !== "11.9 behind" || read[2].state !== "on") fail("the pace read: " + JSON.stringify(read));

// Source names from the CRM and the app onto the plan's rows.
const map = { "Dealer Site": "dealer_site", "O'Regan's Website": "website", "Walk-in": "lot", "Facebook": "facebook", "Referral": "referral", "AutoAlert paid-off": "autoalert", "Service Drive": "service_drive", "Service": "service", "Repeat Customer": "repeat", "Appointment": "appointment", "Manufacturer Internet/Email lead": "oem", "Promo Letter": "promo", "": "other", "Voice": "other", "Phone-up": "website" };
for (const [k, v] of Object.entries(map)) if (M.sourceKey(k) !== v) fail(`source "${k}" → ${M.sourceKey(k)}, wanted ${v}`);

console.log(process.exitCode ? "\nopmodel.test.js FAILED" : "\nopmodel.test.js passed");
})();
