// The daily customer prospect log: the rep fills five Auto Alert / service
// list customers (with outcomes) and five Facebook posts on their phone; a
// customer picked from the book fills the row and the outcome counts as a
// contact; the sheet syncs, and the manager reads every rep's for a day.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });

// --- The rep's sheet.
const rep = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
rep.on("pageerror", (e) => errs.push(e.message));
await rep.addInitScript(() => {
  if (localStorage.getItem("seeded")) return;
  localStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "l1", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", stage: "working", vehicleInterest: "2021 Rogue", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
    vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", stock: "N10001", status: "available", price: 38000, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});
await rep.goto(APP + "/#/");
await rep.waitForSelector(".dl-home", { timeout: 20000 }).catch(() => fail("Home has no Daily log row"));
const homeBefore = await rep.evaluate(() => document.querySelector(".dl-home")?.textContent.replace(/\s+/g, " ").trim());
if (!/Not started today/.test(homeBefore || "")) fail("Home's row doesn't say the sheet isn't started: " + homeBefore);
// From the "+".
await rep.click("#quick-add");
await rep.waitForFunction(() => [...document.querySelectorAll(".modal .qa-label")].some((x) => x.textContent.trim() === "Daily log"), null, { timeout: 10000 }).catch(() => fail("Daily log isn't under the +"));
await rep.evaluate(() => [...document.querySelectorAll(".modal .qa-tile")].find((t) => t.querySelector(".qa-label").textContent.trim() === "Daily log").click());
await rep.waitForSelector(".dl-slot", { timeout: 10000 });
const slots = await rep.evaluate(() => ({ prospects: document.querySelectorAll('.dl-slot[data-kind="prospect"]').length, posts: document.querySelectorAll('.dl-slot[data-kind="post"]').length, title: document.querySelector(".hero-title")?.textContent.trim() }));
if (slots.prospects !== 5 || slots.posts !== 5 || slots.title !== "Daily log") fail("the sheet isn't five and five: " + JSON.stringify(slots));

// Slot 1: Dana from the book — phone and email fill in, the outcome counts as a contact.
const s1 = '.dl-slot[data-kind="prospect"][data-i="0"]';
await rep.type(`${s1} [data-f="name"]`, "Dan");
await rep.waitForSelector(`${s1} .dl-match`, { timeout: 5000 }).catch(() => fail("typing a name offered no match from the book"));
await rep.evaluate((sel) => document.querySelector(sel + " .dl-match").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })), s1);
await rep.waitForTimeout(100);
const picked = await rep.evaluate((sel) => ({ name: document.querySelector(sel + ' [data-f="name"]').value, phone: document.querySelector(sel + ' [data-f="phone"]').value, email: document.querySelector(sel + ' [data-f="email"]').value }), s1);
if (picked.name !== "Dana Muise" || picked.phone !== "9025551111" || picked.email !== "dana@example.com") fail("the pick didn't fill the row: " + JSON.stringify(picked));
await rep.fill(`${s1} [data-f="outcome"]`, "Left a voicemail, texted the offer");
await rep.dispatchEvent(`${s1} [data-f="outcome"]`, "change");
// Slot 2: a walk-in typed by hand.
const s2 = '.dl-slot[data-kind="prospect"][data-i="1"]';
await rep.fill(`${s2} [data-f="name"]`, "Walk-in Bob");
await rep.fill(`${s2} [data-f="phone"]`, "9025552222");
await rep.fill(`${s2} [data-f="outcome"]`, "Coming Saturday");
await rep.dispatchEvent(`${s2} [data-f="outcome"]`, "change");
// Post 1: the Rogue from the lot — stock fills, store defaults to the dealership.
const p1 = '.dl-slot[data-kind="post"][data-i="0"]';
await rep.type(`${p1} [data-f="vehicle"]`, "Rog");
await rep.waitForSelector(`${p1} .dl-match`, { timeout: 5000 }).catch(() => fail("typing a vehicle offered no match from the lot"));
await rep.evaluate((sel) => document.querySelector(sel + " .dl-match").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })), p1);
await rep.waitForTimeout(600);
const post = await rep.evaluate((sel) => ({ vehicle: document.querySelector(sel + ' [data-f="vehicle"]').value, stock: document.querySelector(sel + ' [data-f="stock"]').value, store: document.querySelector(sel + ' [data-f="store"]').value, counts: [...document.querySelectorAll(".dl-count")].map((n) => n.textContent.trim()) }), p1);
console.log("sheet:", JSON.stringify({ picked, post }));
if (post.vehicle !== "2026 Nissan Rogue SV" || post.stock !== "N10001" || !/O'Regan/.test(post.store)) fail("the vehicle pick didn't fill the post: " + JSON.stringify(post));
if (post.counts.join("|") !== "· 2 of 5|· 1 of 5") fail("the section counts are wrong: " + post.counts.join(" | "));

// Saved: the record, the contact on Dana, the event.
const saved = await rep.evaluate(async () => {
  const s = await import("/js/store.js");
  const rec = s.all("daylogs")[0];
  return { id: rec && rec.id, prospects: rec && rec.prospects.filter((p) => p.name).map((p) => [p.leadId, p.name, p.outcome]), posts: rec && rec.posts.filter((p) => p.vehicle).map((p) => [p.vehicleId, p.vehicle, p.stock]),
    dana: s.get("leads", "l1").lastContacted ? "contacted" : "not contacted", calls: s.all("calls").filter((c) => c.leadId === "l1").length, events: s.all("events").filter((e) => e.kind === "daylog_prospect").map((e) => e.name) };
});
console.log("saved:", JSON.stringify(saved));
if (!saved.id || !/^daylog:\d{4}-\d{2}-\d{2}$/.test(saved.id)) fail("no daily record: " + JSON.stringify(saved));
if (saved.dana !== "contacted" || saved.calls !== 1) fail("the outcome on a customer from the book wasn't logged as a contact: " + JSON.stringify(saved));
if (saved.events.slice().sort().join("|") !== "Dana Muise|Walk-in Bob") fail("the events weren't logged: " + JSON.stringify(saved.events));

// Reopened: still there; Home says how far it is.
await rep.goto(APP + "/#/");
await rep.waitForFunction(() => /2 of 5 prospects/.test(document.querySelector(".dl-home")?.textContent || ""), null, { timeout: 15000 }).catch(() => fail("Home's row doesn't show the day's counts"));
await rep.evaluate(() => { location.hash = "#/daylog"; });
await rep.waitForSelector(".dl-slot", { timeout: 10000 });
const again = await rep.evaluate(() => document.querySelector('.dl-slot[data-kind="prospect"][data-i="1"] [data-f="outcome"]').value);
if (again !== "Coming Saturday") fail("the sheet didn't come back after a reopen: " + again);

// Synced: the record reaches the cloud.
let inCloud = null;
for (let i = 0; i < 40 && !inCloud; i++) {
  const rows = await fetch(APP + "/rest/v1/records?collection=eq.daylogs&user_id=eq." + U1 + "&select=id,data", { headers: { Authorization: "Bearer t", apikey: "k" } }).then((r) => r.json()).catch(() => []);
  if (Array.isArray(rows) && rows.length) inCloud = rows[0]; else await rep.waitForTimeout(250);
}
if (!inCloud) fail("the sheet never synced to the cloud");

// --- The manager reads it.
const mgr = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
mgr.on("pageerror", (e) => errs.push(e.message));
await mgr.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "tm", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000003", email: "mgr@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Sam", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});
await mgr.goto(APP + "/#/");
await mgr.waitForFunction(() => document.body.classList.contains("management") && document.querySelector("#quick-add"), null, { timeout: 20000 });
await mgr.click("#quick-add");
await mgr.waitForFunction(() => [...document.querySelectorAll(".modal .qa-label")].some((x) => x.textContent.trim() === "Daily logs"), null, { timeout: 10000 }).catch(() => fail("Daily logs isn't under the manager's +"));
await mgr.evaluate(() => [...document.querySelectorAll(".modal .qa-tile")].find((t) => t.querySelector(".qa-label").textContent.trim() === "Daily logs").click());
await mgr.waitForFunction(() => location.hash === "#/daylogs" && document.querySelector(".dl-rep") && !/reading…/.test(document.querySelector("#view .section-title")?.textContent || ""), null, { timeout: 30000 });
const page = await mgr.evaluate(() => ({
  title: document.querySelector(".hero-title")?.textContent.trim(),
  summary: document.querySelector("#view .section-title")?.textContent.replace(/\s+/g, " ").trim(),
  sum: document.querySelector(".dl-sum")?.textContent.replace(/\s+/g, " ").trim(),
  parm: [...document.querySelectorAll(".dl-rep")].map((c) => c.textContent.replace(/\s+/g, " ").trim()).find((t) => /^Parm/.test(t)),
  reps: document.querySelectorAll(".dl-rep").length,
}));
console.log("manager:", JSON.stringify(page));
if (page.title !== "Daily logs" || !/1 of 1 rep logged/.test(page.summary || "")) fail("the manager's page doesn't say who logged: " + JSON.stringify([page.title, page.summary]));
if (!/2 ?prospects ?2 ?with an outcome ?1 ?posts/.test(page.sum || "")) fail("the day's totals are wrong: " + page.sum);
if (!page.parm || !/Parm ?2 of 5 · 1 post/.test(page.parm) || !/Dana Muise 9025551111 dana@example.com ?Left a voicemail, texted the offer/.test(page.parm) || !/Walk-in Bob 9025552222 ?Coming Saturday/.test(page.parm) || !/2026 Nissan Rogue SV #N10001 ?O'Regan's Nissan Halifax/.test(page.parm)) fail("Parm's sheet isn't on the manager's page: " + page.parm);
// Yesterday: nothing.
await mgr.evaluate(() => [...document.querySelectorAll("[data-day]")].find((b) => b.textContent.trim() === "Yesterday").click());
await mgr.waitForFunction(() => document.querySelector(".dl-rep") && /0 of 1 rep/.test(document.querySelector("#view .section-title")?.textContent || ""), null, { timeout: 20000 }).catch(() => fail("yesterday didn't read as empty"));
// Home's rep line carries the sheet.
await mgr.evaluate(() => { location.hash = "#/"; });
await mgr.waitForFunction(() => document.querySelector(".mg-daylog"), null, { timeout: 30000 }).catch(() => fail("Home's rep line has no daily-log count"));
const line = await mgr.evaluate(() => document.querySelector(".mg-daylog")?.textContent.trim());
if (!/^log 2 of 5 · 1 post$/.test(line || "")) fail("Home's daily-log line is wrong: " + line);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndaylog.test.js FAILED" : "\ndaylog.test.js passed");
})();
