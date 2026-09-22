// Settings → Import the lot now: the function reads the store's site, the
// vehicles come down on the next sync, Inventory lists them, and the stock
// moves can see them.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
await fetch(APP + "/__reset");
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const FAR = Math.floor(Date.now() / 1000) + 86400;
await p.addInitScript((far) => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: far, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "lead_ann", name: "Ann Example", phone: "9025550111", stage: "new", vehicleInterest: "Rogue", createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:00:00.000Z" }],
    settings: { salesperson: "Parm", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
}, FAR);
await p.goto(APP + "/#/settings");
await p.waitForTimeout(1500);

// --- The card says what it does and where the lot comes from.
const card = await p.evaluate(() => {
  const btn = document.querySelector("#inv-import");
  return { btn: !!btn, status: document.querySelector("#inv-status")?.textContent.trim(), url: document.querySelector("#d-store-url")?.value };
});
console.log("the card:", JSON.stringify(card));
if (!card.btn) fail("no Import the lot now button");
if (!/Not imported yet/.test(card.status || "")) fail(`the status line says ${JSON.stringify(card.status)}`);
if (!/vehicle-inventory-type-ids\.0=-1/.test(card.url || "")) fail(`the store URL isn't the whole lot: ${card.url}`);

// --- Import.
await p.click("#inv-import");
await p.waitForTimeout(2500);
const after = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  return { status: document.querySelector("#inv-status")?.textContent.trim(), copy: !document.querySelector("#inv-copy").hidden,
    saved: store.getSettings().lastInventoryImport, vehicles: store.all("vehicles").map((v) => [v.year, v.make, v.model, v.trim, v.price, v.status, v.source]) };
});
console.log("after the import:", JSON.stringify(after));
if (!/3 on the site · 3 new/.test(after.status || "")) fail(`the status line doesn't report the import: ${after.status}`);
if (!after.copy) fail("no way to copy the report");
if (!after.saved || after.saved.found !== 3) fail("the import wasn't remembered in settings");
if (after.vehicles.length !== 3) fail(`${after.vehicles.length} vehicles on the phone after the sync — wanted 3`);
if (!after.vehicles.every((v) => v[5] === "available" && v[6] === "web")) fail("the vehicles didn't come down as available, web-sourced");

// --- Inventory lists them; the stock move sees them.
await p.evaluate(() => { location.hash = "#/inventory"; });
await p.waitForTimeout(500);
const listed = await p.evaluate(() => [...document.querySelectorAll(".row-title")].map((n) => n.textContent.trim()));
console.log("Inventory shows:", JSON.stringify(listed));
if (!listed.some((x) => /2026 Nissan Rogue SV/.test(x)) || !listed.some((x) => /2025 Nissan Kicks SR/.test(x))) fail("the imported vehicles aren't on the Inventory page");
const move = await p.evaluate(async () => {
  const m = await import("/js/moves.js");
  return m.nextMoves("lead_ann", "loves the Rogue SV").moves.map((x) => x.kind + ": " + x.title);
});
console.log("stock move now:", JSON.stringify(move));
if (!move.some((x) => /^stock: 1 Rogue SV in stock/.test(x))) fail("the stock move doesn't see the imported lot");

// --- Reopened: the last import is still shown.
await p.evaluate(() => { location.hash = "#/settings"; });
await p.waitForTimeout(500);
const again = await p.evaluate(() => document.querySelector("#inv-status")?.textContent.trim());
console.log("Settings again:", JSON.stringify(again));
if (!/Last import .*3 on the site/.test(again || "")) fail("the last import isn't remembered on the card");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ninventory.test.js FAILED" : "\ninventory.test.js passed");
})();
