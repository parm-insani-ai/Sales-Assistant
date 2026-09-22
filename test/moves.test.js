// A note is not filed and forgotten. Each thing it says becomes a move:
// booked, found, drafted, dated — taken right away, shown back, undoable.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
await fetch(APP + "/__reset");
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "lead_ann", name: "Ann Example", phone: "9025550111", stage: "new", vehicleInterest: "Rogue", createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:00:00.000Z" },
      { id: "lead_bob", name: "Bob Example", phone: "9025550112", stage: "working", vehicleInterest: "Kicks", currentPayment: 520, createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:00:00.000Z" },
      { id: "lead_cy", name: "Cy Example", phone: "9025550113", stage: "new", createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:00:00.000Z" },
      { id: "lead_dee", name: "Dee Example", phone: "9025550114", stage: "sold", currentVehicle: "2021 Rogue SV", createdAt: "2024-03-01T12:00:00.000Z", updatedAt: "2024-03-01T12:00:00.000Z" },
      { id: "lead_eve", name: "Eve Example", phone: "9025550115", stage: "working", createdAt: "2026-09-20T12:00:00.000Z", updatedAt: "2026-09-20T12:00:00.000Z" },
    ],
    vehicles: [
      { id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38500, stock: "R101", status: "available", notes: "Moonroof, AWD, heated seats", condition: "New" },
      { id: "v2", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 39200, stock: "R102", status: "available", notes: "Panoramic moonroof", condition: "New" },
      { id: "v3", year: 2026, make: "Nissan", model: "Rogue", trim: "S", price: 34900, stock: "R103", status: "available", notes: "", condition: "New" },
      { id: "v4", year: 2026, make: "Nissan", model: "Rogue", trim: "SL", price: 44900, stock: "R104", status: "sold", notes: "Moonroof", condition: "New" },
      { id: "v5", year: 2025, make: "Nissan", model: "Kicks", trim: "SR", price: 29900, stock: "K201", status: "available", notes: "", condition: "New" },
    ],
    settings: { salesperson: "Parm", dealership: "Nissan", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", taxRate: 14, docFee: 699 } }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(600);

// --- The parsers, on their own.
const parsed = await p.evaluate(async () => {
  const m = await import("/js/moves.js");
  const now = new Date("2026-09-22T09:00:00"); // a Tuesday
  return {
    satAt2: m.parseWhen("she's coming in Saturday at 2", now),
    tomorrow1030: m.parseWhen("test drive tomorrow at 10:30am", now),
    friAfternoon: m.parseWhen("coming Friday afternoon", now),
    thursday: m.parseWhen("said he'd be in Thursday", now),
    nothing: m.parseWhen("loves the moonroof", now),
    march: m.parseLater("lease is up in March", now),
    twoWeeks: m.parseLater("check back in two weeks", now),
    looking: m.parseLater("just looking for now", now),
    money30: m.parseMoney("wants to be around thirty"),
    money450: m.parseMoney("450 a month is the ceiling"),
    money38k: m.parseMoney("budget is $38k tops"),
  };
});
console.log("parsed:", JSON.stringify(parsed));
if (parsed.satAt2?.when !== "2026-09-26T14:00") fail(`Saturday at 2 → ${parsed.satAt2?.when}`);
if (parsed.tomorrow1030?.when !== "2026-09-23T10:30") fail(`tomorrow at 10:30am → ${parsed.tomorrow1030?.when}`);
if (parsed.friAfternoon?.when !== "2026-09-25T14:00") fail(`Friday afternoon → ${parsed.friAfternoon?.when}`);
if (parsed.thursday?.date !== "2026-09-24" || parsed.thursday?.when) fail(`Thursday alone → ${JSON.stringify(parsed.thursday)}`);
if (parsed.nothing) fail("a note with no day parsed as a visit");
if (parsed.march !== "2027-03-01") fail(`March → ${parsed.march}`);
if (parsed.twoWeeks !== "2026-10-06") fail(`two weeks → ${parsed.twoWeeks}`);
if (!parsed.looking) fail("just looking didn't date a check-back");
if (parsed.money30 !== 30000 || parsed.money450 !== 450 || parsed.money38k !== 38000) fail(`money: ${parsed.money30} ${parsed.money450} ${parsed.money38k}`);

// --- One rich note, many moves.
const rich = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const ctx = await import("/js/context.js"); const m = await import("/js/moves.js");
  const note = "Loves the SV with the moonroof, wants to be around thirty eight, wife has to sign off, coming Saturday at 2, trading a 2019 Altima";
  ctx.addContext("lead_ann", { note });
  const r = m.nextMoves("lead_ann", note);
  const l = store.get("leads", "lead_ann");
  return { moves: r.moves.map((x) => x.kind + ": " + x.title), stage: l.stage,
    appts: store.all("appointments").filter((a) => a.leadId === "lead_ann").map((a) => ({ when: a.when, type: a.type, confirmed: a.confirmed })),
    tasks: store.all("tasks").filter((t) => t.leadId === "lead_ann" && !t.done).map((t) => ({ title: t.title, due: t.due, cadence: !!t.cadence, intent: t.intent })) };
});
console.log("rich note →", JSON.stringify(rich.moves));
console.log("  appointments:", JSON.stringify(rich.appts), "stage:", rich.stage);
console.log("  tasks:", JSON.stringify(rich.tasks.filter((t) => !t.cadence).map((t) => t.title)));
const has = (re) => rich.moves.some((x) => re.test(x));
if (!has(/^appointment: Booked Ann for/)) fail("the visit wasn't booked");
if (rich.appts.length !== 1 || !/T14:00$/.test(rich.appts[0].when)) fail("no appointment at Saturday 2pm on the calendar");
if (rich.stage !== "appointment") fail(`stage is ${rich.stage}, not appointment`);
if (!has(/^text: Confirmation text for/)) fail("no confirmation text drafted");
if (!has(/^stock: 2 Rogue SVs in stock/)) fail("the two SVs with a moonroof in stock weren't found (the S has none, the SL is sold)");
if (!has(/^text: Text about the ones in stock/)) fail("no text about the stock");
if (!has(/^budget: \d+ in stock under their budget/)) fail("the budget wasn't counted against stock");
if (!has(/^people: Their wife decides too/)) fail("the wife wasn't picked up");
if (!has(/^trade: Appraise the trade: 2019 altima/)) fail("the trade wasn't picked up");
if (!has(/^plan: \d+-step follow-up plan started/)) fail("the plan didn't start");
if (!rich.tasks.some((t) => t.intent === "confirm" && t.cadence)) fail("the confirmation isn't a drafted plan step");
if (!rich.tasks.some((t) => /Get Ann's wife in the room/.test(t.title))) fail("no task to get the wife in");
if (!rich.tasks.some((t) => /Appraise Ann's trade — 2019 altima/.test(t.title))) fail("no appraisal task");
// The plan stepped aside for the visit: nothing from it is due before Saturday.
const early = rich.tasks.filter((t) => t.cadence && t.intent !== "confirm" && t.intent !== "stock" && t.due <= "2026-09-26");
if (early.length) fail("plan steps are still due before the visit: " + JSON.stringify(early.map((t) => t.title + " " + t.due)));

// Every move has a clock time, inside business hours, never in the past.
const timed = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const now = Date.now();
  return store.all("tasks").filter((t) => t.leadId === "lead_ann" && !t.done).map((t) => ({ title: t.title.slice(0, 40), at: t.at, ok: !!t.at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t.at) && new Date(t.at).getTime() > now - 60000 && t.due === t.at.slice(0, 10) && !!t.readyAt }));
});
console.log("timed:", JSON.stringify(timed.map((x) => [x.title, x.at])));
if (!timed.length || !timed.every((x) => x.ok)) fail("a move has no clock time, or its day and time disagree: " + JSON.stringify(timed.filter((x) => !x.ok)));

// --- The same note again makes nothing twice.
const again = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const m = await import("/js/moves.js");
  const before = store.all("tasks").length + store.all("appointments").length;
  const ids = new Set(store.all("tasks").map((t) => t.id));
  const r = m.nextMoves("lead_ann", "Loves the SV with the moonroof, wants to be around thirty eight, wife has to sign off, coming Saturday at 2, trading a 2019 Altima");
  return { before, after: store.all("tasks").length + store.all("appointments").length, moves: r.moves.map((x) => x.kind), added: store.all("tasks").filter((t) => !ids.has(t.id)).map((t) => t.title) };
});
console.log("same note again:", JSON.stringify(again));
if (again.added.length) console.log("  added:", JSON.stringify(again.added));
if (again.after !== again.before) fail("running the same note again created more");

// --- New context moves what's already set up rather than adding to it.
const replan = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const m = await import("/js/moves.js");
  const count = () => store.all("tasks").filter((t) => t.leadId === "lead_ann" && !t.done).length + store.all("appointments").filter((a) => a.leadId === "lead_ann" && a.status !== "cancelled").length;
  const before = count();
  const moved = m.nextMoves("lead_ann", "actually she's coming Sunday at 3 instead");
  const appts = store.all("appointments").filter((a) => a.leadId === "lead_ann" && a.status !== "cancelled").map((a) => a.when);
  const confirm = store.all("tasks").find((t) => t.leadId === "lead_ann" && !t.done && t.intent === "confirm");
  const afterMove = count();
  const budget = m.nextMoves("lead_ann", "budget is more like forty two now");
  const budgets = store.all("tasks").filter((t) => t.leadId === "lead_ann" && !t.done && t.kind === "budget");
  const off = m.nextMoves("lead_ann", "she can't make it Sunday, will call to rebook");
  const live = store.all("appointments").filter((a) => a.leadId === "lead_ann" && a.status !== "cancelled").length;
  const confirmGone = !store.all("tasks").find((t) => t.leadId === "lead_ann" && !t.done && t.intent === "confirm");
  const rebook = store.all("tasks").find((t) => t.leadId === "lead_ann" && !t.done && t.kind === "rebook");
  return { before, afterMove, moved: moved.moves.map((x) => x.kind + ": " + x.title + (x.updated ? " (moved)" : "")), appts, confirmTitle: confirm && confirm.title,
    budget: budget.moves.map((x) => x.kind + ": " + x.title + (x.updated ? " (moved)" : "")), budgets: budgets.map((t) => t.title), live, confirmGone, rebook: rebook && rebook.at,
    off: off.moves.map((x) => x.kind + ": " + x.title), stage: store.get("leads", "lead_ann").stage };
});
console.log("moved the visit →", JSON.stringify(replan.moved), "appointments:", JSON.stringify(replan.appts));
console.log("  budget again →", JSON.stringify(replan.budget), "budget tasks:", JSON.stringify(replan.budgets));
console.log("  can't make it →", JSON.stringify(replan.off), "live visits:", replan.live, "rebook at:", replan.rebook, "stage:", replan.stage);
if (replan.appts.length !== 1 || !/T15:00$/.test(replan.appts[0])) fail("the visit wasn't moved to Sunday 3pm (still " + JSON.stringify(replan.appts) + ")");
if (!replan.moved.some((x) => /^appointment: Visit moved to/.test(x))) fail("no move says the visit moved");
if (!/Sep 27, 3:00 PM/.test(replan.confirmTitle || "")) fail("the confirmation text wasn't re-dated: " + replan.confirmTitle);
if (replan.afterMove !== replan.before) fail(`moving the visit changed the count of things set up (${replan.before} → ${replan.afterMove})`);
if (replan.budgets.length !== 1 || !/under Ann's budget/.test(replan.budgets[0])) fail("a second budget note made a second budget task: " + JSON.stringify(replan.budgets));
if (replan.live !== 0) fail("can't make it didn't cancel the visit");
if (!replan.confirmGone) fail("the confirmation text survived the cancellation");
if (!replan.rebook) fail("no rebook task with a time");
if (replan.stage !== "working") fail(`after the cancellation the stage is ${replan.stage}, not working`);

// --- Hesitation, a payment target, and a far-off timeline.
const bob = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const m = await import("/js/moves.js");
  const r = m.nextMoves("lead_bob", "thinks the Kicks is too expensive, went to look at a Honda, 450 a month tops, needs financing, lease is up in March");
  const l = store.get("leads", "lead_bob");
  return { moves: r.moves.map((x) => x.kind + ": " + x.title), followUp: l.followUp,
    tasks: store.all("tasks").filter((t) => t.leadId === "lead_bob" && !t.done).map((t) => ({ title: t.title, due: t.due, intent: t.intent })) };
});
console.log("bob →", JSON.stringify(bob.moves), "follow-up:", bob.followUp);
if (!bob.moves.some((x) => /^objection: Prepare a second option/.test(x))) fail("the objection wasn't picked up");
if (!bob.moves.some((x) => /^text: Options text, two days out/.test(x))) fail("no options text two days out");
if (!bob.moves.some((x) => /^budget: \d+ fit their payment target/.test(x))) fail("the payment target wasn't run against the deals");
if (!bob.moves.some((x) => /^finance: /.test(x))) fail("financing wasn't picked up");
if (!bob.moves.some((x) => /^later: Check back/.test(x))) fail("the March timeline didn't date a check-back");
if (!/^2027-02-2/.test(bob.followUp || "")) fail(`follow-up is ${bob.followUp}, not a few days before March`);

// --- The one that came back empty: a past customer, a voicemail, a day
// without a time, a trim without a model.
const dee = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const m = await import("/js/moves.js");
  const r = m.nextMoves("lead_dee", "left a voicemail, wants to come saturday to look at an SV");
  const l = store.get("leads", "lead_dee");
  return { moves: r.moves.map((x) => x.kind + ": " + x.title), stage: l.stage,
    tasks: store.all("tasks").filter((t) => t.leadId === "lead_dee" && !t.done).map((t) => ({ title: t.title, due: t.due, intent: t.intent, cadence: !!t.cadence })),
    appts: store.all("appointments").filter((a) => a.leadId === "lead_dee").length };
});
console.log("dee →", JSON.stringify(dee.moves), "stage:", dee.stage);
if (dee.stage !== "working") fail(`a sold customer who wants to come in is still ${dee.stage}`);
if (!dee.moves.some((x) => /^stage: Back in the market/.test(x))) fail("no move says they're back in the market");
if (!dee.moves.some((x) => /^text: .Tried you. text/.test(x))) fail("the voicemail didn't draft a tried-you text");
if (!dee.moves.some((x) => /^task: Call again /.test(x))) fail("the voicemail didn't set a call for tomorrow");
if (!dee.moves.some((x) => /^task: Pin down a time for Saturday/.test(x))) fail("Saturday without a time didn't become a time to pin down");
if (dee.appts !== 0) fail("a day without a time was booked as an appointment");
if (!dee.moves.some((x) => /^task: No SV in stock — locate one/.test(x))) fail("the SV with no model on file wasn't taken as a vehicle to find");
if (!dee.moves.some((x) => /^plan: \d+-step follow-up plan started/.test(x))) fail("the plan didn't start for a customer back in the market");
if (!dee.tasks.some((t) => t.intent === "missed" && t.cadence)) fail("the tried-you text isn't a drafted plan step");

// --- "Call me Saturday" is a call, not a visit.
const eve = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const m = await import("/js/moves.js");
  const r = m.nextMoves("lead_eve", "said to call her back Saturday morning");
  return { moves: r.moves.map((x) => x.kind + ": " + x.title), appts: store.all("appointments").filter((a) => a.leadId === "lead_eve").length,
    call: store.all("tasks").find((t) => t.leadId === "lead_eve" && /^Call Eve — they asked for/.test(t.title))?.due };
});
console.log("eve →", JSON.stringify(eve.moves), "call due:", eve.call);
if (eve.appts !== 0) fail("a callback was booked as a visit");
if (!eve.moves.some((x) => /^task: Call them (Saturday|Sep 26)/.test(x))) fail("the callback wasn't put on the list for Saturday");
if (!/^\d{4}-\d{2}-\d{2}$/.test(eve.call || "")) fail("the callback task isn't dated");

// --- With no inventory loaded at all, the vehicle move is to go and check.
const bare = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const m = await import("/js/moves.js");
  const saved = store.all("vehicles").map((v) => ({ ...v }));
  saved.forEach((v) => store.remove("vehicles", v.id));
  const r = m.nextMoves("lead_eve", "she's after a Rogue SV with the moonroof");
  saved.forEach((v) => store.restore("vehicles", v));
  return r.moves.map((x) => x.kind + ": " + x.title);
});
console.log("no inventory →", JSON.stringify(bare));
if (!bare.some((x) => /^stock: Check stock for a Rogue SV/.test(x))) fail("with no inventory loaded, the move should be to check stock");

// --- Nothing in particular: the plan, and its next text from the note.
const cy = await p.evaluate(async () => {
  const m = await import("/js/moves.js");
  return m.nextMoves("lead_cy", "nice guy, works at the shipyard").moves.map((x) => x.kind + ": " + x.title);
});
console.log("plain note →", JSON.stringify(cy));
if (cy.length !== 1 || !/^plan: \d+-step follow-up plan started/.test(cy[0])) fail("a plain note should start the plan and nothing else");
const cy2 = await p.evaluate(async () => (await import("/js/moves.js")).nextMoves("lead_cy", "has a dog").moves.map((x) => x.kind + ": " + x.title));
console.log("second plain note →", JSON.stringify(cy2));
if (cy2.length !== 1 || !/^plan: Next: /.test(cy2[0])) fail("a second plain note should point at the plan's next text");

// --- On the page: Add context, the moves come back where the panel was,
// Undo takes one back, and the Next moves card lists the rest.
await p.evaluate(() => { location.hash = "#/leads/lead_cy"; });
await p.waitForTimeout(400);
await p.click('[data-act="add-context"]');
await p.waitForTimeout(900);
await p.fill(".note-panel textarea", "coming tomorrow at 10, brother is looking too");
await p.click('.note-panel [data-act="save"]');
await p.waitForTimeout(400);
const shown = await p.evaluate(() => {
  const box = document.querySelector(".moves");
  return box ? { lines: [...box.querySelectorAll(".move-t")].map((n) => n.textContent), undo: box.querySelectorAll('[data-act="undo"]').length, review: !!box.querySelector('[data-act="home"]') } : null;
});
console.log("on the page:", JSON.stringify(shown));
if (!shown) fail("the moves didn't show where the panel was");
else {
  if (!shown.lines.some((x) => /^Booked Cy for/.test(x))) fail("the page's note didn't book the visit");
  if (!shown.lines.some((x) => /brother's number/.test(x))) fail("the referral wasn't picked up");
  if (!shown.review) fail("no way to review the drafted text");
}
// Undo the referral task.
const undone = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const row = [...document.querySelectorAll(".move")].find((r) => /brother/.test(r.textContent));
  row.querySelector('[data-act="undo"]').click();
  return { struck: row.classList.contains("move-undone"), left: store.all("tasks").filter((t) => t.leadId === "lead_cy" && /brother/.test(t.title)).length };
});
console.log("undo the referral:", JSON.stringify(undone));
if (!undone.struck || undone.left !== 0) fail("Undo didn't take the task back");
await p.click('.moves [data-act="ok"]');
await p.waitForTimeout(500);
const card = await p.evaluate(() => {
  const title = [...document.querySelectorAll(".section-title")].find((t) => /^Next moves/.test(t.textContent));
  const slot = document.getElementById("moves-slot");
  return { present: !!title, items: slot ? [...slot.querySelectorAll(".check-item, .task, [data-id]")].length : 0, text: slot ? slot.textContent.replace(/\s+/g, " ").trim().slice(0, 200) : "" };
});
console.log("Next moves card:", JSON.stringify(card));
if (!card.present) fail("no Next moves section on the page");
if (!/confirm/i.test(card.text)) fail("the Next moves card doesn't list the confirmation step");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nmoves.test.js FAILED" : "\nmoves.test.js passed");
})();
