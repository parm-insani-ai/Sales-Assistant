// "I need the application to use all emails and messages as context the
// agent refers to." So: every text, email and call — both directions, plus
// what's in the connected inbox — is one conversation per customer that the
// assistant carries into every turn, can read back on request, and that a
// drafted message continues from.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const hit = (path, opts) => fetch(APP + path, opts).then((r) => r.json());
await hit("/__reset");

const H = 3600000, now = Date.now();
const iso = (ago) => new Date(now - ago).toISOString();
const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// The inbox: Dana's reply to an email (also filed, with the snippet), and a
// stranger's email that isn't on file anywhere else.
const inbox = {
  m1: { id: "m1", threadId: "thm1", snippet: "Saturday works, can you hold the white one", internalDate: String(now - 2 * H), labelIds: ["INBOX", "UNREAD"],
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Dana Muise <dana@example.com>" }, { name: "To", value: "parm.test@gmail.com" }, { name: "Subject", value: "Re: the Rogue" }, { name: "Message-ID", value: "<m1@mail.example>" }], body: { data: b64("Saturday works, can you hold the white one? My husband wants to see the Platinum too.") } } },
  m2: { id: "m2", threadId: "thm2", snippet: "Is the Frontier still available", internalDate: String(now - 5 * H), labelIds: ["INBOX", "UNREAD"],
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Ray Doucet <ray@example.com>" }, { name: "To", value: "parm.test@gmail.com" }, { name: "Subject", value: "Frontier" }, { name: "Message-ID", value: "<m2@mail.example>" }], body: { data: b64("Is the Frontier still available?") } } },
};
await p.route("https://gmail.googleapis.com/**", (route) => {
  const u = route.request().url();
  if (/\/messages\?/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: Object.keys(inbox).map((id) => ({ id })) }) });
  const m = /\/messages\/(m\d)/.exec(u);
  if (m && inbox[m[1]]) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inbox[m[1]]) });
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});
await p.addInitScript(({ iso }) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("viniva:gmail:tokens", JSON.stringify({ accessToken: "gtok", refreshToken: "grefresh", expiresAt: Date.now() + 3600000, scope: "gmail.readonly gmail.send", account: { email: "parm.test@gmail.com" } }));
  localStorage.setItem("viniva:gmail:last", iso.d1); // a pull has run; nothing to file again
  const x = { createdAt: iso.d3, updatedAt: iso.d3 };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "a", name: "Dana Muise", email: "dana@example.com", phone: "9025551111", stage: "working", vehicleInterest: "2026 Rogue SV", loggedAt: iso.d3, ...x },
      { id: "k", name: "Ken Ito", phone: "9025552222", stage: "working", vehicleInterest: "Kicks", loggedAt: iso.d3, ...x },
    ],
    texts: [
      { id: "t1", leadId: "k", dir: "in", body: "Can I come by tomorrow around 5?", at: iso.h20, read: false, ...x },
      { id: "t0", leadId: "a", dir: "out", body: "Hi Dana, the Rogue SV you liked is in — want to see it?", at: iso.d1, read: true, status: "sent", ...x },
      { id: "t2", leadId: "a", dir: "in", body: "Yes! Saturday morning?", at: iso.h22, read: true, ...x },
      { id: "t3", leadId: "a", dir: "out", body: "Saturday at 10 works, see you then.", at: iso.h21, read: true, status: "sent", ...x },
    ],
    emails: [
      { id: "e1", leadId: "a", direction: "out", subject: "The Rogue", body: "Dana, here's the SV I mentioned — happy to hold it.", via: "gmail", createdAt: iso.h6, updatedAt: iso.h6 },
      { id: "e2", leadId: "a", direction: "in", subject: "Re: the Rogue", body: "Saturday works, can you hold the white one", via: "gmail", msgId: "m1", receivedAt: iso.h2, createdAt: iso.h2, updatedAt: iso.h2 },
    ],
    calls: [{ id: "c1", leadId: "a", dir: "out", at: iso.d2, outcome: "reached", notes: "walked through trims, she wants the SV", logged: true, createdAt: iso.d2, updatedAt: iso.d2 }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", googleClientId: "123-abc.apps.googleusercontent.com" },
  }));
}, { iso: { d1: iso(24 * H), d2: iso(48 * H), d3: iso(72 * H), h2: iso(2 * H), h6: iso(6 * H), h20: iso(20 * H), h21: iso(21 * H), h22: iso(22 * H) } });

// Open the inbox once so the mailbox is on the device, as it is on a phone
// that has looked at Comms → Email.
await p.goto(APP + "/#/comms");
await p.waitForSelector('[data-tab="email"]', { timeout: 15000 });
await p.click('[data-tab="email"]');
await p.waitForFunction(() => document.querySelectorAll(".mail-list .conv-row").length === 2, null, { timeout: 15000 }).catch(() => fail("the inbox didn't fill"));
await p.evaluate(() => { location.hash = "#/"; });
await p.waitForTimeout(300);

// --- One conversation per customer, every channel, oldest first.
const convo = await p.evaluate(async () => {
  const c = await import("/js/convo.js");
  const items = c.conversationFor("a", { limit: 0 });
  return { kinds: items.map((i) => `${i.kind}:${i.dir}`), lines: c.transcript(items, { name: "Dana Muise" }), standing: c.standingWith("a"), ken: c.standingWith("k") };
});
console.log("Dana:", JSON.stringify(convo.lines, null, 1));
if (convo.kinds.join("|") !== "call:out|text:out|text:in|text:out|email:out|email:in") fail("the conversation should be every channel in time order: " + convo.kinds.join("|"));
if (!/^.+? · Dana \(email\): "Re: the Rogue" — Saturday works, can you hold the white one$/.test(convo.lines[5] || "")) fail("before it's opened, the email is its snippet: " + convo.lines[5]);
if (!/^.+? · me \(call\): Called them: walked through trims/.test(convo.lines[0] || "")) fail("a logged call should read as one: " + convo.lines[0]);
if (!convo.standing.waitingOnMe || convo.standing.last.kind !== "email" || !convo.ken.waitingOnMe) fail("Dana (email) and Ken (text) both wrote last and are waiting: " + JSON.stringify([convo.standing, convo.ken]));

// --- What came in lately, from everyone, strangers included.
const recent = await p.evaluate(async () => { const c = await import("/js/convo.js"); return { rows: c.recentInbound({ hours: 48 }).map((i) => `${i.who}|${i.kind}|${i.customer}|${i.answered}`), digest: c.recentDigest() }; });
console.log("recent:", JSON.stringify(recent, null, 1));
if (recent.rows.join(" ; ") !== "Dana Muise|email|true|false ; Ray Doucet|email|false|false ; Ken Ito|text|true|false ; Dana Muise|text|true|true") fail("recent inbound should be newest first, every source once, strangers marked: " + recent.rows.join(" ; "));
if (!/Dana Muise emailed — WAITING on a reply: "Re: the Rogue" Saturday works/.test(recent.digest) || !/Ray Doucet \(not on file\) emailed — WAITING/.test(recent.digest) || !/Ken Ito texted — WAITING on a reply: Can I come by/.test(recent.digest)) fail("the digest should name who wrote, how, and that they're waiting: " + recent.digest);

// --- The assistant carries it into every turn, and can read it back.
await hit("/__reset");
const agent = await p.evaluate(async () => {
  const a = await import("/js/agent.js");
  const s = a.createAgentSession();
  await s.send("anything from my customers?");
  const dana = await a.execTool("get_customer", { name: "Dana" });
  const msgs = await a.execTool("get_messages", { customer: "dana" });
  const all = await a.execTool("get_messages", {});
  const emails = await a.execTool("get_messages", { kind: "email" });
  return { dana: dana.result, msgs: msgs.result, all: all.result, emails: emails.result, hash: location.hash };
});
const relays = await hit("/__relays");
const sys = relays[0] && relays[0].system || "";
if (!/RECENT MESSAGES IN/.test(sys) || !/Dana Muise emailed — WAITING/.test(sys) || !/Ken Ito texted — WAITING/.test(sys)) fail("the assistant's prompt should carry who has written in: " + sys.slice(-600));
if (!/WHAT CUSTOMERS HAVE SAID is on file/.test(sys) || !relays[0].tools.includes("get_messages")) fail("the assistant should be told the conversations exist and have the tool");
console.log("get_customer conversation:", JSON.stringify(agent.dana.conversation, null, 1));
if (!agent.dana.waitingOnMe || agent.dana.conversation.length !== 6 || !/Platinum/.test(agent.dana.conversation[5])) fail("get_customer should include the whole conversation — the email's full text fetched — and that she's waiting: " + JSON.stringify(agent.dana));
if (agent.msgs.customer !== "Dana Muise" || agent.msgs.messages.length !== 6 || !agent.msgs.waitingOnMe || !/Platinum/.test(agent.msgs.messages[5])) fail("get_messages for a customer is their conversation, emails in full: " + JSON.stringify(agent.msgs));
if (agent.all.messages.map((m) => `${m.from}:${m.by}:${m.answered}`).join("|") !== "Dana Muise:email:false|Ray Doucet:email:false|Ken Ito:text:false|Dana Muise:text:true") fail("get_messages without a customer is everything that came in, newest first: " + JSON.stringify(agent.all.messages));
if (agent.emails.messages.length !== 2 || agent.emails.messages.some((m) => m.by !== "email")) fail("kind narrows it: " + JSON.stringify(agent.emails.messages));
if (agent.hash !== "#/comms") fail("the recent list should land on Comms: " + agent.hash);

// --- A drafted follow-up continues from the whole conversation, figures out.
await hit("/__reset");
await p.evaluate(async () => {
  const s = await import("/js/store.js");
  s.create("texts", { leadId: "a", dir: "in", body: "Also I can put about 5,000 down", at: new Date().toISOString(), read: true });
  const t = await import("/js/touches.js");
  await t.draftTouch(s.get("leads", "a"), { intent: "confirm", step: 1, of: 3, why: ["Saturday at 10"] });
});
const touch = (await hit("/__relays"))[0];
const asked = touch && touch.messages[0] && touch.messages[0].content || "";
console.log("touch prompt:", asked.slice(0, 700));
if (!/Dana \(email\): Re: the Rogue — Saturday works, can you hold the white one/.test(asked) || !/Me \(call\): Called them: walked through trims/.test(asked) || !/Dana: Yes! Saturday morning\?/.test(asked)) fail("the follow-up draft should see the emails and calls as well as the texts: " + asked.slice(0, 500));
if (/5,000|5000/.test(asked)) fail("a figure the customer texted must not reach the drafter: " + asked);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nconvo.test.js FAILED" : "\nconvo.test.js passed");
})();
