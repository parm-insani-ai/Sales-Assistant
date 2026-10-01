// "How do we make it so the emails are automatically updated and I don't
// need to hit check." The inbox checks itself while the app is in front;
// new mail lands on the Email tab by itself and is announced wherever
// you are.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const msg = (id, from, subject, text, ago) => ({ id, threadId: "th" + id, snippet: text, internalDate: String(Date.now() - ago), labelIds: ["INBOX", "UNREAD"],
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: "parm.test@gmail.com" }, { name: "Subject", value: subject }, { name: "Message-ID", value: `<${id}@mail.example>` }], body: { data: b64(text) } } });
const inbox = { m1: msg("m1", "Uncle Bob <bob@family.example>", "Dinner", "Sunday?", 7200000) };
let lists = 0;
await p.route("https://gmail.googleapis.com/**", (route) => {
  const u = route.request().url();
  if (/\/messages\?/.test(u)) { lists++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: Object.keys(inbox).map((id) => ({ id })) }) }); }
  const m = /\/messages\/(m\d)/.exec(u);
  if (m && inbox[m[1]]) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inbox[m[1]]) });
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("viniva:gmail:tokens", JSON.stringify({ accessToken: "gtok", refreshToken: "grefresh", expiresAt: Date.now() + 3600000, scope: "gmail.readonly gmail.send", account: { email: "parm.test@gmail.com" } }));
  localStorage.setItem("viniva:gmail:last", new Date().toISOString());
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", email: "dana@example.com", phone: "9025550101", stage: "working", ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", googleClientId: "123-abc.apps.googleusercontent.com", mailPollSec: 2 },
  }));
});

await p.goto(APP + "/#/comms");
await p.waitForSelector('[data-tab="email"]', { timeout: 15000 });
await p.click('[data-tab="email"]');
await p.waitForFunction(() => document.querySelectorAll(".mail-list .conv-row").length === 1, null, { timeout: 15000 }).catch(() => fail("the inbox didn't fill"));
const listsAtOpen = lists;

// Mail arrives. Nobody taps anything.
inbox.m2 = msg("m2", "Dana Muise <dana@example.com>", "Re: the Rogue", "Saturday works!", 1000);
await p.waitForFunction(() => document.querySelectorAll(".mail-list .conv-row").length === 2, null, { timeout: 8000 }).catch(() => fail("new mail should land on the Email tab by itself"));
const seen = await p.evaluate(() => ({
  top: document.querySelector(".mail-list .conv-row .conv-name")?.textContent.trim(),
  toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent),
  when: document.querySelector(".mail-when")?.textContent,
}));
console.log("after new mail:", JSON.stringify(seen), "lists:", lists - listsAtOpen);
if (seen.top !== "Dana Muise") fail("the new email should be at the top: " + JSON.stringify(seen));
if (!seen.toasts.some((t) => /New email from Dana Muise/.test(t))) fail("new mail should be announced: " + JSON.stringify(seen.toasts));
if (lists - listsAtOpen < 1) fail("the inbox wasn't checked on its own");
// A customer's reply is filed into their history straight away.
await p.waitForFunction(async () => (await import("/js/store.js")).all("emails").some((e) => e.msgId === "m2"), null, { timeout: 6000 }).catch(() => fail("a customer's new email should be filed into their history right away"));

// It keeps checking while the app is in front (the floor is five seconds,
// whatever the setting says), and stops costing anything when hidden.
const before = lists;
await p.waitForTimeout(11000);
const polls = lists - before;
console.log("checks in 11s at the 5s floor:", polls);
if (polls < 1 || polls > 3) fail("it should check on the interval, no more: " + polls);
await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
const hiddenBefore = lists;
await p.waitForTimeout(11000);
if (lists - hiddenBefore > 0) fail("a hidden app shouldn't keep polling the inbox: " + (lists - hiddenBefore));
await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });

// Leaving the tab: the list stops listening, the watch goes on quietly.
await p.click('[data-tab="messages"]');
await p.waitForTimeout(300);
inbox.m3 = msg("m3", "Ray Doucet <ray@example.com>", "Frontier", "Still available?", 500);
await p.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /New email from Ray Doucet/.test(t.textContent)), null, { timeout: 12000 }).catch(() => fail("new mail should be announced even off the Email tab"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmailwatch.test.js FAILED" : "\nmailwatch.test.js passed");
})();
