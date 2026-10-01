// The Performance screen and the tracker export: every number the target
// sheet and the "Vehicles Sold Track" sheet carry, and the sheet itself
// filled in from the deals — columns in the sheet's order, the phone from
// the customer's record, the plate from Settings, the panels down the right.
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
const today = `${ym}-${pad(d.getDate())}`;
await p.addInitScript(([ym, today]) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: ym + "-01T12:00:00.000Z", updatedAt: ym + "-01T12:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "a", name: "Nick Marsh", phone: "9025551001", stage: "sold", shopping: "New", vehicleInterest: "Sentra", loggedAt: ym + "-02T12:00:00.000Z", ...x },
      { id: "b", name: "Ruth Owen", phone: "9025551002", stage: "sold", shopping: "New", vehicleInterest: "Seltos", loggedAt: ym + "-03T12:00:00.000Z", ...x },
      { id: "c", name: "Mike Botch", phone: "9025551003", stage: "sold", shopping: "Used", vehicleInterest: "Rav4", loggedAt: ym + "-04T12:00:00.000Z", ...x },
      { id: "d", name: "Dana Muise", phone: "9025551004", stage: "working", shopping: "New", vehicleInterest: "Rogue", loggedAt: ym + "-05T12:00:00.000Z", ...x },
    ],
    sales: [
      { id: "s1", leadId: "a", customerName: "Nick Marsh", saleDate: ym + "-02", leadType: "Hand Off", brand: "Nissan", model: "Sentra", trim: "SV Prem", kms: 25000, year: 2017, newUsed: "New", stock: "NHP1950", vin: "JN2TEST0000000001", etchNo: "FC001", deliveredAt: ym + "-09", bm: "MS", frontComm: 300, bizGross: 2500, boComm: 200, commission: 500, makeReady: { file: true, etch: true, gas: true, mvi: true, clean: true, ncar: true, nvis: true }, ...x },
      { id: "s2", leadId: "b", customerName: "Ruth Owen", saleDate: ym + "-03", leadType: "Walk-in", brand: "KIA", model: "Seltos", trim: "EX", kms: 60, year: 2026, newUsed: "New", stock: "NH23500", bm: "JP", frontComm: 100, bizGross: 500, boComm: 40, commission: 140, makeReady: {}, ...x },
      { id: "s3", leadId: "c", customerName: "Mike Botch", saleDate: ym + "-04", leadType: "BDC", brand: "Toyota", model: "Rav4", trim: "XSE", kms: 192000, year: 2016, newUsed: "Used", stock: "NHP1980", bm: "HD", frontComm: 450, bizGross: 200, boComm: 16, commission: 466, makeReady: {}, ...x },
    ],
    appointments: [
      { id: "ap1", leadId: "a", customerName: "Nick Marsh", when: ym + "-02T10:00", status: "scheduled", confirmed: true, outcome: "sold", ...x },
      { id: "ap2", leadId: "d", customerName: "Dana Muise", when: ym + "-03T10:00", status: "scheduled", confirmed: true, outcome: "showed", ...x },
      { id: "ap3", leadId: "d", customerName: "Dana Muise", when: ym + "-28T15:00", status: "scheduled", confirmed: false, ...x },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, targetNew: 8, targetUsed: 4, closingNew: 42, closingUsed: 42, goalCommission: 8000, myPlate: "D-23553" },
  }));
}, [ym, today]);

// --- Home's target card opens the screen.
await p.goto(APP + "/#/");
await p.waitForSelector('[data-act="performance"]', { timeout: 10000 }).catch(() => fail("Home's target card has no way into Performance"));
await p.click('[data-act="performance"]');
await p.waitForSelector("#pf-body .card", { timeout: 10000 }).catch(() => fail("Performance didn't open"));
const screen = await p.evaluate(() => ({
  hash: location.hash, month: document.querySelector("#pf-month").textContent,
  sections: [...document.querySelectorAll("#pf-body .section-title")].map((n) => n.textContent),
  text: [...document.querySelectorAll("#pf-body .pf-row")].map((r) => [...r.children].map((c) => c.textContent.trim()).join(" ")).join(" | "),
}));
console.log("sections:", JSON.stringify(screen.sections));
if (screen.hash !== "#/performance") fail("the target card should open /performance: " + screen.hash);
for (const s of ["Target sheet", "Appointments", "Commission", "New vs used", "Type of lead", "Business managers", "Manufacturers", "Models", "Week by week", "Activity"]) {
  if (!screen.sections.includes(s)) fail(`Performance is missing the ${s} section`);
}
// The sheet's numbers: 3 sold of 12 (2 new, 1 used), 4 spoken with of 29
// (ROUNDUP(8/.42)=20 + ROUNDUP(4/.42)=10 = 30 — the sheet's way), commission $1,106.
const t = screen.text;
if (!/Target 8 4 12/.test(t)) fail("the target row should read 8 / 4 / 12: " + t.slice(0, 400));
if (!/Customers to speak with 20 10 30/.test(t)) fail("the conversations required should be 20 / 10 / 30: " + t.slice(0, 600));
if (!/Sold 2 1 3/.test(t)) fail("sold should read 2 / 1 / 3: " + t.slice(0, 600));
if (!/Spoken with 3 1 4/.test(t)) fail("spoken with should read 3 / 1 / 4: " + t.slice(0, 600));
if (!/Set 3/.test(t) || !/Showed 2/.test(t) || !/Sold from appointments 1/.test(t)) fail("the appointment funnel should count set, showed and sold: " + t.slice(0, 900));
if (!/Total commission \$1,106/.test(t) || !/Front \$850/.test(t) || !/Business office \$256/.test(t) || !/Business gross \$3,200/.test(t)) fail("commission should total the deals: " + t.slice(0, 1200));
if (!/Hand Off 1 \$500/.test(t) || !/BDC 1 \$466/.test(t)) fail("type of lead should list each with its total: " + t);
if (!/MS 1 \$200/.test(t)) fail("business managers should list B.O. per manager: " + t);
if (!/Sentra 1 1 0/.test(t) || !/Rav4 1 0 1/.test(t)) fail("models should split new and used: " + t);

// --- The export: the sheet itself, filled in.
const sheet = await p.evaluate(async () => {
  const ds = await import("/js/dealstats.js"); const s = await import("/js/store.js");
  const deals = s.all("sales").sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  const sh = ds.trackerSheet(deals, { leads: s.all("leads"), plate: s.getSettings().myPlate });
  const W = ds.SHEET_COLUMNS.length;
  return { name: sh.name, head: sh.rows[1].slice(0, W), groups: sh.rows[0].slice(0, W).filter(Boolean), first: sh.rows[2].slice(0, W), third: sh.rows[4].slice(0, W), panel: sh.rows.map((r) => r.slice(W + 1).filter((c) => c !== "")).filter((r) => r.length) };
});
console.log("sheet:", sheet.name, "|", sheet.groups.join(" / "), "|", sheet.head.join(","));
if (sheet.name !== "Vehicles Sold Track") fail("the export should be the tracker sheet by name");
if (sheet.head.join(",") !== "Month,Deal,Type,Name,Phone,Brand,Model,Trim,KMS,Year,Type,Stock,File,ETCH,Gas,MVI,Clean,NCAR,NVIS,VIN,Etch,Delivered,BM,Front Commission,Business Gross,B. Off Comm,Total Comm,Notes") fail("the columns should be the sheet's, in its order: " + sheet.head.join(","));
if (!sheet.groups.includes("Customer") || !sheet.groups.includes("Vehicle") || !sheet.groups.includes("Make Ready") || !sheet.groups.includes("My Plate = D-23553")) fail("the sheet's group headers and plate should be on the first row: " + sheet.groups.join(" / "));
const f = sheet.first;
if (f[1] !== 1 || f[2] !== "Hand Off" || f[3] !== "Nick Marsh" || f[4] !== "(902) 555-1001" || f[5] !== "Nissan" || f[8] !== 25000 || f[9] !== 2017 || f[10] !== "New" || f[11] !== "NHP1950") fail("the first deal row should carry the sheet's customer and vehicle columns, phone from the customer's record: " + JSON.stringify(f));
if (f.slice(12, 19).join("") !== "✓✓✓✓✓✓✓" || f[19] !== "JN2TEST0000000001" || f[20] !== "FC001" || !/-09$/.test(f[21]) || f[22] !== "MS" || f[23] !== 300 || f[24] !== 2500 || f[25] !== 200 || f[26] !== 500) fail("the first deal row should carry make-ready, VIN, etch, delivered, BM and the money as numbers: " + JSON.stringify(f));
if (sheet.third[12] !== "" || sheet.third[26] !== 466) fail("an unticked make-ready cell is blank and the total is front + B.O.: " + JSON.stringify(sheet.third));
const panel = sheet.panel.map((r) => r.join(" "));
console.log("panels:", panel.slice(0, 8).join(" | "));
if (panel[0] !== "New Used Total" || panel[1] !== "2 1 3" || panel[2] !== "66.67% 33.33% %" || panel[3] !== "200 450 Av Com" || panel[4] !== "400 450 Total Car Comm" || panel[5] !== "120 16 Av B.O" || panel[6] !== "320 466 Av Tot") fail("the New / Used / Total panel should read as the sheet's: " + panel.slice(0, 7).join(" | "));
if (!panel.includes("B Manager Deals Average") || !panel.includes("MS 1 200") || !panel.includes("JP 1 40") || !panel.includes("HD 1 16")) fail("the B Manager panel should list deals and average B.O.: " + panel.join(" | "));
if (!panel.includes("Manufacturer Total") || !panel.includes("Nissan 1") || !panel.includes("Ford 0") || !panel.includes("KIA 1")) fail("the manufacturer panel should list the sheet's brands with zeros: " + panel.join(" | "));
if (!panel.includes("Model Total New Used") || !panel.includes("Sentra 1 1 0") || !panel.includes("Kicks 0 0 0")) fail("the model panel should list the sheet's models with new and used: " + panel.join(" | "));
if (!panel.includes("Type of lead Sales Total Average %") || !panel.includes("Hand Off 1 500 500 33.33%") || !panel.includes("Referral 0 0 0 0%") || !panel.includes("3 1106 368.67 100%")) fail("the type-of-lead panel should read as the sheet's: " + panel.join(" | "));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nperformance.test.js FAILED" : "\nperformance.test.js passed");
})();
