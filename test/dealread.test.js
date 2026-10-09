// Read the paperwork: from a sale on the Sold screen, a photo of the
// approval order goes to the function (the stub answers with a canned deal),
// the rep sees the car, the money, every product and the prep list with
// owners and lead times, and one tap writes it to the delivery, patches the
// sale, and makes a to-do for each lead-time item — today. The photo is
// saved with the sale like any other page. No real paperwork is used here.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");
const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
await p.addInitScript(([today]) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "a", name: "Test Buyer", phone: "9025551111", stage: "sold", ...x }],
    sales: [{ id: "s1", customerName: "Test Buyer", vehicle: "2026 Nissan Sentra SV", saleDate: today, leadId: "a", frontGross: 1200, backGross: 600, commission: 500, makeReady: {}, ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false, goalUnits: 10, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" },
  }));
}, [today]);

await p.goto(APP + "/#/sold");
await p.waitForSelector('.sd-sale[data-id="s1"] .sd-head', { timeout: 15000 });
await p.click('.sd-sale[data-id="s1"] .sd-head');
await p.waitForSelector('.sd-sale[data-id="s1"] [data-read]', { state: "attached", timeout: 5000 });
// A page: a small PNG stands in for the photo (the stub ignores its contents).
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVQIW2P8z8DwnwEIAAgIAgL8KxFvAAAAAElFTkSuQmCC", "base64");
await p.setInputFiles('.sd-sale[data-id="s1"] [data-read]', { name: "approval.png", mimeType: "image/png", buffer: png });
await p.waitForSelector(".deal-read", { timeout: 20000 }).catch(() => fail("the read sheet didn't open"));
const sheet = await p.evaluate(() => ({
  head: document.querySelector(".deal-read .card")?.textContent.replace(/\s+/g, " ").trim(),
  products: [...document.querySelectorAll(".deal-products .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  prep: [...document.querySelectorAll(".deal-prep-item")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
  heads: document.querySelector(".deal-prep > div")?.textContent.trim(),
}));
console.log("sheet:", JSON.stringify(sheet, null, 1));
if (!/2026 Nissan Sentra SV · NH00001 ?New · Bluestone Pearl · trade: 2013 Hyundai Elantra · finance · 84 mo · \$254 bi-weekly/.test(sheet.head || "")) fail("the car and the money aren't read back: " + sheet.head);
if (!/On the order: 84-Month finance\. Bank Rate\./.test(sheet.head || "")) fail("the order's own lines aren't shown: " + sheet.head);
if (sheet.products.length !== 3 || !/Vehicle protection \(10 yr rust\) ?protection/.test(sheet.products[0])) fail("the products aren't listed: " + JSON.stringify(sheet.products));
if (!sheet.prep.some((x) => /^Book rust protection with service ?Service · 3 days lead · Vehicle protection/.test(x))) fail("rust protection didn't become a service booking: " + JSON.stringify(sheet.prep));
if (!sheet.prep.some((x) => /^Trade: ownership, both keys/.test(x)) || !sheet.prep.some((x) => /^Lender approval and stips/.test(x)) || !sheet.prep.some((x) => /^PDI done/.test(x))) fail("the base steps are missing: " + JSON.stringify(sheet.prep));
if (!/^Start now: Book rust protection \(3 days\)/.test(sheet.heads || "")) fail("the heads-up is wrong: " + sheet.heads);

// Untick one, confirm the rest.
await p.evaluate(() => { const items = [...document.querySelectorAll(".deal-prep-item")]; const w = items.find((x) => /Walkaway/.test(x.textContent)); if (w) w.querySelector("input").checked = false; });
await p.click('.deal-read [data-act="apply"]');
await p.waitForFunction(() => !document.querySelector(".deal-read"), null, { timeout: 5000 });
const after = await p.evaluate(async () => {
  const s = await import("/js/store.js");
  const sale = s.get("sales", "s1");
  const d = s.all("deliveries")[0];
  return {
    sale: { stock: sale.stock, vin: sale.vin, newUsed: sale.newUsed, dealType: sale.dealType, dealNo: sale.dealNo, products: (sale.products || []).map((x) => x.name), deliveryId: sale.deliveryId, readAt: !!sale.dealReadAt },
    delivery: d ? { customer: d.customerName, vehicle: d.vehicle, leadId: d.leadId, status: d.status, items: d.checklist.map((i) => i.label), notes: d.notes } : null,
    tasks: s.all("tasks").filter((t) => t.source === "dealread").map((t) => ({ title: t.title, due: t.due, kind: t.kind, deliveryId: t.deliveryId })),
    docs: s.all("docs").filter((x) => x.saleId === "s1").length,
  };
});
console.log("after:", JSON.stringify(after, null, 1));
if (after.sale.stock !== "NH00001" || after.sale.vin !== "1N4TEST0000000001" || after.sale.newUsed !== "New" || after.sale.dealType !== "finance" || after.sale.dealNo !== "22299" || after.sale.products.length !== 3 || !after.sale.readAt) fail("the sale wasn't patched from the read: " + JSON.stringify(after.sale));
if (!after.delivery || after.delivery.customer !== "Test Buyer" || after.delivery.leadId !== "a" || after.delivery.status !== "prep" || after.sale.deliveryId !== undefined && !after.sale.deliveryId) fail("no delivery in prep for the sale: " + JSON.stringify(after.delivery));
if (after.delivery && (after.delivery.items.some((l) => /Walkaway/.test(l)) || !after.delivery.items.includes("Book rust protection with service") || !after.delivery.items.includes("Plates and registration"))) fail("the delivery's checklist isn't the confirmed list: " + JSON.stringify(after.delivery.items));
if (!/84-Month finance/.test(after.delivery ? after.delivery.notes : "")) fail("the order's lines aren't on the delivery's notes");
if (after.tasks.length !== 3 || !after.tasks.every((t) => t.due === today && t.kind === "prep" && t.deliveryId) || !after.tasks.some((t) => /rust/.test(t.title)) || !after.tasks.some((t) => /Lender approval/.test(t.title)) || !after.tasks.some((t) => /etch/.test(t.title))) fail("the lead-time items aren't today's to-dos: " + JSON.stringify(after.tasks));
if (after.docs !== 1) fail("the page wasn't saved with the sale: " + after.docs);
const reads = await (await fetch(APP + "/__dealreads")).json();
if (reads.length !== 1 || reads[0].pages !== 1 || reads[0].saleId !== "s1") fail("the function wasn't asked once with one page: " + JSON.stringify(reads));

// The Sold screen now says it's been read, with a way to the prep list.
const mark = await p.evaluate(() => document.querySelector('.sd-sale[data-id="s1"] .sd-read-done')?.textContent.replace(/\s+/g, " ").trim());
if (!/read · 3 products · prep list/.test(mark || "")) fail("the sale doesn't show it's been read: " + mark);

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndealread.test.js FAILED" : "\ndealread.test.js passed");
})();
