// Slide a customer left on Leads and there's a second button beside Delete:
// Contacted. Tap it, say whether it was a call, a text or an email, and the
// contact is on their timeline with the date and time — and their card,
// their page and their thread all know about it.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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
      { id: "lead_ann", name: "Ann Example", phone: "9025550111", stage: "new", vehicleInterest: "Rogue SV", createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" },
      { id: "lead_bob", name: "Bob Example", phone: "9025550112", stage: "new", createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" },
    ],
    settings: { salesperson: "Parm", cloudAutoSync: false, supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k" } }));
});
await p.goto(APP + "/#/leads");
await p.waitForTimeout(700);

// --- Slide Ann's card left.
const card = p.locator(".swipe-card", { hasText: "Ann Example" }).first();
const box = await card.boundingBox();
if (!box) { fail("Ann's card isn't on the Leads page"); await b.close(); return; }
const y = box.y + box.height / 2;
await p.mouse.move(box.x + box.width - 30, y);
await p.mouse.down();
await p.mouse.move(box.x + box.width - 120, y, { steps: 6 });
await p.mouse.move(box.x + box.width - 260, y, { steps: 10 });
await p.mouse.up();
await p.waitForTimeout(350);

const tray = await p.evaluate(() => {
  const wrap = [...document.querySelectorAll(".swipe-wrap")].find((w) => /Ann Example/.test(w.textContent));
  const btns = [...wrap.querySelectorAll(".swipe-act")].map((b) => ({ label: b.textContent.trim(), ok: b.classList.contains("swipe-act-ok"), del: b.classList.contains("swipe-del"),
    visible: b.getBoundingClientRect().right <= window.innerWidth && b.getBoundingClientRect().width > 0 }));
  const shift = getComputedStyle(wrap.querySelector(".swipe-card")).transform;
  return { btns, shift, stillOnLeads: /#\/leads$/.test(location.hash) };
});
console.log("after the slide:", JSON.stringify(tray));
if (!tray.stillOnLeads) fail("the slide opened the customer instead of revealing the buttons");
if (tray.btns.length !== 2) fail(`${tray.btns.length} buttons behind the card — wanted Contacted and Delete`);
if (!tray.btns.some((x) => x.label === "Contacted" && x.ok)) fail("no Contacted button");
if (!tray.btns.some((x) => x.label === "Delete" && x.del)) fail("the Delete button is gone");
if (tray.shift === "none") fail("the card didn't slide");

// --- Tap Contacted: the sheet asks how.
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act-ok");
await p.waitForTimeout(250);
const sheet = await p.evaluate(() => {
  const m = document.querySelector(".modal");
  return m ? { title: m.querySelector("h2").textContent, ways: [...m.querySelectorAll("[data-via]")].map((b) => b.dataset.via),
    when: m.querySelector('[data-f="at"]')?.value || "", whenHidden: m.querySelector("[data-when]")?.hidden, notes: !!m.querySelector('[data-f="notes"]'),
    focused: /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "") ? document.activeElement.tagName + ":" + (document.activeElement.type || "") : "nothing" } : null;
});
console.log("the sheet:", JSON.stringify(sheet));
if (!sheet) fail("tapping Contacted opened nothing");
else {
  if (!/Ann/.test(sheet.title)) fail("the sheet doesn't say who");
  if (sheet.ways.join() !== "call,text,email") fail(`the ways are ${sheet.ways.join()}, not call, text, email`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(sheet.when)) fail("the time isn't filled in with now");
  if (!sheet.whenHidden) fail("the time picker is showing before anyone asked for it");
  // On a phone, a focused date field opens the system picker over the sheet
  // and the three buttons can't be tapped. Nothing may take focus here.
  if (sheet.focused !== "nothing") fail(`something took focus when the sheet opened: ${sheet.focused}`);
}
// The time is there when asked for.
await p.click('.modal [data-act="change-when"]');
await p.waitForTimeout(100);
const whenShown = await p.evaluate(() => ({ shown: !document.querySelector(".modal [data-when]").hidden, focused: document.activeElement?.type || "" }));
console.log("after 'Change the time':", JSON.stringify(whenShown));
if (!whenShown.shown) fail("'Change the time' didn't reveal the picker");
if (whenShown.focused !== "datetime-local") fail("the picker wasn't focused once asked for");

// --- "Text", with a note.
await p.fill('.modal [data-f="notes"]', "Wants to come Saturday");
const before = Date.now();
await p.click('.modal [data-via="text"]');
await p.waitForTimeout(300);
const logged = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const sms = await import("/js/sms.js");
  const l = store.get("leads", "lead_ann");
  const calls = store.callsFor("lead_ann");
  const tl = sms.timelineFor("lead_ann");
  return { lastContacted: l.lastContacted, via: l.lastContactVia, calls: calls.map((c) => ({ via: c.via, at: c.at, notes: c.notes, logged: c.logged })),
    timeline: tl.map((i) => i.type), modalGone: !document.querySelector(".modal"),
    toast: document.querySelector(".toast")?.textContent || "",
    cardChip: [...document.querySelectorAll(".swipe-wrap")].find((w) => /Ann Example/.test(w.textContent))?.textContent || "" };
});
console.log("logged:", JSON.stringify({ via: logged.via, lastContacted: logged.lastContacted, calls: logged.calls, timeline: logged.timeline, toast: logged.toast }));
if (!logged.modalGone) fail("the sheet stayed open");
if (logged.via !== "text") fail(`the customer's last contact is ${JSON.stringify(logged.via)}, not text`);
const at = new Date(logged.lastContacted || 0).getTime();
if (Math.abs(at - before) > 2 * 60 * 1000) fail(`the logged time (${logged.lastContacted}) isn't now`);
if (logged.calls.length !== 1 || logged.calls[0].via !== "text" || logged.calls[0].notes !== "Wants to come Saturday") fail("the contact record is wrong: " + JSON.stringify(logged.calls));
if (!logged.timeline.includes("call")) fail("the contact isn't on the timeline");
if (!/Texted Ann Example/.test(logged.toast)) fail(`the toast says ${JSON.stringify(logged.toast)}`);
if (/No contact/.test(logged.cardChip)) fail("the card still says no contact after logging one");

// --- Their page shows it, and the row logs another.
await p.evaluate(() => { location.hash = "#/leads/lead_ann"; });
await p.waitForTimeout(400);
const page = await p.evaluate(() => {
  const kv = [...document.querySelectorAll(".kv")].find((k) => /Last contacted/.test(k.textContent));
  return kv ? kv.querySelector(".v").textContent.trim() : null;
});
console.log("on their page:", JSON.stringify(page));
if (!page || !/text/.test(page) || /Tap to log/.test(page)) fail("the page doesn't show the last contact");
await p.click('.kv[data-act="contacted"]');
await p.waitForTimeout(250);
const rowOpens = await p.evaluate(() => !!document.querySelector('.modal [data-via="call"]'));
if (!rowOpens) fail("tapping the row on their page doesn't open the sheet");
await p.click('.modal [data-via="call"]');
await p.waitForTimeout(300);
const twice = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  return { via: store.get("leads", "lead_ann").lastContactVia, n: store.callsFor("lead_ann").length,
    row: [...document.querySelectorAll(".kv")].find((k) => /Last contacted/.test(k.textContent))?.querySelector(".v").textContent.trim() };
});
console.log("after a second one from the page:", JSON.stringify(twice));
if (twice.via !== "call" || twice.n !== 2) fail("the second contact didn't log");
if (!/call/.test(twice.row || "")) fail("the page didn't refresh to the new contact");

// --- The thread reads it as an event.
await p.evaluate(() => { location.hash = "#/inbox/lead_ann"; });
await p.waitForTimeout(400);
const thread = await p.evaluate(() => [...document.querySelectorAll(".chat-event")].map((e) => e.textContent.trim()));
console.log("thread events:", JSON.stringify(thread));
if (!thread.some((t) => /You texted them \(logged\)/.test(t) && /Wants to come Saturday/.test(t))) fail("the logged text isn't on the thread with its note");
if (!thread.some((t) => /You called them \(logged\)/.test(t))) fail("the logged call isn't on the thread");

// --- Delete behind the same slide still works.
await p.evaluate(() => { location.hash = "#/leads"; });
await p.waitForTimeout(500);
const bob = p.locator(".swipe-card", { hasText: "Bob Example" }).first();
const bb = await bob.boundingBox();
await p.mouse.move(bb.x + bb.width - 30, bb.y + bb.height / 2);
await p.mouse.down();
await p.mouse.move(bb.x + bb.width - 260, bb.y + bb.height / 2, { steps: 12 });
await p.mouse.up();
await p.waitForTimeout(350);
await p.click(".swipe-wrap:has-text('Bob Example') .swipe-del");
await p.waitForTimeout(300);
const gone = await p.evaluate(async () => { const store = await import("/js/store.js"); return !store.get("leads", "lead_bob"); });
console.log("delete still works:", gone);
if (!gone) fail("Delete behind the slide stopped working");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncontacted.test.js FAILED" : "\ncontacted.test.js passed");
})();
