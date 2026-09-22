// "Make sure we are using all of the information from the import list to be
// as accurate as possible. It seems like some of the payoff (payments left
// times payment) are not being taken into consideration, i.e. negative
// equity is not being calculated."
//
// It was true. The importer had no column for payments remaining, so a
// customer whose export carried a payment and a count of payments left — but
// no payoff and no maturity date — had no payoff, therefore no equity,
// therefore never showed as upside down. And an export that gave a value and
// an equity figure but no payoff was read as if the payoff were unknown.
//
// So: every money column an export can carry is read, the missing third of
// value/payoff/equity is worked out from the other two, payments left become
// a payoff that ages with the calendar, and negative equity shows up on the
// card, in the reasons, and in the payment of the deal being pitched.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "j@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Jordan Reid", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72,
      supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/settings");
await p.evaluate(async () => { const s = await import("/js/store.js"); await s.ready; });

// --- 1. The columns an AutoAlert export carries all land somewhere.
console.log("column mapping:");
const mapped = await p.evaluate(async () => {
  const imp = await import("/js/views/import.js"); const csv = await import("/js/csv.js");
  const headers = ["Customer", "Cell Phone", "Home Phone", "Current Vehicle", "Deal Date", "Payment", "Payments Remaining", "Term", "Rate", "Est Payoff", "Est Value", "Est Equity", "Odometer", "Alert Type", "Priority", "Deal Type", "RO Appt", "Last RO Date", "New Payment", "New Vehicle"];
  const m = csv.autoMap(headers, imp.LEAD_TARGETS);
  return m;
});
console.log("  " + JSON.stringify(mapped));
for (const [field, header] of [["paymentsLeft", "Payments Remaining"], ["currentTerm", "Term"], ["payoff", "Est Payoff"], ["currentValue", "Est Value"], ["equity", "Est Equity"], ["odometer", "Odometer"], ["alertType", "Alert Type"], ["priority", "Priority"], ["dealType", "Deal Type"], ["serviceAppt", "RO Appt"], ["lastService", "Last RO Date"], ["phone2", "Home Phone"], ["currentApr", "Rate"]]) {
  if (mapped[field] !== header) fail(`"${header}" should map to ${field}, mapped to ${JSON.stringify(mapped[field])}`);
}
if (mapped.currentPayment !== "Payment") fail(`the current payment mapped to ${JSON.stringify(mapped.currentPayment)}`);
if (["Payment", "Payments Remaining"].includes(mapped._skipProposed)) fail("the proposed-deal decoy ate a real column");

// --- 2. A row with a payment and payments left but no payoff: the payoff is
// payment × payments left, and the equity — negative here — follows.
console.log("\npayoff from payments left:");
const noPayoff = await p.evaluate(async (mapping) => {
  const imp = await import("/js/views/import.js"); const store = await import("/js/store.js"); const db = await import("/js/views/dealbuilder.js"); const a = await import("/js/assess.js");
  const row = { "Customer": "Under Water", "Cell Phone": "9025551001", "Current Vehicle": "2019 Nissan Versa S", "Deal Date": "2022-03-01", "Payment": "$520.00", "Payments Remaining": "40", "Term": "84", "Rate": "9.9", "Est Payoff": "", "Est Value": "", "Est Equity": "", "Odometer": "61,000", "Alert Type": "Flex Alert", "Priority": "High", "Deal Type": "Retail", "RO Appt": "", "Last RO Date": "", "New Payment": "$610", "New Vehicle": "2026 Kicks" };
  const rec = imp.buildRecord("leads", row, mapping);
  const lead = store.create("leads", rec);
  const inp = db.dealInputs(lead);
  const eq = db.equityDetail(lead);
  const x = a.assessment(lead.id);
  // A twin who owes nothing: the difference in the pitched payment is the
  // negative equity being rolled into the new deal.
  const twin = store.create("leads", { ...rec, name: "Clear Title", phone: "9025551002", paymentsLeft: null, payoff: 0 });
  const best = db.bestPitch(lead, "finance"), bestTwin = db.bestPitch(twin, "finance");
  return { rec: { paymentsLeft: rec.paymentsLeft, asOf: rec.paymentsLeftAsOf, alertType: rec.alertType, priority: rec.priority, dealType: rec.dealType },
    payoff: inp.payoff, value: inp.value, equity: eq, reasons: x.reasons, why: x.why,
    monthly: best && Math.round(best.monthly), monthlyTwin: bestTwin && Math.round(bestTwin.monthly), pitch: best && best.vehicle.model };
}, mapped);
console.log("  " + JSON.stringify({ rec: noPayoff.rec, payoff: noPayoff.payoff, value: noPayoff.value, equity: noPayoff.equity }));
console.log("  reasons:", noPayoff.reasons.join(" · "));
console.log(`  pitched ${noPayoff.pitch}: ${noPayoff.monthly}/mo owing ${noPayoff.payoff.v}, vs ${noPayoff.monthlyTwin}/mo with a clear title`);
if (noPayoff.rec.paymentsLeft !== 40) fail("payments remaining wasn't read");
if (noPayoff.rec.alertType !== "Flex Alert" || noPayoff.rec.priority !== "High" || noPayoff.rec.dealType !== "Retail") fail("the export's alert, priority and deal type aren't stored as fields");
if (noPayoff.payoff.src !== "calc" || noPayoff.payoff.v !== 20800) fail(`payoff should be 520 × 40 = 20,800 (calc), got ${JSON.stringify(noPayoff.payoff)}`);
if (noPayoff.equity.v == null) fail("equity is still unknown with a payment and payments left on file");
if (noPayoff.equity.v >= 0) fail(`a Versa owing $20,800 should be upside down, equity came out ${noPayoff.equity.v}`);
if (!noPayoff.reasons.some((r) => /upside down/i.test(r))) fail("negative equity isn't on the card: " + noPayoff.reasons.join(", "));
if (!noPayoff.why.some((w) => /payments left/i.test(w))) fail("the read doesn't say the payoff was worked out from payments left");
if (noPayoff.monthly == null || noPayoff.monthlyTwin == null) fail("no deal was priced");
else if (noPayoff.monthly <= noPayoff.monthlyTwin + 50) fail(`the negative equity isn't in the pitched payment (${noPayoff.monthly} vs ${noPayoff.monthlyTwin} with a clear title)`);

// --- 3. Value and equity but no payoff: payoff = value − equity.
console.log("\npayoff from value − equity:");
const fromEq = await p.evaluate(async (mapping) => {
  const imp = await import("/js/views/import.js"); const store = await import("/js/store.js"); const db = await import("/js/views/dealbuilder.js");
  const row = { "Customer": "Val Andequity", "Cell Phone": "9025551003", "Current Vehicle": "2021 Nissan Rogue SV", "Deal Date": "2021-06-01", "Payment": "$540", "Payments Remaining": "", "Term": "72", "Rate": "6.9", "Est Payoff": "", "Est Value": "$18,000", "Est Equity": "-$2,500", "Odometer": "", "Alert Type": "", "Priority": "", "Deal Type": "", "RO Appt": "", "Last RO Date": "", "New Payment": "", "New Vehicle": "" };
  const rec = imp.buildRecord("leads", row, mapping);
  const lead = store.create("leads", rec);
  return { payoff: rec.payoff, equity: db.equityDetail(lead) };
}, mapped);
console.log("  " + JSON.stringify(fromEq));
if (fromEq.payoff !== 20500) fail(`payoff should be 18,000 − (−2,500) = 20,500, got ${fromEq.payoff}`);
if (fromEq.equity.v !== -2500 || fromEq.equity.src !== "known") fail(`equity should be −2,500 and solid, got ${JSON.stringify(fromEq.equity)}`);

// --- 4. Equity and payments left but no value: the export's equity is kept,
// and the value is the worked-out payoff plus it.
console.log("\nvalue from payoff + the export's equity:");
const fromImp = await p.evaluate(async (mapping) => {
  const imp = await import("/js/views/import.js"); const store = await import("/js/store.js"); const db = await import("/js/views/dealbuilder.js");
  const row = { "Customer": "Eq Only", "Cell Phone": "9025551004", "Current Vehicle": "2020 Nissan Sentra SV", "Deal Date": "2020-09-01", "Payment": "$500", "Payments Remaining": "30", "Term": "84", "Rate": "7.5", "Est Payoff": "", "Est Value": "", "Est Equity": "-$3,000", "Odometer": "", "Alert Type": "", "Priority": "", "Deal Type": "", "RO Appt": "", "Last RO Date": "", "New Payment": "", "New Vehicle": "" };
  const rec = imp.buildRecord("leads", row, mapping);
  const lead = store.create("leads", rec);
  const inp = db.dealInputs(lead);
  return { importedEquity: rec.importedEquity, payoff: inp.payoff, value: inp.value, equity: db.equityDetail(lead) };
}, mapped);
console.log("  " + JSON.stringify(fromImp));
if (fromImp.payoff.v !== 15000) fail(`payoff should be 500 × 30 = 15,000, got ${JSON.stringify(fromImp.payoff)}`);
if (fromImp.value.src !== "import" || fromImp.value.v !== 12000) fail(`value should be 15,000 − 3,000 from the export's equity, got ${JSON.stringify(fromImp.value)}`);
if (fromImp.equity.v !== -3000) fail(`equity should be −3,000, got ${fromImp.equity.v}`);

// --- 5. Payments left age with the calendar; when they've run out, it's paid off.
console.log("\npayments left age:");
const aged = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const db = await import("/js/views/dealbuilder.js");
  const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
  const mid = store.create("leads", { name: "Half Way", phone: "9025551005", stage: "delivered", vehicleInterest: "2021 Nissan Rogue SV", currentPayment: 500, paymentsLeft: 24, paymentsLeftAsOf: monthsAgo(6) });
  const done = store.create("leads", { name: "All Paid", phone: "9025551006", stage: "delivered", vehicleInterest: "2018 Nissan Rogue SV", currentPayment: 500, paymentsLeft: 5, paymentsLeftAsOf: monthsAgo(8) });
  return { midMonths: db.monthsRemaining(mid), midPayoff: db.dealInputs(mid).payoff, doneMonths: db.monthsRemaining(done), donePayoff: db.dealInputs(done).payoff, doneEquity: db.equityDetail(done) };
});
console.log("  " + JSON.stringify(aged));
if (aged.midMonths !== 18) fail(`24 payments left six months ago should be 18 now, got ${aged.midMonths}`);
if (aged.midPayoff.v !== 9000) fail(`payoff should be 500 × 18 = 9,000, got ${JSON.stringify(aged.midPayoff)}`);
if (aged.donePayoff.v !== 0) fail(`five payments left eight months ago means paid off, got ${JSON.stringify(aged.donePayoff)}`);
if (aged.doneEquity.v == null || aged.doneEquity.v <= 0) fail("a paid-off car with a book value should show positive equity");

// --- 6. A re-import updates the count instead of keeping the stale one.
const merged = await p.evaluate(async () => {
  const imp = await import("/js/views/import.js");
  const patch = imp.mergeLead({ id: "x", name: "Under Water", paymentsLeft: 40, paymentsLeftAsOf: "2026-01-01", payoff: null, phone2: "" },
    { name: "Under Water", paymentsLeft: 34, paymentsLeftAsOf: "2026-09-13", alertType: "Lease Maturity", phone2: "9025550009" });
  return patch;
});
console.log("\nre-import patch:", JSON.stringify(merged));
if (merged.paymentsLeft !== 34 || merged.paymentsLeftAsOf !== "2026-09-13") fail("a fresh export's payments-left count doesn't replace the old one");
if (merged.alertType !== "Lease Maturity" || merged.phone2 !== "9025550009") fail("the export's other fields don't merge");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\naccuracy.test.js FAILED" : "\naccuracy.test.js passed");
})();
