// "From now on, always offer a test drive before talking price." Said once,
// it has to hold: read back for a yes, saved into the standing instructions,
// in the brief from the next turn, in every drafter, on every device — and
// gone again on "forget that rule" or an Undo.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Ann Lee", phone: "9025551111", stage: "working", vehicleInterest: "2023 Nissan Rogue", createdAt: "x", updatedAt: "x" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", agentNotes: "Call me PJ in texts." },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(500);

const r = await p.evaluate(async () => {
  const a = await import("/js/agent.js"); const s = await import("/js/store.js");
  const out = {};
  const RULE = "always offer a test drive before talking price";
  // Step one: not saved, handed back to confirm.
  out.ask = await a.execTool("remember_rule", { rule: RULE });
  out.notesAfterAsk = s.getSettings().agentNotes;
  // Step two, confirmed: saved as its own line, the old rule kept.
  out.saved = await a.execTool("remember_rule", { rule: RULE, confirmed: true });
  out.notes = s.getSettings().agentNotes;
  // The brief carries it, as a list.
  out.brief = a.agentRequest([{ role: "user", content: "hi" }]).system[1].text;
  // Saying it twice doesn't save it twice.
  out.again = await a.execTool("remember_rule", { rule: RULE, confirmed: true });
  out.notesAgain = s.getSettings().agentNotes;
  // Undo puts the instructions back as they were.
  out.undone = a.undoLast();
  out.notesUndone = s.getSettings().agentNotes;
  // Forget, by a few of its words.
  await a.execTool("remember_rule", { rule: RULE, confirmed: true });
  out.forgot = await a.execTool("forget_rule", { rule: "the rule about test drives" });
  out.notesForgot = s.getSettings().agentNotes;
  out.forgotNone = await a.execTool("forget_rule", { rule: "the rule about unicorns" });
  // A rule is not a customer note.
  out.tools = a.agentRequest([{ role: "user", content: "hi" }]).tools.map((t) => t.name);
  out.standing = a.agentRequest([{ role: "user", content: "hi" }]).system[0].text;
  return out;
});
console.log("ask:", JSON.stringify(r.ask.result).slice(0, 160));
console.log("saved:", JSON.stringify(r.saved.note), "| notes:", JSON.stringify(r.notes));
console.log("undo:", JSON.stringify(r.undone), "→", JSON.stringify(r.notesUndone), "| forgot:", JSON.stringify(r.forgot.note), "→", JSON.stringify(r.notesForgot));
if (!/Not saved yet/.test(r.ask.result) || !/Yes, remember it/.test(r.ask.result) || r.notesAfterAsk !== "Call me PJ in texts.") fail("the first call should read the rule back, not save it: " + JSON.stringify(r.ask));
if (r.notes !== "Call me PJ in texts.\nalways offer a test drive before talking price" || !/^remembered: /.test(r.saved.note)) fail("the confirmed rule should be saved as its own line after the old one: " + JSON.stringify(r.notes));
if (!/Standing instructions from the salesperson, which always apply:\n- Call me PJ in texts\.\n- always offer a test drive before talking price/.test(r.brief)) fail("the brief should list both rules: " + r.brief.slice(0, 500));
if (!/already a rule/.test(r.again.result) || r.notesAgain !== r.notes) fail("the same rule shouldn't be saved twice: " + JSON.stringify(r.again));
if (!/^remembered: /.test(String(r.undone)) || r.notesUndone !== "Call me PJ in texts.") fail("Undo should put the standing instructions back: " + JSON.stringify([r.undone, r.notesUndone]));
if (!/forgot the rule: "always offer a test drive/.test(r.forgot.result) || r.notesForgot !== "Call me PJ in texts.") fail("forget_rule should drop just that rule: " + JSON.stringify([r.forgot, r.notesForgot]));
if (!/no rule matches/.test(r.forgotNone.result) || !/Call me PJ/.test(r.forgotNone.result)) fail("forgetting an unknown rule should list what's on file: " + JSON.stringify(r.forgotNone));
if (!r.tools.includes("remember_rule") || !r.tools.includes("forget_rule")) fail("the rule tools should be offered to the model");
if (!/RULES FROM THE SALESPERSON/.test(r.standing) || !/remember_rule/.test(r.standing)) fail("the brief should tell the model when a sentence is a standing rule");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nrules.test.js FAILED" : "\nrules.test.js passed");
})();
