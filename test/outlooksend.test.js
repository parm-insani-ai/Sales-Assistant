// One Outlook connection does both halves of email: replies come in, and
// what viniva sends goes out from the salesperson's own mailbox (Graph
// sendMail, saved to Sent Items) — the automated follow-ups and reminders
// included. Without the send permission (a connection made before sending
// existed) the app says so and asks for one more Connect; with no Outlook
// at all it falls back to the function's Resend sending.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const sent = [];
await p.route("https://graph.microsoft.com/**", (route) => {
  const req = route.request();
  if (/\/me\/sendMail$/.test(req.url()) && req.method() === "POST") { sent.push(JSON.parse(req.postData())); return route.fulfill({ status: 202, body: "" }); }
  if (/\/me\/messages/.test(req.url())) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ value: [] }) });
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  localStorage.setItem("viniva:msmail:tokens", JSON.stringify({ accessToken: "graph", refreshToken: "g", expiresAt: Date.now() + 3600000, scope: "openid profile offline_access Mail.Read Mail.Send", account: { name: "Parm Shokar", email: "parm@store.example" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", email: "dana@example.com", stage: "working", vehicleInterest: "2026 Rogue SV", ...x }],
    tasks: [{ id: "t1", leadId: "a", cadence: true, channel: "email", title: "Email Dana — follow up", due: "2026-09-01", done: false, ...x }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, msClientId: "client-1", emailAutoSend: false, contactEmail: "parm@store.example" },
  }));
});

// --- Settings says the connection sends, and the test email goes out through Graph.
await p.goto(APP + "/#/settings");
await p.waitForSelector("#em-test", { timeout: 15000 });
const card = await p.evaluate(() => ({ text: document.querySelector("#email-slot").textContent.replace(/\s+/g, " ").trim(), reconnect: !!document.querySelector("#email-slot #ms-connect") }));
console.log("settings:", card.text.slice(0, 260));
if (!/Connected as parm@store\.example/.test(card.text) || !/sends from this address/.test(card.text) || !/Emails go out from parm@store\.example/.test(card.text)) fail("Settings doesn't say the connected Outlook sends: " + card.text.slice(0, 300));
if (card.reconnect) fail("a connection that can send is asked to connect again");
await p.click("#em-test");
await p.waitForFunction(() => /Sent from your Outlook/.test(document.querySelector("#em-test-out")?.textContent || ""), null, { timeout: 8000 }).catch(() => fail("the test email didn't report going out from Outlook: " + (p.evaluate(() => document.querySelector("#em-test-out")?.textContent) || "")));
if (sent.length !== 1 || sent[0].message.toRecipients[0].emailAddress.address !== "parm@store.example" || !sent[0].saveToSentItems || !/viniva test email/.test(sent[0].message.subject)) fail("the test email didn't go through Graph sendMail: " + JSON.stringify(sent));

// --- The automated follow-up goes the same way, and is logged as sent.
const auto = await p.evaluate(async () => {
  const s = await import("/js/store.js"); const e = await import("/js/email.js");
  s.updateSettings({ emailAutoSend: true });
  const r = await e.autoSendDueEmails();
  return { r, task: s.get("tasks", "t1").done, emails: s.all("emails").filter((m) => m.leadId === "a").map((m) => `${m.direction}:${m.via}:${m.subject}`), via: e.emailSendVia() };
});
console.log("auto:", JSON.stringify(auto));
if (auto.r.sent !== 1 || auto.r.errors.length || !auto.task || !auto.emails.some((m) => /^out:auto:/.test(m)) || auto.via !== "outlook") fail("the due follow-up didn't send from Outlook: " + JSON.stringify(auto));
if (sent.length !== 2 || sent[1].message.toRecipients[0].emailAddress.address !== "dana@example.com" || !/Rogue/.test(sent[1].message.subject)) fail("the follow-up didn't go to the customer through Graph: " + JSON.stringify(sent[1]));

// --- A read-only connection (no Mail.Send) is told to connect again, and sending falls back to the function.
await p.evaluate(() => { const t = JSON.parse(localStorage.getItem("viniva:msmail:tokens")); t.scope = "openid profile offline_access Mail.Read"; localStorage.setItem("viniva:msmail:tokens", JSON.stringify(t)); location.hash = "#/"; });
await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/settings"; });
await p.waitForSelector("#em-test", { timeout: 15000 });
const ro = await p.evaluate(async () => { const e = await import("/js/email.js"); return { text: document.querySelector("#email-slot").textContent.replace(/\s+/g, " ").trim(), reconnect: !!document.querySelector("#email-slot #ms-connect"), via: e.emailSendVia() }; });
if (!/read your mail but not send/.test(ro.text) || !ro.reconnect || ro.via === "outlook") fail("a read-only connection isn't asked to allow sending: " + JSON.stringify({ reconnect: ro.reconnect, via: ro.via }));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\noutlooksend.test.js FAILED" : "\noutlooksend.test.js passed");
})();
