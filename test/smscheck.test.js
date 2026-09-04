// The setup check has one job: when texting doesn't work, say which of the
// three secrets is wrong and why — without ever showing a secret. These are the
// misconfigurations that actually happen, and what the salesperson must read.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const APP = "http://127.0.0.1:8137";

const GOOD_SID = { set: true, length: 34, hasWhitespace: false, hasQuotes: false, startsWith: "AC", looksRight: true };
const GOOD_TOK = { set: true, length: 32, hasWhitespace: false, hasQuotes: false, looksRight: true };
const GOOD_FROM = { set: true, length: 12, hasWhitespace: false, hasQuotes: false, value: "+19025550123", looksRight: true };

const CASES = [
  {
    name: "an API key pasted where the Account SID goes",
    reply: {
      secrets: {
        TWILIO_ACCOUNT_SID: { ...GOOD_SID, startsWith: "SK", looksRight: false },
        TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM,
      },
      auth: { ok: false, status: 401, code: 20003, message: "Authenticate" },
    },
    expect: [/starts.*SK/i, /should start.*AC/i, /Twilio rejected the credentials/i],
    forbid: [/✅ <b>Twilio accepted/],
  },
  {
    name: "a stray newline in the auth token",
    reply: {
      secrets: {
        TWILIO_ACCOUNT_SID: GOOD_SID,
        TWILIO_AUTH_TOKEN: { ...GOOD_TOK, length: 33, hasWhitespace: true, looksRight: false },
        TWILIO_FROM: GOOD_FROM,
      },
      auth: { ok: false, status: 401, code: 20003, message: "Authenticate" },
    },
    expect: [/stray space or newline/i, /re-paste/i],
  },
  {
    name: "credentials fine, but the number is on another account",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "My Twilio Account" },
      number: { owned: false, note: "That number isn't on this account — check you're using the right account or subaccount." },
    },
    expect: [/Twilio accepted the credentials/i, /isn't on this account/i],
  },
  {
    name: "everything works, but the number is in a Messaging Service",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "O'Regan's" },
      number: { owned: true, smsCapable: true, inMessagingService: true, friendlyName: "Halifax line" },
    },
    expect: [/Messaging Service/i, /replies will never arrive/i],
  },
  {
    name: "a trial account",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Trial", friendlyName: "My account" },
      number: { owned: true, smsCapable: true, inMessagingService: false, smsUrl: "https://x.test/hook?sms=1" },
    },
    expect: [/trial account/i, /only text numbers you've verified/i],
  },
  {
    name: "replies still going to the previous project",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "My first Twilio account" },
      number: { owned: true, smsCapable: true, inMessagingService: false, smsUrl: "https://api.vapi.ai/twilio/sms" },
    },
    expect: [/going somewhere else/i, /api\.vapi\.ai/, /sms=1&(amp;)?u=/, /Copy this URL/],
    forbid: [/Replies are pointed at entoa/],
  },
  {
    // The ambiguity this resolves: Twilio lists inbound messages as "Received"
    // whether they were forwarded here or to somebody else, so an empty inbox
    // looks the same either way. Only the function knows if it was called.
    name: "webhook looks right but nothing has ever arrived",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "O'Regan's" },
      number: { owned: true, smsCapable: true, inMessagingService: false,
        smsUrl: "http://127.0.0.1:8137/functions/v1/voice-agent?sms=1&u=00000000-0000-4000-8000-000000000001" },
      canReportInbound: true,
      inbound: null,
    },
    expect: [/No inbound text has ever reached this function/i, /only means Twilio got them/i],
  },
  {
    name: "a text reached the function and was accepted",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "O'Regan's" },
      number: { owned: true, smsCapable: true, inMessagingService: false,
        smsUrl: "http://127.0.0.1:8137/functions/v1/voice-agent?sms=1&u=00000000-0000-4000-8000-000000000001" },
      canReportInbound: true,
      inbound: { outcome: "accepted", from: "7202", at: new Date(Date.now() - 120000).toISOString() },
    },
    expect: [/A text has reached entoa/i, /7202/],
    forbid: [/never reached this function/i],
  },
  {
    name: "a text reached the function and was rejected",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "O'Regan's" },
      number: { owned: true, smsCapable: true, inMessagingService: false,
        smsUrl: "http://127.0.0.1:8137/functions/v1/voice-agent?sms=1&u=00000000-0000-4000-8000-000000000001" },
      canReportInbound: true,
      inbound: { outcome: "rejected: signature", from: "7202", at: new Date(Date.now() - 60000).toISOString() },
    },
    expect: [/turned away/i, /auth token is the thing to re-check/i],
    forbid: [/never reached this function/i],
  },
  {
    name: "replies correctly pointed at entoa",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "O'Regan's" },
      number: { owned: true, smsCapable: true, inMessagingService: false,
        smsUrl: "http://127.0.0.1:8137/functions/v1/voice-agent?sms=1&u=00000000-0000-4000-8000-000000000001" },
    },
    expect: [/Replies are pointed at entoa/i],
    forbid: [/going somewhere else/i],
  },
  {
    // The trap this closes: an older function returns no inbound field, which
    // is indistinguishable from "nothing ever arrived" — and sends someone to
    // debug Twilio when the answer is "redeploy me".
    name: "an older function that cannot report inbound hits",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "O'Regan's" },
      number: { owned: true, smsCapable: true, inMessagingService: false,
        smsUrl: "http://127.0.0.1:8137/functions/v1/voice-agent?sms=1&u=00000000-0000-4000-8000-000000000001" },
    },
    expect: [/can't report whether texts are arriving/i, /older build/i],
    forbid: [/never reached this function/i, /A text has reached entoa/i],
  },
  {
    name: "the number has no inbound webhook",
    reply: {
      secrets: { TWILIO_ACCOUNT_SID: GOOD_SID, TWILIO_AUTH_TOKEN: GOOD_TOK, TWILIO_FROM: GOOD_FROM },
      auth: { ok: true, accountStatus: "active", accountType: "Full", friendlyName: "O'Regan's" },
      number: { owned: true, smsCapable: true, inMessagingService: false, smsUrl: "" },
    },
    expect: [/no inbound webhook/i, /replies go nowhere/i],
  },
];

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem("entoa:auth", JSON.stringify({
      access_token: "t", refresh_token: "r",
      user: { id: "00000000-0000-4000-8000-000000000001", email: "t@e.com" },
    }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({
      leads: [], texts: [],
      settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false,
        smsFrom: "+19025550123", agentUrl: "http://127.0.0.1:8137/functions/v1/voice-agent" },
    }));
  });

  for (const c of CASES) {
    await fetch(APP + "/__check", { method: "POST", body: JSON.stringify(c.reply) });
    await p.goto(APP + "/#/settings");
    await p.waitForTimeout(500);
    await p.$$eval("details", (ds) => ds.forEach((d) => (d.open = true)));
    await p.waitForSelector("#sms-check");
    await p.$eval("#sms-check", (x) => x.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await p.waitForFunction(() => {
      const t = document.querySelector("#sms-check-out")?.textContent || "";
      return t && t !== "Checking…";
    }, null, { timeout: 8000 });
    const html = await p.$eval("#sms-check-out", (x) => x.innerHTML);
    const text = await p.$eval("#sms-check-out", (x) => x.textContent.replace(/\s+/g, " ").trim());
    console.log(`\n${c.name}:\n  ${text.slice(0, 210)}`);
    for (const re of c.expect) {
      if (!re.test(html)) throw new Error(`FAIL [${c.name}]: readout never says ${re}\n  got: ${text}`);
    }
    for (const re of c.forbid || []) {
      if (re.test(html)) throw new Error(`FAIL [${c.name}]: readout wrongly says ${re}`);
    }
    // A diagnostic that leaks the thing it's diagnosing is worse than none.
    if (/[0-9a-f]{32}/i.test(text)) throw new Error(`FAIL [${c.name}]: a credential-shaped string is on screen`);
  }

  if (errs.length) throw new Error("FAIL: page errors — " + errs.join(" | "));
  console.log("\nSMS CHECK PASS");
  await b.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
