// What a file gives you: before an import, which reasons to call the file's
// columns can support, on what share of rows, and what to ask the dealer
// for. Pure — rows and a mapping in, a report out — so node checks it
// without a browser.
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
(async () => {
const { fileReport } = await import("../js/importreport.js");

// --- An equity export: payment, payoff, value, APR, purchase date on every
// row; no lease ends, no service, a few rows without a number.
const eq = Array.from({ length: 20 }, (_, i) => ({ Name: `Owner ${i}`, Phone: i % 10 === 9 ? "" : "9025550" + String(100 + i), Payment: 400 + i, Payoff: 12000, Value: 15000, APR: 6.9, "Sale Date": "2021-03-01", Vehicle: "2021 Rogue" }));
const m1 = { name: "Name", phone: "Phone", currentPayment: "Payment", payoff: "Payoff", currentValue: "Value", currentApr: "APR", purchaseDate: "Sale Date", vehicleInterest: "Vehicle" };
let r = fileReport(eq, m1);
const states = Object.fromEntries(r.reasons.map((x) => [x.key, x.state]));
console.log("equity export:", r.headline, JSON.stringify(states), "asks:", JSON.stringify(r.asks));
if (states.payment !== "good" || states.equity !== "good" || states.cycle !== "good" || states.rate !== "good" || states.warranty !== "good") fail("the equity export should support payment, equity, years, rate, warranty: " + JSON.stringify(states));
if (states.ending !== "missing") fail("purchase date alone is not a contract end; with no term, lease end or payments left, ending is missing: " + states.ending);
if (states.service !== "missing" || states.lease !== "missing") fail("no service or deal type columns: " + JSON.stringify(states));
if (r.unreachable !== 2 || !/A number for the 2 rows without one/.test(r.asks[0] || "")) fail("the two rows without a number should top the asks: " + JSON.stringify({ unreachable: r.unreachable, asks: r.asks }));
if (!r.asks.some((a) => /Lease end dates/.test(a) && /Contract ending/.test(a))) fail("lease end dates should be asked for, naming what they unlock: " + JSON.stringify(r.asks));
if (!/strong file/.test(r.headline)) fail("five reasons on nearly every row is a strong file: " + r.headline);

// --- A bare list: names and numbers. Nothing to call on.
const bare = Array.from({ length: 10 }, (_, i) => ({ Customer: `Person ${i}`, Cell: "902555" + String(1000 + i) }));
r = fileReport(bare, { name: "Customer", phone: "Cell" });
console.log("bare list:", r.headline);
if (r.unlocked.length || !/list of names/.test(r.headline)) fail("a bare list should say so: " + r.headline);
if (r.unreachable !== 0) fail("everyone has a number: " + r.unreachable);

// --- Partial: payment on half the rows reads as partial, with an ask to
// fill it; a mapping fixed to the right column makes it good.
const half = Array.from({ length: 10 }, (_, i) => ({ Name: `P ${i}`, Phone: "9025550" + i, Pmt: i < 5 ? 450 : "", RealPmt: 450, "Lease End": "2027-03-01", Type: "Lease" }));
r = fileReport(half, { name: "Name", phone: "Phone", currentPayment: "Pmt", leaseEnd: "Lease End", dealType: "Type" });
let st = Object.fromEntries(r.reasons.map((x) => [x.key, x.state]));
console.log("half:", JSON.stringify(st), JSON.stringify(r.asks));
if (st.payment !== "partial" || st.ending !== "good" || st.lease !== "good") fail("half the payments is partial; lease end and type are good: " + JSON.stringify(st));
if (!r.asks.some((a) => /current monthly payment on every row/.test(a) && /50%/.test(a))) fail("the partial column should be asked for, with its share: " + JSON.stringify(r.asks));
r = fileReport(half, { name: "Name", phone: "Phone", currentPayment: "RealPmt", leaseEnd: "Lease End", dealType: "Type" });
if (r.reasons.find((x) => x.key === "payment").state !== "good") fail("fixing the column should fix the report");

// --- Equity from payments remaining when there's no payoff column.
const rem = Array.from({ length: 8 }, (_, i) => ({ Name: `R ${i}`, Phone: "9025551" + i, Payment: 500, "Remaining Term": 20, Value: 16000 }));
r = fileReport(rem, { name: "Name", phone: "Phone", currentPayment: "Payment", paymentsLeft: "Remaining Term", currentValue: "Value" });
st = Object.fromEntries(r.reasons.map((x) => [x.key, x.state]));
if (st.equity !== "good" || st.ending !== "good") fail("payment × payments left with a value is equity, and payments left is a contract end: " + JSON.stringify(st));

console.log(process.exitCode ? "\nimportreport.test.js FAILED" : "\nimportreport.test.js passed");
})();
