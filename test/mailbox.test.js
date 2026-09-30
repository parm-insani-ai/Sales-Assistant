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
  m1: msg("m1", "Dana Muise <dana@example.com>", "Re: the Rogue", "Saturday works for me", "Saturday works for me.\n\nSee you at 10? Directions: https://maps.example/oregans.\n\nOn Mon, Sep 28, 2026 at 2:00 PM Parm <parm.test@gmail.com> wrote:\n> Does Saturday work for a test drive?", true, 3600000),
  m2: msg("m2", "Uncle Bob <bob@family.example>", "Dinner Sunday", "Are you coming", "Are you coming to dinner Sunday?", false, 7200000),
  m3: msg("m3", "no-reply@newsletter.example", "This week's deals", "Big savings", "Big savings inside.", true, 10800000),
};
await p.route("https://gmail.googleapis.com/**", (route) => {
  const req = route.request(); const u = req.url();
  if (/\/profile/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ emailAddress: "parm.test@gmail.com" }) });
  if (/\/messages\/send(\?|$)/.test(u)) { sent.push(JSON.parse(req.postData())); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "s" + sent.length }) }); }
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
const open = await p.evaluate(() => ({
  title: document.querySelector(".modal h2")?.textContent.trim(),
  customer: document.querySelector('.modal [data-act="open-customer"]')?.getAttribute("aria-label"),
  body: document.querySelector(".modal .mail-body")?.textContent,
  from: document.querySelector(".modal .mail-from")?.textContent.replace(/\s+/g, " ").trim(),
  link: document.querySelector('.modal [data-act="open-in"]')?.getAttribute("href"),
  linkText: [...document.querySelectorAll('.modal [data-act="open-in"]')].map((a) => a.textContent.trim() || a.getAttribute("aria-label")).join("|"),
  quoteHidden: !document.querySelector(".modal .mail-quote")?.checkVisibility(),
  href: document.querySelector(".modal .mail-body a")?.getAttribute("href"),
  replyHidden: !document.querySelector(".modal #mc-text"),
  topOpen: !!document.querySelector(".modal .mail-bar [data-act='open-in']"),
  detailsHidden: !document.querySelector(".modal .mail-details")?.checkVisibility(),
  full: document.querySelector(".modal").classList.contains("modal-mail"),
}));
console.log("open:", JSON.stringify(open, null, 1));
if (open.title !== "Re: the Rogue" || !/Dana Muise/.test(open.customer || "") || /<p>/.test(open.body || "")) fail("the message view is wrong: " + JSON.stringify(open));
if (!/Dana Muise.*to me/.test(open.from || "")) fail("the sender row should read like the mail apps (name, time, 'to me'): " + open.from);
await p.waitForTimeout(400); // past the slide-in
const page = await p.evaluate(() => ({
  bar: !!document.querySelector(".modal .mail-bar [data-act='back']"),
  chip: document.querySelector(".modal .mail-subject .mail-chip")?.textContent.trim(),
  edge: (() => { const r = document.querySelector(".modal").getBoundingClientRect(); return Math.abs(r.top) < 1 && Math.abs(r.left) < 1 && Math.abs(r.width - innerWidth) < 1 && Math.abs(r.height - innerHeight) < 1; })(),
  pills: [...document.querySelectorAll(".modal .mail-actions .mail-pill")].map((b) => b.textContent.trim()).join("|"),
  handle: document.querySelector(".modal .modal-handle")?.checkVisibility() || false,
  footFixed: (() => { const f = document.querySelector(".modal .mail-foot"); if (!f || f.closest(".mail-page")) return false; const r = f.getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 1; })(),
}));
if (!page.footFixed) fail("Reply / Open in Gmail should sit in a footer pinned to the bottom, outside the scrolling page: " + JSON.stringify(page));
if (!page.bar || page.chip !== "Customer" || !page.edge || page.handle) fail("the email should be a full page with a back arrow, no sheet handle, and the subject carrying a Customer chip: " + JSON.stringify(page));
if (page.pills !== "Reply|Open in Gmail") fail("the pills along the bottom should be Reply and Open in Gmail: " + page.pills);
if (open.link !== "https://mail.google.com/mail/?authuser=parm.test%40gmail.com#all/thm1" || !/Open in Gmail/.test(document_or(open.linkText))) fail("Open in Gmail should link to this thread in Gmail: " + open.link + " / " + open.linkText);
if (!open.quoteHidden || !/Does Saturday work/.test(open.body || "")) fail("the quoted history should be folded behind the dots: " + JSON.stringify(open));
if (open.href !== "https://maps.example/oregans") fail("links in the text should be tappable, without the trailing period: " + open.href);
if (!open.replyHidden || !open.full) fail("the reply box waits for a Reply tap, and the email takes the full sheet: " + JSON.stringify(open));
if (open.topOpen) fail("the top bar shouldn't carry a second Open in Gmail — the pill is the one");
if (!open.detailsHidden) fail("the full addresses stay folded until the sender row is tapped");
// Open in Gmail on a phone goes to the app: Android by an intent that names
// Gmail (falling back to the web), iPhone by Gmail's own scheme (it won't
// take a link to one email), Outlook by its message deep link.
const links = await p.evaluate(async () => {
  const mb = await import("/js/mailbox.js");
  const g = { provider: "gmail", id: "m1", threadId: "thm1" }, o = { provider: "outlook", id: "AAMkAG=", webLink: "https://outlook.live.com/mail/0/deeplink/read/AAMkAG%3D" };
  const A = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128 Mobile", I = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1", D = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/128";
  return { ga: mb.mailAppLink(g, A), gi: mb.mailAppLink(g, I), gd: mb.mailAppLink(g, D), oa: mb.mailAppLink(o, A), od: mb.mailAppLink(o, D) };
});
console.log("app links:", JSON.stringify(links, null, 1));
if (!links.ga.app || links.ga.href !== "intent://mail.google.com/mail/?authuser=parm.test%40gmail.com#all/thm1#Intent;scheme=https;package=com.google.android.gm;S.browser_fallback_url=https%3A%2F%2Fmail.google.com%2Fmail%2F%3Fauthuser%3Dparm.test%2540gmail.com%23all%2Fthm1;end") fail("Android should hand the thread to the Gmail app by intent: " + JSON.stringify(links.ga));
if (!links.gi.app || links.gi.href !== "googlegmail://") fail("iPhone should open the Gmail app: " + JSON.stringify(links.gi));
if (links.gd.app || links.gd.href !== "https://mail.google.com/mail/?authuser=parm.test%40gmail.com#all/thm1") fail("desktop should keep the web link: " + JSON.stringify(links.gd));
if (!links.oa.app || links.oa.href !== "ms-outlook://emails/message/open?restid=AAMkAG%3D&account=parm.test%40gmail.com") fail("phones should open Outlook's app on the message: " + JSON.stringify(links.oa));
if (links.od.app || links.od.href !== o_web(links)) fail("desktop Outlook should use the message's own web link: " + JSON.stringify(links.od));
function o_web() { return "https://outlook.live.com/mail/0/deeplink/read/AAMkAG%3D"; }
function document_or(s) { return s || ""; }
await p.click(".modal .mail-from");
if (!(await p.evaluate(() => document.querySelector(".modal .mail-details").checkVisibility() && /dana@example\.com/.test(document.querySelector(".modal .mail-details").textContent)))) fail("tapping the sender should show From / To / Date");
await p.click(".modal .mail-quote-btn");
if (!(await p.evaluate(() => document.querySelector(".modal .mail-quote").checkVisibility()))) fail("the dots should unfold the quoted text");
// --- Reply is Gmail's reply: the compose page with To and Subject set, the
// original quoted under the message area, sent in the thread.
await p.click('.modal .mail-foot [data-act="reply"]');
await p.waitForSelector(".modal-compose #mc-text", { state: "visible", timeout: 3000 });
await p.waitForFunction(() => /wrote:/.test(document.querySelector(".modal-compose .mail-quote")?.textContent || ""), null, { timeout: 5000 }).catch(() => fail("the original didn't load under the reply"));
await p.waitForTimeout(250); // the cursor lands in the message a beat after the page opens
const rp = await p.evaluate(() => ({
  title: document.querySelector(".modal-compose .mail-bar-title")?.textContent.trim(),
  to: document.querySelector(".modal-compose #mc-to").value, subject: document.querySelector(".modal-compose #mc-subject").value,
  quoteHidden: !document.querySelector(".modal-compose .mail-quote").checkVisibility(),
  quote: document.querySelector(".modal-compose .mail-quote").textContent,
  focused: document.hasFocus() ? (document.activeElement && document.activeElement.id) : "mc-text", // headless windows may hold no focus at all
  pick: !!document.querySelector(".modal-compose [data-act='pick']"),
}));
console.log("reply page:", JSON.stringify(rp));
if (rp.title !== "Reply" || rp.to !== "Dana Muise <dana@example.com>" || rp.subject !== "Re: the Rogue") fail("the reply page should be the compose page with To and Subject set: " + JSON.stringify(rp));
if (!rp.quoteHidden || !/^On .*Dana Muise <dana@example\.com> wrote:\n> Saturday works for me\./.test(rp.quote) || rp.pick) fail("the original should sit quoted behind the dots, and no customer picker on a reply: " + JSON.stringify(rp));
if (rp.focused !== "mc-text") fail("a reply should start with the cursor in the message: " + rp.focused);
await p.fill(".modal-compose #mc-text", "10 is perfect — see you then.");
await p.click('.modal-compose [data-act="send"]');
await p.waitForFunction(() => !document.querySelector(".modal-compose"), null, { timeout: 8000 }).catch(() => fail("the reply didn't send"));
if (!(await p.evaluate(() => !!document.querySelector(".modal .mail-body")))) fail("after sending, the email should still be open underneath, as in Gmail");
const reply = sent[0];
const raw = reply && Buffer.from(String(reply.raw).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
console.log("reply headers:", raw ? raw.split("\r\n").slice(0, 4).join(" | ") : "(none)");
if (!reply || reply.threadId !== "thm1" || !/^To: Dana Muise <dana@example\.com>/m.test(raw) || !/^In-Reply-To: <m1@mail\.example>/m.test(raw)) fail("the reply isn't in Dana's thread: " + JSON.stringify(reply));
const sentBody = raw && Buffer.from(raw.split("\r\n\r\n")[1] || "", "base64").toString("utf8");
if (!/^10 is perfect — see you then\.\n\nOn .* wrote:\n> Saturday works for me\./.test(sentBody || "")) fail("the reply should carry the quoted original under it, like Gmail: " + JSON.stringify(sentBody));
await p.click('.modal [data-act="back"]');
await p.waitForFunction(() => !document.querySelector(".modal"), null, { timeout: 3000 }).catch(() => fail("back didn't close the email"));
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
const compose = await p.evaluate(() => ({
  title: document.querySelector(".modal .mail-bar-title")?.textContent.trim(),
  sendInBar: !!document.querySelector(".modal .mail-bar [data-act='send']"),
  from: document.querySelector(".modal .mc-from")?.textContent.trim(),
  rows: [...document.querySelectorAll(".modal .mc-label")].map((l) => l.textContent.trim()).join("|"),
  full: document.querySelector(".modal").classList.contains("modal-mail"),
  bodyTall: (document.querySelector(".modal #mc-text")?.getBoundingClientRect().height || 0) > 180,
}));
console.log("compose:", JSON.stringify(compose));
if (compose.from !== "parm.test@gmail.com" || compose.rows !== "From|To|Cc|Subject") fail("compose should read From / To / Cc / Subject like the mail apps: " + JSON.stringify(compose));
if (compose.title !== "Compose" || !compose.sendInBar) fail("compose should have Gmail's top bar: back arrow, 'Compose', send arrow: " + JSON.stringify(compose));
if (!compose.full || !compose.bodyTall) fail("compose should take the full sheet with a tall message area: " + JSON.stringify(compose));
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
