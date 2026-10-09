// A row loaded from a file is not a lead that walked in today. Imports stamp
// importedAt and give an owner the purchase date as their created date; rows
// already on file get the same once, and the cloud copy follows. The board,
// the insight and the log then leave imported rows out of lead-age reads.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const now = new Date();
const iso = (d) => d.toISOString();
const ago = (min) => new Date(now.getTime() - min * 60000);

// --- The rep's phone: rows already on file get stamped once, and queued.
const rep = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
rep.on("pageerror", (e) => errs.push(e.message));
await rep.addInitScript(({ nowISO }) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: nowISO, updatedAt: nowISO };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      // An owner from the book: bought in 2021, loaded today.
      { id: "own", name: "Olive Owner", phone: "9025550001", stage: "delivered", source: "Import", purchaseDate: "2021-06-01", currentPayment: 540, vehicleInterest: "2021 Rogue", ...x },
      // A prospect from an AutoAlert export: no purchase date.
      { id: "pro", name: "Pat Prospect", phone: "9025550002", stage: "new", source: "AutoAlert", alertType: "Lease Maturity", ...x },
      // Someone who walked in today.
      { id: "walk", name: "Wes Walkin", phone: "9025550003", stage: "new", source: "Walk-in", ...x },
      // A prospect list whose source column named the lead source: 25 rows
      // in one second is a file, whatever it says. One "Internet" lead typed
      // in at another moment is not.
      ...Array.from({ length: 25 }, (_, i) => ({ id: "list" + i, name: "Lead " + i, phone: "902555" + String(2000 + i), stage: "new", source: "Internet", createdAt: "2026-09-15T14:00:00.000Z", updatedAt: "2026-09-15T14:00:00.000Z" })),
      { id: "typed", name: "Terry Typed", phone: "9025550006", stage: "new", source: "Internet", createdAt: "2026-09-15T14:00:01.000Z", updatedAt: "2026-09-15T14:00:01.000Z" },
      // Sold customers made from the sales list arrive in a batch too; they're sales, not a file.
      ...Array.from({ length: 25 }, (_, i) => ({ id: "sold" + i, name: "Buyer " + i, stage: "sold", source: "Sale", createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-20T09:00:00.000Z" })),
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" },
  }));
}, { nowISO: iso(now) });
await rep.goto(APP + "/#/");
await rep.waitForSelector("#view", { timeout: 20000 });
const stamped = await rep.evaluate(async () => {
  const s = await import("/js/store.js"); const lb = await import("/js/logbook.js");
  const g = (id) => s.get("leads", id);
  return { list: s.all("leads").filter((l) => /^list/.test(l.id) && l.importedAt).length, typed: g("typed").importedAt || null, sold: s.all("leads").filter((l) => /^sold/.test(l.id) && l.importedAt).length, own: { importedAt: g("own").importedAt, createdAt: g("own").createdAt, inLog: lb.inLog(g("own")) }, pro: { importedAt: g("pro").importedAt, createdAt: g("pro").createdAt, inLog: lb.inLog(g("pro")) }, walk: { importedAt: g("walk").importedAt || null, inLog: lb.inLog(g("walk")) }, outbox: s.getOutbox().map((e) => e.id).sort(), stamped: !!s.getSettings().importStamped };
});
console.log("stamped:", JSON.stringify(stamped));
const bought = new Date("2021-06-01T12:00:00").toISOString();
if (stamped.own.importedAt !== iso(now) || stamped.own.createdAt !== bought) fail("the owner isn't on file since the purchase date: " + JSON.stringify(stamped.own));
if (stamped.pro.importedAt !== iso(now) || stamped.pro.createdAt !== iso(now) || stamped.pro.inLog) fail("the prospect from the export isn't stamped, or counts as logged: " + JSON.stringify(stamped.pro));
if (stamped.walk.importedAt || !stamped.walk.inLog) fail("the walk-in was treated as an import: " + JSON.stringify(stamped.walk));
if (stamped.list !== 25 || stamped.typed || stamped.sold !== 0) fail("the batch rule is wrong — list " + stamped.list + ", typed " + stamped.typed + ", sold " + stamped.sold);
if (stamped.outbox.length !== 27 || !stamped.outbox.includes("own") || !stamped.outbox.includes("pro") || !stamped.outbox.includes("list0") || !stamped.stamped) fail("the stamped rows aren't queued for the cloud: " + JSON.stringify(stamped.outbox));

// --- A fresh import builds rows the same way.
const built = await rep.evaluate(() => import("/js/views/import.js").then((m) => {
  const mapping = { name: "Name", phone: "Phone", purchaseDate: "Purchase Date", currentPayment: "Payment" };
  const a = m.buildRecord("leads", { Name: "Olga Owner", Phone: "902 555 0004", "Purchase Date": "06/15/2022", Payment: "610" }, mapping);
  const c = m.buildRecord("leads", { Name: "Chris Cold", Phone: "902 555 0005", "Purchase Date": "", Payment: "" }, mapping);
  return { a: { importedAt: !!a.importedAt, createdAt: a.createdAt, stage: a.stage }, c: { importedAt: !!c.importedAt, createdAt: c.createdAt || null, stage: c.stage } };
}));
console.log("built:", JSON.stringify(built));
if (!built.a.importedAt || built.a.createdAt !== new Date("2022-06-15T12:00:00").toISOString() || built.a.stage !== "delivered") fail("an imported owner isn't dated from the purchase: " + JSON.stringify(built.a));
if (!built.c.importedAt || built.c.createdAt || built.c.stage !== "new") fail("an imported prospect carries a made-up created date: " + JSON.stringify(built.c));

// --- The manager's board: imported rows aren't untouched or fresh leads.
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
const rows = [];
for (let i = 0; i < 30; i++) rows.push({ id: "imp" + i, collection: "leads", data: { id: "imp" + i, name: "Owner " + i, phone: "902555" + String(1000 + i), stage: "new", source: "Import", importedAt: iso(ago(2 * 1440)), createdAt: iso(ago(2 * 1440)), updatedAt: iso(ago(2 * 1440)) } });
rows.push({ id: "imp-fresh", collection: "leads", data: { id: "imp-fresh", name: "Fresh Import", phone: "9025559000", stage: "new", source: "Import", importedAt: iso(ago(120)), createdAt: iso(ago(120)), updatedAt: iso(ago(120)) } });
rows.push({ id: "real-old", collection: "leads", data: { id: "real-old", name: "Real Untouched", phone: "9025559001", stage: "new", source: "Web", createdAt: iso(ago(2 * 1440)), updatedAt: iso(ago(2 * 1440)) } });
rows.push({ id: "real-fresh", collection: "leads", data: { id: "real-fresh", name: "Real Fresh", phone: "9025559002", stage: "new", source: "Web", createdAt: iso(ago(120)), updatedAt: iso(ago(120)) } });
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U1, rows }) });
const mgr = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await mgr.goto(APP + "/#/reps");
await mgr.waitForFunction(() => document.querySelector(".team-cells"), null, { timeout: 30000 });
const cells = await mgr.evaluate(() => [...document.querySelectorAll(".team-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));
console.log("reps:", JSON.stringify(cells));
if (!cells.some((c) => /^Parm .*1 untouched0 overdue/.test(c))) fail("the board counts the imported book as untouched leads: " + JSON.stringify(cells));
await mgr.goto(APP + "/#/floor");
await mgr.waitForFunction(() => document.querySelector(".mg-due") && !/reading…|Reading every rep/.test(document.querySelector("#view").textContent), null, { timeout: 30000 });
const fresh = await mgr.evaluate(() => { const t = [...document.querySelectorAll("#view .section-title")].find((n) => /^Fresh leads waiting/.test(n.textContent)); const card = t && t.nextElementSibling; return card ? card.textContent.replace(/\s+/g, " ").trim() : ""; });
console.log("fresh:", fresh);
if (!/Real Fresh/.test(fresh) || /Fresh Import|Owner \d/.test(fresh)) fail("the fresh-leads card shows imported rows: " + fresh);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nimportdate.test.js FAILED" : "\nimportdate.test.js passed");
})();
