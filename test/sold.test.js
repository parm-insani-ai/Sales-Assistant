// Sold: the Sold tile on Home opens the Sold Tracker; a deal there opens to
// its paperwork; a photo added is saved with the sale, shown as a thumbnail
// at once, backed up to the bucket in the background, and still there after
// a reload (from the device). (The separate Sold list folded in here.)
const fs = require("fs");
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset"); // the stub's bucket, emptied of other tests' files

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const last = new Date(d.getFullYear(), d.getMonth() - 1, 15);
const lym = `${last.getFullYear()}-${pad(last.getMonth() + 1)}`;
await p.addInitScript(([ym, lym]) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Dana Muise", phone: "9025551111", stage: "sold", ...x }],
    sales: [
      { id: "s1", customerName: "Dana Muise", vehicle: "2026 Nissan Kicks SR", saleDate: ym + "-03", leadId: "a", frontGross: 1200, backGross: 600, commission: 500, ...x },
      { id: "s2", customerName: "Ken Boudreau", vehicle: "2025 Rogue SV", saleDate: ym + "-01", frontGross: 900, backGross: 400, commission: 380, ...x },
      { id: "s3", customerName: "Moe Hassan", vehicle: "2024 Frontier", saleDate: lym + "-20", frontGross: 1500, backGross: 0, commission: 450, ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, goalUnits: 10, goalNew: 6, goalUsed: 4, closingNew: 20, closingUsed: 20, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" },
  }));
}, [ym, lym]);

// --- Home: the Sold tile is the way in — to the Sold Tracker.
await p.goto(APP + "/#/");
await p.waitForSelector('.target-card [data-act="sold"]', { timeout: 15000 }).catch(() => fail("the Sold tile isn't tappable"));
await p.click('.target-card [data-act="sold"]');
await p.waitForSelector('#sl-list .card[data-id="s1"]', { timeout: 10000 }).catch(() => fail("tapping Sold didn't open the Sold Tracker"));
let list = await p.evaluate(() => ({ hash: location.hash, names: [...document.querySelectorAll("#sl-list .card .row-title")].map((s) => s.textContent.replace(/\s+/g, " ").trim()), pw: document.querySelector('#sl-list .card[data-id="s1"] [data-act="paperwork"]')?.textContent.trim() }));
console.log("tracker:", JSON.stringify(list));
if (list.hash !== "#/soldlog" || list.names.length !== 2 || !list.names.some((n) => /Dana Muise/.test(n)) || !list.names.some((n) => /Ken Boudreau/.test(n)) || list.pw !== "Paperwork") fail("the Tracker lists the month's deals, each with Paperwork: " + JSON.stringify(list));
await p.click('[data-nav="year"]'); await p.waitForTimeout(300);
list = await p.evaluate(() => [...document.querySelectorAll("#sl-list .card .row-title")].map((s) => s.textContent.replace(/\s+/g, " ").trim()));
if (list.length !== 3 || !list.some((n) => /Moe Hassan/.test(n))) fail("Year shows the three: " + JSON.stringify(list));
await p.click('[data-nav="year"]'); await p.waitForTimeout(300);

// --- A deal opens to its paperwork; a photo added is saved with the sale.
await p.click('#sl-list .card[data-id="s1"] [data-act="paperwork"]');
await p.waitForSelector('.pw-panel[data-sale="s1"] [data-add]', { state: "attached", timeout: 5000 }).catch(() => fail("Paperwork should open the sale's folder with the add buttons"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVQIW2P8z8DwnwEIAAr+Av+1yJjkAAAAAElFTkSuQmCC", "base64");
const tmp = "/tmp/claude-sold-test.png"; fs.writeFileSync(tmp, png);
const inputs = await p.$$('.pw-panel[data-sale="s1"] [data-add]');
await inputs[1].setInputFiles({ name: "bill-of-sale.png", mimeType: "image/png", buffer: png });
await p.waitForSelector('.pw-panel[data-sale="s1"] .sd-thumb img', { timeout: 8000 }).catch(() => fail("the photo didn't show as a thumbnail"));
await p.waitForFunction(() => (document.querySelector('.pw-panel[data-sale="s1"] .sd-count')?.textContent || "").trim().endsWith("1"), null, { timeout: 5000 }).catch(() => fail("the count should say 1"));
let objects = [];
for (let i = 0; i < 40 && !objects.length; i++) { await p.waitForTimeout(200); objects = await fetch(APP + "/__objects").then((r) => r.json()); }
const saved = await p.evaluate(async () => { const s = await import("/js/store.js"); const docs = s.all("docs"); return { n: docs.length, saleId: docs[0] && docs[0].saleId, leadId: docs[0] && docs[0].leadId, mime: docs[0] && docs[0].mime, synced: !!(docs[0] && docs[0].id), uploaded: !!(docs[0] && docs[0].uploaded), path: docs[0] && docs[0].path }; });
console.log("saved:", JSON.stringify(saved), "bucket:", JSON.stringify(objects));
if (saved.n !== 1 || saved.saleId !== "s1" || saved.leadId !== "a" || !/^image\//.test(saved.mime || "") || !saved.synced) fail("the photo should be a docs row on the sale and the customer: " + JSON.stringify(saved));
if (!objects.length || !/^docs\/00000000-0000-4000-8000-000000000001\/s1\//.test(objects[0].key) || !saved.uploaded || "docs/" + saved.path !== objects[0].key) fail("the photo should be backed up under the account's own folder: " + JSON.stringify({ saved, objects }));
const thumbSrc = await p.evaluate(() => document.querySelector('.pw-panel[data-sale="s1"] .sd-thumb img')?.src || "");
if (!/^blob:/.test(thumbSrc)) fail("the thumbnail should come from the device: " + thumbSrc);

// --- The viewer opens it; the file is still there after a reload; the Tracker's button counts it.
await p.click('.pw-panel[data-sale="s1"] .sd-thumb');
await p.waitForSelector(".modal .sd-viewer-body img", { timeout: 5000 }).catch(() => fail("tapping the thumbnail should open the photo"));
await p.evaluate(() => { const m = [...document.querySelectorAll(".modal")].pop(); m.querySelector(".modal-close").click(); }); await p.waitForTimeout(200);
await p.reload();
await p.waitForSelector('#sl-list .card[data-id="s1"] [data-act="paperwork"]', { timeout: 10000 });
const btn = await p.evaluate(() => document.querySelector('#sl-list .card[data-id="s1"] [data-act="paperwork"]')?.textContent.replace(/\s+/g, " ").trim());
if (!/Paperwork · 1/.test(btn || "")) fail("the deal's button counts the file: " + btn);
await p.click('#sl-list .card[data-id="s1"] [data-act="paperwork"]');
await p.waitForSelector('.pw-panel[data-sale="s1"] .sd-thumb img[src^="blob:"]', { timeout: 8000 }).catch(() => fail("after a reload the photo should still be there, from the device"));

// --- Delete, with undo.
await p.click('.pw-panel[data-sale="s1"] .sd-thumb');
await p.waitForSelector(".modal [data-del]", { timeout: 5000 });
await p.click(".modal [data-del]");
await p.waitForTimeout(400);
const gone = await p.evaluate(async () => { const s = await import("/js/store.js"); return { docs: s.all("docs").length, thumbs: document.querySelectorAll('.pw-panel[data-sale="s1"] .sd-thumb').length, undo: !!document.querySelector("#toast-root button") }; });
if (gone.docs !== 0 || gone.thumbs !== 0 || !gone.undo) fail("delete should remove the file and offer undo: " + JSON.stringify(gone));
await p.click("#toast-root button");
await p.waitForSelector('.pw-panel[data-sale="s1"] .sd-thumb', { timeout: 5000 }).catch(() => fail("undo should bring the file back"));
await p.evaluate(() => { const m = [...document.querySelectorAll(".modal")].pop(); if (m) m.querySelector(".modal-close").click(); }); await p.waitForTimeout(200);

// --- Spoken with opens the month's Logged on Log.
await p.goto(APP + "/#/");
await p.waitForSelector('.target-card [data-act="spoken"]', { timeout: 15000 }).catch(() => fail("the Spoken with tile isn't tappable"));
await p.click('.target-card [data-act="spoken"]');
await p.waitForFunction(() => location.hash === "#/log" && document.querySelector(".log-tabs .btn-primary")?.dataset.tab === "logged", null, { timeout: 10000 }).catch(() => fail("tapping Spoken with should open Log on the Logged chip"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsold.test.js FAILED" : "\nsold.test.js passed");
})();
