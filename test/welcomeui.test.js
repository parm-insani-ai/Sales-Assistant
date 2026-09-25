// The manager's welcome text, end to end through the app: switch it on
// with a name, read the preview, see who's due, send one now, and find it
// in the rep's conversation marked as the manager's.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const pageAs = async (token, email, leads = []) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, email, leads }) => {
    const ids = { t: "00000000-0000-4000-8000-000000000001", t2: "00000000-0000-4000-8000-000000000002", tm: "00000000-0000-4000-8000-000000000003" };
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: ids[token], email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, settings: { salesperson: token === "tm" ? "Sam" : "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: token === "t", supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", smsFrom: "+19025550000" } }));
  }, { token, email, leads });
  return p;
};
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
const now = Date.now(); const ago = (min) => new Date(now - min * 60000).toISOString();
const seed = (user_id, rows) => fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id, rows }) });
await seed(U1, [
  { id: "w1", collection: "leads", data: { id: "w1", name: "Dana Muise", phone: "9025551111", stage: "new", source: "Walk-in", vehicleInterest: "Rogue", createdAt: ago(200) } },
  { id: "w2", collection: "leads", data: { id: "w2", name: "Just Logged", phone: "9025552222", stage: "new", source: "Walk-in", vehicleInterest: "Kicks", createdAt: ago(5) } },
  { id: "w3", collection: "leads", data: { id: "w3", name: "Old Owner", phone: "9025553333", stage: "delivered", purchaseDate: "2021-01-01", vehicleInterest: "Sentra", createdAt: ago(60000) } },
  { id: "w4", collection: "leads", data: { id: "w4", name: "Texted In", phone: "9025554444", stage: "new", source: "text", createdAt: ago(300) } },
]);

// --- The sheet, from Home.
const mgr = await pageAs("tm", "mgr@e.com");
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelector('[data-act="welcome"]'), null, { timeout: 20000 });
await mgr.click('[data-act="welcome"]');
await mgr.waitForSelector("#wl-on");
await mgr.waitForFunction(() => document.querySelectorAll(".modal [data-send]").length > 0, null, { timeout: 15000 });
const sheet = await mgr.evaluate(() => ({
  on: document.querySelector("#wl-on").checked,
  preview: document.querySelector(".modal .card.small")?.textContent.trim(),
  rows: [...document.querySelectorAll(".modal .card .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
}));
console.log("sheet:", JSON.stringify(sheet, null, 1));
if (sheet.on) fail("the welcome should be off until the manager switches it on");
if (!/^Hi Dana, it's Sam, the sales manager at O'Regan's Nissan Halifax\. Thanks for coming in to see Parm/.test(sheet.preview || "")) fail("the preview: " + sheet.preview);
if (!sheet.rows.some((r) => /Dana Muise.*would be due/.test(r)) || !sheet.rows.some((r) => /Just Logged.*waits until \d+ min/.test(r))) fail("who's due is wrong: " + JSON.stringify(sheet.rows));
if (sheet.rows.some((r) => /Old Owner|Texted In/.test(r))) fail("an owner or a texted-in customer is on the welcome list");

// Switch it on with a name and a tweak to the words.
await mgr.check("#wl-on");
await mgr.fill("#wl-name", "Sam Manager");
await mgr.fill("#wl-template", "Hi {first}, {manager} here, the sales manager at {store}. Thanks for coming in to see {rep} — anything at all, I'm right here.");
await mgr.click('.modal [data-act="save"]');
await mgr.waitForFunction(() => /due — goes on the next sweep/.test(document.querySelector(".modal")?.textContent || ""), null, { timeout: 10000 });
const saved = await rpc("tm", "store_config_get", { store: st.id });
console.log("saved:", JSON.stringify(saved));
if (!saved.welcome || !saved.welcome.enabled || saved.welcome.manager !== "Sam Manager" || !/right here\.$/.test(saved.welcome.template) || typeof saved.welcome.tzOffsetMinutes !== "number") fail("the config didn't save: " + JSON.stringify(saved));
// A rep can't change it.
const forged = await rpc("t", "store_config_set", { store: st.id, patch: { welcome: { enabled: false } } });
if (!forged.message || !/only a manager/.test(forged.message)) fail("a rep could change the store's welcome: " + JSON.stringify(forged));

// Send now to Dana: the function sends, logs it in Parm's thread, marks her welcomed.
await mgr.click('.modal [data-send="w1"]');
await mgr.waitForFunction(() => /Dana Muise.*welcomed/.test(document.querySelector(".modal")?.textContent.replace(/\s+/g, " ") || ""), null, { timeout: 10000 });
const welcomes = await (await fetch(APP + "/__welcomes")).json();
console.log("welcomes:", JSON.stringify(welcomes));
if (welcomes.length !== 1 || welcomes[0].leadId !== "w1" || !/^Hi Dana, Sam Manager here, the sales manager at O'Regan's Nissan Halifax\. Thanks for coming in to see Parm/.test(welcomes[0].body)) fail("the welcome didn't send with the store's words: " + JSON.stringify(welcomes));
const recs = await (await fetch(APP + "/__records")).json();
const txt = recs.find((r) => r.user_id === U1 && r.collection === "texts" && r.data.via === "manager-welcome");
const lead = recs.find((r) => r.user_id === U1 && r.id === "w1");
if (!txt || txt.data.leadId !== "w1" || !lead.data.managerWelcomeAt) fail("the text isn't in the rep's thread or the customer isn't marked welcomed");
const sentList = await mgr.evaluate(() => [...document.querySelectorAll(".modal .card")].map((c) => c.textContent).join(" "));
if (!/Sam Manager here/.test(sentList)) fail("the sent list doesn't show it");
// A rep can't send one through the function.
const repSend = await fetch(APP + "/functions/v1/quick-api", { method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify({ welcome: { rep: U1, leadId: "w2" } }) });
if (repSend.status !== 403) fail("a rep could send the manager's welcome: " + repSend.status);

// --- In the rep's app, the text shows in Dana's conversation, marked as the manager's.
const rep = await pageAs("t", "p@e.com", [{ id: "w1", name: "Dana Muise", phone: "9025551111", stage: "new", vehicleInterest: "Rogue", createdAt: "x", updatedAt: "x" }]);
await rep.goto(APP + "/#/");
await rep.waitForFunction(async () => { const s = await import("/js/store.js"); return s.all("texts").some((t) => t.via === "manager-welcome"); }, null, { timeout: 20000 });
await rep.evaluate(() => { location.hash = "#/inbox/w1"; });
await rep.waitForSelector(".bubble-out", { timeout: 10000 });
const thread = await rep.evaluate(() => ({ by: document.querySelector(".bubble-by")?.textContent.trim(), body: document.querySelector(".bubble-out .bubble-body")?.textContent.trim() }));
console.log("rep's thread:", JSON.stringify(thread));
if (thread.by !== "Sam Manager · sales manager" || !/Sam Manager here/.test(thread.body || "")) fail("the rep's thread doesn't show the manager's text as the manager's: " + JSON.stringify(thread));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nwelcomeui.test.js FAILED" : "\nwelcomeui.test.js passed");
})();
