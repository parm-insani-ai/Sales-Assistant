// The voice sheet's thread picks up at the newest message: on opening with
// the day's kept conversation, and again when the sheet is tapped back up
// from the strip it docks to while the app navigates.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }], settings: { salesperson: "Parm", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
  // The day's conversation, kept: forty exchanges — far more than a screen.
  const d = new Date(new Date().getTime() - 4 * 3600000); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const messages = []; for (let i = 1; i <= 40; i++) { messages.push({ role: "user", content: `Question number ${i} about the book` }); messages.push({ role: "assistant", content: [{ type: "text", text: `Answer ${i}: here is what I found about that, in a sentence or two so the thread is long.` }] }); }
  localStorage.setItem("viniva:convo:rep", JSON.stringify({ day, at: Date.now(), messages }));
});
await p.goto(APP + "/#/"); await p.waitForSelector("#view .card", { timeout: 30000 });
await p.click("#voice-btn"); await p.waitForSelector(".voice-overlay #v-thread", { timeout: 8000 }); await p.waitForTimeout(700);
const at = () => p.evaluate(() => { const t = document.querySelector("#v-thread"); return { top: Math.round(t.scrollTop), max: Math.round(t.scrollHeight - t.clientHeight), earlier: document.querySelectorAll("#v-thread .vt-earlier .vt-me").length, docked: document.body.classList.contains("voice-docked") }; });
let s = await at(); console.log("opened:", JSON.stringify(s));
if (s.earlier !== 40) fail("the kept conversation should draw: " + JSON.stringify(s));
if (s.max <= 0 || s.max - s.top > 4) fail("opened, the thread sits at its newest message: " + JSON.stringify(s));
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(800);
s = await at(); if (!s.docked) fail("navigating docks the sheet to a strip: " + JSON.stringify(s));
await p.evaluate(() => { document.querySelector(".voice-sheet").click(); }); await p.waitForTimeout(700);
s = await at(); console.log("back:", JSON.stringify(s));
if (s.docked || s.max <= 0 || s.max - s.top > 4) fail("tapped back up from the strip, the thread is at its newest message, not the top: " + JSON.stringify(s));
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nvoicescroll.test.js FAILED" : "\nvoicescroll.test.js passed");
})();
