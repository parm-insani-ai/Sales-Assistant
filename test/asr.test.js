// Repairing what the speech engine heard.
//
// The engine is a general-purpose English model. It has never heard of Sentra,
// or of a customer called Cy Poe, and it ranks its guesses accordingly. The app
// knows both. These check that the knowledge is used where it helps and — much
// more importantly — that it is NOT used where it would do damage. A tool that
// rewrites what the salesperson said is worse than one that leaves a typo in.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "a", name: "Cy Poe", phone: "9025553333", vehicleInterest: "2023 Nissan Frontier", stage: "working", createdAt: "x", updatedAt: "x" },
      { id: "b", name: "Priya Raghunathan", phone: "9025554444", stage: "new", createdAt: "x", updatedAt: "x" },
      { id: "c", name: "Dee Marsh", phone: "9025555555", stage: "working", createdAt: "x", updatedAt: "x" },
    ],
    vehicles: [
      { id: "v1", make: "Nissan", model: "Sentra", trim: "SV", createdAt: "x", updatedAt: "x" },
      { id: "v2", make: "Nissan", model: "Rogue", trim: "Platinum", createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(600);

const call = (fn, ...args) => p.evaluate(async ([fn, args]) => {
  const m = await import("/js/asr.js");
  return m[fn](...args);
}, [fn, args]);

// --- Snapping a mangled proper noun onto the real one.
const REPAIRS = [
  ["text centra guy about the sentra", /Sentra/, "a model heard as a common word"],

  ["call priya raghunathon", /Raghunathan/, "a long name with one syllable wrong"],
  ["show me the rouge in stock", /Rogue/, "Rogue heard as rouge"],
];
console.log("repairs:");
for (const [input, want, why] of REPAIRS) {
  const out = await call("repair", input);
  const ok = want.test(out);
  console.log(`  ${ok ? "ok  " : "MISS"} ${why}\n       "${input}"\n    -> "${out}"`);
  if (!ok) fail(`${why}: "${input}" -> "${out}"`);
}

// --- Very short names are deliberately NOT repaired here. "sy po" for "Cy Poe"
// is two two-letter tokens, and fuzzy-matching at that length is where this
// turns into putting words in the salesperson's mouth. The model gets the
// customer list in its prompt and resolves those from the whole sentence, which
// is the right place for a judgement that needs context.
{
  const out = await call("repair", "book sy po for thursday");
  console.log("\nleft for the model:", JSON.stringify(out));
  if (out !== "book sy po for thursday") fail("two-letter tokens are being rewritten locally: " + out);
}

// --- And the part that matters more: ordinary words are left alone.
// Fuzzy matching against a name list will happily turn "for" into "Ford" and
// "some" into "Sam" if you let it, and then the app is putting words in the
// salesperson's mouth.
const LEAVE_ALONE = [
  "text him that the car is ready",
  "what's on my plate today",
  "the three car is ready",
  "book a test drive for four thirty",
  "did anyone open the link i sent",
  "she said the price was too high",
];
console.log("\nleft untouched:");
for (const input of LEAVE_ALONE) {
  const out = await call("repair", input);
  console.log(`  ${out === input ? "ok  " : "CHANGED"} "${input}"${out === input ? "" : ` -> "${out}"`}`);
  if (out !== input) fail(`ordinary speech was rewritten: "${input}" -> "${out}"`);
}

// --- Choosing between the engine's alternatives.
{
  const alts = ["book sigh po for thursday", "book Cy Poe for thursday", "book sci poe for thursday"];
  const best = await call("pickBest", alts);
  console.log("\nalternatives:", JSON.stringify(alts));
  console.log("  picked:", JSON.stringify(best));
  if (!/Cy Poe/.test(best)) fail("the reading naming a real customer wasn't chosen");

  // With nothing to go on, the engine's own first choice wins — it knows things
  // about the audio that a word list doesn't.
  const neutral = await call("pickBest", ["turn on the lights", "turn on the light"]);
  if (neutral !== "turn on the lights") fail("a tie should defer to the engine's ranking, got: " + neutral);
}

// --- Spoken phone numbers. The agent can text a raw number now, so a run of
// spoken digits has to survive the trip.
const NUMBERS = [
  ["text two two six two four six seven two oh two", "2262467202"],
  ["call nine oh two five five five one one one one", "9025551111"],
  ["his number is 226 246 7202", "2262467202"],
  ["book him at four thirty", ""],          // not a phone number, don't invent one
  ["i sold three cars", ""],
];
console.log("\nspoken numbers:");
for (const [input, want] of NUMBERS) {
  const got = await call("digitsFromSpeech", input);
  const ok = got === want;
  console.log(`  ${ok ? "ok  " : "BAD "} "${input}" -> ${JSON.stringify(got)}`);
  if (!ok) fail(`"${input}" gave ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

// --- The vocabulary the model gets. It has to contain the names and skip the
// filler, or it crowds out the instructions around it.
{
  const v = await call("vocabulary", {});
  console.log("\nvocabulary:", JSON.stringify(v).slice(0, 200));
  if (!v.names.includes("Raghunathan")) fail("customer surnames are missing from the vocabulary");
  if (!v.models.includes("Sentra")) fail("inventory models are missing from the vocabulary");
  if (v.names.some((n) => /^(the|and|for|new|used)$/i.test(n))) fail("filler words leaked into the vocabulary");
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nasr.test.js FAILED" : "\nasr.test.js passed");
})();
