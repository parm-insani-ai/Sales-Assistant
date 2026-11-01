// Delivered, from the "+" sheet: everyone who took delivery — the sale marked
// delivered on the Sold Tracker, or the delivery completed — newest first,
// each opening to their contact details and the pictures of their contract.
// The pictures are the sale's own folder, the one Sold keeps. A search finds
// a name, a vehicle or a phone number. Someone merely sold isn't here yet.
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
    leads: [
      { id: "a", name: "Dana Muise", phone: "9025551111", email: "dana@example.com", vin: "1N4BL4BV5RN000001", stage: "delivered", ...x },
      { id: "k", name: "Ken Boudreau", phone: "9025552222", stage: "delivered", ...x },
      { id: "m", name: "Moe Hassan", phone: "9025553333", stage: "sold", ...x },
    ],
    sales: [
      // Delivered on the Sold Tracker.
      { id: "s1", customerName: "Dana Muise", vehicle: "2026 Nissan Kicks SR", saleDate: ym + "-03", deliveredAt: ym + "-06", leadId: "a", stock: "N12345", ...x },
      // Delivered on the Deliveries screen (the delivery below is complete).
      { id: "s2", customerName: "Ken Boudreau", vehicle: "2025 Rogue SV", saleDate: lym + "-20", leadId: "k", deliveryId: "dl2", ...x },
      // Sold, not delivered yet.
      { id: "s3", customerName: "Moe Hassan", vehicle: "2024 Frontier", saleDate: ym + "-01", leadId: "m", ...x },
    ],
    deliveries: [
      { id: "dl2", customerName: "Ken Boudreau", vehicle: "2025 Rogue SV", leadId: "k", status: "delivered", deliveryDate: lym + "-22", checklist: [], ...x },
      { id: "dl3", customerName: "Moe Hassan", vehicle: "2024 Frontier", leadId: "m", status: "prep", deliveryDate: ym + "-28", checklist: [], ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" },
  }));
}, [ym, lym]);

// --- The "+" sheet has the tile; it opens the list.
await p.goto(APP + "/#/");
await p.waitForSelector("#quick-add", { timeout: 15000 });
await p.click("#quick-add");
await p.waitForSelector(".qa-tile", { timeout: 8000 });
const tile = await p.evaluate(() => { const t = [...document.querySelectorAll(".qa-tile")].find((x) => /^\s*Delivered\s*$/.test(x.textContent)); if (t) t.click(); return !!t; });
if (!tile) fail("the + sheet has no Delivered tile");
await p.waitForSelector(".dv-page .dv-card", { timeout: 10000 }).catch(() => fail("the Delivered tile didn't open the list"));
const list = await p.evaluate(() => ({
  hash: location.hash,
  names: [...document.querySelectorAll(".dv-page .dv-card .row-title")].map((s) => s.textContent.trim()),
  subs: [...document.querySelectorAll(".dv-page .dv-card .row-sub")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  months: [...document.querySelectorAll(".dv-page > .section-title")].map((s) => s.textContent.replace(/\s+/g, " ").trim()),
  greeting: document.querySelector(".dv-page .hero-greeting")?.textContent || "",
}));
console.log("delivered:", JSON.stringify(list));
if (list.hash !== "#/delivered" || list.names.join() !== "Dana Muise,Ken Boudreau") fail("Delivered should list the two delivered customers, newest first, and not the one only sold: " + JSON.stringify(list));
if (!/delivered/.test(list.subs[0]) || !/Kicks/.test(list.subs[0]) || list.months.length !== 2 || !/2 customers/.test(list.greeting)) fail("each card should say the vehicle and the delivery day, grouped by month: " + JSON.stringify(list));

// --- A customer opens to their details and the ways to reach them.
await p.click('.dv-card[data-id="s1"] .sd-head');
await p.waitForSelector('.dv-card[data-id="s1"] .dv-contact', { timeout: 5000 });
const dana = await p.evaluate(() => {
  const c = document.querySelector('.dv-card[data-id="s1"]');
  return {
    lines: [...c.querySelectorAll(".dv-line")].map((l) => l.textContent.replace(/\s+/g, " ").trim()),
    links: [...c.querySelectorAll(".dv-actions a")].map((a) => [a.textContent.trim(), a.getAttribute("href")]),
    empty: c.querySelector(".sd-body .small.muted")?.textContent || "",
  };
});
console.log("dana:", JSON.stringify(dana));
if (!dana.lines.some((l) => /Phone.*\(902\) 555-1111/.test(l)) || !dana.lines.some((l) => /Email.*dana@example\.com/.test(l)) || !dana.lines.some((l) => /VIN.*1N4BL4BV5RN000001/.test(l)) || !dana.lines.some((l) => /Stock.*N12345/.test(l))) fail("the card should show phone, email, VIN and stock: " + JSON.stringify(dana.lines));
const href = (label) => (dana.links.find((l) => l[0].includes(label)) || [])[1] || "";
if (href("Call") !== "tel:9025551111" || href("Text") !== "sms:9025551111" || href("Email") !== "mailto:dana@example.com" || href("Customer") !== "#/leads/a") fail("Call, Text, Email and Customer should be one tap each: " + JSON.stringify(dana.links));
if (!/No pictures of Dana's contract yet/.test(dana.empty)) fail("with nothing saved it should say so: " + dana.empty);

// --- A picture of the contract: saved with the sale, shown here and on Sold.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVQIW2P8z8DwnwEIAAr+Av+1yJjkAAAAAElFTkSuQmCC", "base64");
const inputs = await p.$$('.dv-card[data-id="s1"] [data-add]');
await inputs[1].setInputFiles({ name: "contract-p1.png", mimeType: "image/png", buffer: png });
await p.waitForSelector('.dv-card[data-id="s1"] .sd-thumb img[src^="blob:"]', { timeout: 8000 }).catch(() => fail("the picture didn't show as a thumbnail"));
const saved = await p.evaluate(async () => { const s = await import("/js/store.js"); const docs = s.all("docs"); return { n: docs.length, saleId: docs[0]?.saleId, leadId: docs[0]?.leadId, count: document.querySelector('.dv-card[data-id="s1"] .sd-count')?.textContent.trim(), title: document.querySelector('.dv-card[data-id="s1"] .dv-sub')?.textContent.replace(/\s+/g, " ").trim() }; });
console.log("saved:", JSON.stringify(saved));
if (saved.n !== 1 || saved.saleId !== "s1" || saved.leadId !== "a" || !/1$/.test(saved.count || "") || !/Contract · 1/.test(saved.title || "")) fail("the picture should be a docs row on Dana's sale: " + JSON.stringify(saved));
await p.click('.dv-card[data-id="s1"] .sd-thumb');
await p.waitForSelector(".modal .sd-viewer-body img", { timeout: 5000 }).catch(() => fail("tapping the thumbnail should open the picture"));
await p.click(".modal .modal-close"); await p.waitForTimeout(200);
await p.goto(APP + "/#/sold");
await p.waitForSelector(".sd-page .sd-sale", { timeout: 10000 });
const onSold = await p.evaluate(() => document.querySelector('.sd-sale[data-id="s1"] .sd-count')?.textContent.trim());
if (!/1$/.test(onSold || "")) fail("the same picture should count on Sold: " + onSold);

// --- Search: a name, a vehicle, a phone number.
await p.goto(APP + "/#/delivered");
await p.waitForSelector(".dv-q", { timeout: 10000 });
const search = async (q) => { await p.fill(".dv-q", q); await p.waitForTimeout(100); return p.evaluate(() => [...document.querySelectorAll(".dv-page .dv-card .row-title")].map((s) => s.textContent.trim())); };
const byName = await search("ken"), byCar = await search("kicks"), byPhone = await search("555-2222"), none = await search("zzz");
console.log("search:", JSON.stringify({ byName, byCar, byPhone, none }));
if (byName.join() !== "Ken Boudreau" || byCar.join() !== "Dana Muise" || byPhone.join() !== "Ken Boudreau" || none.length) fail("search should find by name, vehicle and phone: " + JSON.stringify({ byName, byCar, byPhone, none }));
const nobody = await p.evaluate(() => document.querySelector(".dv-page .card .muted")?.textContent || "");
if (!/matches/.test(nobody)) fail("no match should say so: " + nobody);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndelivered.test.js FAILED" : "\ndelivered.test.js passed");
})();
