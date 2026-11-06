// Two customers with the same name are two customers. A whole-CRM export
// carries several people called the same thing; the import used to fold
// them into one record by name alone, handing the first person the second's
// payment, payoff and rate and dropping the second's phone. Now a name only
// identifies a person when neither side's phone or email says otherwise —
// so a service list with no contact columns still finds its customer, and a
// second person with the same name and a different number gets their own
// record.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { stage: "delivered", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [
    { id: "j1", name: "Jordan Example", phone: "9025551111", currentPayment: 500, vehicleInterest: "2021 Nissan Rogue SV", ...x },
    // From an earlier service list: no phone on file yet.
    { id: "c1", name: "Casey Example", vehicleInterest: "2019 Nissan Kicks SR", ...x },
  ], vehicles: [], settings: { salesperson: "Parm", cloudAutoSync: false } }));
  sessionStorage.setItem("import-type", "leads");
});
await p.goto(APP + "/#/import");
await p.waitForSelector("#imp-file", { state: "attached", timeout: 20000 });
const csv = [
  "Customer,Phone,Payment,Vehicle",
  "Jordan Example,9025552222,650,2023 Nissan Pathfinder SL",   // a different Jordan: new number
  "Jordan Example,9025551111,510,2021 Nissan Rogue SV",        // the Jordan we have: same number
  "Casey Example,9025553333,380,2019 Nissan Kicks SR",         // our Casey, now with a phone
  "Casey Example,,390,2019 Nissan Kicks SR",                   // a row with no contact at all: still Casey
  "Jordan Example,,,2021 Nissan Rogue SV",                     // no contact: the first Jordan on file, not a third
].join("\n");
// A whole book first: the follow-up plan (eight tasks a person) starts off
// for a file this size, with a line saying why; a short prospect list keeps it on.
const big = "Customer,Phone,Vehicle\n" + Array.from({ length: 250 }, (_, i) => `Owner ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} Example,90255${String(10000 + i)},2020 Nissan Rogue`).join("\n");
await p.setInputFiles("#imp-file", { name: "book.csv", mimeType: "text/csv", buffer: Buffer.from(big) });
await p.waitForSelector('[data-act="run"]', { timeout: 10000 });
const bigBox = await p.evaluate(() => ({ on: document.querySelector("#imp-outreach").checked, note: document.querySelector("#imp-outreach-note").hidden ? "" : document.querySelector("#imp-outreach-note").textContent }));
console.log("big file:", JSON.stringify(bigBox));
if (bigBox.on || !/250 plans would be about 2,000 tasks/.test(bigBox.note)) fail("a 250-row file should start with outreach off and say why: " + JSON.stringify(bigBox));
await p.setInputFiles("#imp-file", { name: "crm.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await p.waitForSelector('[data-act="run"]', { timeout: 10000 });
const smallBox = await p.evaluate(() => ({ on: document.querySelector("#imp-outreach").checked, note: document.querySelector("#imp-outreach-note").hidden }));
if (!smallBox.on || !smallBox.note) fail("a short list keeps outreach on, no note: " + JSON.stringify(smallBox));
await p.evaluate(() => { const c = document.querySelector("#imp-outreach"); if (c) c.checked = false; });
await p.click('[data-act="run"]');
await p.waitForFunction(() => location.hash === "#/leads", null, { timeout: 20000 });
await p.waitForTimeout(300);
const got = await p.evaluate(async () => {
  const st = await import("/js/store.js");
  return st.all("leads").map((l) => ({ id: l.id, name: l.name, phone: l.phone || "", pay: l.currentPayment, car: l.vehicleInterest })).sort((a, b) => a.phone.localeCompare(b.phone) || a.id.localeCompare(b.id));
});
console.log(JSON.stringify(got));
if (got.length !== 3) fail("two Jordans and one Casey make three customers: " + got.length);
const j1 = got.find((l) => l.id === "j1"), j2 = got.find((l) => l.phone === "9025552222"), c1 = got.find((l) => l.id === "c1");
if (!j1 || j1.phone !== "9025551111" || j1.pay !== 510) fail("the Jordan on file keeps their number and takes their own new payment: " + JSON.stringify(j1));
if (!j2 || j2.id === "j1" || j2.pay !== 650 || !/Pathfinder/.test(j2.car)) fail("the other Jordan is their own record: " + JSON.stringify(j2));
if (!c1 || c1.phone !== "9025553333" || c1.pay !== 390) fail("Casey gains the phone, and the contact-less row still finds Casey: " + JSON.stringify(c1));
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nsamename.test.js FAILED" : "\nsamename.test.js passed");
})();
