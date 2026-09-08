// The voice panel as a conversation rather than a command box.
//
// It used to take one sentence, act, and close itself — so every follow-up
// meant reaching for the mic again, and the agent's answer was the end of the
// exchange instead of the middle of one. And on iOS, the one platform this is
// built for, speech recognition was skipped entirely: the mic button opened a
// keyboard.
//
// Chromium has no real speech engine, so recognition is driven through a fake
// SpeechRecognition that the app can't tell from the real one. That's the right
// level to test at: what matters is that the panel keeps listening, keeps
// context, waits for its own voice to stop, and knows when it's been dismissed.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 },
  colorScheme: "dark", serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("entoa:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Ann Lee", phone: "9025551111", stage: "working",
      vehicleInterest: "2023 Nissan Rogue", createdAt: "x", updatedAt: "x" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false,
      agentUrl: "http://127.0.0.1:8137/functions/v1/voice-agent" },
  }));

  // --- A speech engine the app can drive. Records how many times it was
  // started, and lets the test feed it utterances.
  window.__mic = { starts: 0, live: null, spoke: [] };
  class FakeRecognition {
    constructor() { this.lang = "en-US"; }
    start() {
      window.__mic.starts++;
      window.__mic.live = this;
      setTimeout(() => { if (window.__mic.live === this) window.dispatchEvent(new Event("__mic-ready")); }, 0);
    }
    abort() { if (window.__mic.live === this) window.__mic.live = null; }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  // Say something as if it had been heard.
  window.__say = (text) => {
    const r = window.__mic.live;
    if (!r) return false;
    r.onresult && r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { 0: { transcript: text }, isFinal: true, length: 1 })] });
    window.__mic.live = null;
    r.onend && r.onend();
    return true;
  };
  window.__silence = () => {
    const r = window.__mic.live;
    if (!r) return false;
    window.__mic.live = null;
    r.onend && r.onend();
    return true;
  };

  // Capture what the app says out loud, and let it finish instantly.
  // speechSynthesis is an accessor on window, so plain assignment is silently
  // dropped — it has to be redefined.
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      cancel() { },
      speak(u) { window.__mic.spoke.push(String(u.text)); setTimeout(() => u.onend && u.onend(), 5); },
    },
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: function (t) { this.text = t; },
  });
});

// The agent: one canned reply per turn, so the test drives the conversation.
let turn = 0;
const asked = [];
const replies = ["Ann Lee is working a 2023 Rogue.", "Booked for Thursday at five."];
await p.route("**/functions/v1/voice-agent", (route) => {
  const body = route.request().postDataJSON() || {};
  if (!Array.isArray(body.messages)) return route.continue();
  asked.push(body.messages.filter((m) => m.role === "user").length);
  return route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ content: [{ type: "text", text: replies[Math.min(turn++, replies.length - 1)] }], stop_reason: "end_turn" }) });
});

await p.goto(APP + "/#/");
await p.waitForTimeout(600);

// --- Opening the panel starts listening on its own. No tapping a text box.
await p.$eval("#voice-btn", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForTimeout(300);
let st = await p.evaluate(() => ({
  open: !!document.querySelector(".voice-overlay"),
  starts: window.__mic.starts,
  status: document.querySelector("#v-status")?.textContent.trim(),
}));
console.log("on open:", JSON.stringify(st));
if (!st.open) fail("the voice panel didn't open");
if (!st.starts) fail("the panel opened without starting to listen — the mic button is a keyboard again");

// --- First turn: it acts, answers out loud, and goes straight back to listening.
await p.evaluate(() => window.__say("what's the story with Ann Lee"));
await p.waitForTimeout(900);
st = await p.evaluate(() => ({
  starts: window.__mic.starts, spoke: window.__mic.spoke,
  open: !!document.querySelector(".voice-overlay"),
  status: document.querySelector("#v-status")?.textContent.trim(),
}));
console.log("after first answer:", JSON.stringify(st));
if (!st.open) fail("the panel closed itself after one command — that's a command box, not a conversation");
if (!st.spoke.some((x) => /Ann Lee is working/.test(x))) fail("the answer was never spoken");
if (st.starts < 2) fail("it didn't start listening again after answering");

// --- Second turn, no tapping: the follow-up goes to the same session, so the
// agent still has the first exchange in context.
await p.evaluate(() => window.__say("book her Thursday at five"));
await p.waitForTimeout(900);
const convo = await p.evaluate(() => ({
  spoke: window.__mic.spoke, starts: window.__mic.starts,
  open: !!document.querySelector(".voice-overlay"),
}));
console.log("after follow-up:", JSON.stringify(convo));
if (!convo.spoke.some((x) => /Booked for Thursday/.test(x))) fail("the follow-up never ran");
if (!convo.open) fail("the panel closed after the follow-up");
console.log("user turns carried into each agent call:", JSON.stringify(asked));
if (asked.length < 2) fail("the second turn didn't reach the agent");
if (asked[1] < 2) fail("the follow-up started a new session — the agent lost the first exchange");

// --- When the agent takes you somewhere, the panel gets out of the way.
// It used to sit full-height over the screen it had just opened, saying "just
// hit send" on top of the send button.
{
  const before = await p.evaluate(() => ({
    docked: document.querySelector(".voice-overlay")?.classList.contains("voice-docked"),
    hash: location.hash,
  }));
  if (before.docked) fail("the panel was already docked before anything navigated");

  await p.evaluate(() => { location.hash = "#/inbox/a"; });
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => {
    const o = document.querySelector(".voice-overlay");
    const sheet = o?.querySelector(".voice-sheet");
    const cs = o ? getComputedStyle(o) : null;
    return {
      open: !!o,
      docked: o?.classList.contains("voice-docked"),
      overlayClicks: cs?.pointerEvents,
      sheetClicks: sheet ? getComputedStyle(sheet).pointerEvents : null,
      sheetHeight: sheet ? Math.round(sheet.getBoundingClientRect().height) : null,
      viewport: window.innerHeight,
      listening: !!window.__mic.live,
    };
  });
  console.log("\nafter the agent navigated:", JSON.stringify(after));
  if (!after.open) fail("the panel closed entirely — you can't keep talking to it");
  if (!after.docked) fail("the panel didn't dock when the app navigated");
  if (after.overlayClicks !== "none") fail("the backdrop still swallows taps on the screen underneath");
  if (after.sheetClicks === "none") fail("the docked bar itself isn't tappable");
  if (after.sheetHeight > after.viewport / 3)
    fail(`the docked bar is ${after.sheetHeight}px tall — it's still covering the screen`);
  // The whole point: it must clear whatever the screen already anchors to its
  // bottom edge. On a conversation that's the reply row — docking over the send
  // button is the bug this exists to fix.
  const clears = await p.evaluate(() => {
    const bar = document.querySelector(".voice-overlay .voice-sheet")?.getBoundingClientRect();
    const compose = document.querySelector("#ib-compose")?.getBoundingClientRect();
    const tabs = document.querySelector(".tabbar")?.getBoundingClientRect();
    return {
      overCompose: !!(bar && compose && bar.bottom > compose.top + 1),
      overTabs: !!(bar && tabs && bar.bottom > tabs.top + 1),
      hasCompose: !!compose,
    };
  });
  console.log("  clearance:", JSON.stringify(clears));
  // The strip has to read as part of the screen's bottom edge, not a widget
  // dropped on top of it: same width, flush, opaque, and the waveform down to
  // one brand-coloured line at a size where three interleaved colours are just
  // a squiggle. The canvas also has to actually re-measure — rendered at the
  // full panel's backing size and squashed into a strip, it looked broken.
  const look = await p.evaluate(() => {
    const sheet = document.querySelector(".voice-overlay .voice-sheet");
    const cs = getComputedStyle(sheet);
    const c = document.querySelector("#v-wave");
    return {
      fullWidth: Math.round(sheet.getBoundingClientRect().width) === document.documentElement.clientWidth,
      translucent: /rgba\(.*0(\.\d+)?\)/.test(cs.backgroundColor),
      radius: parseFloat(cs.borderTopLeftRadius),
      canvasMatchesBox: c.width === Math.round(c.clientWidth) && c.height === Math.round(c.clientHeight),
      liveTab: document.body.classList.contains("voice-live"),
    };
  });
  console.log("  integration:", JSON.stringify(look));
  if (!look.fullWidth) fail("the docked strip is inset — it reads as a floating pill, not the screen's edge");
  if (look.translucent) fail("the strip is see-through; the conversation shows through it");
  if (look.radius > 1) fail("the strip has rounded corners — that's a pill, not an edge");
  if (!look.canvasMatchesBox) fail("the waveform canvas didn't re-measure when it docked");
  if (!look.liveTab) fail("the Voice button isn't showing a live session");
  if (clears.hasCompose && clears.overCompose)
    fail("the docked bar is sitting on top of the reply row — that's the bug it exists to fix");
  if (clears.overTabs) fail("the docked bar is covering the tab bar");
  if (!after.listening) fail("it stopped listening once docked — the whole point is to keep talking");

  // Talking to it docked still works.
  await p.evaluate(() => window.__say("what's the story with Ann Lee"));
  await p.waitForTimeout(900);
  const spoke = await p.evaluate(() => window.__mic.spoke.length);
  console.log("  spoken replies after docking:", spoke);
  if (spoke < 3) fail("a command given to the docked bar didn't run");

  // And tapping it brings the full panel back.
  await p.$eval(".voice-sheet", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(300);
  const back = await p.evaluate(() => document.querySelector(".voice-overlay")?.classList.contains("voice-docked"));
  if (back) fail("tapping the docked bar didn't reopen the full panel");
  console.log("  tapping it reopens the panel \u2713");
}

// --- Silence doesn't hold the microphone open forever.
for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__silence()); await p.waitForTimeout(320); }
const afterQuiet = await p.evaluate(() => ({
  status: document.querySelector("#v-status")?.textContent.trim(),
  listening: !!window.__mic.live,
}));
console.log("after silence:", JSON.stringify(afterQuiet));
if (afterQuiet.listening) fail("it's still holding the mic open after repeated silence");

// --- Saying you're done closes it, rather than being sent to the agent.
// Resume the same panel by tapping the waveform rather than opening a second
// one on top of it.
const before = await p.evaluate(() => window.__mic.spoke.length);
await p.$eval("#v-wave", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForTimeout(300);
if (!(await p.evaluate(() => !!window.__mic.live)))
  fail("tapping the waveform didn't resume listening");
await p.evaluate(() => window.__say("that's all thanks"));
await p.waitForTimeout(1200);
const bye = await p.evaluate(() => ({
  open: !!document.querySelector(".voice-overlay"),
  extra: window.__mic.spoke.length,
}));
console.log("on 'that's all':", JSON.stringify(bye));
if (bye.open) fail(`"that's all" didn't close the panel`);
if (bye.extra > before + 1) fail("a goodbye was sent to the agent as a command");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nvoice.test.js FAILED" : "\nvoice.test.js passed");
})();
