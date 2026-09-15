// Permission to text.
//
// A text to a past customer is a commercial electronic message, and in
// Canada that needs consent. It can be express (they said yes, and it doesn't
// expire) or implied (an existing business relationship: two years from a
// purchase; six months from an enquiry, or from them contacting us). STOP
// withdraws it. Until now the app knew about STOP and nothing else — every
// opener to an imported owner went out on an assumption.
//
// So each customer has a consent status, worked out from what's on file and
// anything recorded by hand, and the parts of the app that write texts for
// the salesperson respect it: no consent, no drafted opener — a call instead,
// or record the consent first.

import * as store from "./store.js";

export const IMPLIED_PURCHASE_DAYS = 730;   // existing business relationship
export const IMPLIED_INQUIRY_DAYS = 180;    // an enquiry, or them contacting us

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * { basis: "express"|"implied"|"withdrawn"|"none", ok, until, source, note }
 * ctx (optional, for reading the whole book at once): { lastIn, lastSale } —
 * the customer's latest inbound text and latest sale date, as ISO strings.
 */
export function consentStatus(lead, ctx = null, now = Date.now()) {
  if (!lead) return { basis: "none", ok: false, until: null, source: "", note: "" };
  const rec = lead.consent || null;
  if (lead.smsOptOut || (rec && rec.basis === "withdrawn")) return { basis: "withdrawn", ok: false, until: null, source: lead.smsOptOut ? "they texted STOP" : "recorded", note: (rec && rec.note) || "" };
  if (rec && rec.basis === "express") return { basis: "express", ok: true, until: null, source: "recorded" + (rec.at ? " " + String(rec.at).slice(0, 10) : ""), note: rec.note || "" };

  const lastSale = ctx ? ctx.lastSale : latestSale(lead.id);
  // Many dealerships take express consent on the credit application, in
  // which case every purchase carries it and it doesn't expire. That's a
  // fact about the store's paperwork, so it's a setting — off by default.
  if (store.getSettings().consentAtPurchase && (lead.purchaseDate || lastSale)) {
    return { basis: "express", ok: true, until: null, source: "their purchase (consent taken at the desk)", note: "" };
  }

  // Implied: the most recent relationship event wins, each with its own life.
  const events = [];
  const lastIn = ctx ? ctx.lastIn : latestInbound(lead.id);
  if (lastIn) events.push({ at: new Date(lastIn).getTime(), days: IMPLIED_INQUIRY_DAYS, source: "they texted us" });
  if (lastSale) events.push({ at: new Date(lastSale).getTime(), days: IMPLIED_PURCHASE_DAYS, source: "their purchase" });
  if (lead.purchaseDate) events.push({ at: new Date(lead.purchaseDate).getTime(), days: IMPLIED_PURCHASE_DAYS, source: "their purchase" });
  if (rec && rec.basis === "implied" && rec.at) events.push({ at: new Date(rec.at).getTime(), days: rec.days || IMPLIED_INQUIRY_DAYS, source: "recorded" });
  if (["new", "working", "appointment", "negotiating"].includes(lead.stage) && lead.createdAt && !lead.purchaseDate) {
    events.push({ at: new Date(lead.createdAt).getTime(), days: IMPLIED_INQUIRY_DAYS, source: "their enquiry" });
  }
  const live = events.filter((e) => isFinite(e.at)).map((e) => ({ ...e, until: e.at + e.days * DAY })).sort((a, b) => b.until - a.until);
  if (!live.length) return { basis: "none", ok: false, until: null, source: "", note: "" };
  const best = live[0];
  if (best.until > now) return { basis: "implied", ok: true, until: iso(best.until), source: best.source, note: "" };
  return { basis: "none", ok: false, until: iso(best.until), source: best.source, note: "" };
}

function latestInbound(leadId) {
  let at = "";
  store.all("texts").forEach((t) => { if (t.dir === "in" && t.leadId === leadId) { const a = String(t.at || t.createdAt || ""); if (a > at) at = a; } });
  return at || null;
}
function latestSale(leadId) {
  let at = "";
  store.all("sales").forEach((s) => { if (s.leadId === leadId) { const a = String(s.saleDate || s.createdAt || ""); if (a > at) at = a; } });
  return at || null;
}

// Record consent by hand: "express" (they said yes — say where), "implied"
// (an enquiry today), or "withdrawn".
export function recordConsent(leadId, { basis, note = "" }) {
  if (!["express", "implied", "withdrawn"].includes(basis)) return null;
  const rec = { basis, at: new Date().toISOString(), note: String(note || "").trim() };
  const patch = { consent: rec };
  if (basis === "withdrawn") patch.smsOptOut = true;
  else if (store.get("leads", leadId)?.smsOptOut) patch.smsOptOut = false;
  store.update("leads", leadId, patch);
  return rec;
}

// One line for a card or a toast.
export function consentLine(c) {
  if (!c) return "";
  if (c.basis === "express") return `Express consent on file (${c.source}).`;
  if (c.basis === "withdrawn") return `Texting withdrawn — ${c.source}.`;
  if (c.basis === "implied") return `Implied consent from ${c.source}, until ${c.until}.`;
  return c.until ? `No texting consent — implied consent from ${c.source} expired ${c.until}.` : "No texting consent on file.";
}
