// Voice, while the keyboard is up.
//
// Voice lives in the middle of the tab bar, and the tab bar is hidden while
// you're typing (body.typing .tabbar { display: none }). So the one moment you
// most want to say "ask her if Thursday works" instead of thumbing it — mid
// reply, keyboard open — was the one moment the mic wasn't on screen.
//
// A mic in the reply row covers exactly that gap. It has to open the STRIP,
// not the full panel: you're talking about the conversation in front of you,
// and covering it to say so is the mistake docking exists to fix.
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
    texts: [{ id: "t1", leadId: "a", dir: "in", body: "is the Rogue still there?", at: new Date().toISOString(), read: true, createdAt: "x", updatedAt: "x" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, smsFrom: "+19025550123",
      agentUrl: "http://127.0.0.1:8137/functions/v1/voice-agent" },
  }));
  // A recogniser that starts cleanly and then just sits there listening.
  let live = 0;
  function Fake() {
    this.start = () => { live++; window.__live = live; };
    this.stop = () => {};
    this.abort = () => {};
  }
  // Both names: Chromium ships SpeechRecognition as well, and the app takes
  // whichever it finds first.
  window.SpeechRecognition = Fake;
  window.webkitSpeechRecognition = Fake;
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true, value: { speak: (u) => { if (u.onend) setTimeout(u.onend, 0); }, cancel: () => {} },
  });
});

await p.goto(APP + "/#/inbox/a");
await p.waitForTimeout(700);

// --- The mic is in the reply row.
const present = await p.evaluate(() => {
  const mic = document.querySelector('.ib-compose [data-act="voice"]');
  if (!mic) return null;
  const r = mic.getBoundingClientRect();
  const send = document.querySelector('.ib-compose [data-act="send"]').getBoundingClientRect();
  const box = document.querySelector("#ib-text").getBoundingClientRect();
  return {
    visible: r.width > 0 && r.height > 0,
    tappable: Math.min(r.width, r.height) >= 36,
    // Order along the row, and the text box still has room to be a text box.
    afterBox: r.left >= box.right - 1,
    beforeSend: r.right <= send.left + 1,
    boxWidth: Math.round(box.width),
  };
});
console.log("mic in the reply row:", JSON.stringify(present));
if (!present) fail("there's no mic in the reply row");
else {
  if (!present.visible) fail("the mic is in the markup but not on screen");
  if (!present.tappable) fail("the mic is too small to hit with a thumb");
  if (!present.afterBox || !present.beforeSend) fail("the mic isn't between the message box and send");
  if (present.boxWidth < 180) fail(`the message box is squeezed to ${present.boxWidth}px — the row is too crowded`);
}

// --- Tapping it starts a session, DOCKED, so the thread stays visible.
await p.$eval('.ib-compose [data-act="voice"]', (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForTimeout(400);
const after = await p.evaluate(() => {
  const o = document.querySelector(".voice-overlay");
  const bar = o?.querySelector(".voice-sheet")?.getBoundingClientRect();
  const compose = document.querySelector("#ib-compose")?.getBoundingClientRect();
  const thread = document.querySelector("#ib-thread")?.getBoundingClientRect();
  return {
    open: !!o,
    docked: o?.classList.contains("voice-docked"),
    listening: window.__live || 0,
    atTop: !!bar && Math.round(bar.top) <= 1,
    // The point of docking: what you're talking about is still in front of you.
    coversCompose: !!(bar && compose && compose.top < bar.bottom - 1),
    coversThread: !!(bar && thread && thread.bottom > bar.top && thread.top < bar.bottom - 1),
    // Live has to LOOK live, without becoming a second filled circle beside
    // send — the two green discs fought for the same tap.
    micLive: getComputedStyle(document.querySelector('[data-act="voice"]')).animationName,
    micFilled: getComputedStyle(document.querySelector('[data-act="voice"]')).backgroundColor
      === getComputedStyle(document.querySelector('[data-act="send"]')).backgroundColor,
  };
});
console.log("after tapping it:", JSON.stringify(after));
if (!after.open) fail("tapping the mic didn't start a voice session");
if (!after.docked) fail("it opened the full panel over the conversation instead of the strip");
if (!after.listening) fail("it opened but never started listening");
if (!after.atTop) fail("the strip isn't at the top");
if (after.coversCompose) fail("the strip is covering the reply row it was launched from");
if (after.coversThread) fail("the strip is covering the conversation");
if (after.micLive === "none") fail("the mic doesn't show that it's already listening");
if (after.micFilled) fail("the live mic is filled the same as send — two competing circles in one row");

// --- Tapping again doesn't stack a second session fighting for the mic.
await p.$eval('.ib-compose [data-act="voice"]', (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForTimeout(300);
const twice = await p.evaluate(() => ({
  overlays: document.querySelectorAll(".voice-overlay").length,
  recognisers: window.__live || 0,
}));
console.log("tapped twice:", JSON.stringify(twice));
if (twice.overlays !== 1) fail(`${twice.overlays} voice panels are open at once`);
if (twice.recognisers > 1) fail(`${twice.recognisers} recognisers are fighting for the microphone`);

// --- The tab bar's Voice button, with a session already docked, brings the
// full panel back rather than starting another one.
await p.$eval("#voice-btn", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForTimeout(300);
const viaTab = await p.evaluate(() => ({
  overlays: document.querySelectorAll(".voice-overlay").length,
  docked: document.querySelector(".voice-overlay")?.classList.contains("voice-docked"),
}));
console.log("then the tab-bar Voice button:", JSON.stringify(viaTab));
if (viaTab.overlays !== 1) fail("the tab bar started a second session on top of the live one");
if (viaTab.docked) fail("it didn't bring the full panel back");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncomposemic.test.js FAILED" : "\ncomposemic.test.js passed");
})();
