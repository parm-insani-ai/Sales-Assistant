// "Text 226-246-7202 that his car is ready" came back with a question:
//
//   "I need to clarify which customer this is for. You've given me a phone
//    number but I need the customer's name to send them a message."
//
// Nothing was wrong with the sentence. The tool only ever matched customers by
// name, so a number found nobody, and the agent did the only thing left to it.
// Texting a number you were just handed is one of the most ordinary things a
// salesperson does, and the assistant couldn't.
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
    leads: [{ id: "a", name: "Ann Lee", phone: "9025551111", stage: "working", createdAt: "x", updatedAt: "x" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false,
      smsFrom: "+19025550123", agentUrl: "http://127.0.0.1:8137/functions/v1/voice-agent" },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(700);

const run = (tool, input) => p.evaluate(async ([tool, input]) => {
  const m = await import("/js/agent.js");
  return await m.execTool(tool, input);
}, [tool, input]);

// --- Texting a number nobody is on file for has to just work.
{
  const r = await run("text_customer", { customer: "226-246-7202", message: "Your car is ready for pickup." });
  console.log("text a stranger's number:", JSON.stringify(r));
  if (/not found/i.test(String(r.result))) fail("texting a raw phone number still comes back 'not found'");

  const after = await p.evaluate(async () => {
    const store = await import("/js/store.js");
    const lead = store.leadByPhone("2262467202");
    return { made: !!lead, name: lead?.name, hash: location.hash };
  });
  console.log("  after:", JSON.stringify(after));
  if (!after.made) fail("no customer record was created for the number");
  if (!/^#\/inbox\//.test(after.hash)) fail("it didn't open the conversation: " + after.hash);
}

// --- A number that IS on file goes to that customer, not to a second record.
{
  await p.evaluate(() => { location.hash = "#/"; });
  await p.waitForTimeout(200);
  const r = await run("text_customer", { customer: "(902) 555-1111", message: "See you Thursday." });
  console.log("\ntext a number already on file:", JSON.stringify(r));
  const dupes = await p.evaluate(async () => {
    const store = await import("/js/store.js");
    return store.all("leads").filter((l) => store.phoneKey(l.phone) === "9025551111").length;
  });
  if (dupes !== 1) fail(`a number already on file created a duplicate customer (${dupes} records)`);
  if (!/Ann Lee/.test(String(r.result))) fail("it didn't recognise the number as Ann Lee: " + r.result);
}

// --- Names still work exactly as before.
{
  const r = await run("text_customer", { customer: "Ann", message: "Quick one." });
  console.log("\ntext by name:", JSON.stringify(r));
  if (!/Ann Lee/.test(String(r.result))) fail("matching by name broke: " + r.result);
}

// --- And something that's neither still fails honestly rather than texting
// a made-up number.
{
  const r = await run("text_customer", { customer: "Nobody McNobody", message: "Hello." });
  console.log("\ntext an unknown name:", JSON.stringify(r));
  if (!/not found/i.test(String(r.result))) fail("an unknown name should still come back not found: " + r.result);
}

// --- Calling a raw number, same rule.
{
  const r = await run("call_customer", { customer: "226 246 7202" });
  console.log("\ncall a raw number:", JSON.stringify(r));
  if (/not found/i.test(String(r.result))) fail("calling a raw phone number still comes back 'not found'");
}

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nagentphone.test.js FAILED" : "\nagentphone.test.js passed");
})();
