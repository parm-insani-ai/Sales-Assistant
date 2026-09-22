// Slide a customer left on Leads: Contacted sits beside Delete. Tap it and
// the same tray becomes the question — Call, Text, Email. Tap one and the
// contact is logged as of that moment: on their card, on their page, on
// their thread, with Undo. Nothing opens over the list; nothing takes focus.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
await fetch(APP + "/__reset"); // the stub cloud keeps rows between runs
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

const slide = async (name) => {
  const card = p.locator(".swipe-card", { hasText: name }).first();
  const box = await card.boundingBox();
  const y = box.y + box.height / 2;
  await p.mouse.move(box.x + box.width - 30, y);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width - 120, y, { steps: 6 });
  await p.mouse.move(box.x + box.width - 260, y, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(350);
};
const trayOf = (name) => p.evaluate((name) => {
  const wrap = [...document.querySelectorAll(".swipe-wrap")].find((w) => w.textContent.includes(name));
  const r = wrap.getBoundingClientRect();
  return {
    buttons: [...wrap.querySelectorAll(".swipe-act")].map((b) => {
      const bb = b.getBoundingClientRect();
      return { label: b.textContent.trim(), ok: b.classList.contains("swipe-act-ok"), del: b.classList.contains("swipe-del"),
        onScreen: bb.width > 0 && bb.left >= r.left && bb.right <= r.right + 1 };
    }),
    shift: getComputedStyle(wrap.querySelector(".swipe-card")).transform,
    hash: location.hash,
    focused: /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "") ? document.activeElement.tagName : "nothing",
    sheet: !!document.querySelector(".modal"),
  };
}, name);

// --- Slide Ann's card: Contacted and Delete.
await slide("Ann Example");
let t = await trayOf("Ann Example");
console.log("after the slide:", JSON.stringify(t));
if (!/#\/leads$/.test(t.hash)) fail("the slide opened the customer instead of revealing the buttons");
if (t.buttons.map((x) => x.label).join() !== "Contacted,Delete") fail(`behind the card: ${t.buttons.map((x) => x.label).join()} — wanted Contacted, Delete`);
if (!t.buttons[0].ok || !t.buttons[1].del) fail("the buttons aren't coloured as the OK one and the delete one");
if (!t.buttons.every((x) => x.onScreen)) fail("a button is off the card's edge");
if (!/-184/.test(t.shift)) fail(`the card slid ${t.shift}, not the width of two buttons`);

// --- Tap Contacted: the tray becomes Call / Text / Email. No sheet, no focus.
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act-ok");
await p.waitForTimeout(350);
t = await trayOf("Ann Example");
console.log("after Contacted:", JSON.stringify(t));
if (t.buttons.map((x) => x.label).join() !== "Call,Text,Email") fail(`the tray shows ${t.buttons.map((x) => x.label).join()}, not Call, Text, Email`);
if (!t.buttons.every((x) => x.onScreen)) fail("a way is off the card's edge");
if (!/-276/.test(t.shift)) fail(`the card slid ${t.shift}, not the width of three buttons`);
if (t.sheet) fail("a sheet opened — the whole point is that nothing does");
if (t.focused !== "nothing") fail(`something took focus: ${t.focused}`);

// --- Tap Text.
const before = Date.now();
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act:has-text('Text')");
await p.waitForTimeout(400);
const logged = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const sms = await import("/js/sms.js");
  const l = store.get("leads", "lead_ann");
  const wrap = [...document.querySelectorAll(".swipe-wrap")].find((w) => w.textContent.includes("Ann Example"));
  return { lastContacted: l.lastContacted, via: l.lastContactVia,
    calls: store.callsFor("lead_ann").map((c) => ({ via: c.via, at: c.at, logged: c.logged })),
    timeline: sms.timelineFor("lead_ann").map((i) => i.type),
    card: wrap.querySelector(".row-contact")?.textContent.trim() || "",
    shift: getComputedStyle(wrap.querySelector(".swipe-card")).transform,
    tray: [...wrap.querySelectorAll(".swipe-act")].map((b) => b.textContent.trim()).join(),
    toast: document.querySelector(".toast-undo")?.textContent || "" };
});
console.log("after Text:", JSON.stringify(logged));
if (logged.via !== "text") fail(`the customer's last contact is ${JSON.stringify(logged.via)}, not text`);
const at = new Date(logged.lastContacted || 0).getTime();
if (Math.abs(at - before) > 5000) fail(`the logged time (${logged.lastContacted}) isn't the moment of the tap`);
if (logged.calls.length !== 1 || logged.calls[0].via !== "text" || !logged.calls[0].logged) fail("the contact record is wrong: " + JSON.stringify(logged.calls));
if (!logged.timeline.includes("call")) fail("the contact isn't on the timeline");
if (!/^Texted /.test(logged.card)) fail(`the card doesn't show the contact: ${JSON.stringify(logged.card)}`);
// One more step in the same tray: a note, or done.
if (logged.tray !== "Note,Done") fail(`after logging the tray shows ${logged.tray}, not Note, Done`);
if (!/-184/.test(logged.shift)) fail("the card isn't showing the Note / Done step");
if (!/Texted Ann Example/.test(logged.toast) || !/Undo/.test(logged.toast)) fail(`no undo toast (${JSON.stringify(logged.toast)})`);
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act:has-text('Done')");
await p.waitForTimeout(350);
const done = await p.evaluate(() => {
  const wrap = [...document.querySelectorAll(".swipe-wrap")].find((w) => w.textContent.includes("Ann Example"));
  return { shift: getComputedStyle(wrap.querySelector(".swipe-card")).transform, tray: [...wrap.querySelectorAll(".swipe-act")].map((b) => b.textContent.trim()).join() };
});
console.log("after Done:", JSON.stringify(done));
if (done.shift !== "none" || done.tray !== "Contacted,Delete") fail("Done didn't close the row and put the first tray back");

// --- Undo takes it back.
await p.click(".toast-undo button");
await p.waitForTimeout(300);
const undone = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const l = store.get("leads", "lead_ann");
  const wrap = [...document.querySelectorAll(".swipe-wrap")].find((w) => w.textContent.includes("Ann Example"));
  return { lastContacted: l.lastContacted || null, calls: store.callsFor("lead_ann").length, card: wrap.querySelector(".row-contact")?.textContent || "" };
});
console.log("after Undo:", JSON.stringify(undone));
if (undone.lastContacted || undone.calls !== 0 || undone.card) fail("Undo didn't take the contact back");

// --- Log it again, then a tap on the card while the ways are showing cancels.
await slide("Ann Example");
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act-ok");
await p.waitForTimeout(300);
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-card");
await p.waitForTimeout(350);
t = await trayOf("Ann Example");
console.log("tapped the card instead:", JSON.stringify({ shift: t.shift, buttons: t.buttons.map((x) => x.label).join(), hash: t.hash }));
if (t.shift !== "none" || t.buttons.map((x) => x.label).join() !== "Contacted,Delete") fail("tapping the card didn't cancel back to the first tray");
if (!/#\/leads$/.test(t.hash)) fail("cancelling opened the customer");
const stillNone = await p.evaluate(async () => (await import("/js/store.js")).callsFor("lead_ann").length);
if (stillNone !== 0) fail("cancelling logged something");

// --- Log a call, then say what happened. No microphone here, so the panel
// falls back to typing — the same panel, the same Save.
await slide("Ann Example");
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act-ok");
await p.waitForTimeout(300);
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act:has-text('Call')");
await p.waitForTimeout(300);
await p.click(".swipe-wrap:has-text('Ann Example') .swipe-act:has-text('Note')");
await p.waitForTimeout(900);
const panel = await p.evaluate(() => {
  const wrap = [...document.querySelectorAll(".swipe-wrap")].find((w) => w.textContent.includes("Ann Example"));
  const pn = wrap.querySelector(".note-panel");
  return pn ? { status: pn.querySelector(".note-status").textContent.trim(), box: !!pn.querySelector("textarea"), save: !!pn.querySelector('[data-act="save"]'),
    shift: getComputedStyle(wrap.querySelector(".swipe-card")).transform, sheet: !!document.querySelector(".modal") } : null;
});
console.log("note panel:", JSON.stringify(panel));
if (!panel) fail("tapping Note didn't open the note panel in the card");
else {
  if (!panel.box || !panel.save) fail("the panel has no box or no Save");
  if (panel.shift !== "none") fail("the row didn't close for the panel");
  if (panel.sheet) fail("a sheet opened");
}
await p.fill(".note-panel textarea", "Wants to come Saturday, wife has to sign off");
// The card behind the panel must not open the customer when the box is tapped.
await p.click(".note-panel textarea");
await p.waitForTimeout(150);
if (!/#\/leads$/.test(await p.evaluate(() => location.hash))) fail("tapping inside the panel opened the customer");
await p.click('.note-panel [data-act="save"]');
await p.waitForTimeout(400);
const noted = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const l = store.get("leads", "lead_ann");
  const wrap = [...document.querySelectorAll(".swipe-wrap")].find((w) => w.textContent.includes("Ann Example"));
  return { notes: l.notes || "", call: store.callsFor("lead_ann").map((c) => c.notes).join("|"), panelGone: !wrap.querySelector(".note-panel"),
    card: wrap.querySelector(".row-contact")?.textContent.trim() || "", toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join("|") };
});
console.log("after Save:", JSON.stringify(noted));
if (!/Wants to come Saturday/.test(noted.notes)) fail("the note isn't on the customer's profile");
if (!/^\d{4}-\d{2}-\d{2} — Wants/.test(noted.notes)) fail("the note isn't dated");
if (!/Wants to come Saturday/.test(noted.call)) fail("the note isn't on the contact record");
if (!noted.panelGone) fail("the panel stayed up after saving");
if (!/^Called /.test(noted.card)) fail("the card didn't come back showing the call");
if (!/Noted/.test(noted.toast)) fail("no confirmation");

// --- Their page: the row shows it and logs another, inline.
await p.evaluate(() => { location.hash = "#/leads/lead_ann"; });
await p.waitForTimeout(400);
const row = () => p.evaluate(() => {
  const kv = [...document.querySelectorAll(".kv")].find((k) => /Last contacted/.test(k.textContent));
  return { value: kv ? kv.querySelector(".v").textContent.trim() : null, ways: [...document.querySelectorAll(".contact-ways [data-via]")].map((b) => b.dataset.via).join(), sheet: !!document.querySelector(".modal") };
});
// Context comes first: under the name, on the first screen, before Why now.
const first = await p.evaluate(() => {
  const titles = [...document.querySelectorAll(".section-title")].map((t) => t.textContent.trim().split(" ")[0]);
  const ctx = [...document.querySelectorAll(".section-title")].find((t) => /^Context/.test(t.textContent));
  return { titles: titles.slice(0, 3), top: ctx ? Math.round(ctx.getBoundingClientRect().top) : null, addBtn: !!document.querySelector('[data-act="add-context"]') };
});
console.log("page order:", JSON.stringify(first));
if (first.titles[0] !== "Context") fail(`the first section is ${first.titles[0]}, not Context`);
if (first.top == null || first.top > 400) fail(`Context sits ${first.top}px down — it should be visible without scrolling`);
// Add context is the same listening panel; saving adds a dated note.
await p.click('[data-act="add-context"]');
await p.waitForTimeout(900);
const addPanel = await p.evaluate(() => !!document.querySelector(".note-panel textarea") && !document.querySelector(".modal"));
if (!addPanel) fail("Add context didn't show the note panel inline");
await p.fill(".note-panel textarea", "Loves the SV moonroof");
await p.click('.note-panel [data-act="save"]');
await p.waitForTimeout(500);
const added = await p.evaluate(async () => {
  const store = await import("/js/store.js");
  const card = [...document.querySelectorAll(".section-title")].find((t) => /^Context/.test(t.textContent))?.nextElementSibling;
  return { notes: store.get("leads", "lead_ann").notes || "", shown: card ? card.textContent : "", plan: store.all("tasks").filter((t) => t.leadId === "lead_ann" && t.cadence && !t.done).length };
});
console.log("after Add context:", JSON.stringify({ notes: added.notes.split("\n").length + " lines", shown: /moonroof/.test(added.shown), plan: added.plan }));
if (!/Loves the SV moonroof/.test(added.notes)) fail("the note wasn't added to the profile");
if (!/moonroof/.test(added.shown)) fail("the Context card doesn't show the new note");
if (!added.plan) fail("adding context didn't start the follow-up plan for a new customer");
let r = await row();
console.log("on their page:", JSON.stringify(r));
if (!r.value || !/call/.test(r.value) || /Tap to log/.test(r.value)) fail("the page doesn't show the last contact");
await p.click('.kv[data-act="contacted"]');
await p.waitForTimeout(200);
r = await row();
console.log("row tapped:", JSON.stringify(r));
if (r.ways !== "call,text,email") fail("tapping the row didn't show the three ways under it");
if (r.sheet) fail("the row opened a sheet");
await p.click('.contact-ways [data-via="email"]');
await p.waitForTimeout(900);
const pagePanel = await p.evaluate(() => !!document.querySelector(".note-panel textarea"));
console.log("page shows the note panel after Email:", pagePanel);
if (!pagePanel) fail("the page didn't offer a note after logging");
await p.fill(".note-panel textarea", "Sent the brochure");
await p.click('.note-panel [data-act="save"]');
await p.waitForTimeout(400);
r = await row();
const n = await p.evaluate(async () => (await import("/js/store.js")).callsFor("lead_ann").length);
console.log("after Email + note from the page:", JSON.stringify({ ...r, records: n }));
if (!/email/.test(r.value || "")) fail("the page didn't update to the new contact");
if (n !== 2) fail(`${n} contact records — wanted 2`);

// --- The thread reads them as events.
await p.evaluate(() => { location.hash = "#/inbox/lead_ann"; });
await p.waitForTimeout(400);
const thread = await p.evaluate(() => [...document.querySelectorAll(".chat-event")].map((e) => e.textContent.trim()));
console.log("thread events:", JSON.stringify(thread));
if (!thread.some((x) => /You called them \(logged\)/.test(x) && /Wants to come Saturday/.test(x))) fail("the logged call isn't on the thread with its note");
if (!thread.some((x) => /You emailed them \(logged\)/.test(x) && /Sent the brochure/.test(x))) fail("the logged email isn't on the thread with its note");

// --- Delete behind the same slide still works.
await p.evaluate(() => { location.hash = "#/leads"; });
await p.waitForTimeout(500);
await slide("Bob Example");
await p.click(".swipe-wrap:has-text('Bob Example') .swipe-del");
await p.waitForTimeout(300);
const gone = await p.evaluate(async () => !(await import("/js/store.js")).get("leads", "lead_bob"));
console.log("delete still works:", gone);
if (!gone) fail("Delete behind the slide stopped working");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncontacted.test.js FAILED" : "\ncontacted.test.js passed");
})();
