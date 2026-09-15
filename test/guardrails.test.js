// Three fixes from the honest read of the app:
//
//   The numbers hole. The new drafters never state a figure; the old offer
//   text and the money placeholders in templates still did. One standard now.
//
//   The feedback loop. Every opener is logged with why it was sent, and the
//   replies, bookings and sales that follow are read back on Coach.
//
//   Consent. A text to a past customer needs permission. Each customer has a
//   consent status from what's on file, the app won't draft an opener
//   without it, and it can be recorded by hand.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP = "http://127.0.0.1:8137";
const AGENT = APP + "/functions/v1/voice-agent";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await fetch(APP + "/__reset");
await p.route("**/functions/v1/voice-agent", async (route) => {
  const body = route.request().postDataJSON() || {};
  if (body.sms) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sent: true, sid: "SM1" }) });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "Hi there, it's Jordan. Your Rogue may put you in a better spot to move than you'd think — ten minutes this week?" }], stop_reason: "end_turn" }) });
});
await p.addInitScript((agent) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "j@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [],
    settings: { salesperson: "Jordan Reid", dealership: "O'Regan's Nissan", cloudAutoSync: false, taxRate: 15, defaultApr: 7.9, defaultTerm: 72,
      supabaseUrl: "http://127.0.0.1:8137", supabaseAnonKey: "k", agentUrl: agent, smsFrom: "+19025550123" } }));
}, AGENT);
await p.goto(APP + "/#/settings");
await p.evaluate(async () => { const s = await import("/js/store.js"); await s.ready; });

const MONEY = /\$\s?\d|\d\s?%|\b\d{1,3},\d{3}\b|\b\d{3,}\s?(\/mo|a month|per month)\b/i;

// --- 1. No figure leaves by text, anywhere.
console.log("the numbers hole:");
const texts = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const db = await import("/js/views/dealbuilder.js"); const msg = await import("/js/views/messages.js"); const occ = await import("/js/occasions.js");
  const lead = store.create("leads", { name: "Rich Owner", phone: "9025551000", stage: "delivered", vehicleInterest: "2021 Nissan Rogue SV", purchaseDate: "2022-06-01", currentPayment: 520, payoff: 9000, currentValue: 21000, currentApr: 6.9 });
  const best = db.bestPitch(lead, "finance");
  const offer = best ? db.offerText(lead, best) : "";
  const custom = msg.fillTemplate("Your {theirCar} is worth {tradeValue}, that's {equity} against {payment}.", lead);
  const defaults = msg.allTemplates().map((t) => msg.fillTemplate(t.body, lead));
  store.create("sales", { leadId: lead.id, customerName: lead.name, vehicle: lead.vehicleInterest, saleDate: new Date(Date.now() - 365 * 86400000 - 3 * 86400000).toISOString().slice(0, 10), commission: 500 });
  const anniv = occ.getOccasions().filter((o) => o.kind === "anniv").map((o) => o.message);
  return { offer, custom, defaults, anniv };
});
console.log("  offer:", texts.offer.slice(0, 110) + "…");
console.log("  custom placeholders:", texts.custom);
if (!texts.offer) fail("no offer text was produced");
if (MONEY.test(texts.offer)) fail("the offer text still quotes a figure: " + texts.offer);
if (MONEY.test(texts.custom)) fail("a custom template's money placeholders still resolve to figures: " + texts.custom);
texts.defaults.forEach((t) => { if (MONEY.test(t)) fail("a default template carries a figure: " + t.slice(0, 80)); });
texts.anniv.forEach((t) => { if (/strong right now|record high/i.test(t)) fail("the anniversary message makes a market claim: " + t); });

// --- 2. Consent: worked out from what's on file, recorded by hand, respected.
console.log("\nconsent:");
const consent = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const c = await import("/js/consent.js"); const a = await import("/js/assess.js"); const pr = await import("/js/prospects.js"); const plays = await import("/js/plays.js");
  const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const base = { stage: "delivered", vehicleInterest: "2021 Nissan Rogue SV", currentPayment: 520, payoff: 9000, currentValue: 21000, currentApr: 6.9 };
  const recent = store.create("leads", { ...base, name: "Recent Buyer", phone: "9025551001", purchaseDate: day(-400) });
  const stale = store.create("leads", { ...base, name: "Stale Buyer", phone: "9025551002", purchaseDate: day(-900) });
  const texted = store.create("leads", { ...base, name: "Texted Us", phone: "9025551003", purchaseDate: day(-900) });
  store.create("texts", { leadId: texted.id, dir: "in", body: "Hi, is the SV in stock?", phone: texted.phone, at: new Date(Date.now() - 86400000).toISOString(), read: true });
  const stop = store.create("leads", { ...base, name: "Said Stop", phone: "9025551004", purchaseDate: day(-100), smsOptOut: true });
  const enquiry = store.create("leads", { name: "New Enquiry", phone: "9025551005", stage: "new", source: "Internet", vehicleInterest: "Nissan Kicks" });
  const rec = store.create("leads", { ...base, name: "Recorded Yes", phone: "9025551006", purchaseDate: day(-900) });
  c.recordConsent(rec.id, { basis: "express", note: "asked on the phone" });
  const st = (l) => { const x = c.consentStatus(store.get("leads", l.id)); return { basis: x.basis, ok: x.ok, until: x.until, source: x.source }; };
  const staleA = a.assessment(stale.id), recentA = a.assessment(recent.id);
  const play = plays.getPlays(40).find((x) => x.kind === "prospect" && x.leadId === stale.id);
  const playRecent = plays.getPlays(40).find((x) => x.kind === "prospect" && x.leadId === recent.id);
  return {
    recent: st(recent), stale: st(stale), texted: st(texted), stop: st(stop), enquiry: st(enquiry), rec: st(rec),
    staleReasons: staleA.reasons, staleNext: staleA.next, recentNext: recentA.next,
    stalePlay: play && { href: play.href, prospectId: play.prospectId, sub: play.sub }, recentPlay: playRecent && { prospectId: playRecent.prospectId },
    staleId: stale.id,
  };
});
for (const k of ["recent", "stale", "texted", "stop", "enquiry", "rec"]) console.log(`  ${k.padEnd(8)} ${JSON.stringify(consent[k])}`);
if (consent.recent.basis !== "implied" || !consent.recent.ok) fail("a purchase 400 days ago should give implied consent");
if (consent.stale.ok || consent.stale.basis !== "none" || !consent.stale.until) fail("a purchase 900 days ago should have expired, with the date");
if (consent.texted.basis !== "implied" || !consent.texted.ok || !/texted/.test(consent.texted.source)) fail("a customer who texted us yesterday has implied consent");
if (consent.stop.basis !== "withdrawn" || consent.stop.ok) fail("STOP isn't read as withdrawn");
if (consent.enquiry.basis !== "implied" || !consent.enquiry.ok) fail("a fresh enquiry has implied consent");
if (consent.rec.basis !== "express" || !consent.rec.ok) fail("recorded express consent isn't honoured");
console.log("  stale on the card:", consent.staleReasons.join(" · "), "→", consent.staleNext && consent.staleNext.label);
if (!consent.staleReasons.some((r) => /consent/i.test(r))) fail("the card doesn't say there's no consent");
if (!consent.staleNext || consent.staleNext.kind !== "call") fail("the next move for someone without consent isn't a call");
if (!consent.recentNext || consent.recentNext.kind === "call") fail("someone with consent was pushed to a call");
if (!consent.stalePlay || consent.stalePlay.prospectId || !/^tel:/.test(consent.stalePlay.href || "")) fail("Home still offers to draft a text for someone without consent: " + JSON.stringify(consent.stalePlay));
if (!consent.recentPlay || !consent.recentPlay.prospectId) fail("Home doesn't offer the opener for someone with consent");

// A store that takes consent on the credit application: every purchase is
// express, and it doesn't expire.
const desk = await p.evaluate(async (id) => {
  const store = await import("/js/store.js"); const c = await import("/js/consent.js");
  store.updateSettings({ consentAtPurchase: true });
  const on = c.consentStatus(store.get("leads", id));
  store.updateSettings({ consentAtPurchase: false });
  const off = c.consentStatus(store.get("leads", id));
  return { on: on.basis, onSource: on.source, off: off.basis };
}, consent.staleId);
console.log("  consent taken at the desk:", JSON.stringify(desk));
if (desk.on !== "express" || !/purchase/.test(desk.onSource) || desk.off !== "none") fail("the consent-at-purchase setting doesn't switch an old purchase to express and back");

// Trying to draft for them anyway lands on their page, with the consent card.
await p.evaluate(async (id) => { const t = await import("/js/touches.js"); await t.reviewProspect(id); }, consent.staleId);
await p.waitForTimeout(300);
const blocked = await p.evaluate(() => ({ hash: location.hash, card: !!document.querySelector(".consent-card"), express: !!document.querySelector('[data-act="consent-express"]') }));
console.log("  drafting without consent:", JSON.stringify(blocked));
if (!/^#\/leads\//.test(blocked.hash) || !blocked.card || !blocked.express) fail("drafting without consent didn't stop at the customer's page with a way to record it");

// --- 3. The feedback loop: an opener sent, then a reply, a booking, a sale.
console.log("\nfeedback loop:");
const loop = await p.evaluate(async () => {
  const store = await import("/js/store.js"); const t = await import("/js/touches.js"); const sms = await import("/js/sms.js"); const oc = await import("/js/outcomes.js");
  const lead = store.all("leads").find((l) => l.name === "Recent Buyer");
  await t.reviewProspect(lead.id);
  await new Promise((r) => setTimeout(r, 200));
  const body = document.querySelector(".ib-compose textarea")?.value || "";
  const sent = await sms.sendText(lead, body);
  const row = store.all("outreach").find((o) => o.leadId === lead.id);
  const before = oc.outreachReport({ weeks: 4 });
  // What came of it.
  store.create("texts", { leadId: lead.id, dir: "in", body: "Sure, Thursday works", phone: lead.phone, at: new Date(Date.now() + 3600000).toISOString(), read: false });
  store.create("appointments", { leadId: lead.id, customerName: lead.name, when: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16), status: "scheduled", type: "appointment" });
  const after = oc.outreachReport({ weeks: 4 });
  return { sent: sent.ok, row: row && { kind: row.kind, intent: row.intent, reasons: row.reasons, score: row.score, consent: row.consent },
    before: before.total, after: { total: after.total, byReason: after.byReason.slice(0, 3), byKind: after.byKind, insights: after.insights } };
});
console.log("  logged:", JSON.stringify(loop.row));
console.log("  before:", JSON.stringify(loop.before), "· after:", JSON.stringify(loop.after.total));
console.log("  by reason:", JSON.stringify(loop.after.byReason));
if (!loop.sent) fail("the opener didn't send");
if (!loop.row || loop.row.kind !== "prospect" || !loop.row.reasons.length || loop.row.score == null) fail("the send wasn't logged with why: " + JSON.stringify(loop.row));
if (loop.row && loop.row.consent !== "implied") fail("the log doesn't record the consent basis");
if (loop.before.sent !== 1 || loop.before.replied !== 0) fail("the report doesn't see the send");
if (loop.after.total.replied !== 1 || loop.after.total.booked !== 1) fail("the reply and the booking weren't read back: " + JSON.stringify(loop.after.total));
if (!loop.after.byReason.length || !loop.after.byReason[0].replied) fail("outcomes aren't attributed to the reason");
if (!loop.after.byKind.some((k) => k.kind === "prospect" && k.sent === 1)) fail("outcomes aren't attributed to the kind of opener");

// And it's on Coach.
await p.evaluate(() => { location.hash = "#/coach"; }); await p.waitForTimeout(300);
const coach = await p.evaluate(() => { const c = document.querySelector(".worked-card"); return { has: !!c, text: c ? c.textContent.replace(/\s+/g, " ").slice(0, 200) : "" }; });
console.log("  Coach:", JSON.stringify(coach));
if (!coach.has || !/Same payment|Equity|Years owned/.test(coach.text)) fail("Coach doesn't show what's working");

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nguardrails.test.js FAILED" : "\nguardrails.test.js passed");
})();
