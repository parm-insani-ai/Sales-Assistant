// "Fix the conversation UI so that the last message is always visible. When
// I click to type I have to scroll to see it." The keyboard shrinks the
// visible area; the thread has to follow its newest message down to the
// keyboard's lip — in a text conversation and on the voice panel alike.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  const texts = [];
  for (let i = 0; i < 40; i++) texts.push({ id: "t" + i, leadId: "a", dir: i % 2 ? "out" : "in", body: `Message number ${i} in a long conversation about the Rogue`, at: new Date(Date.now() - (40 - i) * 60000).toISOString(), read: true, status: "sent", ...x });
  texts.push({ id: "last", leadId: "a", dir: "in", body: "THE NEWEST MESSAGE — can you do Saturday?", at: new Date().toISOString(), read: true, ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025550101", stage: "working", ...x }],
    texts,
    settings: { salesperson: "Parm", cloudAutoSync: false, smsFrom: "+19025559999", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" },
  }));
  window.__mic = { live: null };
  class FR { start() { window.__mic.live = this; } abort() { window.__mic.live = null; this.onend && this.onend(); } stop() { this.abort(); } }
  window.SpeechRecognition = FR; window.webkitSpeechRecognition = FR;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() { }, speak(u) { setTimeout(() => u.onend && u.onend(), 5); } } });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: function (t) { this.text = t; } });
});
await p.route("**/functions/v1/quick-api", (route) => {
  const body = route.request().postDataJSON() || {};
  if (Array.isArray(body.messages)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "A reply long enough to take a line or two on the thread, so the thread grows past the panel." }], stop_reason: "end_turn" }) });
  return route.continue();
});

// Safari's keyboard: the layout viewport stays put, the visual one shrinks.
const keyboard = (open) => p.evaluate((open) => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, "height", { configurable: true, get: () => (open ? 508 : 844) });
  Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 0 });
  vv.dispatchEvent(new Event("resize"));
  setTimeout(() => vv.dispatchEvent(new Event("scroll")), 120); // iOS reports the final size on a scroll event
}, open);

// --- A text conversation.
await p.goto(APP + "/#/inbox/a");
await p.waitForSelector("#ib-text", { timeout: 15000 });
await p.waitForTimeout(500);
const visible = () => p.evaluate(() => {
  const last = [...document.querySelectorAll(".bubble")].pop();
  const box = document.querySelector("#ib-compose").getBoundingClientRect();
  const app = document.getElementById("app").getBoundingClientRect();
  const r = last.getBoundingClientRect();
  const sc = document.querySelector(".view");
  return { lastBottom: Math.round(r.bottom), boxTop: Math.round(box.top), boxBottom: Math.round(box.bottom), appBottom: Math.round(app.bottom), atEnd: Math.abs(sc.scrollTop + sc.clientHeight - sc.scrollHeight) < 3, text: last.textContent.slice(0, 20) };
});
const open = await visible();
console.log("opened:", JSON.stringify(open));
if (!open.atEnd || open.lastBottom > open.boxTop + 2 || !/NEWEST/.test(open.text)) fail("the thread should open on its newest message: " + JSON.stringify(open));
await p.focus("#ib-text");
await keyboard(true);
await p.waitForTimeout(700);
const typing = await visible();
console.log("keyboard up:", JSON.stringify(typing));
if (Math.abs(typing.appBottom - 508) > 2) fail("the shell should end at the keyboard's lip: " + JSON.stringify(typing));
if (typing.lastBottom > typing.boxTop + 2 || typing.boxBottom > 510 || !typing.atEnd) fail("with the keyboard up the newest message must still be right above the reply box: " + JSON.stringify(typing));
await keyboard(false);
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.waitForTimeout(400);

// --- The voice panel's thread.
await p.$eval("#voice-btn", (n) => n.dispatchEvent(new MouseEvent("click", { bubbles: true })));
await p.waitForSelector("#v-thread", { timeout: 5000 });
for (let i = 0; i < 6; i++) {
  await p.evaluate((i) => { document.querySelector("#v-text").value = `Typed question number ${i} that goes on for a bit`; document.querySelector("#v-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }, i);
  await p.waitForFunction((n) => document.querySelectorAll("#v-thread .vt-bot").length === n, i + 1, { timeout: 8000 });
}
await p.waitForTimeout(300);
await p.focus("#v-text");
await keyboard(true);
await p.waitForTimeout(700);
const voice = await p.evaluate(() => {
  const t = document.querySelector("#v-thread"); const last = [...t.querySelectorAll(".vt-bot")].pop().getBoundingClientRect();
  const sheet = document.querySelector(".voice-sheet").getBoundingClientRect(); const input = document.querySelector("#v-text").getBoundingClientRect();
  return { sheetBottom: Math.round(sheet.bottom), inputBottom: Math.round(input.bottom), lastBottom: Math.round(last.bottom), threadBottom: Math.round(t.getBoundingClientRect().bottom), atEnd: Math.abs(t.scrollTop + t.clientHeight - t.scrollHeight) < 3 };
});
console.log("voice, keyboard up:", JSON.stringify(voice));
if (voice.sheetBottom > 510 || voice.inputBottom > 510) fail("the voice sheet and its box should sit on the keyboard's lip, not under the keyboard: " + JSON.stringify(voice));
if (!voice.atEnd || voice.lastBottom > voice.threadBottom + 2) fail("the newest reply should be in view above the box: " + JSON.stringify(voice));
await keyboard(false);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nthreadpin.test.js FAILED" : "\nthreadpin.test.js passed");
})();
