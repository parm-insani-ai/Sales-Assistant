// Deleting in Comms. In a conversation, tapping a message (or a logged call)
// puts a Delete under it; confirming removes it from the phone and the
// account, with an undo for a moment. In the conversation list, a press and
// hold (or a right-click) on a conversation deletes the whole thread, with
// an undo. Nothing is sent to the customer; their copy is theirs.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const leads = [
    { id: "a", name: "Ann Example", phone: "9025551111", stage: "delivered", vehicleInterest: "2023 Nissan Rogue", ...x },
    { id: "b", name: "Bo Example", phone: "9025552222", stage: "delivered", vehicleInterest: "2021 Nissan Kicks", ...x },
  ];
  const texts = [
    { id: "t1", leadId: "a", dir: "out", body: "Hi Ann, it's Parm. Worth a ten-minute look at where your Rogue sits.", at: "2026-09-02T14:00:00.000Z", read: true, status: "sent", ...x },
    { id: "t2", leadId: "a", dir: "in", body: "Maybe next month", at: "2026-09-02T14:06:00.000Z", read: true, ...x },
    { id: "t3", leadId: "a", dir: "out", body: "Sounds good — I'll check in then.", at: "2026-09-02T14:10:00.000Z", read: true, status: "sent", ...x },
    { id: "t4", leadId: "b", dir: "out", body: "Hi Bo, it's Parm.", at: "2026-09-03T10:00:00.000Z", read: true, status: "sent", ...x },
    { id: "t5", leadId: "b", dir: "in", body: "Who is this?", at: "2026-09-03T10:04:00.000Z", read: true, ...x },
  ];
  const calls = [{ id: "c1", leadId: "a", dir: "out", via: "call", at: "2026-09-02T15:00:00.000Z", outcome: "reached", notes: "Wants to come Saturday", logged: true, ...x }];
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, texts, calls, settings: { salesperson: "Parm", cloudAutoSync: false, smsFrom: "+19025550123" } }));
});

// --- In the thread: tap a message, Delete, confirm — gone from the thread and the store.
await p.goto(APP + "/#/inbox/a");
await p.waitForSelector(".bubble", { timeout: 20000 });
const n0 = await p.evaluate(() => document.querySelectorAll(".bubble").length);
if (n0 !== 3) fail("three messages to start: " + n0);
await p.click('.bubble[data-rec-id="t2"]'); await p.waitForTimeout(200);
const tools = await p.evaluate(() => { const t = document.querySelector(".bubble-tools"); return { shown: !!t, under: t && t.previousElementSibling && t.previousElementSibling.dataset.recId, inSide: t && t.classList.contains("bubble-tools-in") }; });
console.log("tools:", JSON.stringify(tools));
if (!tools.shown || tools.under !== "t2" || !tools.inSide) fail("a tap should put Delete under that message, on its side: " + JSON.stringify(tools));
await p.click('[data-act="delete-msg"]'); await p.waitForSelector(".modal", { timeout: 5000 });
const ask = await p.evaluate(() => document.querySelector(".modal").textContent.replace(/\s+/g, " "));
if (!/Delete this message\?/.test(ask) || !/customer keeps their own copy/.test(ask)) fail("the confirmation should say what happens: " + ask);
await p.click('.modal [data-act="ok"]'); await p.waitForTimeout(400);
let after = await p.evaluate(async () => { const st = await import("/js/store.js"); return { bubbles: [...document.querySelectorAll(".bubble")].map((b) => b.dataset.recId), stored: st.all("texts").map((t) => t.id).sort(), toast: !!document.querySelector(".toast-undo") }; });
console.log("deleted:", JSON.stringify(after));
if (after.bubbles.join() !== "t1,t3" || after.stored.join() !== "t1,t3,t4,t5" || !after.toast) fail("the message should be gone, with an undo offered: " + JSON.stringify(after));

// --- Undo brings it back.
await p.evaluate(() => { const bs = [...document.querySelectorAll(".toast-undo button")]; bs[bs.length - 1].click(); }); await p.waitForTimeout(400);
after = await p.evaluate(async () => { const st = await import("/js/store.js"); return { bubbles: [...document.querySelectorAll(".bubble")].map((b) => b.dataset.recId), stored: st.all("texts").map((t) => t.id).sort() }; });
if (after.bubbles.join() !== "t1,t2,t3" || after.stored.length !== 5) fail("undo should put it back: " + JSON.stringify(after));

// --- Cancel leaves it; a second tap folds the tools away.
await p.click('.bubble[data-rec-id="t1"]'); await p.waitForTimeout(150);
await p.click('[data-act="delete-msg"]'); await p.waitForSelector(".modal", { timeout: 5000 });
await p.click('.modal [data-act="cancel"]'); await p.waitForTimeout(300);
if ((await p.evaluate(() => document.querySelectorAll(".bubble").length)) !== 3) fail("cancel should keep the message");
await p.click('.bubble[data-rec-id="t1"]'); await p.waitForTimeout(150);
if (await p.evaluate(() => !!document.querySelector(".bubble-tools"))) fail("tapping the message again should fold the tools away");

// --- A logged call can go too.
await p.click('.chat-event[data-rec-id="c1"]'); await p.waitForTimeout(150);
await p.click('[data-act="delete-msg"]'); await p.waitForSelector(".modal", { timeout: 5000 });
if (!/Delete this call\?/.test(await p.evaluate(() => document.querySelector(".modal").textContent))) fail("the call's confirmation should say call");
await p.click('.modal [data-act="ok"]'); await p.waitForTimeout(400);
const callGone = await p.evaluate(async () => { const st = await import("/js/store.js"); return { onScreen: !!document.querySelector('.chat-event[data-rec-id="c1"]'), stored: st.all("calls").length }; });
if (callGone.onScreen || callGone.stored) fail("the call should be gone: " + JSON.stringify(callGone));

// --- The list: press and hold a conversation deletes the thread, with undo.
await p.evaluate(() => { location.hash = "#/comms"; }); await p.waitForTimeout(600);
await p.waitForSelector(".conv-row", { timeout: 10000 });
const rows0 = await p.evaluate(() => document.querySelectorAll(".conv-row").length);
if (rows0 !== 2) fail("two conversations to start: " + rows0);
// A right-click is the hold's desktop twin.
await p.evaluate(() => { const row = [...document.querySelectorAll(".conv-row")].find((r) => /Bo Example/.test(r.textContent)); row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
await p.waitForSelector(".modal", { timeout: 5000 });
const askT = await p.evaluate(() => document.querySelector(".modal").textContent.replace(/\s+/g, " "));
if (!/Delete the conversation with Bo Example\? 2 messages/.test(askT)) fail("the confirmation should name them and count the messages: " + askT);
await p.click('.modal [data-act="ok"]'); await p.waitForTimeout(500);
let list = await p.evaluate(async () => { const st = await import("/js/store.js"); return { rows: [...document.querySelectorAll(".conv-row .conv-name")].map((n) => n.textContent.trim()), stored: st.all("texts").filter((t) => t.leadId === "b").length, toast: !!document.querySelector(".toast-undo") }; });
console.log("thread deleted:", JSON.stringify(list));
if (list.rows.join() !== "Ann Example" || list.stored || !list.toast) fail("the conversation should be gone with an undo: " + JSON.stringify(list));
// (The newest undo toast — an earlier one may still be fading.)
await p.evaluate(() => { const bs = [...document.querySelectorAll(".toast-undo button")]; bs[bs.length - 1].click(); }); await p.waitForTimeout(500);
list = await p.evaluate(async () => { const st = await import("/js/store.js"); return { rows: document.querySelectorAll(".conv-row").length, stored: st.all("texts").filter((t) => t.leadId === "b").length }; });
if (list.rows !== 2 || list.stored !== 2) fail("undo should bring the conversation back: " + JSON.stringify(list));
// The hold itself, on a phone.
await p.evaluate(() => { const row = [...document.querySelectorAll(".conv-row")].find((r) => /Bo Example/.test(r.textContent)); row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })); });
await p.waitForTimeout(700);
const held = await p.evaluate(() => !!document.querySelector(".modal"));
if (!held) fail("a press and hold should ask to delete the conversation");
await p.click('.modal [data-act="cancel"]'); await p.waitForTimeout(200);
// A plain tap still opens it.
await p.evaluate(() => { const row = [...document.querySelectorAll(".conv-row")].find((r) => /Bo Example/.test(r.textContent)); row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })); setTimeout(() => { row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" })); row.click(); }, 80); });
await p.waitForFunction(() => location.hash === "#/inbox/b", null, { timeout: 5000 }).catch(() => fail("a plain tap should still open the conversation"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndeletemsg.test.js FAILED" : "\ndeletemsg.test.js passed");
})();
