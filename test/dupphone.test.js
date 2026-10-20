// A number already on file. Two customers on one phone — two test
// customers on the rep's own cell, a couple sharing a line — get their
// replies filed on whoever matched first, so adding the second is said and
// asked about: the lead form names whose number it is under the field and
// takes a second tap to add anyway; the assistant's create_lead tells the
// salesperson and waits for a yes.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [{ id: "l1", name: "Dana Muise", phone: "(902) 555-1111", stage: "working", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }], settings: { salesperson: "Parm", dealership: "Store", cloudAutoSync: false, agentUrl: "" } }));
});
await p.goto(APP + "/#/leads");
await p.waitForTimeout(600);

// --- The form: the hint as the number is typed, a second tap to add anyway.
await p.evaluate(async () => { const m = await import("/js/views/leads.js"); m.openLeadForm(null); });
await p.waitForSelector('.modal input[name="name"]', { timeout: 5000 });
await p.fill('.modal input[name="name"]', "Tyson Test");
await p.fill('.modal input[name="phone"]', "902 555 1111");
await p.dispatchEvent('.modal input[name="phone"]', "input");
const hint = await p.evaluate(() => { const h = document.querySelector(".modal .dup-phone"); return { shown: !!h && !h.hidden, text: h ? h.textContent.replace(/\s+/g, " ").trim() : "" }; });
if (!hint.shown || !/Same number as Dana Muise on file/.test(hint.text) || !/open Dana/.test(hint.text)) fail("the form doesn't say whose number it is: " + JSON.stringify(hint));
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(300);
let leads = await p.evaluate(async () => (await import("/js/store.js")).all("leads").map((l) => l.name));
const toast1 = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join("|"));
if (leads.length !== 1 || !/Same number as Dana Muise — tap Add again/.test(toast1)) fail("the first tap should warn, not add: " + JSON.stringify([leads, toast1]));
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(400);
leads = await p.evaluate(async () => (await import("/js/store.js")).all("leads").map((l) => l.name).sort());
if (leads.join("|") !== "Dana Muise|Tyson Test") fail("the second tap should add anyway: " + JSON.stringify(leads));
// A different number: no hint, one tap.
await p.evaluate(async () => { const m = await import("/js/views/leads.js"); m.openLeadForm(null); });
await p.waitForSelector('.modal input[name="name"]', { timeout: 5000 });
await p.fill('.modal input[name="name"]', "Fresh Face");
await p.fill('.modal input[name="phone"]', "902 555 2222");
await p.dispatchEvent('.modal input[name="phone"]', "input");
const noHint = await p.evaluate(() => { const h = document.querySelector(".modal .dup-phone"); return !h || h.hidden; });
if (!noHint) fail("a new number shouldn't warn");
await p.click('.modal button[type="submit"]');
await p.waitForTimeout(400);
leads = await p.evaluate(async () => (await import("/js/store.js")).all("leads").map((l) => l.name).sort());
if (leads.join("|") !== "Dana Muise|Fresh Face|Tyson Test") fail("a new number should add on the first tap: " + JSON.stringify(leads));
// Editing Dana's own record doesn't warn about herself — only about Tyson, who now shares her number.
const selfOk = await p.evaluate(async () => { const s = await import("/js/store.js"); const m = await import("/js/views/leads.js"); m.openLeadForm(s.get("leads", "l1")); await new Promise((r) => setTimeout(r, 100)); const h = document.querySelector(".modal .dup-phone"); const text = h && !h.hidden ? h.textContent : ""; document.querySelector(".modal .modal-close")?.click(); return text; });
if (/Dana/.test(selfOk) || !/Tyson Test/.test(selfOk)) fail("editing a customer should name the other person on the number, not themselves: " + selfOk);

// --- The assistant: told whose number it is, adds only on a yes.
const voice = await p.evaluate(async () => {
  const a = await import("/js/agent.js"); const s = await import("/js/store.js");
  const r1 = await a.execTool("create_lead", { name: "Second Tester", phone: "9025551111", vehicle: "Kicks" });
  const after1 = s.all("leads").length;
  const r2 = await a.execTool("create_lead", { name: "Second Tester", phone: "9025551111", vehicle: "Kicks", sameNumberOk: true });
  const after2 = s.all("leads").length;
  return { r1: r1.result, after1, r2: r2.result, after2 };
});
console.log("voice:", JSON.stringify(voice));
if (!/already on file for Tyson Test and Dana Muise/.test(voice.r1) || !/sameNumberOk/.test(voice.r1) || voice.after1 !== 3) fail("create_lead should stop and say whose number it is: " + JSON.stringify(voice));
if (!/created lead Second Tester/.test(voice.r2) || voice.after2 !== 4) fail("create_lead with the salesperson's yes should add: " + JSON.stringify(voice));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndupphone.test.js FAILED" : "\ndupphone.test.js passed");
})();
