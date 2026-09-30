// Email with the rest of what a mail app does: an HTML email shows with its
// pictures in place and its attachments underneath; a new email or a reply
// can carry files and photos and copy people in; and the assistant writes
// the email from the conversation when asked, never with a figure.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const hit = (path) => fetch(APP + path).then((r) => r.json());
await hit("/__reset");
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// A 1×1 PNG, and a "PDF".
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4 fake quote sheet");
const html = `<div dir="ltr"><p>Hi Parm,</p><p>Here's the photo of my trade — the Sentra.</p><img src="cid:pic1@mail" alt="trade"><p>Quote sheet attached too.</p></div><div class="gmail_quote">On Mon, Parm wrote:<br><blockquote>Could you send a photo of the Sentra?</blockquote></div>`;
const inbox = {
  m1: { id: "m1", threadId: "thm1", snippet: "Here's the photo of my trade", internalDate: String(Date.now() - 3600000), labelIds: ["INBOX", "UNREAD"],
    payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: "Dana Muise <dana@example.com>" }, { name: "To", value: "parm.test@gmail.com" }, { name: "Subject", value: "My trade" }, { name: "Message-ID", value: "<m1@mail.example>" }],
      parts: [
        { mimeType: "multipart/related", parts: [
          { mimeType: "text/html", body: { data: b64u(Buffer.from(html)) } },
          { mimeType: "image/png", filename: "sentra.png", headers: [{ name: "Content-ID", value: "<pic1@mail>" }, { name: "Content-Disposition", value: "inline; filename=sentra.png" }], body: { attachmentId: "att1", size: PNG.length } },
        ] },
        { mimeType: "application/pdf", filename: "quote.pdf", headers: [{ name: "Content-Disposition", value: "attachment; filename=quote.pdf" }], body: { attachmentId: "att2", size: PDF.length } },
        { mimeType: "image/png", filename: "lot.png", headers: [{ name: "Content-Disposition", value: "attachment; filename=lot.png" }], body: { attachmentId: "att3", size: PNG.length } },
      ] } },
};
const atts = { att1: PNG, att2: PDF, att3: PNG };
const sent = [];
await p.route("https://gmail.googleapis.com/**", (route) => {
  const req = route.request(); const u = req.url();
  if (/\/messages\/send(\?|$)/.test(u)) { sent.push({ url: u, headers: req.headers(), body: req.postData() }); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "s" + sent.length }) }); }
  const a = /\/messages\/m\d\/attachments\/(att\d)/.exec(u);
  if (a) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ size: atts[a[1]].length, data: b64u(atts[a[1]]) }) });
  if (/\/messages\?/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: Object.keys(inbox).map((id) => ({ id })) }) });
  const m = /\/messages\/(m\d)/.exec(u);
  if (m && inbox[m[1]]) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(inbox[m[1]]) });
  return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
});
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("viniva:gmail:tokens", JSON.stringify({ accessToken: "gtok", refreshToken: "grefresh", expiresAt: Date.now() + 3600000, scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send", account: { email: "parm.test@gmail.com" } }));
  localStorage.setItem("viniva:gmail:last", new Date().toISOString());
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", email: "dana@example.com", stage: "working", vehicleInterest: "2026 Rogue SV", profile: { trim: "SV", features: ["moonroof"], budget: 30000 }, notes: "wants to be around $30k, trading a 2019 Sentra", loggedAt: "2026-09-01T00:00:00.000Z", ...x }],
    settings: { salesperson: "Parm Shokar", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", googleClientId: "123-abc.apps.googleusercontent.com" },
  }));
});

await p.goto(APP + "/#/comms");
await p.waitForSelector('[data-tab="email"]', { timeout: 15000 });
await p.click('[data-tab="email"]');
await p.waitForFunction(() => document.querySelectorAll(".mail-list .conv-row").length === 1, null, { timeout: 15000 }).catch(() => fail("the inbox didn't fill"));

// --- An HTML email: rendered in its frame, the inline picture in place,
// the quoted history folded, the attachments underneath (the inline picture
// not counted twice), pictures as thumbnails.
await p.click(".mail-list .conv-row");
await p.waitForFunction(() => { try { const f = document.querySelector(".modal .mail-html"); return !!(f && f.contentDocument && f.contentDocument.body && /Quote sheet attached/.test(f.contentDocument.body.textContent) && parseInt(f.style.height) > 40); } catch { return false; } }, null, { timeout: 10000 }).catch((e) => fail("the HTML email didn't render in its frame: " + e.message));
await p.waitForFunction(() => document.querySelectorAll(".modal .mail-att-thumb img").length === 1, null, { timeout: 8000 }).catch(() => fail("the picture attachment didn't get a thumbnail"));
const view = await p.evaluate(() => {
  const f = document.querySelector(".modal .mail-html"), d = f.contentDocument;
  const img = d.querySelector("img");
  return {
    sandbox: f.getAttribute("sandbox"), imgSrc: img && img.getAttribute("src"), imgW: img && img.naturalWidth,
    quoteHidden: d.body.classList.contains("fold") && getComputedStyle(d.querySelector(".gmail_quote")).display === "none",
    dots: !!document.querySelector(".modal .mail-body .mail-quote-btn"),
    atts: [...document.querySelectorAll(".modal .mail-att")].map((a) => a.querySelector(".mail-att-name").textContent + (a.classList.contains("mail-att-pic") ? "*" : "")),
    head: document.querySelector(".modal .mail-atts-head")?.textContent.trim(),
    height: parseInt(f.style.height),
  };
});
console.log("view:", JSON.stringify(view));
if (!/allow-same-origin/.test(view.sandbox || "") || /allow-scripts/.test(view.sandbox || "")) fail("the frame must allow no scripts: " + view.sandbox);
if (!/^blob:/.test(view.imgSrc || "") || view.imgW !== 1) fail("the cid: picture should be swapped for the fetched bytes and show: " + JSON.stringify([view.imgSrc, view.imgW]));
if (!view.quoteHidden || !view.dots) fail("the quoted history should be folded behind the dots: " + JSON.stringify(view));
if (view.atts.join("|") !== "quote.pdf|lot.png*" || !/2 attachments/.test(view.head || "")) fail("attachments: the PDF and the picture, not the inline one: " + JSON.stringify([view.atts, view.head]));
await p.click(".modal .mail-body .mail-quote-btn");
if (!(await p.evaluate(() => getComputedStyle(document.querySelector(".modal .mail-html").contentDocument.querySelector(".gmail_quote")).display !== "none"))) fail("the dots should unfold the quote");
await p.click(".modal .mail-att-pic");
await p.waitForSelector(".photo-box img", { timeout: 5000 }).catch(() => fail("tapping a picture should open it full size"));
const photo = await p.evaluate(() => ({ src: document.querySelector(".photo-box img")?.getAttribute("src"), save: document.querySelector(".photo-box a[download]")?.getAttribute("download") }));
if (!/^blob:/.test(photo.src || "") || photo.save !== "lot.png") fail("the full-size view should show the picture and offer to save it: " + JSON.stringify(photo));
await p.click('.photo-box [data-act="close"]');

// --- Reply with a file and a copy: multipart/mixed through the upload
// route, in the thread, with the Cc header.
await p.click('.modal .mail-foot [data-act="reply"]');
await p.waitForSelector(".modal-compose #mc-text", { state: "visible", timeout: 5000 });
await p.setInputFiles(".modal-compose #mc-files", [{ name: "appraisal.pdf", mimeType: "application/pdf", buffer: PDF }]);
await p.waitForSelector(".modal-compose .mc-att", { timeout: 3000 }).catch(() => fail("the attached file should show as a chip"));
await p.fill(".modal-compose #mc-cc", "manager@oregans.example");
await p.fill(".modal-compose #mc-text", "Thanks Dana — appraisal attached.");
await p.click('.modal-compose [data-act="send"]');
await p.waitForFunction(() => !document.querySelector(".modal-compose"), null, { timeout: 8000 }).catch(() => fail("the reply with a file didn't send"));
const r = sent[0] || {};
console.log("reply upload:", r.url, (r.body || "").slice(0, 300).replace(/\r\n/g, " | "));
if (!/upload\/gmail\/v1\/users\/me\/messages\/send\?uploadType=multipart/.test(r.url || "") || !/multipart\/related/.test(r.headers["content-type"] || "")) fail("files go through Gmail's upload route: " + r.url);
if (!/\{"threadId":"thm1"\}/.test(r.body || "") || !/Content-Type: message\/rfc822/.test(r.body || "")) fail("the upload should carry the thread and the message: " + (r.body || "").slice(0, 400));
if (!/^Cc: manager@oregans\.example/m.test(r.body || "") || !/^In-Reply-To: <m1@mail\.example>/m.test(r.body || "")) fail("the reply should carry Cc and In-Reply-To: " + (r.body || "").slice(0, 600));
if (!/multipart\/mixed; boundary="part-/.test(r.body || "") || !/Content-Disposition: attachment; filename="appraisal\.pdf"/.test(r.body || "") || !(r.body || "").includes(PDF.toString("base64"))) fail("the file should ride along as a MIME part: " + (r.body || "").slice(-500));
const logged = await p.evaluate(async () => { const s = await import("/js/store.js"); return s.all("emails").filter((e) => e.direction === "out").map((e) => e.body); });
if (!logged.some((t) => /appraisal attached\.\n\(1 file attached\)/.test(t))) fail("the customer's history should note the file: " + JSON.stringify(logged));
await p.click('.modal [data-act="back"]');
await p.waitForFunction(() => !document.querySelector(".modal"), null, { timeout: 3000 });

// --- A new email with a photo and a copy.
await p.click('[data-act="compose"]');
await p.waitForSelector(".modal-compose #mc-to", { timeout: 5000 });
await p.setInputFiles(".modal-compose #mc-files", [{ name: "rogue.png", mimeType: "image/png", buffer: PNG }, { name: "sheet.pdf", mimeType: "application/pdf", buffer: PDF }]);
await p.waitForFunction(() => document.querySelectorAll(".modal-compose .mc-att").length === 2, null, { timeout: 3000 }).catch(() => fail("two chips for two files"));
const chips = await p.evaluate(() => [...document.querySelectorAll(".modal-compose .mc-att")].map((c) => (c.querySelector("img") ? "pic:" : "file:") + c.querySelector(".mc-att-name").textContent));
if (chips.join("|") !== "pic:rogue.png|file:sheet.pdf") fail("a photo chip shows a thumbnail, a file chip an icon: " + chips.join("|"));
await p.click(".modal-compose .mc-att:last-child .mc-att-x");
if ((await p.evaluate(() => document.querySelectorAll(".modal-compose .mc-att").length)) !== 1) fail("× should drop a file");
await p.fill(".modal-compose #mc-to", "dana@example.com");
await p.fill(".modal-compose #mc-cc", "bob@family.example, sis@family.example");
await p.fill(".modal-compose #mc-subject", "The Rogue, in white");
await p.fill(".modal-compose #mc-text", "Here it is.");
await p.click('.modal-compose [data-act="send"]');
await p.waitForFunction(() => !document.querySelector(".modal-compose"), null, { timeout: 8000 }).catch(() => fail("the new email with a photo didn't send"));
const n = sent[1] || {};
if (!/^Cc: bob@family\.example, sis@family\.example/m.test(n.body || "") || !/Content-Type: image\/png; name="rogue\.png"/.test(n.body || "") || !/\r\n\r\n\{\}\r\n/.test(n.body || "")) fail("the new email should carry both copies and the photo, with empty metadata: " + (n.body || "").slice(0, 700));

// --- Written for me: from the conversation and the profile, subject and
// all, never a figure.
await hit("/__draft?t=" + encodeURIComponent("Subject: Your Rogue SV, in white\n\nHi Dana,\n\nThanks for the photo of the Sentra — that helps. The white SV with the moonroof is here, and I'll have it out front for you Saturday.\n\nParm"));
await p.click('[data-act="compose"]');
await p.waitForSelector(".modal-compose #mc-to", { timeout: 5000 });
await p.fill(".modal-compose #mc-to", "dana@example.com");
await p.click('.modal-compose [data-act="draft"]');
await p.waitForFunction(() => /Thanks for the photo/.test(document.querySelector(".modal-compose #mc-text").value), null, { timeout: 8000 }).catch(() => fail("the draft didn't land in the message"));
const drafted = await p.evaluate(() => ({ subject: document.querySelector(".modal-compose #mc-subject").value, body: document.querySelector(".modal-compose #mc-text").value }));
if (drafted.subject !== "Your Rogue SV, in white" || /^Subject:/.test(drafted.body)) fail("the subject line goes in the subject, the rest in the body: " + JSON.stringify(drafted));
const relays = await hit("/__relays");
const sys = (relays[relays.length - 1] || {}).system || "";
console.log("draft prompt:", sys.slice(0, 900));
if (!/WHO IT'S TO\nName: Dana/.test(sys) || !/Trim they like: SV/.test(sys) || !/THE CONVERSATION SO FAR/.test(sys) || !/Dana \(email\): "My trade"/.test(sys) || !/me \(email\): "Re: My trade"/.test(sys)) fail("the draft should be written from the profile and the whole conversation: " + sys.slice(0, 1200));
if (/30,000|30000|\$30k/.test(sys)) fail("no figure from the notes or the budget may reach the drafter: " + sys);
await p.click('.modal-compose [data-act="back"]');

// A figure in the draft is caught, twice, and then refused.
await hit("/__draft?t=" + encodeURIComponent("Hi Dana, the SV is $38,995 — come see it Saturday."));
await p.click(".mail-list .conv-row");
await p.waitForSelector(".modal .mail-foot [data-act='reply']", { timeout: 5000 });
await p.click('.modal .mail-foot [data-act="reply"]');
await p.waitForSelector(".modal-compose #mc-text", { state: "visible", timeout: 5000 });
await p.click('.modal-compose [data-act="draft"]');
await p.waitForFunction(() => /kept quoting a figure/.test(document.querySelector(".modal-compose #mc-out").textContent), null, { timeout: 8000 }).catch(async () => fail("a draft with a price should be refused: " + await p.evaluate(() => document.querySelector(".modal-compose #mc-out").textContent)));
if (await p.evaluate(() => document.querySelector(".modal-compose #mc-text").value !== "")) fail("a refused draft must not land in the message");
const rp = (await hit("/__relays")).slice(-2);
if (rp.length !== 2 || !/THE EMAIL BEING ANSWERED/.test(rp[0].system) || !/Write it again with no dollar amount/.test(JSON.stringify(rp[1].messages))) fail("a reply draft sees the email being answered, and a figure gets one rewrite: " + JSON.stringify(rp.map((r) => r.messages)));
await hit("/__draft?t=" + encodeURIComponent("Happy to go through it properly — takes about ten minutes. Does Thursday at 5 work, or is Saturday morning easier?"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmailfiles.test.js FAILED" : "\nmailfiles.test.js passed");
})();
