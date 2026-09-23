// A customer's current contract, read plainly from the pieces on file.
const path = require("path");
(async () => {
const c = await import("file://" + path.resolve(__dirname, "../js/contract.js"));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const now = new Date("2026-09-23T12:00:00");
const show = (l) => { const r = c.contractSummary(l, now); console.log(JSON.stringify(l).slice(0, 80), "→", r ? r.line + " | " + JSON.stringify(r.rows) : null); return r; };

// A stated count, aged from the date it was stated.
let r = show({ currentPayment: 532, paymentsLeft: 26, paymentsLeftAsOf: "2026-06-20", currentTerm: 72, payoff: 19455, currentApr: 8.9, dealType: "Retail" });
if (!r || r.left !== 23 || !/^Finance · \$532\/mo · 23 payments left, matures Aug 2028$/.test(r.line) || r.paid !== 49) fail("stated count: " + (r && r.line) + " paid " + (r && r.paid));
if (!r.rows.some((x) => x[0] === "Payments left" && /^23 of 72 · as of Jun 20, 2026$/.test(x[1]))) fail("the page row doesn't say as of when: " + JSON.stringify(r.rows));
// A maturity date.
r = show({ currentPayment: 410, leaseEnd: "2027-03-15", dealType: "Lease" });
if (!r || r.left !== 6 || !/^Lease · \$410\/mo · 6 payments left, matures Mar 2027$/.test(r.line)) fail("maturity date: " + (r && r.line));
// Purchase date + term.
r = show({ currentPayment: 380, purchaseDate: "2022-01-11", currentTerm: 84 });
if (!r || r.left !== 28 || !/28 payments left, matures Jan 2029/.test(r.line) || r.paid !== 56) fail("purchase + term: " + (r && [r.line, r.paid]));
// Paid off.
r = show({ currentPayment: 299, purchaseDate: "2019-05-01", currentTerm: 60 });
if (!r || !r.paidOff || !/^was \$299\/mo · paid off May 2024$/.test(r.line)) fail("paid off: " + (r && r.line));
// A stated count that has run out.
r = show({ currentPayment: 299, paymentsLeft: 2, paymentsLeftAsOf: "2026-01-01" });
if (!r || !r.paidOff) fail("a count that ran out isn't paid off: " + (r && r.line));
// Only a payment: honest about the rest.
r = show({ currentPayment: 450 });
if (!r || r.line !== "$450/mo" || r.left !== null) fail("payment only: " + (r && r.line));
// Only a payoff.
r = show({ payoff: 12000 });
if (!r || r.line !== "$12,000 owing") fail("payoff only: " + (r && r.line));
// Nothing.
if (c.contractSummary({ name: "x" }, now)) fail("nothing on file read as a contract");
// The deal math's months-left agrees.
const m = c.paymentsLeftOf({ paymentsLeft: 26, paymentsLeftAsOf: "2026-06-20" }, now);
if (!m || m.left !== 23 || m.src !== "stated") fail("paymentsLeftOf: " + JSON.stringify(m));
console.log(process.exitCode ? "\ncontract.test.js FAILED" : "\ncontract.test.js passed");
})();
