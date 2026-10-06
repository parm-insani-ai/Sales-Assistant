// The manager's email: write to a customer on a rep's book from the Email
// sheet and from the customer's page, the welcome by email for a customer
// who left only an address, and the manager's Outlook filing a customer's
// reply into the rep's book — each one visible to the rep.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
const now = Date.now(); const ago = (min) => new Date(now - min * 60000).toISOString();
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows: [
  { id: "w1", collection: "leads", data: { id: "w1", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", stage: "working", source: "Walk-in", vehicleInterest: "Rogue", createdAt: ago(3000) } },
  { id: "w2", collection: "leads", data: { id: "w2", name: "Email Only", email: "only@example.com", stage: "new", source: "Walk-in", vehicleInterest: "Kicks", createdAt: ago(200) } },
] }) });
const pageAs = async (token, id, email, leads = []) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, id, email, leads }) => {
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id, email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: token === "tm" ? "Sam" : "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: token === "t", supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", msClientId: "client-id" } }));
    if (token === "tm") localStorage.setItem("viniva:msmail:tokens", JSON.stringify({ accessToken: "graph", refreshToken: "g", expiresAt: Date.now() + 3600000, account: { name: "Sam", email: "sam@store.example" } }));
  }, { token, id, email, leads });
  return p;
};

// --- The manager: Home → Email → write to Dana.
const mgr = await pageAs("tm", "00000000-0000-4000-8000-000000000003", "mgr@e.com");
// A fake Outlook: one reply from Dana, one from a stranger.
await mgr.route("https://graph.microsoft.com/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ value: [
  { id: "m1", subject: "Re: the Rogue", from: { emailAddress: { address: "dana@example.com", name: "Dana Muise" } }, receivedDateTime: new Date().toISOString(), bodyPreview: "Thanks Sam — Saturday works." },
  { id: "m2", subject: "Newsletter", from: { emailAddress: { address: "news@example.org", name: "News" } }, receivedDateTime: new Date().toISOString(), bodyPreview: "..." },
] }) }));
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.body.classList.contains("management") && /As of|Reading/.test(document.body.textContent), null, { timeout: 20000 });
const plusTap = async (p, label) => { await p.click("#quick-add"); await p.waitForFunction((l) => [...document.querySelectorAll(".modal .qa-label")].some((n) => n.textContent.trim() === l), label, { timeout: 10000 }); await p.evaluate((l) => [...document.querySelectorAll(".modal .qa-tile")].find((t) => t.querySelector(".qa-label").textContent.trim() === l).click(), label); };
await plusTap(mgr, "Email a customer");
await mgr.waitForSelector("#ml-q");
await mgr.waitForFunction(() => /Connected as/.test(document.querySelector(".modal")?.textContent || ""), null, { timeout: 10000 });
await mgr.fill("#ml-q", "dana");
await mgr.waitForSelector(".modal [data-pick]", { timeout: 10000 });
await mgr.click('.modal [data-pick="0"]');
await mgr.waitForSelector("#ml-subject");
const draft = await mgr.evaluate(() => ({ subject: document.querySelector("#ml-subject").value, body: document.querySelector("#ml-body").value }));
console.log("draft:", JSON.stringify(draft));
if (!/Thanks for coming in to O'Regan's Nissan Halifax/.test(draft.subject) || !/Hi Dana,/.test(draft.body) || !/It's Sam, the sales manager/.test(draft.body) || !/coming in to see Parm/.test(draft.body)) fail("the draft: " + JSON.stringify(draft));
// A figure is refused.
await mgr.fill("#ml-body", draft.body + "\nWe can do $299 a month.");
await mgr.click('.modal [data-act="send"]');
await mgr.waitForTimeout(300);
if ((await (await fetch(APP + "/__emails")).json()).length) fail("an email with a dollar figure went out");
await mgr.fill("#ml-body", draft.body);
await mgr.click('.modal [data-act="send"]');
await mgr.waitForFunction(() => !document.querySelector("#ml-subject"), null, { timeout: 10000 });
let emails = await (await fetch(APP + "/__emails")).json();
console.log("emails:", JSON.stringify(emails));
if (emails.length !== 1 || emails[0].to !== "dana@example.com" || emails[0].rep !== U1) fail("the email didn't send to Dana as Parm's customer: " + JSON.stringify(emails));
// It shows in the store's list, marked as the manager's.
await mgr.waitForFunction(() => /Dana Muise.*you/.test(document.querySelector(".modal")?.textContent.replace(/\s+/g, " ") || ""), null, { timeout: 10000 });

// --- Check mail now: Dana's reply is filed into Parm's book; the stranger's isn't.
await mgr.click('.modal [data-act="pull"]');
await mgr.waitForFunction(() => /Re: the Rogue/.test(document.querySelector(".modal")?.textContent || ""), null, { timeout: 10000 });
let recs = await (await fetch(APP + "/__records")).json();
const inbound = recs.filter((r) => r.user_id === U1 && r.collection === "emails" && r.data.direction === "in");
console.log("inbound filed:", JSON.stringify(inbound.map((r) => r.data)));
if (inbound.length !== 1 || inbound[0].data.leadId !== "w1" || inbound[0].data.msgId !== "m1" || inbound[0].data.via !== "outlook" || inbound[0].data.loggedBy !== "00000000-0000-4000-8000-000000000003") fail("Dana's reply wasn't filed into Parm's book (and only hers): " + JSON.stringify(inbound));
// Twice doesn't file it twice.
await mgr.click('.modal [data-act="pull"]');
await mgr.waitForTimeout(500);
recs = await (await fetch(APP + "/__records")).json();
if (recs.filter((r) => r.user_id === U1 && r.collection === "emails" && r.data.direction === "in").length !== 1) fail("the same reply was filed twice");
// A rep can't file into another rep's book, and can't send as the manager.
const forged = await rpc("t2", "manager_log_email", { member: U1, email: { leadId: "w1", subject: "x" } });
if (!forged.message || !/only a manager/.test(forged.message)) fail("a rep could file an email into another's book: " + JSON.stringify(forged));
const forged2 = await fetch(APP + "/functions/v1/quick-api", { method: "POST", headers: { Authorization: "Bearer t2", "Content-Type": "application/json" }, body: JSON.stringify({ memail: { rep: U1, leadId: "w1", subject: "x", text: "y" } }) });
if (forged2.status !== 403) fail("a rep could send the manager's email: " + forged2.status);
await mgr.evaluate(() => document.querySelector(".modal-close")?.click());

// --- From the customer's page: the Email button, with the thread showing both.
await mgr.evaluate(() => { location.hash = "#/customers"; });
await mgr.waitForFunction(() => document.querySelector('.cu-row[data-lead="w1"]') || document.querySelector('[data-mode="all"]'), null, { timeout: 15000 });
await mgr.evaluate(() => document.querySelector('[data-mode="all"]')?.click());
await mgr.waitForSelector('.cu-row[data-lead="w1"] .row-main', { timeout: 10000 });
await mgr.click('.cu-row[data-lead="w1"] .row-main');
await mgr.waitForSelector('.modal [data-act="email"]', { timeout: 10000 });
const sheet = await mgr.evaluate(() => document.querySelector(".modal").textContent.replace(/\s+/g, " "));
if (!/Emails.*You.*Thanks for coming in/.test(sheet) || !/Them.*Re: the Rogue/.test(sheet)) fail("the customer's sheet doesn't show the manager's email and the reply: " + sheet.slice(0, 400));
await mgr.$eval('.modal [data-act="email"]', (n) => n.click());
await mgr.waitForSelector("#ml-subject", { timeout: 10000 });
await mgr.fill("#ml-subject", "Saturday it is");
await mgr.fill("#ml-body", "Hi Dana, Saturday works for us too — see you then. Sam");
await mgr.click('.modal [data-act="send"]');
await mgr.waitForFunction(() => !document.querySelector("#ml-subject"), null, { timeout: 10000 });
emails = await (await fetch(APP + "/__emails")).json();
if (emails.length !== 2 || emails[1].subject !== "Saturday it is") fail("the second email didn't send: " + JSON.stringify(emails));

// --- The welcome by email: Email Only left no phone.
await mgr.evaluate(async () => { (await import("/js/components.js")).closeAllModals(); location.hash = "#/"; });
await mgr.waitForFunction(() => !document.querySelector(".modal"), null, { timeout: 15000 });
await plusTap(mgr, "Welcome text");
await mgr.waitForFunction(() => document.querySelector('.modal [data-send="w2"]'), null, { timeout: 15000 });
const wrow = await mgr.evaluate(() => [...document.querySelectorAll(".modal .card .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()).find((t) => /Email Only/.test(t)));
console.log("welcome row:", wrow);
if (!/by email/.test(wrow || "")) fail("the welcome sheet doesn't say Email Only gets it by email: " + wrow);
await mgr.click('.modal [data-send="w2"]');
await mgr.waitForFunction(() => /Email Only.*welcomed/.test(document.querySelector(".modal")?.textContent.replace(/\s+/g, " ") || ""), null, { timeout: 10000 });
const welcomes = await (await fetch(APP + "/__welcomes")).json();
console.log("welcomes:", JSON.stringify(welcomes));
if (welcomes.length !== 1 || welcomes[0].channel !== "email" || welcomes[0].to !== "only@example.com") fail("the welcome didn't go by email: " + JSON.stringify(welcomes));
recs = await (await fetch(APP + "/__records")).json();
const wmail = recs.find((r) => r.user_id === U1 && r.collection === "emails" && r.data.via === "manager-welcome");
if (!wmail || wmail.data.leadId !== "w2") fail("the emailed welcome isn't filed in Parm's book");

// --- The rep sees it all on Dana's page, marked as the manager's.
const rep = await pageAs("t", U1, "p@e.com", [{ id: "w1", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", stage: "working", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }]);
await rep.goto(APP + "/#/");
// The pull lands, then settles: read it three times in a row before trusting it.
for (let stable = 0, tries = 0; stable < 3 && tries < 80; tries++) {
  const n = await rep.evaluate(async () => { const s = await import("/js/store.js"); return s.all("emails").filter((e) => e.leadId === "w1").length; });
  stable = n >= 3 ? stable + 1 : 0;
  await rep.waitForTimeout(300);
}
const repSees = await rep.evaluate(async () => { const s = await import("/js/store.js"); return s.all("emails").filter((e) => e.leadId === "w1").map((e) => `${e.direction}:${e.via}:${e.by || ""}:${e.subject}`); });
console.log("rep sees:", JSON.stringify(repSees));
if (!repSees.some((x) => /^out:manager:Sam:Thanks for coming in/.test(x)) || !repSees.some((x) => /^in:outlook:Sam:Re: the Rogue/.test(x))) fail("the rep's book doesn't carry the manager's email and the filed reply: " + JSON.stringify(repSees));
await rep.evaluate(() => { sessionStorage.setItem("leads-open-info", "w1"); location.hash = "#/leads/w1"; });
await rep.waitForFunction(() => /from Sam, sales manager/.test(document.body.textContent) && /from your manager's Outlook/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => fail("the rep's customer page doesn't say the emails are the manager's"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmemail.test.js FAILED" : "\nmemail.test.js passed");
})();
