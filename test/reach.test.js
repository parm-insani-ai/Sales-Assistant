// The manager's read of a customer, pinned: the signals, the score, the
// tiers relative to the book, who makes the reach-out list, and the task
// that gets handed to the rep.
const path = require("path");
(async () => {
const R = await import("file://" + path.resolve(__dirname, "../js/reach.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const now = new Date("2026-09-25T12:00:00");
const iso = (d) => new Date(d).toISOString();
const ago = (days) => iso(now.getTime() - days * 86400000);

const leaseEnd = { id: "a", name: "Lease Ending", phone: "1", stage: "delivered", vehicleInterest: "2023 Nissan Rogue SV", dealType: "Lease", leaseEnd: "2026-12-10", currentPayment: 520, purchaseDate: "2023-12-10", createdAt: ago(600) };
const equity = { id: "b", name: "Big Equity", phone: "1", stage: "delivered", vehicleInterest: "2020 Nissan Frontier PRO-4X", currentValue: 31000, payoff: 18000, currentPayment: 610, purchaseDate: "2020-08-01", currentApr: 9.9, createdAt: ago(900) };
const fresh = { id: "c", name: "Fresh Lead", phone: "1", stage: "new", vehicleInterest: "Kicks", source: "Web", createdAt: ago(3) };
const quiet = { id: "d", name: "Paid Off Quiet", phone: "1", stage: "delivered", vehicleInterest: "2017 Nissan Sentra SV", purchaseDate: "2017-05-01", currentValue: 9000, lastContacted: ago(200), createdAt: ago(1500) };
const justTouched = { id: "e", name: "Touched Last Week", phone: "1", stage: "delivered", vehicleInterest: "2021 Nissan Rogue", currentValue: 25000, payoff: 15000, purchaseDate: "2021-06-01", lastContacted: ago(5), createdAt: ago(800) };
const lost = { id: "f", name: "Marked Lost", phone: "1", stage: "lost", vehicleInterest: "Rogue", createdAt: ago(30) };
const noPhone = { id: "g", name: "No Phone", stage: "delivered", vehicleInterest: "2019 Nissan Kicks", currentValue: 14000, payoff: 3000, purchaseDate: "2019-03-01", createdAt: ago(900) };
const inPlay = { id: "h", name: "At The Table", phone: "1", stage: "negotiating", vehicleInterest: "2020 Nissan Murano", currentValue: 22000, payoff: 10000, purchaseDate: "2020-01-01", createdAt: ago(700) };
const upside = { id: "i", name: "Upside Down", phone: "1", stage: "delivered", vehicleInterest: "2024 Nissan Pathfinder", currentValue: 38000, payoff: 44000, currentPayment: 900, purchaseDate: "2024-06-01", createdAt: ago(400) };

const r = (l) => R.readCustomer(l, { now });
const a = r(leaseEnd);
console.log("lease:", a.score, a.reasons, a.next && a.next.label);
if (!a.reasons.some((x) => /Lease ends in [23] mo/.test(x)) || a.score < 40 || !/Lease-end/.test(a.next.label)) fail("lease ending: " + JSON.stringify(a));
const b = r(equity);
console.log("equity:", b.score, b.reasons);
if (!b.reasons.includes("$13,000 equity") || !b.reasons.some((x) => /Owned 6 yrs/.test(x)) || !b.reasons.includes("Rate 9.9%") || b.score < 45 || !/Equity opener/.test(b.next.label)) fail("equity: " + JSON.stringify(b));
const c = r(fresh);
if (!c.reasons.includes("Live lead") || !c.reasons.includes("Never touched") || c.next.kind !== "call") fail("fresh untouched lead: " + JSON.stringify(c));
const d = r(quiet);
console.log("quiet:", d.score, d.reasons);
if (!d.reasons.includes("Paid off") || !d.reasons.includes("Gone quiet") || !d.reasons.some((x) => /Owned 9 yrs/.test(x))) fail("paid off and quiet: " + JSON.stringify(d));
const e = r(justTouched);
if (!(e.score < r({ ...justTouched, lastContacted: undefined }).score) || !e.why.some((w) => /Contacted 5 days ago/.test(w))) fail("recent contact should cost points: " + JSON.stringify(e));
if (r(lost).score !== 0 || !r(lost).excluded) fail("lost must be excluded");
const g = r(noPhone);
if (g.contactable || !g.reasons.includes("No phone or email")) fail("no phone: " + JSON.stringify(g));
const h = r(inPlay);
if (!h.inPlay || h.next.kind !== "inplay") fail("in play: " + JSON.stringify(h));
const i = r(upside);
if (!i.reasons.includes("$6,000 upside down")) fail("upside down caution: " + JSON.stringify(i));
// Equity estimated from payment × payments left when the payoff is missing.
const est = R.equityOf({ currentValue: 20000, currentPayment: 400, paymentsLeft: 10, paymentsLeftAsOf: "2026-09-01" }, now.getTime());
if (est.v !== 16000 || est.src !== "est") fail("estimated equity: " + JSON.stringify(est));

// --- The book, ranked; tiers relative to it; the reach-outs.
const reps = { p: { user_id: "p", name: "Parm" }, d: { user_id: "d", name: "Dana" } };
const rows = [leaseEnd, equity, fresh, quiet, justTouched, lost, noPhone, inPlay, upside].map((lead, k) => ({ lead, rep: k % 2 ? reps.d : reps.p }));
const ranked = R.rankBook(rows, { now });
console.log("ranked:", ranked.rows.map((x) => `${x.lead.name}:${x.read.score}${x.tier ? "/" + x.tier.key : ""}`).join("  "), "cuts", JSON.stringify(ranked.cuts));
const top2 = ranked.rows.slice(0, 2).map((x) => x.lead.name).sort().join();
if (top2 !== "Big Equity,Paid Off Quiet" || !ranked.rows[0].tier || !["hot", "strong"].includes(ranked.rows[0].tier.key)) fail("the two biggest opportunities aren't on top with a tier: " + top2);
const outs = R.reachOuts(ranked, { limit: 10 });
const names = outs.map((x) => x.lead.name);
console.log("reach-outs:", names.join(", "));
if (names.includes("Marked Lost") || names.includes("At The Table") || names.includes("No Phone")) fail("excluded, in-play or unreachable customers made the list: " + names.join(", "));
if (!names.includes("Big Equity") || !names.includes("Lease Ending") || !names.includes("Fresh Lead")) fail("the obvious reach-outs are missing: " + names.join(", "));

// --- The task handed to the rep.
const t = R.taskFor(ranked.rows.find((x) => x.lead.id === "b"), { by: "Sam", now });
console.log("task:", JSON.stringify(t));
if (!/^Reach out to Big Equity — \$13,000 equity, Owned 6 yrs \(from Sam\)$/.test(t.title) || t.due !== "2026-09-25" || t.channel !== "message" || t.leadId !== "b" || !t.fromManager) fail("the task: " + JSON.stringify(t));
const tc = R.taskFor(ranked.rows.find((x) => x.lead.id === "c"), { by: "Sam", now });
if (tc.channel !== "call") fail("an untouched lead's task should be a call");
console.log(process.exitCode ? "\nreach.test.js FAILED" : "\nreach.test.js passed");
})();
