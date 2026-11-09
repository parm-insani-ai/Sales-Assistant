// Any question about the book, run over made-up customers: the fields, the
// operators, the order, the numbers, the words for it, and the profile.
const path = require("path");
(async () => {
const q = await import("file://" + path.resolve(__dirname, "../js/bookquery.js"));
const fail = (x) => { console.error("FAIL: " + x); process.exitCode = 1; };
const J = JSON.stringify;
const now = new Date("2026-11-09T12:00:00").getTime();
const DAY = 86400000;
const iso = (d) => new Date(now + d * DAY).toISOString().slice(0, 10);
const x = { stage: "delivered", source: "Import" };
const leads = [
  { id: "a", name: "Ann Example", phone: "9025550001", email: "a@example.com", vehicleInterest: "2019 Nissan Rogue SV", currentPayment: 520, payoff: 9000, currentValue: 18000, currentApr: 8.9, currentTerm: 84, purchaseDate: "2021-03-10", dealType: "Lease", leaseEnd: iso(40), dob: "1980-11-02", lastContacted: new Date(now - 100 * DAY).toISOString(), notes: "loves the moonroof", ...x },
  { id: "b", name: "Bob Example", vehicleInterest: "2022 Nissan Sentra S", currentPayment: 380, payoff: 15000, currentValue: 14000, currentApr: 4.9, purchaseDate: "2024-05-01", createdAt: new Date(now - 2 * DAY).toISOString(), ...x },
  { id: "c", name: "Cat Example", phone: "9025550003", vehicleInterest: "2018 Honda CR-V", currentPayment: 610, payoff: 2000, currentValue: 16000, currentApr: 11.9, purchaseDate: "2021-07-15", dob: "1975-11-20", lastContacted: new Date(now - 5 * DAY).toISOString(), stage: "new", source: "Walk-in" },
  { id: "d", name: "Dee Example", phone: "9025550004", vehicleInterest: "2020 Nissan Kicks SR", currentPayment: 290, purchaseDate: "2023-01-20", smsOptOut: true, ...x },
];
const ctx = { now, appointments: [{ leadId: "b", when: new Date(now + 3 * DAY).toISOString() }, { leadId: "c", when: new Date(now - 3 * DAY).toISOString() }], tasks: [{ leadId: "a", done: false }, { leadId: "a", done: true }], sales: [{ leadId: "c" }],
  assess: new Map([["a", { score: 72, reasons: ["$9,000 equity", "Lease ends in 40d"], tier: { key: "hot" } }], ["c", { score: 50, reasons: ["Rate 11.9% → ~7.9%"], tier: { key: "strong" } }]]) };
const names = (spec) => q.runQuery(spec, leads, ctx).rows.map((l) => l.name.split(" ")[0]).join(",");
const W = (...where) => ({ where });
const C = (field, op, value) => ({ field, op, value });

// Numbers, dates and text, ANDed.
if (names(W(C("currentPayment", "gt", 500), C("purchaseDate", "inYear", 2021))) !== "Ann,Cat") fail("payment over 500 bought in 2021: " + names(W(C("currentPayment", "gt", 500), C("purchaseDate", "inYear", 2021))));
if (names(W(C("currentPayment", "between", [300, 550]))) !== "Ann,Bob") fail("payment between");
if (names(W(C("model", "is", "rogue"))) !== "Ann") fail("model is rogue");
if (names(W(C("make", "is", "Nissan"), C("currentApr", "gte", 8))) !== "Ann") fail("Nissan with a rate of 8+");
if (names(W(C("body", "is", "suv"))) !== "Ann,Cat,Dee") fail("SUVs: " + names(W(C("body", "is", "suv"))));
if (names(W(C("year", "lt", 2020))) !== "Ann,Cat") fail("model year under 2020");
if (names(W(C("notes", "contains", "moonroof"))) !== "Ann") fail("notes contain");
if (names(W(C("email", "missing"))) !== "Bob,Cat,Dee") fail("no email");
if (names(W(C("phone", "exists"))) !== "Ann,Cat,Dee") fail("has a phone");
if (names(W(C("stage", "in", ["new", "working"]))) !== "Cat") fail("stage in");
if (names(W(C("source", "isnt", "Import"))) !== "Cat") fail("source isn't Import");
// OR.
if (names({ where: [C("model", "is", "rogue"), C("model", "is", "kicks")], any: true }) !== "Ann,Dee") fail("rogue or kicks");
// Dates: a window ahead, a window behind, a month, a year.
if (names(W(C("leaseEnd", "withinDays", 120))) !== "Ann") fail("lease ending in 120 days");
if (names(W(C("birthMonth", "is", 11))) !== "Ann,Cat") fail("birthday in November");
if (names(W(C("dob", "inMonth", 11))) !== "Ann,Cat") fail("dob inMonth");
if (names(W(C("createdAt", "pastDays", 7))) !== "Bob") fail("added this week");
if (names(W(C("nextAppointment", "withinDays", 7))) !== "Bob") fail("appointment this week (a past one doesn't count)");
if (names(W(C("purchaseDate", "before", "2022-01-01"))) !== "Ann,Cat") fail("bought before 2022");
if (names(W(C("purchaseDate", "after", "2023-01-01"))) !== "Bob,Dee") fail("bought after 2023");
// Derived: equity, days since contact (never = forever), can text, open to-dos, sales, score, tier, reasons.
if (names(W(C("equity", "gte", 5000))) !== "Ann,Cat") fail("equity 5000+: " + names(W(C("equity", "gte", 5000))));
if (names(W(C("equity", "lt", 0))) !== "Bob") fail("upside down");
if (names(W(C("daysSinceContact", "gt", 90))) !== "Ann,Bob,Dee") fail("quiet 90 days includes never contacted: " + names(W(C("daysSinceContact", "gt", 90))));
if (names(W(C("contacted", "is", false))) !== "Bob,Dee") fail("never contacted");
if (names(W(C("canText", "is", true))) !== "Ann,Cat") fail("can text (Dee opted out, Bob has no number): " + names(W(C("canText", "is", true))));
if (names(W(C("openTasks", "exists"))) !== "Ann") fail("open to-dos");
if (names(W(C("sales", "gte", 1))) !== "Cat") fail("sold to");
if (names(W(C("score", "gte", 60))) !== "Ann") fail("score 60+");
if (names(W(C("tier", "is", "hot"))) !== "Ann") fail("tier hot");
if (names(W(C("reasons", "contains", "lease"))) !== "Ann") fail("a lease reason");
if (names(W(C("reasonKinds", "contains", "rate"))) !== "Cat") fail("a rate reason");
if (names(W(C("dealType", "is", "lease"))) !== "Ann") fail("leases");
if (names(W(C("ownedYears", "gte", 3))) !== "Ann,Cat,Dee") fail("owned 3+ years: " + names(W(C("ownedYears", "gte", 3))));
// Aliases the assistant might use.
if (names(W(C("payment", "gt", 500))) !== "Ann,Cat") fail("'payment' means currentPayment");
if (names(W(C("rate", "gt", 10))) !== "Cat") fail("'rate' means currentApr");
// Order and limit.
let r = q.runQuery({ where: [], sort: { field: "currentPayment", dir: "desc" }, limit: 2 }, leads, ctx);
if (r.rows.map((l) => l.id).join() !== "c,a" || r.count !== 4) fail("top two by payment: " + J(r.rows.map((l) => l.id)) + " of " + r.count);
r = q.runQuery({ where: [], sort: { field: "equity" } }, leads, ctx);
if (r.rows.map((l) => l.id).join() !== "c,a,b,d") fail("equity with no direction is biggest first, unknown last: " + r.rows.map((l) => l.id).join());
r = q.runQuery({ where: [], sort: { field: "name", dir: "asc" } }, leads, ctx);
if (r.rows[0].id !== "a") fail("by name");
// Numbers and breakdowns.
r = q.runQuery({ where: [C("make", "is", "nissan")], measure: { op: "avg", field: "currentApr" } }, leads, ctx);
if (r.measure !== 6.9) fail("average Nissan rate: " + r.measure);
r = q.runQuery({ where: [], measure: { op: "count" } }, leads, ctx);
if (r.measure !== 4) fail("count");
r = q.runQuery({ where: [], measure: { op: "sum", field: "currentPayment" } }, leads, ctx);
if (r.measure !== 1800) fail("sum of payments: " + r.measure);
r = q.runQuery({ where: [], group: "model" }, leads, ctx);
if (r.groups.length !== 4 || r.groups[0].count !== 1) fail("by model: " + J(r.groups));
r = q.runQuery({ where: [], group: "stage" }, leads, ctx);
if (J(r.groups.map((g) => [g.value, g.count])) !== J([["delivered", 3], ["new", 1]])) fail("by stage: " + J(r.groups));
r = q.runQuery({ where: [], group: "make", measure: { op: "avg", field: "currentPayment" } }, leads, ctx);
if (r.groups.find((g) => g.value === "honda").measure !== 610) fail("average payment by make: " + J(r.groups));
// In words.
const say = (spec) => q.describeQuery(spec);
if (say(W(C("currentPayment", "gt", 500), C("purchaseDate", "inYear", 2021))) !== "payment over $500 · purchase date in 2021") fail("label: " + say(W(C("currentPayment", "gt", 500), C("purchaseDate", "inYear", 2021))));
if (say(W(C("model", "is", "rogue"))) !== "Rogue owners") fail("model label: " + say(W(C("model", "is", "rogue"))));
if (say(W(C("email", "missing"))) !== "no email") fail("missing label: " + say(W(C("email", "missing"))));
if (say(W(C("currentApr", "gte", 7))) !== "rate 7%+") fail("pct label: " + say(W(C("currentApr", "gte", 7))));
if (say(W(C("dob", "inMonth", 11))) !== "birthday in November") fail("month label: " + say(W(C("dob", "inMonth", 11))));
if (say({ where: [C("leaseEnd", "withinDays", 90)], sort: { field: "leaseEnd", dir: "asc" } }) !== "lease end in 90 days, by lease end (lowest first)") fail("sort label: " + say({ where: [C("leaseEnd", "withinDays", 90)], sort: { field: "leaseEnd", dir: "asc" } }));
if (say({ where: [] }) !== "everyone") fail("everyone");
// Bad specs say what's wrong, never throw.
const v = q.validateQuery({ where: [C("foo", "is", 1), C("payment", "bigger", 1)], sort: { field: "nope" } });
if (v.ok || v.errors.length !== 3) fail("validate: " + J(v));
if (!q.validateQuery(W(C("payment", "gt", 1))).ok) fail("a good spec is ok");
if (q.runQuery({ where: [C("foo", "is", 1)] }, leads, ctx).count !== 0) fail("an unknown field matches nobody");
// The profile: counts, never a name.
const p = q.bookProfile(leads, ctx);
console.log(p);
if (!/^4 customers\./.test(p) || !/phone 3/.test(p) || !/lease end 1/.test(p) || !/Models: /.test(p) || /Example/.test(p)) fail("profile: " + p);
if (q.FIELD_HELP.length > 5000 || !/currentPayment \(number, \$\)/.test(q.FIELD_HELP)) fail("field help");

console.log(process.exitCode ? "\nbookquery.test.js FAILED" : "\nbookquery.test.js passed");
})();
