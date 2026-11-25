// The tab bar never goes missing: typing hides it (the keyboard's room), and
// anything that takes the field away — the voice sheet docking when the
// assistant opens a screen, a modal closing, a screen change — brings it
// back, whether or not the browser said the field lost focus.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
// A touch device: the typing state only applies on one.
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }], vehicles: [{ id: "v1", year: 2022, make: "Nissan", model: "Rogue", trim: "SV", price: 28900, stock: "U1", condition: "used", status: "available", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }], settings: { salesperson: "Parm", cloudAutoSync: false } }));
});
const tabbar = () => p.evaluate(() => ({ shown: getComputedStyle(document.querySelector(".tabbar")).display !== "none", typing: document.body.classList.contains("typing"), hash: location.hash, active: document.activeElement && document.activeElement.id }));
await p.goto(APP + "/#/"); await p.waitForSelector("#view .card", { timeout: 30000 });
// Type into the voice sheet: the tab bar steps aside.
await p.click("#voice-btn"); await p.waitForSelector(".voice-overlay #v-text", { timeout: 8000 });
await p.focus("#v-text"); await p.type("#v-text", "show me all the used cars"); await p.waitForTimeout(300);
let s = await tabbar(); console.log("typing:", JSON.stringify(s));
if (!s.typing || s.shown) fail("typing in the sheet hides the tab bar: " + JSON.stringify(s));
// The assistant opens a screen (what the lot lookup does): the sheet docks; the field is hidden; the tab bar must be back.
await p.evaluate(async () => { const A = await import("/js/agent.js"); A.showLotOnScreen({ matches: [{ id: "v1" }], label: "used" }); });
await p.waitForTimeout(900);
s = await tabbar(); console.log("after the assistant navigated:", JSON.stringify(s));
if (s.hash !== "#/inventory" || s.typing || !s.shown) fail("the tab bar must be back the moment the sheet docks: " + JSON.stringify(s));
// A field hidden without any blur at all (the worst case): the guard still brings the bar back.
await p.evaluate(() => { const i = document.createElement("input"); i.id = "stray"; i.type = "text"; document.getElementById("view").appendChild(i); });
await p.focus("#stray"); await p.waitForTimeout(200);
s = await tabbar(); if (!s.typing) fail("a focused field sets typing: " + JSON.stringify(s));
await p.evaluate(() => { document.getElementById("stray").hidden = true; });
await p.waitForFunction(() => !document.body.classList.contains("typing"), null, { timeout: 3000 }).catch(() => fail("a hidden field left the typing state on"));
s = await tabbar(); if (!s.shown) fail("the tab bar is back once the field is gone: " + JSON.stringify(s));
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ntabbarstuck.test.js FAILED" : "\ntabbarstuck.test.js passed");
})();
