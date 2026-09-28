// The manager's voice assistant, end to end: the Voice button is in the
// store's app, the panel opens and listens, and what the manager says runs
// the store's tools — the board, a customer on a rep's book, an email to
// that customer, a nudge and a to-do to the rep — with the screen following.
//
// The model is scripted: each turn, the test says which tool the "model"
// calls and what it says once the tool has answered, and checks what the
// tool actually did and what it told the model.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
const now = Date.now(); const ago = (min) => new Date(now - min * 60000).toISOString();
const pad = (n) => String(n).padStart(2, "0");
const d = new Date(); const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "w1", collection: "leads", data: { id: "w1", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", stage: "working", source: "Walk-in", vehicleInterest: "2023 Nissan Rogue", createdAt: ago(3000), lastContacted: ago(2000) } },
  { id: "w2", collection: "leads", data: { id: "w2", name: "Ken Adams", phone: "9025552222", email: "ken@example.com", stage: "new", source: "Web", vehicleInterest: "Kicks", createdAt: ago(200) } },
  { id: "a1", collection: "appointments", data: { id: "a1", leadId: "w1", customerName: "Dana Muise", when: today + "T15:00", createdAt: ago(1000), type: "appointment" } },
] }) });

const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
  window.__mic = { starts: 0, live: null, spoke: [] };
  class FakeRecognition {
    constructor() { this.lang = "en-US"; }
    start() { window.__mic.starts++; window.__mic.live = this; }
    abort() { if (window.__mic.live !== this) return; window.__mic.live = null; this.onerror && this.onerror({ error: "aborted" }); this.onend && this.onend(); }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
  window.__say = (text) => { const r = window.__mic.live; if (!r) return false; r.onresult && r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { 0: { transcript: text }, isFinal: true, length: 1 })] }); window.__mic.live = null; r.onend && r.onend(); return true; };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() { }, speak(u) { window.__mic.spoke.push(String(u.text)); setTimeout(() => u.onend && u.onend(), 5); } } });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: function (t) { this.text = t; } });
});

// The scripted model: on a fresh user turn it calls `plan.tool`; once the
// tool's result is back it says `plan.say`. Everything the app told it is kept.
let plan = null;
const seen = [];
await p.route("**/functions/v1/quick-api", (route) => {
  const body = route.request().postDataJSON() || {};
  if (!Array.isArray(body.messages)) return route.continue();
  const last = body.messages[body.messages.length - 1];
  seen.push({ system: body.system, tools: (body.tools || []).map((t) => t.name), last });
  const reply = (content, stop) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content, stop_reason: stop }) });
  if (typeof last.content === "string" && plan && plan.tool) return reply([{ type: "tool_use", id: "tu_" + seen.length, name: plan.tool, input: plan.input || {} }], "tool_use");
  return reply([{ type: "text", text: plan ? plan.say : "Okay." }], "end_turn");
});

await p.goto(APP + "/#/");
await p.waitForFunction(() => document.body.classList.contains("management") && document.querySelector("#voice-btn") && document.querySelector('[data-act="welcome"]'), null, { timeout: 20000 });
const tabs = await p.evaluate(() => [...document.querySelectorAll(".tabbar .tab-label")].map((n) => n.textContent.trim()));
console.log("tabs:", tabs.join(" · "));
if (tabs.join(",") !== "Home,Appts,Voice,Customers,Team") fail("the store's tab bar should carry the Voice button: " + tabs.join(","));

// Open the panel: it listens straight away.
await p.$eval("#voice-btn", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForTimeout(400);
let s = await p.evaluate(() => ({ open: !!document.querySelector(".voice-overlay"), starts: window.__mic.starts }));
if (!s.open || !s.starts) fail("the manager's voice panel didn't open and listen: " + JSON.stringify(s));

const turn = async (said, pl, waitFor) => {
  plan = pl;
  const before = await p.evaluate(() => window.__mic.spoke.length);
  await p.evaluate((t) => window.__say(t), said);
  await p.waitForFunction((n) => window.__mic.spoke.length >= n, before + 1, { timeout: 20000 });
  if (waitFor) await p.waitForFunction(waitFor, null, { timeout: 10000 });
  const last = seen[seen.length - 1].last;
  const result = Array.isArray(last.content) ? last.content.find((c) => c.type === "tool_result") : null;
  let parsed = null; try { parsed = JSON.parse(result.content); } catch { parsed = result ? result.content : null; }
  return { spoke: await p.evaluate(() => window.__mic.spoke[window.__mic.spoke.length - 1]), result: parsed, hash: await p.evaluate(() => location.hash) };
};

// 1. The brain is the manager's.
await p.waitForTimeout(200);
let r = await turn("how are we doing", { tool: "store_today", say: "Two set this month; the board's on screen." }, () => location.hash === "#/");
const sys = seen[0].system, tools = seen[0].tools;
console.log("tools:", tools.join(", "));
if (!/sales manager/.test(sys) || !/The team: .*Parm/.test(sys) || !/Dana Muise/.test(sys)) fail("the system prompt isn't the manager's: " + sys.slice(0, 300));
if (!tools.includes("store_today") || !tools.includes("nudge_rep") || tools.includes("log_sale")) fail("the tool set is wrong: " + tools.join(","));
console.log("store_today →", JSON.stringify(r.result).slice(0, 300));
if (!r.result || r.result.store !== "O'Regan's Nissan Halifax" || !r.result.reps.some((x) => x.rep === "Parm") || r.result.apptsSetThisMonth < 1) fail("store_today didn't read the board: " + JSON.stringify(r.result));
if (!/Two set/.test(r.spoke)) fail("the answer wasn't spoken: " + r.spoke);

// 2. A customer on a rep's book, and the screen follows.
r = await turn("what's the story with Dana", { tool: "get_customer", input: { name: "Dana" }, say: "Dana is Parm's, working a Rogue." }, () => /Dana Muise/.test(document.querySelector(".modal")?.textContent || ""));
console.log("get_customer →", JSON.stringify(r.result).slice(0, 300));
if (!r.result || r.result.name !== "Dana Muise" || r.result.rep !== "Parm" || r.result.email !== "dana@example.com") fail("get_customer didn't find Dana on Parm's book: " + JSON.stringify(r.result));
await p.evaluate(() => document.querySelector(".modal-close")?.click());

// 3. An email to her, from the manager, filed for the rep.
r = await turn("email Dana and thank her for coming in", { tool: "email_customer", input: { customer: "Dana", subject: "Thanks for coming in", body: "Hi Dana, it's Sam, the sales manager. Thanks for coming in to see Parm — anything at all, I'm here." }, say: "Emailed Dana." });
const emails = await (await fetch(APP + "/__emails")).json();
console.log("emails:", JSON.stringify(emails));
if (emails.length !== 1 || emails[0].to !== "dana@example.com" || !/it's Sam/.test(emails[0].text)) fail("the email didn't send: " + JSON.stringify(emails));
if (!/emailed Dana/.test(String(r.result))) fail("email_customer's answer: " + r.result);
// Figures are refused.
r = await turn("email Ken about the payment", { tool: "email_customer", input: { customer: "Ken", subject: "Your Kicks", body: "Hi Ken, we can do $299 a month on the Kicks." }, say: "Done." });
if (!/No figures/.test(String(r.result)) || (await (await fetch(APP + "/__emails")).json()).length !== 1) fail("an email with a dollar figure went out: " + r.result);

// 4. A nudge and a to-do to the rep.
r = await turn("tell Parm to call his fresh lead", { tool: "nudge_rep", input: { rep: "Parm", title: "Call Ken", body: "Ken Adams has been waiting — call him now." }, say: "Nudged Parm." });
const nudges = await (await fetch(APP + "/__nudges")).json();
if (nudges.length !== 1 || nudges[0].to !== U1 || !/Ken/.test(nudges[0].body)) fail("the nudge didn't reach Parm: " + JSON.stringify(nudges));
r = await turn("have Parm reach out to Dana about her Rogue", { tool: "assign_task", input: { customer: "Dana" }, say: "Sent to Parm." });
const recs = await (await fetch(APP + "/__records")).json();
const task = recs.find((x) => x.user_id === U1 && x.collection === "tasks");
console.log("task:", JSON.stringify(task && task.data));
if (!task || task.data.leadId !== "w1" || !task.data.fromManager || !/Reach out to Dana/.test(task.data.title)) fail("the to-do didn't land in Parm's book: " + JSON.stringify(task));
const mailRec = recs.find((x) => x.user_id === U1 && x.collection === "emails");
if (!mailRec || mailRec.data.via !== "manager" || mailRec.data.by !== "Sam") fail("the email isn't filed in Parm's book as the manager's: " + JSON.stringify(mailRec));

// 5. Tomorrow's calendar opens the board on that tab; an outcome is written.
r = await turn("what's today look like", { tool: "appointments", input: { which: "today" }, say: "One today, Dana at three." }, () => location.hash === "#/appointments");
if (!r.result || r.result.count !== 1 || r.result.appointments[0].customer !== "Dana Muise") fail("appointments today: " + JSON.stringify(r.result));
r = await turn("Dana showed", { tool: "appointment_outcome", input: { customer: "Dana", outcome: "showed" }, say: "Marked Dana as showed." });
const appt = (await (await fetch(APP + "/__records")).json()).find((x) => x.user_id === U1 && x.id === "a1");
if (!appt || appt.data.outcome !== "showed") fail("the outcome wasn't written into Parm's calendar: " + JSON.stringify(appt && appt.data));

// 6. A target.
r = await turn("Parm's goal is twelve units this month", { tool: "set_target", input: { rep: "Parm", units: 12 }, say: "Twelve it is." });
const tg = await rpc("t", "my_target", { target_month: today.slice(0, 7) });
if (!tg || Number(tg.goal_units) !== 12) fail("the target wasn't set: " + JSON.stringify(tg));

// Still listening, still open.
s = await p.evaluate(() => ({ open: !!document.querySelector(".voice-overlay"), spoke: window.__mic.spoke.length }));
if (!s.open) fail("the panel closed itself");
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmvoice.test.js FAILED" : "\nmvoice.test.js passed");
})();
