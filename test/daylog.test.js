// The daily customer prospect log fills itself in: the Auto Alert / service
// list customers the rep reached today come in from the calls with the
// outcome read off the record, the listings they copied come in as posts.
// The rep adds or corrects rows (a pick from the book fills the row and an
// outcome counts as a contact); the sheet syncs; the manager reads every
// rep's for a day — built from the records, so a rep who never opened the
// page is on it too — and Home's rep line carries it.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const U1 = "00000000-0000-4000-8000-000000000001", U4 = "00000000-0000-4000-8000-000000000004";
const b = await launch();
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const errs = [];
await fetch(APP + "/__reset");
const rpc = (tok, fn, args) => fetch(APP + "/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());
const st = await rpc("tm", "create_store", { store_name: "Store", display_name: "Sam" });
await rpc("t", "join_store", { code: st.code, display_name: "Parm" });
await rpc("t4", "join_store", { code: st.code, display_name: "Rae" });
// Rae never opens the page: a service-list customer she called this morning is all there is.
await fetch(APP + "/__seed", { method: "POST", body: JSON.stringify({ user_id: U4, rows: [
  { id: "r1", collection: "leads", data: { id: "r1", name: "Sal Service", phone: "9025554444", stage: "working", serviceAppt: new Date().toISOString().slice(0, 10), importedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" } },
  { id: "rc1", collection: "calls", data: { id: "rc1", leadId: "r1", dir: "out", via: "call", outcome: "reached", logged: true, notes: "Booked a look at the Pathfinder", at: new Date(Date.now() - 40 * 60000).toISOString() } },
] }) });

// --- The rep's sheet.
const rep = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
rep.on("pageerror", (e) => errs.push(e.message));
await rep.addInitScript(() => {
  if (localStorage.getItem("seeded")) return;
  localStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "l1", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", stage: "working", vehicleInterest: "2021 Rogue", alertType: "Flex", importedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "l2", name: "Priya Nair", phone: "9025553333", stage: "working", importedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", stock: "N10001", status: "available", price: 38000, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "v2", year: 2023, make: "Nissan", model: "Kicks", trim: "SR", stock: "U4471", status: "available", price: 24000, mileage: 31000, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: true, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" } }));
});
await rep.goto(APP + "/#/");
await rep.waitForSelector(".dl-home", { timeout: 20000 }).catch(() => fail("Home has no Daily log row"));
const homeBefore = await rep.evaluate(() => document.querySelector(".dl-home")?.textContent.replace(/\s+/g, " ").trim());
if (!/Fills in as you work/.test(homeBefore || "")) fail("Home's row doesn't say the sheet fills itself: " + homeBefore);

// The day's work, before the page is ever opened: Dana reached, a Rogue listing copied for Marketplace.
await rep.evaluate(async () => {
  const s = await import("/js/store.js");
  s.logContact("l1", { via: "call", notes: "Wants numbers on the new Rogue" });
  const m = await import("/js/views/marketplace.js");
  m.openMarketplaceBuilder(s.get("vehicles", "v1"));
});
await rep.waitForSelector('.modal [data-act="copy-all"]', { timeout: 5000 });
await rep.evaluate(() => document.querySelector('.modal [data-act="copy-all"]').click());
await rep.waitForTimeout(300);
await rep.goto(APP + "/?r=1#/");
await rep.waitForFunction(() => /1 of 5 prospects · 1 of 5 posts · 2 read from your day/.test(document.querySelector(".dl-home")?.textContent || ""), null, { timeout: 15000 }).catch(() => fail("Home's row didn't pick up the day's work by itself"));

// From the "+".
await rep.click("#quick-add");
await rep.waitForFunction(() => [...document.querySelectorAll(".modal .qa-label")].some((x) => x.textContent.trim() === "Daily log"), null, { timeout: 10000 }).catch(() => fail("Daily log isn't under the +"));
await rep.evaluate(() => [...document.querySelectorAll(".modal .qa-tile")].find((t) => t.querySelector(".qa-label").textContent.trim() === "Daily log").click());
await rep.waitForSelector(".dl-slot", { timeout: 10000 });
const s1 = '.dl-slot[data-kind="prospect"][data-i="0"]', p1 = '.dl-slot[data-kind="post"][data-i="0"]';
const auto = await rep.evaluate(({ a, c }) => ({
  prospects: document.querySelectorAll('.dl-slot[data-kind="prospect"]').length, posts: document.querySelectorAll('.dl-slot[data-kind="post"]').length, title: document.querySelector(".hero-title")?.textContent.trim(),
  dana: { auto: document.querySelector(a).classList.contains("dl-is-auto"), name: document.querySelector(a + ' [data-f="name"]').value, phone: document.querySelector(a + ' [data-f="phone"]').value, email: document.querySelector(a + ' [data-f="email"]').value, why: document.querySelector(a + " .dl-why")?.textContent.trim(), outcome: document.querySelector(a + ' [data-f="outcome"]').placeholder },
  rogue: { auto: document.querySelector(c).classList.contains("dl-is-auto"), vehicle: document.querySelector(c + ' [data-f="vehicle"]').value, stock: document.querySelector(c + ' [data-f="stock"]').value, store: document.querySelector(c + ' [data-f="store"]').value },
  counts: [...document.querySelectorAll(".dl-count")].map((n) => n.textContent.trim()),
}), { a: s1, c: p1 });
console.log("auto-filled:", JSON.stringify(auto));
if (auto.prospects !== 5 || auto.posts !== 5 || auto.title !== "Daily log") fail("the sheet isn't five and five: " + JSON.stringify(auto));
if (!auto.dana.auto || auto.dana.name !== "Dana Muise" || auto.dana.phone !== "9025551111" || auto.dana.email !== "dana@example.com" || !/^AutoAlert: Flex · reached \d+:\d\d[ap]m$/.test(auto.dana.why || "") || !/^Reached — Wants numbers on the new Rogue/.test(auto.dana.outcome)) fail("Dana didn't come in from the call: " + JSON.stringify(auto.dana));
if (!auto.rogue.auto || auto.rogue.vehicle !== "2026 Nissan Rogue SV" || auto.rogue.stock !== "N10001" || !/O'Regan/.test(auto.rogue.store)) fail("the copied listing didn't come in as a post: " + JSON.stringify(auto.rogue));
if (auto.counts.join("|") !== "· 1 of 5|· 1 of 5") fail("the counts are wrong: " + auto.counts.join(" | "));

// Slot 2: Priya from the book — a pick fills the row, the outcome counts as a contact.
const s2 = '.dl-slot[data-kind="prospect"][data-i="1"]';
await rep.type(`${s2} [data-f="name"]`, "Pri");
await rep.waitForSelector(`${s2} .dl-match`, { timeout: 5000 }).catch(() => fail("typing a name offered no match from the book"));
await rep.evaluate((sel) => document.querySelector(sel + " .dl-match").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })), s2);
await rep.waitForTimeout(100);
await rep.fill(`${s2} [data-f="outcome"]`, "Left a voicemail, texted the offer");
await rep.dispatchEvent(`${s2} [data-f="outcome"]`, "change");
// Slot 3: a walk-in typed by hand.
const s3 = '.dl-slot[data-kind="prospect"][data-i="2"]';
await rep.fill(`${s3} [data-f="name"]`, "Walk-in Bob");
await rep.fill(`${s3} [data-f="phone"]`, "9025552222");
await rep.fill(`${s3} [data-f="outcome"]`, "Coming Saturday");
await rep.dispatchEvent(`${s3} [data-f="outcome"]`, "change");
// Post 2: the Kicks from the lot.
const p2 = '.dl-slot[data-kind="post"][data-i="1"]';
await rep.type(`${p2} [data-f="vehicle"]`, "Kic");
await rep.waitForSelector(`${p2} .dl-match`, { timeout: 5000 }).catch(() => fail("typing a vehicle offered no match from the lot"));
await rep.evaluate((sel) => document.querySelector(sel + " .dl-match").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })), p2);
await rep.waitForTimeout(600);
const typed = await rep.evaluate((sel) => ({ vehicle: document.querySelector(sel + ' [data-f="vehicle"]').value, stock: document.querySelector(sel + ' [data-f="stock"]').value, counts: [...document.querySelectorAll(".dl-count")].map((n) => n.textContent.trim()) }), p2);
if (typed.vehicle !== "2023 Nissan Kicks SR" || typed.stock !== "U4471") fail("the vehicle pick didn't fill the post: " + JSON.stringify(typed));
if (typed.counts.join("|") !== "· 3 of 5|· 2 of 5") fail("the section counts are wrong: " + typed.counts.join(" | "));

// Saved: the record, the contact on Priya (Dana's call already was one), the events.
const saved = await rep.evaluate(async () => {
  const s = await import("/js/store.js");
  const rec = s.all("daylogs")[0];
  return { id: rec && rec.id, prospects: rec && rec.prospects.filter((p) => p.name).map((p) => [p.leadId || "", p.name, p.outcome || "", !!p.auto]), posts: rec && rec.posts.filter((p) => p.vehicle).map((p) => [p.vehicleId || "", p.vehicle, p.stock, !!p.auto]),
    priya: s.get("leads", "l2").lastContacted ? "contacted" : "not contacted", calls: { dana: s.all("calls").filter((c) => c.leadId === "l1").length, priya: s.all("calls").filter((c) => c.leadId === "l2").length }, events: s.all("events").filter((e) => e.kind === "daylog_prospect").map((e) => e.name).sort() };
});
console.log("saved:", JSON.stringify(saved));
if (!saved.id || !/^daylog:\d{4}-\d{2}-\d{2}$/.test(saved.id)) fail("no daily record: " + JSON.stringify(saved));
if (JSON.stringify(saved.prospects) !== JSON.stringify([["l1", "Dana Muise", "", true], ["l2", "Priya Nair", "Left a voicemail, texted the offer", false], ["", "Walk-in Bob", "Coming Saturday", false]])) fail("the rows aren't as written: " + JSON.stringify(saved.prospects));
if (JSON.stringify(saved.posts) !== JSON.stringify([["v1", "2026 Nissan Rogue SV", "N10001", true], ["v2", "2023 Nissan Kicks SR", "U4471", false]])) fail("the posts aren't as written: " + JSON.stringify(saved.posts));
if (saved.priya !== "contacted" || saved.calls.priya !== 1 || saved.calls.dana !== 1) fail("the contacts are wrong: " + JSON.stringify(saved));
if (saved.events.join("|") !== "Priya Nair|Walk-in Bob") fail("the events weren't logged: " + JSON.stringify(saved.events));

// Reopened: still there; Home says how far it is.
await rep.goto(APP + "/#/");
await rep.waitForFunction(() => /3 of 5 prospects · 2 of 5 posts/.test(document.querySelector(".dl-home")?.textContent || ""), null, { timeout: 15000 }).catch(() => fail("Home's row doesn't show the day's counts"));
await rep.evaluate(() => { location.hash = "#/daylog"; });
await rep.waitForSelector(".dl-slot", { timeout: 10000 });
const again = await rep.evaluate(() => document.querySelector('.dl-slot[data-kind="prospect"][data-i="2"] [data-f="outcome"]').value);
if (again !== "Coming Saturday") fail("the sheet didn't come back after a reopen: " + again);

// Synced: the record reaches the cloud.
let inCloud = null;
for (let i = 0; i < 40 && !inCloud; i++) {
  const rows = await fetch(APP + "/rest/v1/records?collection=eq.daylogs&user_id=eq." + U1 + "&select=id,data", { headers: { Authorization: "Bearer t", apikey: "k" } }).then((r) => r.json()).catch(() => []);
  if (Array.isArray(rows) && rows.length) inCloud = rows[0]; else await rep.waitForTimeout(250);
}
if (!inCloud) fail("the sheet never synced to the cloud");
// Parm's calls and the lead have to be there for the manager's read too.
for (let i = 0; i < 40; i++) {
  const rows = await fetch(APP + "/rest/v1/records?collection=eq.calls&user_id=eq." + U1 + "&select=id", { headers: { Authorization: "Bearer t", apikey: "k" } }).then((r) => r.json()).catch(() => []);
  if (Array.isArray(rows) && rows.length >= 2) break; await rep.waitForTimeout(250);
}

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
  cards: [...document.querySelectorAll(".dl-rep")].map((c) => c.textContent.replace(/\s+/g, " ").trim()),
}));
console.log("manager:", JSON.stringify(page));
const parm = page.cards.find((t) => /^Parm/.test(t)) || "", rae = page.cards.find((t) => /^Rae/.test(t)) || "";
if (page.title !== "Daily logs" || !/2 of 2 reps logged/.test(page.summary || "")) fail("the manager's page doesn't say who logged: " + JSON.stringify([page.title, page.summary]));
if (!/4 ?prospects ?4 ?with an outcome ?2 ?posts/.test(page.sum || "")) fail("the day's totals are wrong: " + page.sum);
if (!/Parm ?3 of 5 · 2 posts/.test(parm) || !/Dana Muise 9025551111 dana@example.com · AutoAlert: Flex ?Reached — Wants numbers on the new Rogue/.test(parm) || !/Priya Nair 9025553333 · Owner book ?Left a voicemail, texted the offer/.test(parm) || !/Walk-in Bob 9025552222 ?Coming Saturday/.test(parm) || !/2026 Nissan Rogue SV #N10001/.test(parm) || !/2023 Nissan Kicks SR #U4471/.test(parm)) fail("Parm's sheet isn't on the manager's page: " + parm);
if (!/Rae ?1 of 5 · 0 posts/.test(rae) || !/Sal Service 9025554444 · In service \d{4}-\d{2}-\d{2} ?Reached — Booked a look at the Pathfinder/.test(rae)) fail("Rae's day, never typed, isn't on the manager's page: " + rae);
// Yesterday: nothing.
await mgr.evaluate(() => [...document.querySelectorAll("[data-day]")].find((b) => b.textContent.trim() === "Yesterday").click());
await mgr.waitForFunction(() => document.querySelector(".dl-rep") && /0 of 2 reps/.test(document.querySelector("#view .section-title")?.textContent || ""), null, { timeout: 20000 }).catch(() => fail("yesterday didn't read as empty"));
// Home's rep lines carry the sheets, Rae's included.
await mgr.evaluate(() => { location.hash = "#/"; });
await mgr.waitForFunction(() => document.querySelectorAll(".mg-daylog").length >= 2, null, { timeout: 30000 }).catch(() => fail("Home's rep lines have no daily-log counts"));
const lines = await mgr.evaluate(() => [...document.querySelectorAll(".mg-today-rep")].map((r) => r.querySelector(".row-title")?.textContent.trim().split(" ")[0] + ": " + (r.querySelector(".mg-daylog")?.textContent.trim() || "")));
console.log("home lines:", JSON.stringify(lines));
if (!lines.some((l) => /^Parm: log 3 of 5 · 2 posts$/.test(l)) || !lines.some((l) => /^Rae: log 1 of 5 · 0 posts$/.test(l))) fail("Home's daily-log lines are wrong: " + JSON.stringify(lines));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndaylog.test.js FAILED" : "\ndaylog.test.js passed");
})();
