// Comms → Email with a mailbox connected is the inbox itself: every
// message, customers tagged, read in place, answered in the same thread,
// and a new email to anyone from the connected address. Gmail here; the
// same screen drives Outlook through msmail.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const sent = [];
const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const msg = (id, from, subject, snippet, text, unread, ago) => ({ id, threadId: "th" + id, snippet, internalDate: String(Date.now() - ago), labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"],
  payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: from }, { name: "To", value: "parm.test@gmail.com" }, { name: "Subject", value: subject }, { name: "Message-ID", value: `<${id}@mail.example>` }],
    parts: [{ mimeType: "text/plain", body: { data: b64(text) } }, { mimeType: "text/html", body: { data: b64("<p>" + text + "</p>") } }] } });
const inbox = {
  m1: msg("m1", "Dana Muise <dana@example.com>", "Re: the Rogue", "Saturday works for me", "Saturday works for me.\n\nSee you at 10?", true, 3600000),
  m2: msg("m2", "Uncle Bob <bob@family.example>", "Dinner Sunday", "Are you coming", "Are you coming to dinner Sunday?", false, 7200000),
  m3: msg("m3", "no-reply@newsletter.example", "This week's deals", "Big savings", "Big savings inside.", true, 10800000),
};
await p.route("https://gmail.googleapis.com/**", (route) => {
  const req = route.request(); const u = req.url();
  if (/\/profile/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ emailAddress: "parm.test@gmail.com" }) });
  if (/\/messages\/send$/.test(u)) { sent.push(JSON.parse(req.postData())); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "s" + sent.length }) }); }
  if (/\/messages\?/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: Object.keys(inbox).map((id) => ({ id })) }) });
  const m = /\/messages\/(m\d)/.exec(u);
  if (m && inbox[m[1]]) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inbox[m[1]]) });
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("viniva:gmail:tokens", JSON.stringify({ accessToken: "gtok", refreshToken: "grefresh", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email", account: { email: "parm.test@gmail.com" } }));
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", email: "dana@example.com", stage: "working", vehicleInterest: "2026 Rogue SV", loggedAt: "2026-09-01T00:00:00.000Z", ...x }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", googleClientId: "123-abc.apps.googleusercontent.com" },
  }));
});

// --- The inbox on Comms → Email: every message, newest first, customers tagged.
await p.goto(APP + "/#/comms");
await p.waitForSelector('[data-tab="email"]', { timeout: 15000 });
await p.click('[data-tab="email"]');
await p.waitForFunction(() => document.querySelectorAll(".mail-list .conv-row").length === 3, null, { timeout: 15000 }).catch(() => fail("the inbox didn't fill"));
const list = await p.evaluate(() => ({
  head: document.querySelector(".mail-head")?.textContent.replace(/\s+/g, " ").trim(),
  rows: [...document.querySelectorAll(".mail-list .conv-row")].map((r) => ({ who: r.querySelector(".conv-name").textContent.trim(), subject: r.querySelector(".conv-subject").textContent.trim(), unread: r.classList.contains("conv-unread"), tag: r.querySelector(".conv-tag")?.textContent.trim() || "" })),
}));
console.log("inbox:", JSON.stringify(list, null, 1));
if (!/Gmail · parm\.test@gmail\.com/.test(list.head || "")) fail("the header doesn't name the mailbox: " + list.head);
if (list.rows.map((r) => r.who).join("|") !== "Dana Muise|Uncle Bob|no-reply@newsletter.example") fail("the inbox isn't every message newest first: " + JSON.stringify(list.rows));
if (list.rows[0].tag !== "customer" || list.rows[1].tag) fail("the customer isn't tagged (and only the customer): " + JSON.stringify(list.rows));
if (!list.rows[0].unread || list.rows[1].unread || !list.rows[2].unread) fail("unread state is wrong: " + JSON.stringify(list.rows));

// --- Open Dana's: the whole text, her page one tap away, a reply in the same thread.
await p.click(".mail-list .conv-row");
await p.waitForFunction(() => /See you at 10\?/.test(document.querySelector(".modal .mail-body")?.textContent || ""), null, { timeout: 8000 }).catch(() => fail("the message text didn't load"));
const open = await p.evaluate(() => ({ title: document.querySelector(".modal h2")?.textContent.trim(), customer: document.querySelector('.modal [data-act="open-customer"]')?.textContent.trim(), body: document.querySelector(".modal .mail-body")?.textContent }));
if (open.title !== "Re: the Rogue" || !/Dana Muise/.test(open.customer || "") || /<p>/.test(open.body || "")) fail("the message view is wrong: " + JSON.stringify(open));
await p.fill(".modal #mail-reply-text", "10 is perfect — see you then.");
await p.click('.modal [data-act="send-reply"]');
await p.waitForFunction(() => !document.querySelector(".modal"), null, { timeout: 8000 }).catch(() => fail("the reply didn't send: " + ""));
const reply = sent[0];
const raw = reply && Buffer.from(String(reply.raw).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
console.log("reply headers:", raw ? raw.split("\r\n").slice(0, 4).join(" | ") : "(none)");
if (!reply || reply.threadId !== "thm1" || !/^To: Dana Muise <dana@example\.com>/m.test(raw) || !/^In-Reply-To: <m1@mail\.example>/m.test(raw)) fail("the reply isn't in Dana's thread: " + JSON.stringify(reply));
const logged = await p.evaluate(async () => { const s = await import("/js/store.js"); return { emails: s.all("emails").map((e) => `${e.leadId}:${e.direction}:${e.via}:${e.subject}`), via: s.get("leads", "a").lastContactVia, read: !document.querySelector(".mail-list .conv-row").classList.contains("conv-unread") }; });
if (!logged.emails.includes("a:out:gmail:Re: the Rogue") || logged.via !== "email" || !logged.read) fail("the reply wasn't logged to Dana, or the message wasn't marked read: " + JSON.stringify(logged));

// --- A stranger can be added as a customer from their email.
await p.evaluate(() => document.querySelectorAll(".mail-list .conv-row")[1].click());
await p.waitForSelector('.modal [data-act="add-customer"]', { timeout: 5000 });
await p.click('.modal [data-act="add-customer"]');
await p.waitForSelector('.modal input[name="name"]', { timeout: 5000 });
const prefilled = await p.evaluate(() => ({ name: document.querySelector('.modal input[name="name"]').value, email: document.querySelector('.modal input[name="email"]').value }));
if (prefilled.name !== "Uncle Bob" || prefilled.email !== "bob@family.example") fail("Add as customer didn't start from the sender: " + JSON.stringify(prefilled));
await p.evaluate(() => document.querySelector(".modal .modal-close")?.click());
await p.waitForTimeout(300);

// --- Compose: a new email to anyone, from the connected address.
await p.click('[data-act="compose"]');
await p.waitForSelector(".modal #mc-to", { timeout: 5000 });
const composeBtn = await p.evaluate(() => document.querySelector('.modal [data-act="send"]')?.textContent.trim());
if (!/from parm\.test@gmail\.com/.test(composeBtn || "")) fail("compose doesn't say which address it sends from: " + composeBtn);
await p.fill(".modal #mc-to", "ken@example.com");
await p.fill(".modal #mc-subject", "Your Kicks is in");
await p.fill(".modal #mc-text", "Hi Ken, the Kicks arrived today.");
await p.click('.modal [data-act="send"]');
await p.waitForFunction(() => !document.querySelector(".modal"), null, { timeout: 8000 }).catch(() => fail("the new email didn't send"));
const raw2 = sent[1] && Buffer.from(String(sent[1].raw).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
if (!raw2 || !/^To: ken@example\.com/m.test(raw2)) fail("the new email didn't go out through Gmail: " + JSON.stringify(sent[1]));

// --- Without a mailbox: the logged emails and a nudge to connect.
await p.evaluate(() => { localStorage.removeItem("viniva:gmail:tokens"); location.hash = "#/"; });
await p.waitForTimeout(200);
await p.evaluate(() => { location.hash = "#/comms"; });
await p.waitForSelector('[data-tab="email"]', { timeout: 15000 });
await p.click('[data-tab="email"]');
await p.waitForTimeout(400);
const off = await p.evaluate(() => document.querySelector("#c-body").textContent.replace(/\s+/g, " ").trim());
if (!/inbox isn't connected/.test(off) || !/Dana Muise/.test(off)) fail("without a mailbox the tab should show the log and ask to connect: " + off.slice(0, 200));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmailbox.test.js FAILED" : "\nmailbox.test.js passed");
})();
