// Sold: the Sold tile on Home opens everyone sold, by month, newest first;
// a sale opens to its paperwork; a photo added there is saved with the
// sale, shown as a thumbnail at once, backed up to the bucket in the
// background, and still there after a reload (from the device).
const fs = require("fs");
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

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

// --- Home: the Sold tile is the way in.
await p.goto(APP + "/#/");
await p.waitForSelector('.target-card [data-act="sold"]', { timeout: 15000 }).catch(() => fail("the Sold tile isn't tappable"));
await p.click('.target-card [data-act="sold"]');
await p.waitForSelector(".sd-page .sd-sale", { timeout: 10000 }).catch(() => fail("tapping Sold didn't open the sold list"));
const list = await p.evaluate(() => ({
  hash: location.hash,
  months: [...document.querySelectorAll(".sd-page .section-title")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  names: [...document.querySelectorAll(".sd-page .sd-sale .row-title")].map((s) => s.textContent.trim()),
  sub: document.querySelector(".sd-page .hero-greeting")?.textContent || "",
}));
console.log("sold:", JSON.stringify(list));
if (list.hash !== "#/sold" || list.names.join() !== "Dana Muise,Ken Boudreau,Moe Hassan" || list.months.length !== 2 || !/3 customers/.test(list.sub)) fail("Sold should list everyone sold, by month, newest first: " + JSON.stringify(list));

// --- A sale opens to its paperwork; a photo added is saved with the sale.
await p.click('.sd-sale[data-id="s1"] .sd-head');
await p.waitForSelector('.sd-sale[data-id="s1"] [data-add]', { state: "attached", timeout: 5000 }).catch(() => fail("opening a sale should show the add buttons"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVQIW2P8z8DwnwEIAAr+Av+1yJjkAAAAAElFTkSuQmCC", "base64");
const tmp = "/tmp/claude-sold-test.png"; fs.writeFileSync(tmp, png);
const inputs = await p.$$('.sd-sale[data-id="s1"] [data-add]');
await inputs[1].setInputFiles({ name: "bill-of-sale.png", mimeType: "image/png", buffer: png });
await p.waitForSelector('.sd-sale[data-id="s1"] .sd-thumb img', { timeout: 8000 }).catch(() => fail("the photo didn't show as a thumbnail"));
await p.waitForFunction(() => /\d/.test(document.querySelector('.sd-sale[data-id="s1"] .sd-count')?.textContent || "") && document.querySelector('.sd-sale[data-id="s1"] .sd-count').textContent.trim().endsWith("1"), null, { timeout: 5000 }).catch(() => fail("the count on the sale didn't go to 1"));
let objects = [];
for (let i = 0; i < 40 && !objects.length; i++) { await p.waitForTimeout(200); objects = await fetch(APP + "/__objects").then((r) => r.json()); }
const saved = await p.evaluate(async () => { const s = await import("/js/store.js"); const docs = s.all("docs"); return { n: docs.length, saleId: docs[0] && docs[0].saleId, leadId: docs[0] && docs[0].leadId, mime: docs[0] && docs[0].mime, uploaded: !!(docs[0] && docs[0].uploaded), path: docs[0] && docs[0].path, synced: s.SYNC_COLLECTIONS.includes("docs") }; });
console.log("saved:", JSON.stringify(saved), "bucket:", JSON.stringify(objects));
if (saved.n !== 1 || saved.saleId !== "s1" || saved.leadId !== "a" || !/^image\//.test(saved.mime || "") || !saved.synced) fail("the photo should be a docs row on the sale and the customer: " + JSON.stringify(saved));
if (!objects.length || !/^docs\/00000000-0000-4000-8000-000000000001\/s1\//.test(objects[0].key) || !saved.uploaded || "docs/" + saved.path !== objects[0].key) fail("the photo should be backed up under the account's own folder: " + JSON.stringify({ saved, objects }));
const thumbSrc = await p.evaluate(() => document.querySelector('.sd-sale[data-id="s1"] .sd-thumb img')?.src || "");
if (!/^blob:/.test(thumbSrc)) fail("the thumbnail should come from the device: " + thumbSrc);

// --- The viewer opens it; the file is still there after a reload.
await p.click('.sd-sale[data-id="s1"] .sd-thumb');
await p.waitForSelector(".modal .sd-viewer-body img", { timeout: 5000 }).catch(() => fail("tapping the thumbnail should open the photo"));
await p.click(".modal .modal-close"); await p.waitForTimeout(200);
await p.reload();
await p.waitForSelector(".sd-page .sd-sale", { timeout: 10000 });
await p.click('.sd-sale[data-id="s1"] .sd-head');
await p.waitForSelector('.sd-sale[data-id="s1"] .sd-thumb img[src^="blob:"]', { timeout: 8000 }).catch(() => fail("after a reload the photo should still be there, from the device"));

// --- Delete, with undo.
await p.click('.sd-sale[data-id="s1"] .sd-thumb');
await p.waitForSelector(".modal [data-del]", { timeout: 5000 });
await p.click(".modal [data-del]");
await p.waitForTimeout(400);
const gone = await p.evaluate(async () => { const s = await import("/js/store.js"); return { docs: s.all("docs").length, thumbs: document.querySelectorAll('.sd-sale[data-id="s1"] .sd-thumb').length, undo: !!document.querySelector("#toast-root button") }; });
if (gone.docs !== 0 || gone.thumbs !== 0 || !gone.undo) fail("delete should remove the file and offer undo: " + JSON.stringify(gone));
await p.click("#toast-root button");
await p.waitForSelector('.sd-sale[data-id="s1"] .sd-thumb', { timeout: 5000 }).catch(() => fail("undo should bring the file back"));

// --- Spoken with opens the month's Logged on Log.
await p.goto(APP + "/#/");
await p.waitForSelector('.target-card [data-act="spoken"]', { timeout: 15000 }).catch(() => fail("the Spoken with tile isn't tappable"));
await p.click('.target-card [data-act="spoken"]');
await p.waitForFunction(() => location.hash === "#/log" && document.querySelector(".log-tabs .btn-primary")?.dataset.tab === "logged", null, { timeout: 10000 }).catch(() => fail("tapping Spoken with should open Log on the Logged chip"));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsold.test.js FAILED" : "\nsold.test.js passed");
})();
