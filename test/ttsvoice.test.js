// The assistant's voice: Settings lists the phone's voices with speed and
// pitch; the choice is kept; speakAsync uses it, and falls back to the
// phone's default when the named voice isn't on this one.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Parm Shokar", dealership: "O'Regan's Nissan", cloudAutoSync: false } }));
  // A phone with three voices.
  const mk = (name, lang, def) => ({ name, lang, default: !!def, localService: true, voiceURI: name });
  const voices = [mk("Samantha", "en-US", true), mk("Karen", "en-AU"), mk("Amélie", "fr-CA")];
  const spoken = []; window.__spoken = spoken;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => voices, speak: (u) => { spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate, pitch: u.pitch }); if (u.onend) setTimeout(() => u.onend(), 5); }, cancel: () => {}, addEventListener: () => {} } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
});
await p.goto(APP + "/#/settings");
await p.waitForSelector('[data-fold="voice"]', { timeout: 30000 }).catch(() => fail("Settings should have an Assistant voice section"));
await p.evaluate(() => { const d = document.querySelector('[data-fold="voice"]'); if (d && !d.open) d.open = true; });
await p.waitForFunction(() => document.querySelectorAll("#s-ttsvoice option").length >= 4, null, { timeout: 8000 }).catch(() => fail("the phone's voices should be listed"));
let s = await p.evaluate(() => ({ opts: [...document.querySelectorAll("#s-ttsvoice option")].map((o) => o.textContent.trim()), say: document.querySelector('[data-fold="voice"] .set-fold-s')?.textContent.trim(), note: document.querySelector("#s-ttsnote")?.textContent }));
console.log("voices:", JSON.stringify(s));
if (s.opts.length !== 4 || !/^Phone's default/.test(s.opts[0]) || !/^Samantha · en-US/.test(s.opts[1]) || !/^Karen · en-AU/.test(s.opts[2]) || !/Amélie · fr-CA/.test(s.opts[3]) || s.say !== "Phone's default" || !/3 voices/.test(s.note)) fail("English first, then the rest, the default named: " + JSON.stringify(s));
// Pick Karen, slower and a touch higher; Hear it speaks with exactly that.
await p.selectOption("#s-ttsvoice", "Karen");
await p.evaluate(() => { const r = document.querySelector("#s-ttsrate"); r.value = "0.9"; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); const h = document.querySelector("#s-ttspitch"); h.value = "1.1"; h.dispatchEvent(new Event("input", { bubbles: true })); h.dispatchEvent(new Event("change", { bubbles: true })); });
await p.click("#s-ttshear"); await p.waitForTimeout(400);
s = await p.evaluate(async () => { const st = await import("/js/store.js"); const x = st.getSettings(); return { voice: x.ttsVoice, rate: x.ttsRate, pitch: x.ttsPitch, spoken: window.__spoken, say: document.querySelector('[data-fold="voice"] .set-fold-s')?.textContent.trim(), nums: [document.querySelector("#s-ttsrate-v").textContent, document.querySelector("#s-ttspitch-v").textContent] }; });
console.log("picked:", JSON.stringify(s));
if (s.voice !== "Karen" || s.rate !== 0.9 || s.pitch !== 1.1 || s.say !== "Karen" || s.spoken.length !== 1 || s.spoken[0].voice !== "Karen" || s.spoken[0].rate !== 0.9 || s.spoken[0].pitch !== 1.1 || !/Hi Parm\./.test(s.spoken[0].text) || !/0\.90×/.test(s.nums[0])) fail("the choice is kept and heard: " + JSON.stringify(s));
// The assistant's own speech uses it; a voice not on this phone falls back to the default English one.
s = await p.evaluate(async () => { const V = await import("/js/voice.js"); const st = await import("/js/store.js"); await V.speakAsync("Three callbacks due."); const a = window.__spoken[window.__spoken.length - 1]; st.updateSettings({ ttsVoice: "Daniel (Enhanced)" }); await V.speakAsync("Still talking."); const b2 = window.__spoken[window.__spoken.length - 1]; return { a, b: b2, pick: V.pickVoice("Daniel (Enhanced)")?.name }; });
console.log("spoken:", JSON.stringify(s));
if (s.a.voice !== "Karen" || s.a.rate !== 0.9 || s.b.voice !== "Samantha" || s.pick !== "Samantha") fail("the assistant speaks in the voice picked, or the default when it isn't here: " + JSON.stringify(s));
// Reset.
await p.click("#s-ttsreset"); await p.waitForTimeout(200);
s = await p.evaluate(async () => { const st = await import("/js/store.js"); const x = st.getSettings(); return { voice: x.ttsVoice, rate: x.ttsRate, sel: document.querySelector("#s-ttsvoice").value }; });
if (s.voice !== "" || s.rate !== 1.05 || s.sel !== "") fail("reset: the phone's default: " + JSON.stringify(s));
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nttsvoice.test.js FAILED" : "\nttsvoice.test.js passed");
})();
