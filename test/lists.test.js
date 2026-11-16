// The salesperson's own lists: named buckets customers are put on by hand.
// On Outreach each is a chip with its count and the bar is the list's; a
// whole cut goes on a list from the bar; a customer goes on from their
// page and from the session's "How did it go?"; the card says which lists
// they're on; the assistant adds, removes and shows by name.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", importedAt: "2026-01-01T00:00:00.000Z", stage: "delivered", source: "Import" };
  const models = ["2019 Nissan Rogue SV", "2018 Nissan Murano SL", "2020 Nissan Sentra S", "2021 Nissan Kicks SR"];
  const leads = [];
  for (let i = 0; i < 8; i++) leads.push({ id: "o" + i, name: `Owner ${String(i).padStart(2, "0")} Example`, phone: "90255" + String(10000 + i), vehicleInterest: models[i % 4],
    currentPayment: 380 + i * 5, payoff: 12000 + i * 100, currentValue: 20000 + i * 100, currentApr: i % 3 === 0 ? 11.9 : 5.9, purchaseDate: "2021-03-10", ...x });
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads, vehicles: [{ id: "v1", year: 2026, make: "Nissan", model: "Rogue", trim: "SV", price: 38900, stock: "N1", condition: "new", ...x }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan", cloudAutoSync: false, dailyProspects: 6, taxRate: 14, docFee: 699, defaultApr: 7.9, defaultTerm: 72, dealMatchBand: 150 } }));
});
await p.goto(APP + "/#/leads");
await p.waitForSelector(".cut-row", { timeout: 30000 }).catch(() => fail("Outreach didn't open"));
await p.waitForTimeout(500);

const read = () => p.evaluate(() => ({
  chips: [...document.querySelectorAll(".cut-row .cut-chip")].map((c) => ({ key: c.dataset.cut || c.dataset.list || c.dataset.act, text: c.textContent.replace(/\s+/g, " ").trim(), on: c.classList.contains("btn-primary"), kind: [...c.classList].find((k) => /^cut-(list|new|vehicle|reason|query|more)$/.test(k)) })),
  bar: document.querySelector(".cut-bar")?.textContent.replace(/\s+/g, " ").trim() || "",
  acts: [...document.querySelectorAll(".cut-bar [data-act]")].map((n) => n.dataset.act),
  cards: [...document.querySelectorAll(".lead-list .card[data-lead-id]")].map((c) => ({ id: c.dataset.leadId, lists: [...c.querySelectorAll(".badge-list")].map((n) => n.textContent.trim()) })),
}));

// --- The row offers a new list; with none yet there is no list chip.
let c = await read();
if (!c.chips.some((x) => x.kind === "cut-new")) fail("the row should offer + List: " + JSON.stringify(c.chips.map((x) => x.text)));
if (c.chips.some((x) => x.kind === "cut-list")) fail("no lists yet, no list chip");

// --- A list made from the module (what the picker and the assistant call), two on it.
await p.evaluate(async () => { const L = await import("/js/lists.js"); const x = L.createList("Callbacks"); L.addToList(x.id, ["o1", "o2"]); });
await p.evaluate(() => { location.hash = "#/inventory"; }); await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = "#/leads"; }); await p.waitForTimeout(600);
await p.click('[data-filter="all"]'); await p.waitForTimeout(400);
c = await read();
const cb = c.chips.find((x) => x.kind === "cut-list" && /Callbacks/.test(x.text));
console.log("chip:", JSON.stringify(cb));
if (!cb || !/^Callbacks 2$/.test(cb.text) || !/^members:/.test(cb.key || "")) fail("the list is a chip with its count: " + JSON.stringify(c.chips));
// On: the two, the bar is the list's (delete, no add-to-list), the cards carry the tag.
await p.click(`.cut-row [data-cut="${cb.key}"]`); await p.waitForTimeout(500);
c = await read();
console.log("on:", JSON.stringify({ bar: c.bar, acts: c.acts, cards: c.cards }));
if (c.cards.length !== 2 || !c.cards.every((x) => ["o1", "o2"].includes(x.id))) fail("the list on shows its two: " + JSON.stringify(c.cards));
if (!/^2 on Callbacks/.test(c.bar) || !c.acts.includes("list-delete") || c.acts.includes("cut-addlist") || c.acts.includes("list-save")) fail("the bar is the list's: " + JSON.stringify({ bar: c.bar, acts: c.acts }));
if (!c.cards.every((x) => x.lists.includes("Callbacks"))) fail("each card says the list it's on: " + JSON.stringify(c.cards));

// --- A reason cut on instead: the bar offers putting the whole cut on a list; a new list made right there takes them all.
await p.click('.cut-bar [data-act="aud-clear"]'); await p.waitForTimeout(400);
// Whichever reason or vehicle chip the book offers first.
const anyCut = await p.evaluate(() => [...document.querySelectorAll('.cut-row [data-cut]')].map((x) => x.dataset.cut).find((k) => !/^members:/.test(k)));
if (!anyCut) fail("the row should offer a cut to put on a list");
await p.click(`.cut-row [data-cut="${anyCut}"]`); await p.waitForTimeout(500);
c = await read();
const rateN = Number((c.bar.match(/^(\d+) match/) || [])[1]);
if (!c.acts.includes("cut-addlist") || !rateN) fail("a cut's bar offers Put on a list: " + JSON.stringify({ bar: c.bar, acts: c.acts }));
await p.click('.cut-bar [data-act="cut-addlist"]'); await p.waitForSelector(".modal .list-pick", { timeout: 5000 });
const pick = await p.evaluate(() => ({ rows: [...document.querySelectorAll(".modal .list-pick input[data-list]")].length, checked: [...document.querySelectorAll(".modal .list-pick input[data-list]:checked")].length }));
if (pick.rows !== 1 || pick.checked !== 0) fail("the picker lists Callbacks, unticked (not all of these are on it): " + JSON.stringify(pick));
await p.fill('.modal .list-pick input[name="name"]', "Interested, no appointment");
await p.click('.modal .list-pick-new button[type="submit"]'); await p.waitForTimeout(400);
const made = await p.evaluate(async () => { const L = await import("/js/lists.js"); const x = L.listByName("Interested, no appointment"); return x ? x.ids.length : -1; });
if (made !== rateN) fail(`the new list took the whole cut (${rateN}): ` + made);
await p.click(".modal .modal-close"); await p.waitForTimeout(400);
c = await read();
const intChip = c.chips.find((x) => x.kind === "cut-list" && /Interested/.test(x.text));
if (!intChip || !new RegExp(`Interested, no appointment ${rateN}$`).test(intChip.text)) fail("the new list is a chip with its count: " + JSON.stringify(c.chips.filter((x) => x.kind === "cut-list")));

// --- The customer's page: Lists row, the picker ticks them on. (Someone on
// no list yet, and not one the assistant is asked about below.)
const free = await p.evaluate(async () => { const L = await import("/js/lists.js"); const st = await import("/js/store.js"); return st.all("leads").map((l) => l.id).find((id) => !["o1", "o2", "o7"].includes(id) && !L.listsOf(id).length); });
if (!free) fail("someone should be on no list yet");
await p.evaluate((id) => { window.__free = id; }, free);
await p.evaluate((id) => { window.__free = id; location.hash = "#/leads/" + id; }, free); await p.waitForTimeout(600);
let row = await p.evaluate(() => document.querySelector('.lead-head [data-act="lists"] .v')?.textContent.trim());
if (!/Put on a list/.test(row || "")) fail("a customer on no list is offered one: " + row);
await p.click('.lead-head [data-act="lists"]'); await p.waitForSelector(".modal .list-pick", { timeout: 5000 });
await p.evaluate(async () => { const L = await import("/js/lists.js"); const x = L.listByName("Callbacks"); const i = document.querySelector(`.modal .list-pick input[data-list="${x.id}"]`); i.click(); });
await p.waitForTimeout(300);
const onCb = await p.evaluate(async () => { const L = await import("/js/lists.js"); return L.listsOf(window.__free).map((x) => x.name); });
if (!onCb.includes("Callbacks")) fail("ticking the list puts them on it: " + JSON.stringify(onCb));
await p.click(".modal .modal-close"); await p.waitForTimeout(400);
row = await p.evaluate(() => document.querySelector('.lead-head [data-act="lists"] .v')?.textContent.replace(/\s+/g, " ").trim());
if (!/Callbacks/.test(row || "")) fail("the page's row names the list: " + row);

// --- The session: Spoke → "How did it go?" carries the lists as toggles; the one they're on is lit; a tap moves them.
await p.evaluate(async () => { const s = await import("/js/session.js"); s.startSession([window.__free], { name: "test" }); location.hash = "#/session"; });
await p.waitForSelector(".cs-card", { timeout: 10000 }).catch(() => fail("the session didn't open"));
await p.waitForTimeout(300);
await p.click('[data-outcome="reached"]'); await p.waitForSelector(".cs-how .list-toggles", { timeout: 5000 }).catch(() => fail("How did it go? should carry the list toggles"));
let tog = await p.evaluate(() => [...document.querySelectorAll(".cs-how .list-toggle")].map((b) => ({ text: b.textContent.trim(), on: b.getAttribute("aria-pressed") === "true" })));
console.log("toggles:", JSON.stringify(tog));
if (tog.length !== 2 || !tog.find((t) => /Callbacks/.test(t.text) && t.on) || !tog.find((t) => /Interested/.test(t.text) && !t.on)) fail("the toggles: Callbacks lit, Interested not: " + JSON.stringify(tog));
await p.evaluate(() => [...document.querySelectorAll(".cs-how .list-toggle")].find((b) => /Interested/.test(b.textContent)).click()); await p.waitForTimeout(300);
const after = await p.evaluate(async () => { const L = await import("/js/lists.js"); return L.listsOf(window.__free).map((x) => x.name).sort(); });
if (JSON.stringify(after) !== JSON.stringify(["Callbacks", "Interested, no appointment"])) fail("a tap puts them on the other list too: " + JSON.stringify(after));
await p.evaluate(async () => { (await import("/js/session.js")).endSession(); });

// --- The assistant: add by name, list the lists, show one on Outreach, take one off.
const tool = await p.evaluate(async () => {
  const m = await import("/js/agent.js");
  const add = (await m.execTool("customer_list", { action: "add", list: "Callbacks", customers: ["Owner 07 Example", "Nobody Here"] })).result;
  const all = (await m.execTool("customer_list", { action: "lists" })).result;
  const off = (await m.execTool("customer_list", { action: "remove", list: "Callbacks", customers: ["Owner 01 Example"] })).result;
  const show = (await m.execTool("customer_list", { action: "show", list: "callbacks" })).result;
  return { add, all, off, show, hash: location.hash };
});
console.log("tool:", JSON.stringify(tool));
if (!tool.add || tool.add.added !== 1 || tool.add.onList !== 4 || !tool.add.notFound.includes("Nobody Here")) fail("add by name: " + JSON.stringify(tool.add));
if (!tool.all || tool.all.lists.length !== 2) fail("the lists: " + JSON.stringify(tool.all));
if (!tool.off || tool.off.removed !== 1 || tool.off.onList !== 3) fail("remove by name: " + JSON.stringify(tool.off));
if (!tool.show || tool.show.count !== 3 || tool.hash !== "#/leads") fail("show opens Outreach on the list: " + JSON.stringify({ show: tool.show, hash: tool.hash }));
await p.waitForTimeout(700);
c = await read();
if (!c.chips.find((x) => x.kind === "cut-list" && /Callbacks 3/.test(x.text) && x.on) || c.cards.length !== 3) fail("Outreach opened on the list, lit, its three showing: " + JSON.stringify({ chips: c.chips.filter((x) => x.kind === "cut-list"), n: c.cards.length }));

// --- Delete from the bar: the list goes, the customers stay.
await p.click('.cut-bar [data-act="list-delete"]'); await p.waitForTimeout(300);
await p.evaluate(() => { const b = [...document.querySelectorAll(".modal button")].find((x) => /^Delete$/.test(x.textContent.trim())); if (b) b.click(); }); await p.waitForTimeout(500);
const left = await p.evaluate(async () => { const L = await import("/js/lists.js"); const st = await import("/js/store.js"); return { lists: L.memberLists().map((x) => x.name), leads: st.all("leads").length }; });
if (left.lists.length !== 1 || left.lists[0] !== "Interested, no appointment" || left.leads !== 8) fail("deleting the list keeps the customers: " + JSON.stringify(left));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nlists.test.js FAILED" : "\nlists.test.js passed");
})();
