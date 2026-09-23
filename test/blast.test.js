// "Text everyone who owns a Sentra that…" — said to the assistant, turned into
// a blast: the right people in, the unreachable ones out with a reason, the
// offer written to each of them in their name, sent from the app's number,
// logged on every customer. Figures never leave.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "s1", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", stage: "delivered", vehicleInterest: "2019 Nissan Sentra SV", createdAt: "x", updatedAt: "x" },
      { id: "s2", name: "Lee Wong", phone: "9025552222", stage: "working", vehicleInterest: "2021 Nissan Sentra SR", createdAt: "x", updatedAt: "x" },
      { id: "s3", name: "Pat Roy", phone: "9025553333", stage: "delivered", vehicleInterest: "2017 Sentra", smsOptOut: true, createdAt: "x", updatedAt: "x" },
      { id: "s4", name: "No Phone", email: "np@example.com", stage: "delivered", vehicleInterest: "2020 Nissan Sentra", createdAt: "x", updatedAt: "x" },
      { id: "s5", name: "Recent Reach", phone: "9025555555", stage: "delivered", vehicleInterest: "2018 Nissan Sentra", lastCampaignAt: new Date(Date.now() - 3 * 86400000).toISOString(), createdAt: "x", updatedAt: "x" },
      { id: "r1", name: "Rogue Owner", phone: "9025554444", stage: "delivered", vehicleInterest: "2020 Nissan Rogue SV", createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false,
      agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", smsFrom: "+19025550000" },
  }));
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak: (u) => { (window.__spoke = window.__spoke || []).push(String(u.text)); if (u.onend) setTimeout(u.onend, 0); }, cancel: () => {} } });
});
await p.goto(APP + "/#/");
await p.waitForTimeout(700);

const SENTENCE = "text everyone who owns a Sentra that this month if they trade in their Sentra for a new Nissan, they get double loyalty";

// --- The offline voice parser knows a blast from a lead or a lot question.
const parsed = await p.evaluate(async (S) => {
  const v = await import("/js/voice.js");
  return {
    blast: v.parseCommand(S).action,
    email: v.parseCommand("email all my Rogue owners that we're paying top dollar for Rogues this week").action,
    lead: v.parseCommand("add a lead named Sentra Smith interested in a Kicks").action,
    lot: v.parseCommand("how many sentras do we have").action,
    one: v.parseCommand("text Dana that I'll call her at 4").action,
  };
}, SENTENCE);
console.log("parsed:", JSON.stringify(parsed));
if (parsed.blast !== "outreach" || parsed.email !== "outreach") fail("a blast isn't recognised: " + JSON.stringify(parsed));
if (parsed.lead === "outreach" || parsed.lot === "outreach" || parsed.one === "outreach") fail("something that isn't a blast was taken for one: " + JSON.stringify(parsed));

// --- Said to the assistant: it answers with the count and opens the screen.
const spoken = await p.evaluate(async (S) => {
  const v = await import("/js/voice.js");
  v.startVoiceAssistant();
  await new Promise((r) => setTimeout(r, 300));
  window.__spoke = [];
  document.querySelector("#v-text").value = S;
  document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return (window.__spoke || []).join(" | ");
}, SENTENCE);
console.log("spoken:", spoken);
if (!/text to 2 Sentra owners/.test(spoken) || !/3 left out/.test(spoken)) fail("the assistant didn't say who the blast goes to: " + spoken);
await p.waitForTimeout(500);
const screen = await p.evaluate(() => ({
  hash: location.hash,
  to: [...document.querySelectorAll(".mo-row .row-title")].map((n) => n.textContent.trim()),
  leftOut: [...document.querySelectorAll("details .row")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  message: document.querySelector("#mo-message")?.value,
  preview: document.querySelector(".mo-preview")?.textContent,
  sendLabel: document.querySelector('[data-act="send"]')?.textContent.trim(),
  sendDisabled: document.querySelector('[data-act="send"]')?.disabled,
}));
console.log("screen:", JSON.stringify(screen, null, 1));
if (screen.hash !== "#/outreach") fail("the outreach screen didn't open: " + screen.hash);
if (screen.to.join() !== "Dana Muise,Lee Wong") fail("the wrong people are in the blast: " + screen.to.join(", "));
if (!screen.leftOut.some((x) => /Pat Roy.*opted out/.test(x))) fail("the opted-out owner isn't left out with the reason");
if (!screen.leftOut.some((x) => /No Phone.*no phone/.test(x))) fail("the owner with no phone isn't left out with the reason");
if (!screen.leftOut.some((x) => /Recent Reach.*reached 3 days ago/.test(x))) fail("the recently reached owner isn't left out with the reason");
if (screen.leftOut.some((x) => /Rogue Owner/.test(x))) fail("a Rogue owner is part of a Sentra audience");
if (!/^Hi Dana, it's Parm at O'Regan's Nissan Halifax\. This month if you trade in your Sentra for a new Nissan, you get double loyalty\./.test(screen.preview || "")) fail("the preview isn't written to Dana in the second person: " + screen.preview);
if (!/Reply STOP/.test(screen.preview || "")) fail("no opt-out line in the text");
if (screen.sendLabel !== "Send to 2" || screen.sendDisabled) fail("the send button isn't ready for 2: " + JSON.stringify([screen.sendLabel, screen.sendDisabled]));

// --- A figure in the message blocks the send until it's out.
await p.evaluate(() => { const m = document.querySelector("#mo-message"); m.value = "we'll give you $2,000 over book this month"; m.dispatchEvent(new Event("input", { bubbles: true })); });
await p.waitForTimeout(700);
const blocked = await p.evaluate(() => ({ disabled: document.querySelector('[data-act="send"]').disabled, warn: document.querySelector(".card .fab-note[style*='danger']")?.textContent.trim() }));
console.log("with a figure:", JSON.stringify(blocked));
if (!blocked.disabled || !/\$2,000/.test(blocked.warn || "")) fail("a dollar figure didn't block the send: " + JSON.stringify(blocked));
await p.evaluate(() => { const m = document.querySelector("#mo-message"); m.value = "this month if they trade in their Sentra for a new Nissan, they get double loyalty"; m.dispatchEvent(new Event("input", { bubbles: true })); });
await p.waitForTimeout(700);

// --- Leave one out, put them back.
await p.click('[data-skip="s2"]');
await p.waitForTimeout(150);
let n = await p.evaluate(() => document.querySelectorAll(".mo-row").length);
if (n !== 1) fail("leaving one out didn't take: " + n);
await p.evaluate(() => { document.querySelector("details").open = true; document.querySelector('[data-unskip="s2"]').click(); });
await p.waitForTimeout(150);
n = await p.evaluate(() => document.querySelectorAll(".mo-row").length);
if (n !== 2) fail("putting one back didn't take: " + n);

// --- Send: confirm, then every text goes from the app's number and is logged.
await p.click('[data-act="send"]');
await p.waitForSelector('.modal [data-act="ok"]');
await p.click('.modal [data-act="ok"]');
await p.waitForFunction(() => /2 sent/.test(document.querySelector(".mo-progress")?.textContent || ""), null, { timeout: 15000 });
const after = await p.evaluate(async () => {
  const s = await import("/js/store.js");
  const texts = s.all("texts").filter((t) => t.dir === "out");
  const blast = s.all("blasts")[0];
  return {
    texts: texts.map((t) => [t.leadId, t.status, t.body.slice(0, 40)]),
    stamped: ["s1", "s2", "r1", "s3"].map((id) => [id, !!s.get("leads", id).lastCampaignAt, s.get("leads", id).lastContactVia || ""]),
    blast: blast && { channel: blast.channel, audience: blast.audience, sent: blast.sent, failed: blast.failed, finished: !!blast.finishedAt },
    progress: document.querySelector(".mo-progress")?.textContent,
  };
});
console.log("after send:", JSON.stringify(after, null, 1));
if (after.texts.length !== 2 || !after.texts.every((t) => t[1] === "sent")) fail("two texts weren't sent through the number: " + JSON.stringify(after.texts));
if (!after.texts.some((t) => t[0] === "s1" && /^Hi Dana/.test(t[2])) || !after.texts.some((t) => t[0] === "s2" && /^Hi Lee/.test(t[2]))) fail("the texts aren't in each customer's name: " + JSON.stringify(after.texts));
if (after.stamped.join("|") !== "s1,true,text|s2,true,text|r1,false,|s3,false,") fail("the campaign stamp is on the wrong customers: " + JSON.stringify(after.stamped));
if (!after.blast || after.blast.channel !== "text" || after.blast.audience !== "Sentra owners" || after.blast.sent.join() !== "s1,s2" || after.blast.failed.length || !after.blast.finished) fail("the blast record is wrong: " + JSON.stringify(after.blast));

// --- The agent's tool does the same from a typed sentence, and reports the audience.
const tool = await p.evaluate(async () => {
  const m = await import("/js/agent.js");
  return await m.execTool("mass_outreach", { sentence: "email all my Rogue owners that we're paying top dollar for Rogues this week" });
});
console.log("mass_outreach →", JSON.stringify(tool.result).slice(0, 400));
if (!tool.result || tool.result.channel !== "email" || tool.result.recipients !== 0 || !/Rogue owners/.test(tool.result.audience) || !/paying top dollar/.test(tool.result.message)) fail("the tool didn't set up an email to Rogue owners: " + JSON.stringify(tool.result));
if (!(tool.result.leftOutWhy || []).some((x) => /no email/.test(x))) fail("the tool didn't say why the Rogue owner is left out: " + JSON.stringify(tool.result));

// --- A clause it can't read: nobody is picked, the reply and the screen say what it didn't understand.
const suv = await p.evaluate(async () => {
  window.__spoke = [];
  document.querySelector("#v-text").value = "text everyone who owns an SUV that we have a family event Saturday";
  document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return { spoke: (window.__spoke || []).join(" | "), hash: location.hash, rows: document.querySelectorAll(".mo-row").length, note: document.querySelector(".mo-unknown")?.textContent.trim(), send: document.querySelector('[data-act="send"]')?.disabled, to: document.querySelector(".section-title .muted")?.textContent.trim() };
});
console.log("SUV:", JSON.stringify(suv));
if (!/didn't understand "suv"/.test(suv.spoke) || !/Nobody's picked/.test(suv.spoke)) fail("the assistant didn't say what it couldn't read: " + suv.spoke);
if (suv.hash !== "#/outreach" || suv.rows !== 0 || !/didn't understand "suv"/.test(suv.note || "") || suv.send !== true) fail("the screen picked people for a clause it didn't understand: " + JSON.stringify(suv));
const tool2 = await p.evaluate(async () => { const m = await import("/js/agent.js"); return await m.execTool("mass_outreach", { sentence: "text everyone in Dartmouth that I'm at the Dartmouth store this week" }); });
if (!tool2.result || tool2.result.recipients !== 0 || !(tool2.result.notUnderstood || []).includes("dartmouth")) fail("the tool widened an unreadable audience: " + JSON.stringify(tool2.result));

// --- "my Sentra owners" names the model without "everyone who owns".
const mine = await p.evaluate(async () => {
  const v = await import("/js/voice.js");
  return await v.executeCommand(v.parseCommand("text my Sentra owners that the new Sentra is in"));
});
console.log("mine:", mine);
if (!/to \d Sentra owners/.test(String(mine))) fail("'my Sentra owners' wasn't read as Sentra owners: " + mine);
await p.waitForTimeout(400);

// --- Switching the channel on screen re-reads who can be reached.
await p.evaluate(async () => { const m = await import("/js/views/outreach.js"); m.queueOutreach("text everyone who owns a Sentra that the new Sentra is in"); });
await p.waitForTimeout(400);
await p.click('[data-channel="email"]');
await p.waitForTimeout(200);
const byEmail = await p.evaluate(() => ({ to: [...document.querySelectorAll(".mo-row .row-title")].map((n) => n.textContent.trim()), preview: document.querySelector(".mo-preview")?.textContent }));
console.log("by email:", JSON.stringify(byEmail));
// Dana has an address but was just texted, so she sits out until "include recent".
if (byEmail.to.join() !== "No Phone") fail("switching to email didn't pick the ones with an address: " + byEmail.to.join(", "));
await p.evaluate(() => { document.querySelector("details").open = true; document.querySelector('[data-act="include-recent"]').click(); });
await p.waitForTimeout(200);
const withRecent = await p.evaluate(() => [...document.querySelectorAll(".mo-row .row-title")].map((n) => n.textContent.trim()));
if (withRecent.join() !== "Dana Muise,No Phone") fail("including the recently reached didn't bring Dana back: " + withRecent.join(", "));
if (!/^Subject: /.test(byEmail.preview || "")) fail("the email preview has no subject: " + byEmail.preview);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nblast.test.js FAILED" : "\nblast.test.js passed");
})();
