// The Leads filter: the blast's criteria picked by hand — model, body style,
// years, paid off, stage — narrowing the book, with the same people handed
// to Mass outreach by "Text these".
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "s1", name: "Dana Muise", phone: "9025551111", stage: "delivered", vehicleInterest: "2019 Nissan Sentra SV", currentPayment: 0, payoff: 0, purchaseDate: "2025-05-01", createdAt: "x", updatedAt: "x" },
      { id: "s2", name: "Lee Wong", phone: "9025552222", stage: "delivered", vehicleInterest: "2021 Nissan Sentra SR", currentPayment: 380, payoff: 9000, purchaseDate: "2025-05-01", createdAt: "x", updatedAt: "x" },
      { id: "s3", name: "Pat Roy", phone: "9025553333", stage: "working", vehicleInterest: "2017 Nissan Sentra S", currentPayment: 0, purchaseDate: "2025-05-01", createdAt: "x", updatedAt: "x" },
      { id: "r1", name: "Rogue Owner", phone: "9025554444", stage: "delivered", vehicleInterest: "2020 Nissan Rogue SV", payoff: 0, purchaseDate: "2025-05-01", createdAt: "x", updatedAt: "x" },
      { id: "f1", name: "Frontier Owner", phone: "9025555555", stage: "delivered", vehicleInterest: "2022 Nissan Frontier PRO-4X", currentPayment: 700, purchaseDate: "2025-05-01", createdAt: "x", updatedAt: "x" },
      { id: "h1", name: "Civic Owner", phone: "9025556666", stage: "new", vehicleInterest: "2020 Honda Civic Sport", purchaseDate: "2025-05-01", createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false,
      agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api", smsFrom: "+19025550000" },
  }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector('[data-act="audience"]');
const names = () => p.evaluate(() => [...document.querySelectorAll(".lead-list .row-title")].map((n) => n.textContent.trim()).sort().join(","));
if ((await names()) !== "Civic Owner,Dana Muise,Frontier Owner,Lee Wong,Pat Roy,Rogue Owner") fail("the whole book isn't shown before filtering: " + (await names()));

// --- Sentra owners, paid off.
await p.click('[data-act="audience"]');
await p.waitForSelector("#af-models");
await p.fill("#af-models", "Sentra");
await p.check("#af-paid");
await p.click('.modal [data-act="apply"]');
await p.waitForTimeout(300);
let shown = await p.evaluate(() => ({ names: [...document.querySelectorAll(".lead-list .row-title")].map((n) => n.textContent.trim()).sort().join(","), bar: document.querySelector(".lead-audience")?.textContent.replace(/\s+/g, " ").trim(), chip: document.querySelector('[data-act="audience"]')?.textContent.trim(), kept: sessionStorage.getItem("viniva:leads-audience") }));
console.log("Sentra · paid off:", JSON.stringify(shown));
if (shown.names !== "Dana Muise,Pat Roy") fail("paid-off Sentra owners: " + shown.names);
if (!/2 match · Sentra owners · paid off/.test(shown.bar || "")) fail("the filter bar doesn't say who and how many: " + shown.bar);
if (!/Filter on/.test(shown.chip || "") || !shown.kept) fail("the chip doesn't show the filter is on / it isn't remembered");

// --- A stage chip narrows on top of the filter, and the count follows.
await p.click('[data-filter="working"]');
await p.waitForTimeout(250);
shown = await p.evaluate(() => ({ names: [...document.querySelectorAll(".lead-list .row-title")].map((n) => n.textContent.trim()).join(","), count: document.querySelector(".aud-count")?.textContent }));
if (shown.names !== "Pat Roy" || shown.count !== "1") fail("chip + filter: " + JSON.stringify(shown));
await p.click('[data-filter="all"]');
await p.waitForTimeout(250);

// --- Edit: body style instead of a model.
await p.click('[data-act="aud-edit"]');
await p.waitForSelector("#af-models");
const prefilled = await p.evaluate(() => ({ models: document.querySelector("#af-models").value, paid: document.querySelector("#af-paid").checked }));
if (prefilled.models !== "sentra" || !prefilled.paid) fail("the sheet doesn't open on the current filter: " + JSON.stringify(prefilled));
await p.fill("#af-models", "");
await p.uncheck("#af-paid");
await p.selectOption("#af-body", "suv");
await p.click('.modal [data-act="apply"]');
await p.waitForTimeout(300);
if ((await names()) !== "Rogue Owner") fail("SUV owners: " + (await names()));
const label = await p.evaluate(() => document.querySelector(".lead-audience")?.textContent.replace(/\s+/g, " ").trim());
if (!/1 match · SUV owners/.test(label || "")) fail("SUV label: " + label);

// --- Years and a make.
await p.click('[data-act="aud-edit"]');
await p.waitForSelector("#af-models");
await p.selectOption("#af-body", "");
await p.fill("#af-makes", "Nissan");
await p.fill("#af-ymin", "2020");
await p.fill("#af-ymax", "2022");
await p.click('.modal [data-act="apply"]');
await p.waitForTimeout(300);
if ((await names()) !== "Frontier Owner,Lee Wong,Rogue Owner") fail("2020–2022 Nissans: " + (await names()));

// --- Text these: the same people land on Mass outreach, none of the others.
await p.click('[data-act="aud-text"]');
await p.waitForSelector(".mo-row");
const blast = await p.evaluate(() => ({ hash: location.hash, to: [...document.querySelectorAll(".mo-row .row-title")].map((n) => n.textContent.trim()).sort().join(","), label: document.querySelector(".section-title .muted")?.textContent.trim(), send: document.querySelector('[data-act="send"]')?.disabled, msg: document.querySelector("#mo-message")?.value }));
console.log("blast:", JSON.stringify(blast));
if (blast.hash !== "#/outreach" || blast.to !== "Frontier Owner,Lee Wong,Rogue Owner") fail("Text these didn't carry the filtered people: " + JSON.stringify(blast));
if (!/2020–2022 Nissan owners/.test(blast.label || "")) fail("the blast doesn't name the audience: " + blast.label);
if (blast.send !== true || blast.msg !== "") fail("send should wait for a message");
await p.evaluate(() => { const m = document.querySelector("#mo-message"); m.value = "the new Rogue is in and we're short on trades"; m.dispatchEvent(new Event("input", { bubbles: true })); });
await p.waitForTimeout(700);
const ready = await p.evaluate(() => ({ send: document.querySelector('[data-act="send"]').disabled, preview: document.querySelector(".mo-preview")?.textContent }));
if (ready.send || !/Hi Lee.*The new Rogue is in/.test(ready.preview || "")) fail("a typed message didn't arm the send: " + JSON.stringify(ready));

// --- Adjust who, from the blast screen: the same sheet.
await p.click('[data-act="adjust"]');
await p.waitForSelector("#af-makes");
await p.fill("#af-ymin", "");
await p.fill("#af-ymax", "");
await p.fill("#af-models", "Rogue");
await p.click('.modal [data-act="apply"]');
await p.waitForTimeout(300);
const adjusted = await p.evaluate(() => [...document.querySelectorAll(".mo-row .row-title")].map((n) => n.textContent.trim()).join(","));
if (adjusted !== "Rogue Owner") fail("adjusting the audience on the blast: " + adjusted);

// --- Back on Leads the filter is still on; clearing it shows everyone.
await p.goto(APP + "/#/leads");
await p.waitForSelector('[data-act="aud-clear"]');
await p.click('[data-act="aud-clear"]');
await p.waitForTimeout(300);
if ((await names()) !== "Civic Owner,Dana Muise,Frontier Owner,Lee Wong,Pat Roy,Rogue Owner") fail("clearing the filter: " + (await names()));
if (await p.evaluate(() => !!document.querySelector(".lead-audience") || !!sessionStorage.getItem("viniva:leads-audience"))) fail("the filter bar or memory lingered after clearing");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nleadsfilter.test.js FAILED" : "\nleadsfilter.test.js passed");
})();
