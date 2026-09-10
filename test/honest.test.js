// Messages that name a cause have to have measured it.
//
// Three times running, a failure told the salesperson their data was the
// problem when the code had never looked:
//
//   "your customers don't have payment details captured yet" — said to someone
//   who had just imported a customer file, about a filter the app applied to
//   itself.
//   "Sorry, I didn't catch that — try rephrasing" — said about a sentence that
//   was fine, when the assistant simply wasn't connected.
//   "Voice isn't working here" — said about a microphone that was never asked a
//   question, after the panel counted its own abort as a failure.
//
// Each was individually small and all three cost the same thing: a salesperson
// goes off fixing something that works, and trusts the next message less. So
// the rule these check is narrow and testable — a message may state a cause
// only if the code counted it, and where two causes are possible it has to say
// which one it hit.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [], vehicles: [],
    settings: { salesperson: "Parm", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72 },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(600);

const radar = (input) => p.evaluate(async (i) => {
  const m = await import("/js/agent.js");
  const r = await m.execTool("deal_radar", i);
  return { rows: (r.result.opportunities || []).length, note: r.result.note || "" };
}, input);
const reset = (leads) => p.evaluate(async (ls) => {
  const store = await import("/js/store.js");
  store.all("leads").forEach((l) => store.remove("leads", l.id));
  ls.forEach((l) => store.create("leads", l));
}, leads);

// --- Each empty answer names the reason it actually hit, and they differ.
console.log("why the radar is empty:");
{
  await reset([]);
  const none = await radar({ vehicle: "Sentra" });
  console.log("  no customers at all →", JSON.stringify(none.note));
  if (!/no customers/i.test(none.note)) fail("an empty book doesn't say so: " + none.note);

  // Customers on file, but the model asked for doesn't exist.
  await reset([{ name: "Ann Lee", stage: "working", currentPayment: 500 }]);
  const nomodel = await radar({ vehicle: "Ferrari 296" });
  console.log("  a model we don't sell →", JSON.stringify(nomodel.note));
  if (!/Ferrari/.test(nomodel.note)) fail("it doesn't name the model that couldn't be found: " + nomodel.note);
  if (/payment details|capture/i.test(nomodel.note))
    fail("it blames the customer data for a missing model: " + nomodel.note);

  // Everyone prices ABOVE what they pay — a real answer, and a different one.
  await reset([{ name: "Ann Lee", stage: "working", currentPayment: 90 }]);
  const dearer = await radar({ cheaperOnly: true });
  console.log("  everyone costs more →", JSON.stringify(dearer.note));
  if (!/above what they pay|prices below/i.test(dearer.note))
    fail("it doesn't say they simply price higher: " + dearer.note);
  if (/no payment|capture/i.test(dearer.note))
    fail("it claims missing data for a customer whose payment IS on file: " + dearer.note);

  // And the case that started this: no baseline is reported as such, counted.
  await reset([{ name: "Fresh Import", stage: "new" }]);
  const nobase = await radar({ cheaperOnly: true });
  console.log("  nobody has a payment on file →", JSON.stringify(nobase.note));
  if (!/1 with no current payment/i.test(nobase.note))
    fail("the missing-baseline count isn't reported: " + nobase.note);

  // The same customers, asked the vehicle question, are NOT a failure at all.
  const priced = await radar({ vehicle: "Sentra" });
  console.log("  ...but they can still be shown a Sentra →", priced.rows, "row(s)");
  if (!priced.rows) fail("a customer with no payment on file still can't be shown a car");
}

// --- Two different import failures must not share one message.
console.log("\nimport:");
{
  const said = await p.evaluate(async () => {
    const out = {};
    const { parseCSV } = await import("/js/csv.js");
    // Headings, no data rows.
    out.headersOnly = parseCSV("Name,Phone,Payment\n");
    // Nothing at all.
    out.blank = parseCSV("");
    return { headersOnly: out.headersOnly.headers.length, headersOnlyRows: out.headersOnly.rows.length,
      blankHeaders: out.blank.headers.length };
  });
  console.log("  parser sees:", JSON.stringify(said));
  // The parser distinguishes them, so the message must too.
  if (!(said.headersOnly > 0 && said.headersOnlyRows === 0))
    fail("the parser can't tell headings-without-rows apart — the premise is wrong");
  const src = await (await fetch(APP + "/js/views/import.js")).text();
  if (/Make sure the sheet has a header row and at least one data row/.test(src))
    fail("one message still covers both import failures, guessing at which");
  if (!/No column headings found/.test(src) || !/Headings but no data/.test(src))
    fail("the two import failures don't have distinct messages");
  console.log("  ok   headings-missing and rows-missing say different things");
}

// --- Checked and NOT changed: "Nobody to chase right now" on the prospecting
// list. It looked like the same fault, and isn't. An imported book surfaces
// there on its own — as new leads inside the response window, then as cold
// ones after a week — so the state that message describes is a genuine lull,
// not the app failing to rank anything. Adding a "nothing can be ranked"
// message would have asserted a cause that doesn't occur, which is the fault
// this file exists to catch. Left alone deliberately.

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nhonest.test.js FAILED" : "\nhonest.test.js passed");
})();
