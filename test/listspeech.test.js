// A list said out loud, read into the Outreach screen's own switches.
const path = require("path");
(async () => {
const m = await import("file://" + path.resolve(__dirname, "../js/listspeech.js"));
const fail = (x) => { console.error("FAIL: " + x); process.exitCode = 1; };
const now = new Date("2026-11-06T12:00:00").getTime();
const P = (s) => m.parseList(s, now);
const isListRequest = (s) => m.isListRequest(s, now);
const J = JSON.stringify;

let r = P("Rogue owners with equity I haven't reached in ninety days, highest rate first, call it Rogue equity");
console.log(J({ cuts: r.cuts, sort: r.sort, chip: r.chip, name: r.name, models: r.audience && r.audience.models, quiet: r.audience && r.audience.quietDays, unknown: r.unknown }));
if (r.audience.models.join() !== "rogue" || !r.cuts.includes("equity") || r.audience.quietDays !== 90 || r.sort !== "rate" || r.name !== "Rogue equity" || !r.save || r.unknown.length) fail("the whole sentence: " + J(r));

r = P("make me a list of everyone with a contract ending who I haven't contacted");
if (!r.cuts.includes("ending") || r.chip !== "tocontact" || r.audience || r.unknown.length) fail("contract ending + not contacted: " + J(r));

r = P("show me SUVs from 2018 to 2021 on the same payment, longest quiet first");
if (r.audience.body !== "suv" || r.audience.yearMin !== 2018 || r.audience.yearMax !== 2021 || !r.cuts.includes("payment") || r.sort !== "quiet" || r.unknown.length) fail("SUVs, years, payment, quiet order: " + J(r));

r = P("people with a high rate and warranty ending");
if (r.cuts.join() !== "rate,warranty" || r.sort) fail("high rate is a cut, not the order: " + J(r));

r = P("give me the quiet ones in service");
if (!r.cuts.includes("quiet") || !r.cuts.includes("service")) fail("quiet + in service: " + J(r));

r = P("everyone whose lease is ending in the next three months, soonest first");
if (!r.audience.lease || r.audience.leaseUntil !== "2027-02-04" || r.sort !== "timing" || r.unknown.length) fail("lease in three months: " + J(r));

// "Soon" is the default window said out loud, and "make a list" leaves no
// stray word behind: nothing here is "not understood", so it stays a list.
for (const s of ["make a list of everyone whose lease ends soon", "make a list of everyone whose lease is coming up", "who is coming off lease soon"]) {
  r = P(s);
  if (!r.audience || !r.audience.lease || r.audience.leaseUntil || r.unknown.length || !isListRequest(s)) fail("lease ending soon, as a list: " + s + " " + J(r));
}

r = P("my follow ups who drive a Sentra");
if (r.chip !== "due" || r.audience.models.join() !== "sentra") fail("follow-ups chip: " + J(r));

r = P("Frontier owners I've already contacted, most equity first");
if (r.chip !== "contacted" || r.sort !== "equity" || r.audience.models.join() !== "frontier") fail("contacted + equity order: " + J(r));

r = P("past customers without a phone number");
if (!r.cuts.includes("nonumber") || r.audience.stages.join() !== "sold,delivered") fail("no number + past customers: " + J(r));

r = P("paid off Altimas owned 4 years");
if (!r.audience.paidOff || r.audience.models.join() !== "altima" || r.audience.ownedYears !== 4) fail("paid off, owned 4 years: " + J(r));

r = P("everyone with a blue Rogue, save it as Blue Rogues");
console.log("unknown:", J(r.unknown), "name:", r.name);
if (r.audience.models.join() !== "rogue" || r.unknown.join() !== "blue" || r.name !== "Blue Rogues") fail("what it didn't read is named, the rest still applies: " + J(r));

r = P("um");
if (!r.empty) fail("nothing said is empty: " + J(r));

// What the mic actually hands over.
r = P("rouge owners with equ ity who paid of their car");
if (r.audience.models.join() !== "rogue" || !r.cuts.includes("equity") || !r.audience.paidOff) fail("misheard: " + J(r));

console.log(process.exitCode ? "\nlistspeech.test.js FAILED" : "\nlistspeech.test.js passed");
})();
