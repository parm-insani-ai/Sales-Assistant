// The mic beside the assistant's text box. Once the panel has fallen back to
// typing, a phone whose keyboard has no dictation key still has a one-tap
// way back to talking; while the app is listening the same button pauses it
// and reads as live, like the mic in the tab bar.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Parm", cloudAutoSync: false } }));
  window.__mic = { starts: 0, live: null };
  class FakeRecognition {
    constructor() { this.lang = "en-US"; }
    start() { window.__mic.starts++; window.__mic.live = this; }
    abort() { if (window.__mic.live !== this) return; window.__mic.live = null; this.onerror && this.onerror({ error: "aborted" }); this.onend && this.onend(); }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  // Nothing heard: the engine ends on its own.
  window.__silence = () => { const r = window.__mic.live; if (!r) return false; window.__mic.live = null; r.onend && r.onend(); return true; };
});
await p.goto(APP + "/#/");
await p.waitForTimeout(600);
await p.click("#voice-btn");
await p.waitForTimeout(400);

// --- The button is in the row, between the box and send, big enough for a thumb, and live while listening.
const row = await p.evaluate(() => {
  const mic = document.querySelector("#v-mic"), box = document.querySelector("#v-text"), send = document.querySelector(".voice-send");
  if (!mic) return null;
  const r = mic.getBoundingClientRect(), bx = box.getBoundingClientRect(), s = send.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), afterBox: r.left >= bx.right - 1, beforeSend: r.right <= s.left + 1, live: mic.classList.contains("is-live"), pressed: mic.getAttribute("aria-pressed"), starts: window.__mic.starts, type: mic.type };
});
console.log("row:", JSON.stringify(row));
if (!row) fail("there's no mic beside the assistant's text box");
else {
  if (row.w < 40 || row.h < 40) fail("the mic is too small to hit with a thumb");
  if (!row.afterBox || !row.beforeSend) fail("the mic isn't between the box and send");
  if (row.type !== "button") fail("the mic submits the form instead of listening");
  if (!row.live || row.pressed !== "true" || row.starts < 1) fail("the panel opened listening but the mic doesn't read as live: " + JSON.stringify(row));
}

// --- Three silences and the panel gives up and offers typing (keyboard up).
for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__silence()); await p.waitForTimeout(350); }
const gaveUp = await p.evaluate(() => ({ status: document.querySelector("#v-status").textContent, live: document.querySelector("#v-mic").classList.contains("is-live"), typing: document.activeElement === document.querySelector("#v-text"), starts: window.__mic.starts }));
console.log("after silence:", JSON.stringify(gaveUp));
if (gaveUp.live || !/type/i.test(gaveUp.status)) fail("after giving up the mic should read idle and the status offer typing: " + JSON.stringify(gaveUp));

// --- One tap on the mic: listening again, keyboard gone, button live.
await p.click("#v-mic");
await p.waitForTimeout(300);
const back = await p.evaluate(() => ({ starts: window.__mic.starts, live: document.querySelector("#v-mic").classList.contains("is-live"), status: document.querySelector("#v-status").textContent, typing: document.activeElement === document.querySelector("#v-text") }));
console.log("tap mic:", JSON.stringify(back));
if (back.starts !== gaveUp.starts + 1 || !back.live || !/listening/i.test(back.status) || back.typing) fail("tapping the mic should start listening again and take the keyboard away: " + JSON.stringify(back));

// --- Tap again while listening: paused, not a second engine.
await p.click("#v-mic");
await p.waitForTimeout(300);
const paused = await p.evaluate(() => ({ starts: window.__mic.starts, live: document.querySelector("#v-mic").classList.contains("is-live"), status: document.querySelector("#v-status").textContent, engine: !!window.__mic.live }));
console.log("tap again:", JSON.stringify(paused));
if (paused.starts !== back.starts || paused.live || paused.engine || !/paused/i.test(paused.status)) fail("tapping the live mic should pause: " + JSON.stringify(paused));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "voicemic: FAILED" : "voicemic: ok");
})().catch((e) => { console.error(e); process.exit(1); });
