// "When a customer is added, always ask for a phone number to attach to
// it." Four ways a customer gets added by hand or by voice, and each one
// asks: the lead form, the referral form, the assistant's create_lead, and
// the offline voice parser.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, agentUrl: "" } }));
  window.__mic = { live: null, spoke: [] };
  class FR { start() { window.__mic.live = this; } abort() { window.__mic.live = null; this.onend && this.onend(); } stop() { this.abort(); } }
  window.SpeechRecognition = FR; window.webkitSpeechRecognition = FR;
  window.__say = (t) => { const r = window.__mic.live; if (!r) return false; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { 0: { transcript: t }, isFinal: true, length: 1 })] }); window.__mic.live = null; r.onend && r.onend(); return true; };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() { }, speak(u) { window.__mic.spoke.push(String(u.text)); setTimeout(() => u.onend && u.onend(), 5); } } });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: function (t) { this.text = t; } });
});
await p.goto(APP + "/#/leads");
await p.waitForTimeout(600);

// --- The lead form won't add without a number.
await p.evaluate(async () => { const m = await import("/js/views/leads.js"); m.openLeadForm(null); });
await p.waitForSelector('.modal input[name="name"]', { timeout: 5000 });
const form = await p.evaluate(() => ({ label: [...document.querySelectorAll(".modal label")].find((l) => /Phone/.test(l.textContent))?.textContent.trim(), required: document.querySelector('.modal input[name="phone"]').required }));
if (form.label !== "Phone *" || !form.required) fail("the lead form should mark the phone required: " + JSON.stringify(form));
await p.fill('.modal input[name="name"]', "Dana Muise");
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(300);
let leads = await p.evaluate(async () => (await import("/js/store.js")).all("leads").map((l) => `${l.name}:${l.phone}`));
const toast1 = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join("|"));
if (leads.length || !/Phone is required/.test(toast1)) fail("submitting without a phone should be refused: " + JSON.stringify([leads, toast1]));
await p.fill('.modal input[name="phone"]', "902 555 0101");
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(400);
leads = await p.evaluate(async () => (await import("/js/store.js")).all("leads").map((l) => `${l.name}:${l.phone}`));
if (leads.join() !== "Dana Muise:902 555 0101") fail("with a phone it adds: " + JSON.stringify(leads));
// Editing an old record without a number isn't blocked.
const editOk = await p.evaluate(async () => { const s = await import("/js/store.js"); const l = s.create("leads", { name: "Old Import", stage: "new" }); const m = await import("/js/views/leads.js"); m.openLeadForm(s.get("leads", l.id)); return !document.querySelector('.modal input[name="phone"]').required; });
if (!editOk) fail("editing shouldn't demand a phone on an old record");
await p.evaluate(() => document.querySelector(".modal .modal-close")?.click());

// --- The referral form asks for a number per name.
await p.evaluate(async () => { const m = await import("/js/views/referrals.js"); m.openReferralCapture("Dana Muise"); });
await p.waitForSelector('.modal input[name="name1"]', { timeout: 5000 });
await p.fill('.modal input[name="name1"]', "Ray Doucet");
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(300);
const ref = await p.evaluate(async () => ({ toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join("|"), open: !!document.querySelector('.modal input[name="name1"]'), focused: document.activeElement && document.activeElement.name, leads: (await import("/js/store.js")).all("leads").length }));
if (!/Add a phone number for Ray Doucet/.test(ref.toast) || !ref.open || ref.focused !== "phone1" || ref.leads !== 2) fail("a referral without a number should be asked for one: " + JSON.stringify(ref));
await p.fill('.modal input[name="phone1"]', "9025550202");
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(400);
leads = await p.evaluate(async () => (await import("/js/store.js")).all("leads").map((l) => `${l.name}:${l.phone}`));
if (!leads.includes("Ray Doucet:9025550202")) fail("the referral with a number should be added: " + JSON.stringify(leads));

// --- The assistant's create_lead: no number, no customer — it's told to ask.
const tool = await p.evaluate(async () => {
  const a = await import("/js/agent.js"); const s = await import("/js/store.js");
  const before = s.all("leads").length;
  const r1 = await a.execTool("create_lead", { name: "Ken Ito", vehicle: "Kicks" });
  const after1 = s.all("leads").length;
  const r2 = await a.execTool("create_lead", { name: "Ken Ito", vehicle: "Kicks", phone: "902-555-0303" });
  const r3 = await a.execTool("create_lead", { name: "Moe Nash", vehicle: "Frontier", noPhone: true });
  return { r1: r1.result, note1: r1.note, added1: after1 - before, r2: r2.result, ken: s.all("leads").find((l) => l.name === "Ken Ito")?.phone, r3: r3.result, moe: s.all("leads").find((l) => l.name === "Moe Nash")?.phone };
});
console.log("create_lead:", JSON.stringify(tool));
if (tool.added1 !== 0 || !/needs a phone number/.test(tool.r1) || !/ask_user/.test(tool.r1) || !/asking for Ken Ito's number/.test(tool.note1)) fail("create_lead without a phone should add nobody and ask: " + JSON.stringify(tool));
if (!/created lead Ken Ito/.test(tool.r2) || tool.ken !== "9025550303") fail("with a phone it creates, digits only: " + JSON.stringify(tool));
if (!/created lead Moe Nash/.test(tool.r3) || tool.moe !== "") fail("noPhone lets it through when they truly don't have one: " + JSON.stringify(tool));
// --- The offline voice parser: added, asked, and the next thing said is the number.
await p.goto(APP + "/#/");
await p.waitForTimeout(500);
await p.evaluate(async () => { (await import("/js/store.js")).updateSettings({ agentUrl: "" }); }); // the shipped default fills an empty one at load
await p.$eval("#voice-btn", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForSelector("#v-thread", { timeout: 5000 });
await p.evaluate(() => window.__say("add customer Sara Penn looking for a Rogue"));
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-bot").length === 1, null, { timeout: 5000 }).catch(() => fail("the offline add got no reply"));
let v = await p.evaluate(() => ({ bot: document.querySelector("#v-thread .vt-bot").textContent, listening: !!window.__mic.live }));
console.log("voice add:", JSON.stringify(v));
if (!/Added Sara Penn.*What's Sara's phone number\?/.test(v.bot) || !v.listening) fail("adding by voice should ask for the number and listen for it: " + JSON.stringify(v));
await p.evaluate(() => window.__say("902 555 0404"));
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-bot").length === 2, null, { timeout: 5000 }).catch(() => fail("the number got no reply"));
v = await p.evaluate(async () => ({ bot: [...document.querySelectorAll("#v-thread .vt-bot")].pop().textContent, sara: (await import("/js/store.js")).all("leads").find((l) => l.name === "Sara Penn")?.phone, step: [...document.querySelectorAll("#v-thread .vt-step")].pop()?.textContent }));
console.log("voice number:", JSON.stringify(v));
if (v.sara !== "9025550404" || !/902 555 0404 is on Sara's file/.test(v.bot) || v.step !== "Adding the number to Sara Penn") fail("the next thing said should become the number: " + JSON.stringify(v));
// Said in the same breath: no question needed.
await p.waitForTimeout(300);
await p.evaluate(() => window.__say("add lead Tom Reid phone 902 555 0505 interested in a Kicks"));
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-bot").length === 3, null, { timeout: 5000 });
v = await p.evaluate(async () => ({ bot: [...document.querySelectorAll("#v-thread .vt-bot")].pop().textContent, tom: (await import("/js/store.js")).all("leads").find((l) => l.name === "Tom Reid") }));
console.log("voice with number:", JSON.stringify(v));
if (!v.tom || v.tom.phone !== "9025550505" || !/Kicks/.test(v.tom.vehicleInterest) || /phone number\?/.test(v.bot)) fail("a number said in the sentence is taken, no question: " + JSON.stringify(v));
// "Don't have it" is accepted.
await p.waitForTimeout(300);
await p.evaluate(() => window.__say("add customer Lee Park"));
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-bot").length === 4, null, { timeout: 5000 });
await p.waitForTimeout(200);
await p.evaluate(() => window.__say("I don't have it"));
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-bot").length === 5, null, { timeout: 5000 });
await p.waitForTimeout(300); // the reply is spoken first, then it listens again
v = await p.evaluate(() => ({ bot: [...document.querySelectorAll("#v-thread .vt-bot")].pop().textContent, listening: !!window.__mic.live }));
if (!/no number for Lee yet/.test(v.bot) || !v.listening) fail("'don't have it' should be accepted and it keeps listening: " + JSON.stringify(v));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nphoneask.test.js FAILED" : "\nphoneask.test.js passed");
})();
