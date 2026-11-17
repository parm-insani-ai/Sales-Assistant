// The lease maturity pipeline, pinned: each stage from the records, red
// inside ninety days with no conversation, retained and lost, the months in
// order with their counts, who's left to call, and the line.
const path = require("path");
(async () => {
const P = await import("file://" + path.resolve(__dirname, "../js/leasepipe.js"));
const R = await import("file://" + path.resolve(__dirname, "../js/reachstate.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const now = new Date("2026-11-17T15:00:00").getTime();
const DAY = 86400000;
const iso = (d) => new Date(now + d * DAY).toISOString();
const ymd = (d) => iso(d).slice(0, 10);
const base = { stage: "delivered", phone: "9025550000", dealType: "Lease", purchaseDate: "2023-11-01", currentPayment: 420 };
const leads = [
  // Ends in 40 days, nobody has tried: red, untouched.
  { id: "a", name: "Ann Untouched", ...base, leaseEnd: ymd(40) },
  // Ends in 70 days, a voicemail left last week: red, contacted.
  { id: "b", name: "Bob Tried", ...base, leaseEnd: ymd(70) },
  // Ends in 100 days, a call they answered: spoken, not red.
  { id: "c", name: "Cal Spoke", ...base, leaseEnd: ymd(100) },
  // Ends in 5 months, an appointment next week: booked.
  { id: "d", name: "Dee Booked", ...base, leaseEnd: ymd(150) },
  // Ends in 2 months, bought from us last month: retained.
  { id: "e", name: "Eve Kept", ...base, leaseEnd: ymd(60) },
  // Ends in 3 months, told us they bought elsewhere: lost.
  { id: "f", name: "Fay Gone", ...base, leaseEnd: ymd(90), lastConversationOutcome: "bought_elsewhere" },
  // Ended 20 days ago, nothing yet: still open, untouched (inside the grace).
  { id: "g", name: "Gus Ended", ...base, leaseEnd: ymd(-20) },
  // Ended 100 days ago, nothing sold: lost by time, off the open list.
  { id: "h", name: "Hal Lapsed", ...base, leaseEnd: ymd(-100) },
  // Spoke with them a year ago — outside the window: untouched for this lease.
  { id: "i", name: "Ida Old", ...base, leaseEnd: ymd(200), lastContacted: iso(-400), lastContactOutcome: "reached" },
  // Ends in 18 months: beyond the twelve-month view.
  { id: "j", name: "Jo Later", ...base, leaseEnd: ymd(540) },
  // A lease with no end date on file.
  { id: "k", name: "Kim Unknown", ...base, leaseEnd: null, currentPayment: 390 },
  // Not a lease: finance — not in the pipeline at all.
  { id: "z", name: "Zed Finance", stage: "delivered", phone: "9025550099", dealType: "Finance", purchaseDate: "2023-01-01", currentPayment: 500, currentTerm: 72 },
];
const calls = [
  { leadId: "b", dir: "out", via: "call", at: iso(-7), outcome: "voicemail" },
  { leadId: "c", dir: "out", via: "call", at: iso(-10), outcome: "reached", conversationOutcome: "interested" },
  { leadId: "d", dir: "out", via: "call", at: iso(-3), outcome: "reached", conversationOutcome: "appointment" },
];
const appointments = [{ leadId: "d", when: iso(7), status: "scheduled" }];
const sales = [{ leadId: "e", saleDate: ymd(-30), vehicle: "2026 Nissan Rogue SV" }];
const idx = R.buildReachIndex({ calls, texts: [], tasks: [], appointments, now });
const matcher = (l) => (l.id === "a" ? { pitch: { unit: { name: "2026 Nissan Rogue SV", network: false }, monthly: 432, delta: 12 } } : null);
const pipe = P.leasePipeline(leads, { now, idx, sales, appointments, matcher, months: 12 });

const stageOf = (id) => { for (const g of [pipe.ended, ...pipe.months]) { const r = g.rows.find((x) => x.lead.id === id); if (r) return r; } return null; };
const want = { a: "untouched", b: "contacted", c: "spoken", d: "booked", e: "retained", f: "lost", g: "untouched", i: "untouched" };
for (const [id, st] of Object.entries(want)) { const r = stageOf(id); if (!r || r.stage !== st) fail(`${id} should be ${st}: ` + JSON.stringify(r && { stage: r.stage, days: r.days })); }
console.log("stages:", JSON.stringify(Object.fromEntries(Object.keys(want).map((id) => [id, stageOf(id) && stageOf(id).stage]))));
if (!stageOf("a").red || !stageOf("b").red || stageOf("c").red || stageOf("f").red || stageOf("g").red) fail("red is inside ninety days with no conversation, and never past the end: " + JSON.stringify({ a: stageOf("a").red, b: stageOf("b").red, c: stageOf("c").red, f: stageOf("f").red, g: stageOf("g").red }));
if (stageOf("h")) fail("a lease past its grace with nothing sold is decided, not listed");
if (stageOf("j") || pipe.later !== 1) fail("beyond the view is counted as later: " + pipe.later);
if (pipe.unknown !== 1) fail("no end date is counted: " + pipe.unknown);
if (stageOf("z")) fail("a finance contract is not in the lease pipeline");
if (!stageOf("a").replacement || stageOf("a").replacement.name !== "2026 Nissan Rogue SV" || stageOf("a").replacement.delta !== 12) fail("the replacement rides on the row: " + JSON.stringify(stageOf("a").replacement));
if (pipe.ended.total !== 1 || pipe.ended.rows[0].lead.id !== "g" || !pipe.ended.rows[0].past) fail("ended inside the grace is its own group: " + JSON.stringify(pipe.ended.rows.map((r) => r.lead.id)));

// Months: twelve in order from this month, the ends in their months, empties kept.
if (pipe.months.length !== 12 || pipe.months[0].key !== "2026-11" || pipe.months[11].key !== "2027-10") fail("twelve months from this one: " + pipe.months.map((m) => m.key).join());
const dec = pipe.months.find((m) => m.key === "2026-12"), jan = pipe.months.find((m) => m.key === "2027-01");
console.log("months:", pipe.months.filter((m) => m.total).map((m) => `${m.key}:${m.total} red ${m.red} ${JSON.stringify(m.counts)}`).join(" | "));
if (!dec || dec.total !== 1 || dec.rows[0].lead.id !== "a" || dec.red !== 1) fail("December holds Ann, red: " + JSON.stringify(dec && dec.rows.map((r) => r.lead.id)));
if (!jan || jan.total !== 2 || jan.counts.retained !== 1 || jan.counts.contacted !== 1) fail("January holds Bob (tried) and Eve (retained): " + JSON.stringify(jan && jan.counts));
// Red first within a month, then by end date.
const feb = pipe.months.find((m) => m.key === "2027-02");
if (!feb || feb.rows.map((r) => r.lead.id).join() !== "f,c") fail("February: Fay (lost) then Cal (spoken) by end date: " + JSON.stringify(feb && feb.rows.map((r) => r.lead.id)));

// Totals and retention: Eve kept, Fay and Hal lost → 1 of 3.
console.log("totals:", JSON.stringify(pipe.totals));
if (pipe.totals.counts.retained !== 1 || pipe.totals.counts.lost !== 2 || pipe.totals.pct !== 33 || pipe.totals.decided !== 3) fail("retention 1 of 3: " + JSON.stringify(pipe.totals));
if (pipe.totals.red !== 2) fail("two red: " + pipe.totals.red);

// Who's left to call: the untouched and tried with a number, red first.
const call = P.toCall(pipe).map((r) => r.lead.id);
console.log("to call:", call.join());
if (call[0] !== "a" || call[1] !== "b" || !call.includes("g") || !call.includes("i") || call.includes("c") || call.includes("e") || call.includes("f")) fail("to call: red first, never the spoken, kept or lost: " + call.join());

// The line.
const line = P.pipelineLine(pipe);
console.log("line:", line);
if (!/^7 leases end in the next 12 months · 1 ended and still open · 2 inside 90 days with no conversation · retention 33% \(1 of 3\) · 1 with no end date on file$/.test(line)) fail("the line: " + line);

console.log(process.exitCode ? "\nleasepipe.test.js FAILED" : "\nleasepipe.test.js passed");
})();
