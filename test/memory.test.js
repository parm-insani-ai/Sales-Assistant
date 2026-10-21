// The conversation lasts the day. Closed, reloaded, reopened: the thread
// since the first open after 4am is still in mind, so "book her Thursday"
// still has its "her" — unless it's been more than ten minutes, in which
// case the brief tells the model to check who. A new day starts clean.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  if (!localStorage.getItem("viniva:auth")) {
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({
      leads: [{ id: "a", name: "Ann Lee", phone: "9025551111", stage: "working", vehicleInterest: "2023 Nissan Rogue", createdAt: "x", updatedAt: "x" }],
      settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/voice-agent" },
    }));
  }
  function Fake() { this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }
  window.SpeechRecognition = Fake; window.webkitSpeechRecognition = Fake;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(u) { setTimeout(() => u.onend && u.onend(), 5); } } });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: function (t) { this.text = t; } });
});

// The agent: one canned reply per request; every request is kept.
const asked = [];
await p.route("**/functions/v1/voice-agent", (route) => {
  const body = route.request().postDataJSON() || {};
  if (!Array.isArray(body.messages)) return route.continue();
  const live = Array.isArray(body.system) ? body.system.map((s) => s.text || "").join("\n") : String(body.system || "");
  asked.push({ users: body.messages.filter((m) => m.role === "user" && typeof m.content === "string").map((m) => m.content), system: live });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: `Reply ${asked.length}.` }], stop_reason: "end_turn" }) });
});

const openAndSay = async (text) => {
  await p.$eval("#voice-btn", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForSelector("#v-form", { timeout: 5000 });
  const note = await p.evaluate(() => document.querySelector(".vt-note")?.textContent || "");
  await p.evaluate((t) => { document.querySelector("#v-text").value = t; document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }, text);
  await p.waitForTimeout(900);
  return note;
};

// --- Turn one, this morning.
await p.goto(APP + "/#/");
await p.waitForTimeout(500);
let note = await openAndSay("what's the story with Ann Lee");
if (note) fail("nothing to pick up on the first open: " + note);
if (asked.length !== 1 || asked[0].users.length !== 1 || !/first thing said in today's conversation/.test(asked[0].system)) fail("the first turn should be alone, and say so: " + JSON.stringify(asked[0] && { users: asked[0].users, first: /first thing said/.test(asked[0].system) }));
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("viniva:convo:rep") || "null"));
if (!saved || !saved.day || saved.messages.length !== 2 || saved.messages[1].role !== "assistant") fail("the turn should be kept on the phone, ending on the reply: " + JSON.stringify(saved).slice(0, 200));

// --- The app is closed and reopened (a real reload): the thread comes back.
await p.goto(APP + "/?r=1#/");
await p.waitForTimeout(500);
note = await openAndSay("book her Thursday at five");
console.log("after reload:", JSON.stringify({ note, users: asked[1] && asked[1].users }));
if (!/Picking up today's conversation/.test(note)) fail("reopened, the panel should say it's picking the day up: " + note);
if (!asked[1] || asked[1].users.length !== 2 || !/Ann Lee/.test(asked[1].users[0])) fail("the morning's turn should be in the thread after a reload: " + JSON.stringify(asked[1] && asked[1].users));
const gapLine = (s) => (s.match(/The last exchange in this conversation was[^\n]*/) || [""])[0];
if (!/was under a minute ago/.test(gapLine(asked[1].system))) fail("the live brief should say how long ago the last exchange was: " + gapLine(asked[1].system));
if (/needs a one-line check/.test(asked[1].system)) fail("a follow-up a minute later needs no check of who 'her' is");

// --- Three hours pass: the gap is in the brief, with the pronoun rule armed.
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("viniva:convo:rep")); s.at = Date.now() - 3 * 3600000; localStorage.setItem("viniva:convo:rep", JSON.stringify(s)); });
await p.goto(APP + "/?r=2#/");
await p.waitForTimeout(500);
await openAndSay("text her the booking link");
const gap = asked[2] ? gapLine(asked[2].system) : "";
console.log("after three hours:", gap);
if (!asked[2] || asked[2].users.length !== 3) fail("three turns in the thread by now: " + JSON.stringify(asked[2] && asked[2].users));
if (!/was 3 hours ago/.test(gap) || !/needs a one-line check of who is meant/.test(gap)) fail("three hours on, the brief should arm the pronoun check: " + gap);
if (!/THE CONVERSATION LASTS THE DAY/.test(asked[2].system) || !/last ten minutes/.test(asked[2].system)) fail("the standing brief should carry the pronoun rule");

// --- The window is capped: a long day's thread keeps the recent part.
const capped = await p.evaluate(async () => {
  const a = await import("/js/agent.js");
  const big = []; for (let i = 0; i < 60; i++) { big.push({ role: "user", content: `Turn ${i}: ${"x".repeat(1500)}` }); big.push({ role: "assistant", content: [{ type: "text", text: `Reply ${i}.` }] }); }
  localStorage.setItem("viniva:convo:rep", JSON.stringify({ day: a.convoDay(), at: Date.now(), messages: big }));
  const s = a.createAgentSession({ remember: "rep", call: async (msgs) => { window.__sent = msgs.length; return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }; } });
  const before = s.turns();
  await s.send("one more");
  return { before, sent: window.__sent };
});
console.log("capped:", JSON.stringify(capped));
if (capped.before !== 60 || !(capped.sent < 60) || !(capped.sent >= 9)) fail("a long thread should be trimmed to the recent part before it's sent, never dropped whole: " + JSON.stringify(capped));

// --- A new day (the first open after 4am): clean slate.
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("viniva:convo:rep")); const d = new Date(Date.now() - 86400000); s.day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; localStorage.setItem("viniva:convo:rep", JSON.stringify(s)); });
const day = await p.evaluate(async () => { const a = await import("/js/agent.js"); const s = a.createAgentSession({ remember: "rep" }); const d = new Date(); return { turns: s.turns(), recalled: s.recalled(), today: a.convoDay(d), early: a.convoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 3, 30)), late: a.convoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 30)) }; });
console.log("new day:", JSON.stringify(day));
if (day.turns !== 0 || day.recalled !== 0) fail("yesterday's thread shouldn't come back today: " + JSON.stringify(day));
if (day.early === day.today || day.late !== day.today) fail("the day should start at 4am, not midnight: " + JSON.stringify(day));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "memory: FAILED" : "memory: ok");
})().catch((e) => { console.error(e); process.exit(1); });
