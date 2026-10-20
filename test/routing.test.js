// Who answers a sentence said into the voice panel: the phone, or the
// assistant. The phone answers by itself only a sentence SHAPED like a lot
// question (or a blast, or who-owns-what); anything that merely mentions a
// vehicle goes to the assistant whole. Every sentence here was said on the
// floor, or is the kind that was.
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
      { id: "a", name: "Dana Muise", phone: "9025551111", stage: "working", vehicleInterest: "2021 Nissan Rogue SV", createdAt: "x", updatedAt: "x" },
      { id: "b", name: "Scott Pine", phone: "9025552222", stage: "delivered", vehicleInterest: "2019 Nissan Sentra SV", createdAt: "x", updatedAt: "x" },
      { id: "c", name: "Ken Jones", phone: "9025553333", stage: "new", vehicleInterest: "Civic", createdAt: "x", updatedAt: "x" },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38995, mileage: 14, condition: "New", stock: "N26011", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v2", year: 2025, make: "Nissan", model: "Kicks", trim: "SR", price: 29450, mileage: 8, color: "Black", condition: "New", stock: "K2502", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
      { id: "v3", year: 2022, make: "Honda", model: "Civic", trim: "Sport", price: 24990, mileage: 94573, condition: "Used", stock: "NHP1868", status: "available", source: "web", createdAt: "x", updatedAt: "x" },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(700);

// What the phone decides for each sentence: the action, and whether it would
// answer by itself with an assistant available ("sure").
const table = [
  // The phone's, instantly: shaped like a lot question.
  ["do we have any rogue svs", "lot", true],
  ["how many rogues do we have", "lot", true],
  ["what's the civic sport going for", "lot", true],
  ["how many kilometres on the civic sport", "lot", true],
  ["any black kicks under 30", "lot", true],
  ["cheapest used suv under thirty", "lot", true],
  ["anything new on the lot", "lot", true],
  ["is the civic sport still here", "lot", true],
  ["what do we have in rogues", "lot", true],
  // The assistant's, whole: a vehicle is mentioned, not asked about.
  ["how did the rogue stack up with the rav4", "not-lot", false],
  ["compare the kicks with the cr-v", "not-lot", false],
  ["why would scott be a good candidate for a new vehicle right now", "not-lot", false],
  ["ken jones is coming back in to look at new rogues on tuesday", "not-lot", false],
  ["dana's coming in tomorrow at 4 for the rogue", "not-lot", false],
  ["what did dana say about the rogue", "not-lot", false],
  ["what could i put dana in", "not-lot", false],
  ["is ken's civic worth anything", "not-lot", false],
  ["who should i call about the rogue special", "not-lot", false],
  ["any rogues coming in next week", "lot", true], // a lot ask about arrivals
  // A customer named in a lot-shaped sentence: the assistant's.
  ["dana wants to know how many rogues we have", "not-lot", false],
  // Blasts and owner lists stay on the phone.
  ["text everyone who owns a rogue that the new one is in", "outreach", null],
  ["text everyone whose lease is sending this year", "outreach", null],
  ["make me a list of everyone who owns a nissan rogue", "owners", null],
  // "Reach out to" + "people" is not a blast when it's asking WHO: the
  // assistant's (today's prospects), never the blast screen with nobody on it.
  ["find me some people i can reach out to so i can set some appointments i'm falling behind an appointment i need more", "not-outreach", null],
  ["who should i reach out to today", "not-outreach", null],
  ["bring me people worth a call", "not-outreach", null],
];
const got = await p.evaluate(async (rows) => {
  const v = await import("/js/voice.js");
  return rows.map(([s]) => { const c = v.parseCommand(s); return { s, action: c.action, sure: c.action === "lot" ? !!c.sure : null }; });
}, table);
for (let i = 0; i < table.length; i++) {
  const [s, want, sure] = table[i], r = got[i];
  // "not-lot": the phone must not answer it as the lot — either it isn't read
  // as one at all, or it is but waits for the assistant.
  const okAction = want === "not-lot" ? (r.action !== "lot" || r.sure === false) : want === "not-outreach" ? !/^(outreach|lot|owners)$/.test(r.action) : r.action === want;
  const okSure = sure === null || /^not-/.test(want) || r.sure === sure;
  console.log(`${okAction && okSure ? "ok  " : "BAD "} "${s}" → ${r.action}${r.action === "lot" ? (r.sure ? " (phone answers)" : " (assistant first)") : ""}`);
  if (!okAction) fail(`"${s}" routed to ${r.action}, wanted ${want}`);
  if (!okSure) fail(`"${s}" ${r.sure ? "would be answered on the phone" : "would wait for the assistant"}; wanted the opposite`);
}

// Inside the assistant: the lot tool itself won't list the lot for a
// comparison or an owner question the model mis-routed.
const tools = await p.evaluate(async () => {
  const m = await import("/js/agent.js");
  return {
    compare: await m.execTool("lot_lookup", { question: "how did the rogue stack up with the rav4" }),
    owners: await m.execTool("lot_lookup", { question: "make me a list of everyone who owns a rogue" }),
    lot: await m.execTool("lot_lookup", { question: "do we have any rogues" }),
    // …and the blast tool won't open a blast to nobody for a who-should-I-contact question.
    asking: await m.execTool("mass_outreach", { sentence: "find me some people I can reach out to so I can set some appointments, I'm falling behind on appointments, I need more" }),
    blast: await m.execTool("mass_outreach", { sentence: "text everyone who owns a rogue that the new one is in" }),
  };
});
if (!tools.asking.result.notABlast || !Array.isArray(tools.asking.result.prospects)) fail("the blast tool should answer a who-to-contact question with today's prospects: " + JSON.stringify(tools.asking).slice(0, 200));
if (tools.blast.result.notABlast || tools.blast.result.audience !== "Rogue owners") fail("a real blast stopped being a blast: " + JSON.stringify(tools.blast.result).slice(0, 200));
console.log("lot tool on a comparison →", (tools.compare.note || "").slice(0, 80));
if (!/comparing|not in the vehicle database/.test(tools.compare.note || "")) fail("the lot tool listed the lot for a comparison: " + JSON.stringify(tools.compare).slice(0, 200));
if (!tools.owners.result.notTheLot || tools.owners.result.count !== 1) fail("the lot tool listed the lot for an owner question: " + JSON.stringify(tools.owners.result).slice(0, 200));
if (tools.lot.result.count !== 1 || !tools.lot.result.units) fail("a real lot question stopped being answered from the lot: " + JSON.stringify(tools.lot.result).slice(0, 200));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "routing: FAILED" : "routing: ok");
})().catch((e) => { console.error(e); process.exit(1); });
