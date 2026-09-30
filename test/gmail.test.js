// Gmail, the same two halves as Outlook: the sign-in finishes through the
// function (which holds the client secret), then the phone sends from the
// Gmail address and files customers' replies from the inbox. Google's
// consent page is faked to bounce straight back with a code, as Google
// does after the user allows the app.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const sent = [];
// Google's consent page: allow at once and bounce back with a code.
await p.route("https://accounts.google.com/**", (route) => {
  const u = new URL(route.request().url());
  const back = `${u.searchParams.get("redirect_uri")}?code=CODE123&state=${encodeURIComponent(u.searchParams.get("state") || "")}&scope=${encodeURIComponent(u.searchParams.get("scope") || "")}`;
  return route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace(${JSON.stringify(back)})</script>` });
});
// The Gmail API: a profile, one reply from Dana and one from a stranger, and a send.
await p.route("https://gmail.googleapis.com/**", (route) => {
  const req = route.request(); const u = req.url();
  if (/\/profile/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ emailAddress: "parm.test@gmail.com" }) });
  if (/\/messages\/send$/.test(u)) { sent.push(JSON.parse(req.postData())); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "sent1" }) }); }
  if (/\/messages\?/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [{ id: "m1" }, { id: "m2" }] }) });
  if (/\/messages\/m1/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "m1", snippet: "Saturday works for me", internalDate: String(Date.now() - 3600000), payload: { headers: [{ name: "From", value: "Dana Muise <dana@example.com>" }, { name: "Subject", value: "Re: the Rogue" }] } }) });
  if (/\/messages\/m2/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "m2", snippet: "Buy now", internalDate: String(Date.now() - 7200000), payload: { headers: [{ name: "From", value: "Deals <promo@shop.example>" }, { name: "Subject", value: "Sale!" }] } }) });
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  if (!localStorage.getItem("sales-assistant:v1")) {
    const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
    localStorage.setItem("sales-assistant:v1", JSON.stringify({
      leads: [{ id: "a", name: "Dana Muise", email: "dana@example.com", stage: "working", vehicleInterest: "2026 Rogue SV", ...x }],
      settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", contactEmail: "parm.test@gmail.com" },
    }));
  }
});

// --- Connect: paste the Client ID, tap Connect, allow at Google, land back connected.
await p.goto(APP + "/#/settings");
await p.waitForSelector("#gm-connect", { timeout: 15000 });
await p.fill("#gm-client", "123-abc.apps.googleusercontent.com");
await p.click("#gm-connect");
await p.waitForFunction(() => !!localStorage.getItem("viniva:gmail:tokens"), null, { timeout: 15000 }).catch(() => fail("the Google sign-in never completed"));
await p.waitForTimeout(500);
const conn = await p.evaluate(async () => { const g = await import("/js/gmail.js"); return { connected: g.gmailConnected(), canSend: g.gmailCanSend(), account: g.gmailAccount(), url: location.search }; });
const exchanges = await (await fetch(APP + "/__gauths")).json();
console.log("connected:", JSON.stringify(conn), "| exchanges:", JSON.stringify(exchanges.map((g) => ({ clientId: g.clientId, code: g.code, hasVerifier: !!g.verifier, redirect: g.redirect }))));
if (!conn.connected || !conn.canSend || (conn.account || {}).email !== "parm.test@gmail.com" || conn.url) fail("Gmail didn't connect cleanly: " + JSON.stringify(conn));
if (exchanges.length !== 1 || exchanges[0].code !== "CODE123" || exchanges[0].clientId !== "123-abc.apps.googleusercontent.com" || !exchanges[0].verifier || !/^http:\/\/127\.0\.0\.1:8137\/$/.test(exchanges[0].redirect)) fail("the code wasn't exchanged through the function with the verifier and redirect: " + JSON.stringify(exchanges));

// --- Settings says so, and the test email goes out from Gmail.
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/settings"; });
await p.waitForSelector("#em-test", { timeout: 15000 });
const card = await p.evaluate(() => document.querySelector("#email-slot").textContent.replace(/\s+/g, " ").trim());
if (!/Connected as parm\.test@gmail\.com/.test(card) || !/sends from this address/.test(card) || !/Emails go out from parm\.test@gmail\.com/.test(card)) fail("Settings doesn't say the connected Gmail sends: " + card.slice(0, 400));
await p.click("#em-test");
await p.waitForFunction(() => /Sent from your Gmail/.test(document.querySelector("#em-test-out")?.textContent || ""), null, { timeout: 8000 }).catch(() => fail("the test email didn't report going out from Gmail"));
if (sent.length !== 1 || !sent[0].raw) fail("the test email didn't go through Gmail's send: " + JSON.stringify(sent));
const raw = Buffer.from(String(sent[0].raw).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
if (!/^To: parm\.test@gmail\.com/m.test(raw) || !/^Subject: /m.test(raw)) fail("the message isn't addressed as an email: " + raw.slice(0, 200));

// --- Check mail: Dana's reply is filed to her; the stranger's is ignored; a second pull files nothing twice.
await p.click("#gm-pull");
await p.waitForFunction(() => /Checked 2 messages/.test(document.querySelector("#gm-out")?.textContent || ""), null, { timeout: 8000 }).catch(() => fail("the mail check didn't finish: " + (document && "")));
const filed = await p.evaluate(async () => { const s = await import("/js/store.js"); return s.all("emails").map((e) => `${e.leadId}:${e.direction}:${e.via}:${e.subject}:${e.msgId}`); });
console.log("filed:", JSON.stringify(filed));
if (filed.length !== 1 || filed[0] !== "a:in:gmail:Re: the Rogue:m1") fail("Dana's reply wasn't filed (and only hers): " + JSON.stringify(filed));
await p.click("#gm-pull"); await p.waitForTimeout(600);
const again = await p.evaluate(async () => { const s = await import("/js/store.js"); return s.all("emails").length; });
if (again !== 1) fail("a second check filed the same reply again");

// --- The automated follow-up goes from Gmail too.
const auto = await p.evaluate(async () => {
  const s = await import("/js/store.js"); const e = await import("/js/email.js");
  s.create("tasks", { leadId: "a", cadence: true, channel: "email", title: "Email Dana — follow up", due: "2026-09-01", done: false });
  s.updateSettings({ emailAutoSend: true });
  const r = await e.autoSendDueEmails();
  return { r, via: e.emailSendVia() };
});
if (auto.r.sent !== 1 || auto.via !== "gmail" || sent.length !== 2) fail("the due follow-up didn't send from Gmail: " + JSON.stringify(auto));

// --- Disconnect: back to the setup, nothing sends from Gmail.
await p.click("#gm-off"); await p.waitForTimeout(300);
const off = await p.evaluate(async () => { const e = await import("/js/email.js"); return { connect: !!document.querySelector("#gm-connect"), via: e.emailSendVia() }; });
if (!off.connect || off.via === "gmail") fail("disconnecting didn't take: " + JSON.stringify(off));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ngmail.test.js FAILED" : "\ngmail.test.js passed");
})();
