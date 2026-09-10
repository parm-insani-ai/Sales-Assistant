// "Who are people that I can get into a car right now for a lower payment than
// what they're paying currently?"
//
//   "Sorry, I didn't catch that — try rephrasing."
//
// Two separate faults behind one sentence.
//
// The reply came from the on-device keyword parser, not the agent — the panel
// decided once, at open, whether the agent was configured, and everything after
// that went to a fixed grammar that knows "book Ken Thursday at 4" and nothing
// else. Worse, it blamed the sentence. No rewording reaches a parser that
// doesn't have the concept, so "try rephrasing" sent the salesperson off to fix
// something that was never broken.
//
// And the question itself is one the app can answer exactly — it's the deal
// radar — but the radar's net is "within tolerance", which by default lets the
// payment go UP by $50. "Lower than they're paying now" was not askable.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("entoa:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      // Paying a lot on an old car with equity — the answer to the question.
      { id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2018 Nissan Rogue",
        currentPayment: 720, payoff: 4000, currentValue: 19000, currentApr: 8.9, createdAt: "x", updatedAt: "x" },
      // Also matchable, but only by paying MORE — inside the default band, so
      // the plain radar keeps them and the "cheaper" question must not.
      { id: "b", name: "Ravi Anand", phone: "9025552222", stage: "working", vehicleInterest: "2022 Nissan Kicks",
        currentPayment: 415, payoff: 21000, currentValue: 21500, currentApr: 4.9, createdAt: "x", updatedAt: "x" },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Sentra", trim: "SV", price: 27995, stock: "N1", createdAt: "x", updatedAt: "x" },
      { id: "v2", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, stock: "N2", createdAt: "x", updatedAt: "x" },
      { id: "v3", year: 2026, make: "Nissan", model: "Pathfinder", trim: "SL", price: 52995, stock: "N3", createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false },
  }));
  // A recogniser that starts and waits. Without it, headless Chromium denies
  // the microphone and the panel's "mic blocked" message overwrites whatever
  // the typed turn was going to say.
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake;
  window.webkitSpeechRecognition = Fake;
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true, value: {
      speak: (u) => { (window.__spoke = window.__spoke || []).push(String(u.text)); if (u.onend) setTimeout(u.onend, 0); },
      cancel: () => {},
    },
  });
});
await p.goto(APP + "/#/");
await p.waitForTimeout(700);

const run = (tool, input = {}) => p.evaluate(async ([tool, input]) => {
  const m = await import("/js/agent.js");
  return await m.execTool(tool, input);
}, [tool, input]);

// --- The question is now askable, and the answer is only people who save.
{
  const all = await run("deal_radar", {});
  const cheap = await run("deal_radar", { cheaperOnly: true });
  const show = (r) => (r.result.opportunities || []).map((o) => `${o.customer} pays ${o.pays} → ${o.monthly} (${o.delta > 0 ? "+" : ""}${o.delta})`);
  console.log("radar, everyone:  ", JSON.stringify(show(all)));
  console.log("radar, cheaper:   ", JSON.stringify(show(cheap)));

  const rows = cheap.result.opportunities || [];
  if (!rows.length) fail("nobody comes back for 'a lower payment than they're paying now'");
  for (const o of rows) {
    if (!(o.delta < 0)) fail(`${o.customer} is in the cheaper list at ${o.delta >= 0 ? "+" : ""}${o.delta}/mo — that's not cheaper`);
    if (o.saves !== Math.abs(o.delta)) fail(`${o.customer}'s saving isn't stated for the model to read back`);
  }
  // It has to be a real filter, not a relabelling of the same list.
  if (rows.length >= (all.result.opportunities || []).length && (all.result.opportunities || []).some((o) => o.delta >= 0))
    fail("cheaperOnly returned everyone — somebody paying more is still on the list");
}

// --- Cheapest first: the first name out of a "who saves money" question should
// be the one who saves the most, not the best prospect overall.
{
  const r = await run("deal_radar", { cheaperOnly: true, limit: 10 });
  const deltas = (r.result.opportunities || []).map((o) => o.delta);
  console.log("\nordering:", JSON.stringify(deltas));
  const sorted = deltas.slice().sort((x, y) => x - y);
  if (JSON.stringify(deltas) !== JSON.stringify(sorted))
    fail("the biggest saving isn't first: " + JSON.stringify(deltas));
}

// --- A cap on the new payment is askable too ("nothing over $500").
{
  const r = await run("deal_radar", { maxMonthly: 500 });
  const over = (r.result.opportunities || []).filter((o) => o.monthly > 500);
  console.log("\nunder $500:", JSON.stringify((r.result.opportunities || []).map((o) => o.monthly)));
  if (over.length) fail("maxMonthly didn't cap anything: " + JSON.stringify(over.map((o) => o.monthly)));
}

// --- An empty answer explains itself instead of just being empty, so the model
// can say why rather than inventing a reason. (Forced empty with an impossible
// cap — the lot is never actually bare, since the radar also prices the current
// Nissan lineup, not just what's physically in stock.)
{
  const r = await run("deal_radar", { cheaperOnly: true, maxMonthly: 1 });
  console.log("\nnothing matches:", JSON.stringify(r.result));
  if ((r.result.opportunities || []).length) fail("matches came back under a $1/mo cap");
  if (!/needs|payment|payoff|compare/i.test(String(r.result.note || "")))
    fail("an empty radar says nothing about why: " + r.result.note);
}

// --- "Which customers can be put in a Nissan Sentra right now?"
// The radar only ever ran customer → vehicle. Asking it the other way round —
// from a unit on the lot to the people who fit it — is one of the most ordinary
// questions on a floor (a car is aging, or a model is on program, and you want
// the names) and there was no way to ask it at all.
console.log("\nfrom a vehicle to its customers:");
{
  const r = await run("deal_radar", { vehicle: "Sentra", limit: 10 });
  const rows = r.result.opportunities || [];
  rows.forEach((o) => console.log(`  ${o.customer} → ${o.vehicle} $${o.monthly}/mo`));
  if (!rows.length) fail("nobody matches a Sentra, with a Sentra in stock and customers on file");
  for (const o of rows) {
    if (!/sentra/i.test(o.vehicle)) fail(`asked for a Sentra, got ${o.vehicle} for ${o.customer}`);
  }

  // A model nobody fits comes back empty and says why, rather than silently
  // falling back to whatever the radar liked anyway.
  const none = await run("deal_radar", { vehicle: "Ferrari 296" });
  console.log("  a car we don't sell →", JSON.stringify(none.result.note || "").slice(0, 110));
  if ((none.result.opportunities || []).length) fail("matched a vehicle that isn't on the lot or in the lineup");
  if (!/Ferrari/i.test(String(none.result.note || ""))) fail("an empty vehicle search doesn't name what was asked for");

  // Naming a vehicle is not asking who saves money — someone paying less today
  // than the Sentra would cost still belongs in the answer.
  const cheap = await run("deal_radar", { vehicle: "Sentra", cheaperOnly: true, limit: 10 });
  console.log(`  plain: ${rows.length} customers | cheaper-only: ${(cheap.result.opportunities || []).length}`);
  if ((cheap.result.opportunities || []).length > rows.length)
    fail("adding cheaperOnly widened the answer");
}

// --- And the fallback when the assistant isn't connected names THAT, rather
// than telling the salesperson their sentence was wrong.
{
  const said = await p.evaluate(async () => {
    const store = await import("/js/store.js");
    store.updateSettings({ agentUrl: "" });
    const v = await import("/js/voice.js");
    v.startVoiceAssistant();
    await new Promise((r) => setTimeout(r, 200));
    const form = document.querySelector("#v-form");
    document.querySelector("#v-text").value = "who can I get into a car for a lower payment than they pay now";
    window.__spoke = [];
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 600));
    // What it SAID, not the status line — that flips back to "Listening…" the
    // moment the turn ends.
    return (window.__spoke || []).join(" | ");
  });
  console.log("\nno agent configured →", JSON.stringify(said));
  if (/rephras|didn't catch/i.test(said))
    fail("it still blames the sentence for a missing connection: " + said);
  if (!/settings|connect/i.test(said))
    fail("it doesn't say what's actually wrong or how to fix it: " + said);
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nanything.test.js FAILED" : "\nanything.test.js passed");
})();
