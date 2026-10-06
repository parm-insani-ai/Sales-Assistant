// Sign out from the "+" sheet: a tile under Account, asked once, and then
// the front door. Cancel leaves you signed in. The store's "+" has it too.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
await fetch(APP + "/__reset");
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
const pageAs = async (token, email) => {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(({ token, email }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const ids = { t: "00000000-0000-4000-8000-000000000001", tm: "00000000-0000-4000-8000-000000000003" };
    localStorage.setItem("viniva:auth", JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: ids[token], email } }));
    localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [{ id: "x", name: "Someone", phone: "9025550000", stage: "working", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }], settings: { salesperson: "Parm", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
  }, { token, email });
  return p;
};
const openPlus = async (p) => { await p.click("#quick-add"); await p.waitForFunction(() => [...document.querySelectorAll(".modal .qa-label")].some((n) => n.textContent.trim() === "Sign out"), null, { timeout: 10000 }); };
const tapSignOut = (p) => p.evaluate(() => [...document.querySelectorAll(".modal .qa-tile")].find((t) => /Sign out/.test(t.textContent)).click());

// --- A rep: the tile sits under Account, last.
const p = await pageAs("t", "p@e.com");
await p.goto(APP + "/#/");
await p.waitForSelector("#quick-add");
await openPlus(p);
const sections = await p.evaluate(() => [...document.querySelectorAll(".modal .section-title")].map((n) => n.textContent.trim()));
console.log("sections:", sections.join(" · "));
if (sections[sections.length - 1] !== "Account") fail("Sign out isn't in its own Account section at the end: " + sections.join(","));

// Cancel: still signed in, still on the app.
await tapSignOut(p);
await p.waitForSelector('.modal [data-act="cancel"]');
await p.click('.modal [data-act="cancel"]');
await p.waitForTimeout(400);
const still = await p.evaluate(() => ({ auth: !!localStorage.getItem("viniva:auth"), login: !!document.querySelector(".login-form") }));
if (!still.auth || still.login) fail("cancelling signed out anyway: " + JSON.stringify(still));

// Sign out: the session goes and the front door opens.
await openPlus(p);
await tapSignOut(p);
await p.waitForSelector('.modal [data-act="ok"]');
const label = await p.evaluate(() => document.querySelector('.modal [data-act="ok"]').textContent.trim());
await p.click('.modal [data-act="ok"]');
await p.waitForSelector(".login-form", { timeout: 10000 }).catch(() => fail("signing out didn't open the sign-in screen"));
const out = await p.evaluate(() => { try { const a = JSON.parse(localStorage.getItem("viniva:auth") || "null"); return !!(a && a.access_token); } catch { return false; } });
console.log("confirm button:", label, "· session after:", out);
if (label !== "Sign out") fail("the confirm button doesn't say Sign out: " + label);
if (out) fail("the session is still there after signing out");

// --- The store's "+" has it too.
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
await rpc("tm", "create_store", { store_name: "O'Regan's Nissan Halifax", display_name: "Sam" });
const m = await pageAs("tm", "mgr@e.com");
await m.addInitScript(() => { const s = JSON.parse(localStorage.getItem("sales-assistant:v1")); s.leads = []; localStorage.setItem("sales-assistant:v1", JSON.stringify(s)); });
await m.goto(APP + "/#/");
await m.waitForFunction(() => document.body.classList.contains("management"), null, { timeout: 20000 });
await openPlus(m).catch(() => fail("the store's + has no Sign out"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsignout.test.js FAILED" : "\nsignout.test.js passed");
})();
