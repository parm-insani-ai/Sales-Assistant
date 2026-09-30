// The voice panel as the app's main way of working: you talk, your words
// appear as you say them, the assistant's steps show as it works, and the
// answer lands in writing on the thread (spoken too, unless you've muted it)
// — or the action just gets done.
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
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/voice-agent" },
  }));
  window.__mic = { starts: 0, live: null, spoke: [] };
  class FakeRecognition {
    constructor() { this.lang = "en-US"; }
    start() { window.__mic.starts++; window.__mic.live = this; }
    abort() { if (window.__mic.live !== this) return; window.__mic.live = null; this.onerror && this.onerror({ error: "aborted" }); this.onend && this.onend(); }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  // A partial reading, as the engine gives them several times a second.
  window.__interim = (text) => {
    const r = window.__mic.live; if (!r) return false;
    r.onresult && r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { 0: { transcript: text }, isFinal: false, length: 1 })] });
    return true;
  };
  window.__say = (text) => {
    const r = window.__mic.live; if (!r) return false;
    r.onresult && r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { 0: { transcript: text }, isFinal: true, length: 1 })] });
    window.__mic.live = null;
    r.onend && r.onend();
    return true;
  };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() { }, speak(u) { window.__mic.spoke.push(String(u.text)); setTimeout(() => u.onend && u.onend(), 5); } } });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: function (t) { this.text = t; } });
});

// The agent: first a look-up (with a word of thinking aloud), then the answer.
// "delete Tony" gets a yes/no question with tappable answers first.
let calls = 0;
const answers = [];
await p.route("**/functions/v1/voice-agent", (route) => {
  const body = route.request().postDataJSON() || {};
  if (!Array.isArray(body.messages)) return route.continue();
  calls++;
  const last = body.messages[body.messages.length - 1];
  const first = typeof last.content === "string";
  if (first && /delete tony/i.test(last.content)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [
    { type: "tool_use", id: "q1", name: "ask_user", input: { question: "Delete Tony Montana from your customers? This can't be undone.", options: ["Yes, delete Tony", "No, keep him"] } },
  ], stop_reason: "tool_use" }) });
  if (!first && Array.isArray(last.content) && last.content.some((c) => c.tool_use_id === "q1")) {
    answers.push(last.content.find((c) => c.tool_use_id === "q1").content);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "Kept him." }], stop_reason: "end_turn" }) });
  }
  if (first) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [
    { type: "text", text: "Let me pull her up." },
    { type: "tool_use", id: "t1", name: "get_customer", input: { name: "Ann Lee" } },
  ], stop_reason: "tool_use" }) });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "Ann's working a 2023 Rogue — nothing booked yet." }], stop_reason: "end_turn" }) });
});

await p.goto(APP + "/#/");
await p.waitForTimeout(500);
await p.$eval("#voice-btn", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForSelector(".voice-overlay #v-thread", { timeout: 5000 });

// --- Your words show as you say them.
await p.evaluate(() => window.__interim("what's the"));
await p.evaluate(() => window.__interim("what's the story with"));
let live = await p.evaluate(() => { const t = document.querySelector("#v-transcript"); return { text: t.textContent, shown: !t.hidden && t.classList.contains("vt-live"), inThread: !!t.closest("#v-thread") }; });
console.log("live:", JSON.stringify(live));
if (live.text !== "what's the story with" || !live.shown || !live.inThread) fail("the words should appear on the thread as they're heard: " + JSON.stringify(live));

// --- Said: it becomes your bubble; the steps show as the assistant works;
// the answer lands in writing and is spoken.
await p.evaluate(() => window.__say("what's the story with Ann Lee"));
await p.waitForFunction(() => document.querySelector("#v-thread .vt-bot"), null, { timeout: 8000 }).catch(() => fail("no reply landed on the thread"));
const thread = await p.evaluate(() => ({
  me: [...document.querySelectorAll("#v-thread .vt-me:not(.vt-live)")].map((e) => e.textContent),
  liveHidden: document.querySelector("#v-transcript").hidden,
  steps: [...document.querySelectorAll("#v-thread .vt-step")].map((e) => `${e.textContent}${e.classList.contains("done") ? " ✓" : ""}`),
  finished: !!document.querySelector("#v-thread .vt-steps.finished"),
  bot: [...document.querySelectorAll("#v-thread .vt-bot")].map((e) => e.textContent),
  spoke: window.__mic.spoke,
  status: document.querySelector("#v-status").textContent,
}));
console.log("thread:", JSON.stringify(thread, null, 1));
if (thread.me.join("|") !== "what's the story with Ann Lee" || !thread.liveHidden) fail("what you said should be your bubble, the live one cleared: " + JSON.stringify(thread));
if (!thread.steps.includes("Thinking ✓") || !thread.steps.includes("Let me pull her up. ✓") || !thread.steps.includes("Looking up Ann Lee ✓") || !thread.finished) fail("the steps should show the thinking and each action, ticked when done: " + JSON.stringify(thread.steps));
if (thread.bot.join("|") !== "Ann's working a 2023 Rogue — nothing booked yet.") fail("the reply should be on the thread in writing: " + JSON.stringify(thread.bot));
if (!thread.spoke.some((s) => /Ann's working/.test(s))) fail("the reply should also be spoken");
if (!thread.steps.every((s) => /✓$/.test(s))) fail("every step should be ticked once the answer is in: " + JSON.stringify(thread.steps));

// --- Typing goes on the same thread.
await p.waitForTimeout(300);
await p.evaluate(() => { document.querySelector("#v-text").value = "book her Thursday at five"; document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-me:not(.vt-live)").length === 2, null, { timeout: 3000 }).catch(() => fail("a typed line should join the thread"));
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-bot").length === 2, null, { timeout: 8000 }).catch(() => fail("the typed turn got no reply"));

// --- Mute: the answer is still written, not spoken, and it listens again.
const spokenBefore = await p.evaluate(() => window.__mic.spoke.length);
await p.click("#v-mute");
await p.waitForTimeout(400);
await p.evaluate(() => window.__say("what's the story with Ann Lee"));
await p.waitForFunction(() => document.querySelectorAll("#v-thread .vt-bot").length === 3, null, { timeout: 8000 }).catch(() => fail("no reply while muted"));
await p.waitForTimeout(400);
const muted = await p.evaluate(() => ({ spoke: window.__mic.spoke.length, pressed: document.querySelector("#v-mute").getAttribute("aria-pressed"), listening: !!window.__mic.live, kept: localStorage.getItem("viniva:voice:mute") }));
console.log("muted:", JSON.stringify(muted));
if (muted.spoke !== spokenBefore || muted.pressed !== "true" || !muted.listening || muted.kept !== "1") fail("muted: written not spoken, still listening, and remembered: " + JSON.stringify(muted));
await p.click("#v-mute");

// --- A question with clear answers shows them as chips; a tap answers it.
await p.evaluate(() => window.__say("delete Tony"));
await p.waitForSelector("#v-thread .vt-choices .vt-choice", { timeout: 8000 }).catch(() => fail("the question's answers didn't show as chips"));
const chips = await p.evaluate(() => ({ labels: [...document.querySelectorAll("#v-thread .vt-choice")].map((b) => b.textContent), question: [...document.querySelectorAll("#v-thread .vt-bot")].pop().textContent, listening: !!window.__mic.live }));
console.log("chips:", JSON.stringify(chips));
if (chips.labels.join("|") !== "Yes, delete Tony|No, keep him" || !/Delete Tony Montana/.test(chips.question)) fail("the chips should be the assistant's options under its question: " + JSON.stringify(chips));
if (!chips.listening) fail("it should still listen for a spoken answer while the chips are up");
await p.click("#v-thread .vt-choice:nth-child(2)");
await p.waitForFunction(() => /Kept him/.test([...document.querySelectorAll("#v-thread .vt-bot")].pop().textContent), null, { timeout: 8000 }).catch(() => fail("tapping a chip didn't answer the question"));
const after = await p.evaluate(() => ({
  me: [...document.querySelectorAll("#v-thread .vt-me:not(.vt-live)")].pop().textContent,
  picked: document.querySelector("#v-thread .vt-choice.picked")?.textContent,
  settled: !!document.querySelector("#v-thread .vt-choices.answered") && [...document.querySelectorAll("#v-thread .vt-choice")].every((b) => b.disabled),
}));
console.log("after tap:", JSON.stringify(after), "answer sent:", JSON.stringify(answers));
if (after.me !== "No, keep him" || after.picked !== "No, keep him" || !after.settled) fail("the tap should read as your answer and settle the chips: " + JSON.stringify(after));
if (answers[0] !== "No, keep him") fail("the tapped label should reach the assistant as the answer: " + JSON.stringify(answers));

// --- The thread scrolls, the newest at the bottom, and the layout leaves it room.
const layout = await p.evaluate(() => {
  const t = document.querySelector("#v-thread"), w = document.querySelector("#v-wave"), sheet = document.querySelector(".voice-sheet");
  return { threadTall: t.getBoundingClientRect().height > 200, waveSmall: w.getBoundingClientRect().height < 100, sheetTall: sheet.getBoundingClientRect().height > innerHeight * 0.7, atBottom: Math.abs(t.scrollTop + t.clientHeight - t.scrollHeight) < 2 };
});
console.log("layout:", JSON.stringify(layout));
if (!layout.threadTall || !layout.waveSmall || !layout.sheetTall || !layout.atBottom) fail("the thread should be the panel's main area, scrolled to the newest: " + JSON.stringify(layout));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nvoicechat.test.js FAILED" : "\nvoicechat.test.js passed");
})();
