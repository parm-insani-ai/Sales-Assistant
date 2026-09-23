// "People who drive Infinitis are being suggested Nissan Kicks SR." The next
// vehicle is the closest thing to what they drive that fits the payment.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "inf", name: "Iris Infiniti", phone: "9025551111", stage: "working", vehicleInterest: "2019 INFINITI QX60 LUXE AWD", currentPayment: 720, payoff: 9000, currentValue: 24000, purchaseDate: "2019-06-01", currentTerm: 84, ...x },
      { id: "rav", name: "Rae Rav", phone: "9025552222", stage: "working", vehicleInterest: "2018 Toyota RAV4 XLE", currentPayment: 480, payoff: 6000, currentValue: 17000, purchaseDate: "2018-05-01", currentTerm: 84, ...x },
      { id: "kia", name: "Kim Kia", phone: "9025553333", stage: "working", vehicleInterest: "2019 Kia Forte LX", currentPayment: 330, payoff: 5000, currentValue: 12000, purchaseDate: "2019-05-01", currentTerm: 84, ...x },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Kicks", trim: "SR", price: 32698, condition: "New", stock: "N1", status: "available", source: "web", ...x },
      { id: "v2", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38848, condition: "New", stock: "N2", status: "available", source: "web", ...x },
      { id: "v3", year: 2026, make: "Nissan", model: "Rogue", trim: "Platinum", price: 46848, condition: "New", stock: "N3", status: "available", source: "web", ...x },
      { id: "v4", year: 2026, make: "Nissan", model: "Murano", trim: "SL", price: 62498, condition: "New", stock: "N4", status: "available", source: "web", ...x },
      { id: "v5", year: 2026, make: "Nissan", model: "Pathfinder", trim: "Platinum", price: 63398, condition: "New", stock: "N5", status: "available", source: "web", ...x },
      { id: "v6", year: 2023, make: "Infiniti", model: "QX60", trim: "Luxe", price: 52990, mileage: 31000, condition: "Used", stock: "NHP1", status: "available", source: "web", ...x },
      { id: "v7", year: 2026, make: "Nissan", model: "Sentra", trim: "SV", price: 27768, condition: "New", stock: "N7", status: "available", source: "web", ...x },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 84, dealMatchBand: 150 },
  }));
});
await p.goto(APP + "/#/leads");
await p.waitForFunction(() => document.querySelectorAll("[data-lead-id]").length >= 3, null, { timeout: 20000 });
const picks = await p.evaluate(async () => {
  const a = await import("/js/assess.js"); const d = await import("/js/views/dealbuilder.js"); const s = await import("/js/store.js");
  const name = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  return s.all("leads").map((l) => { const as = a.assessment(l.id); const rep = d.bestPitch ? null : null; return { who: l.vehicleInterest, best: as && as.best ? name(as.best.vehicle) + " (" + (as.best.delta != null ? (as.best.delta > 0 ? "+" : "") + Math.round(as.best.delta) : "?") + "/mo)" : null, why: as ? as.why.slice(0, 2) : [] }; });
});
console.log(JSON.stringify(picks, null, 1));
const inf = picks.find((x) => /INFINITI/.test(x.who)), rav = picks.find((x) => /RAV4/.test(x.who)), kia = picks.find((x) => /Forte/.test(x.who));
if (!inf || !inf.best || !/QX60|Pathfinder Platinum|Murano|Armada/.test(inf.best)) fail("the Infiniti owner isn't offered something like an Infiniti: " + JSON.stringify(inf));
if (inf && /Kicks|Sentra/.test(inf.best)) fail("the Infiniti owner is offered a Kicks or a Sentra: " + JSON.stringify(inf));
if (!rav || !rav.best || !/Rogue/.test(rav.best)) fail("the RAV4 owner isn't offered a Rogue: " + JSON.stringify(rav));
if (!kia || !kia.best || !/Sentra/.test(kia.best)) fail("the Forte owner isn't offered a Sentra: " + JSON.stringify(kia));
const card = await p.evaluate(() => [...document.querySelectorAll("[data-lead-id]")].map((c) => c.textContent.replace(/\s+/g, " ")).find((t) => /Iris/.test(t)));
console.log("Iris's card:", card.slice(0, 200));
if (/Kicks/.test(card)) fail("Iris's card mentions a Kicks");
if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\npitch.test.js FAILED" : "\npitch.test.js passed");
})();
