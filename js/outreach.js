// Mass outreach: "text everyone who owns a Sentra that this month, if they
// trade it in for a new Nissan, they get double loyalty."
//
// One sentence, spoken or typed, becomes a blast: WHO (the audience, read
// from what customers drive and where they stand), HOW (text or email) and
// WHAT (the message, rewritten to the customer — "they" becomes "you"). The
// app builds the recipient list and the drafts; the salesperson reviews and
// sends. Nothing sends itself, and no figure ever goes out.
//
// Pure functions over strings and customer arrays, so node can test them.

import { classify, MAKES, modelsIn } from "./segments.js";

const norm = (s) => String(s || "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
const lower = (s) => norm(s).toLowerCase();
const DAY = 86400000;

/**
 * Read the sentence: { channel, audience, message, raw }.
 *   channel: "text" | "email"
 *   audience: { text, models, makes, nissan, yearMin, yearMax, paidOff,
 *               equity, lease, ownedYears, quietDays, stages, everyone }
 *   message: what to tell them, still in the salesperson's words
 */
export function parseOutreach(text) {
  const raw = norm(text);
  const t = lower(raw);
  const channel = /\b(e-?mail)\b/.test(t) ? "email" : "text";
  // Split at the message: "… that <message>", "… saying <message>",
  // "… telling them <message>", "… : <message>", "… to let them know <message>".
  let audienceText = t, message = "";
  // "that" starts the message unless it introduces the audience ("customers that own a Sentra").
  const cut = /\b(?:that(?!\s+(?:own|owns|drive|drives|have|has|had|bought|are|is|were|lease|leased|got|still)\b)|saying|telling them(?: that)?|tell them(?: that)?|let them know(?: that)?|letting them know(?: that)?|with the message|about)\b[:,]?\s+/.exec(t.slice(4));
  if (cut) cut.index += 4;
  const colon = t.indexOf(":");
  if (cut && (colon < 0 || cut.index < colon)) { audienceText = t.slice(0, cut.index); message = raw.slice(cut.index + cut[0].length); }
  else if (colon > 0) { audienceText = t.slice(0, colon); message = raw.slice(colon + 1); }
  // A quoted message wins.
  const q = /["“]([^"”]{8,})["”]/.exec(raw);
  if (q) { message = q[1]; audienceText = t.replace(q[0].toLowerCase(), " "); }
  message = norm(message).replace(/^(that|saying)\s+/i, "");

  const a = { text: norm(audienceText), models: [], makes: [], nissan: false, yearMin: null, yearMax: null, paidOff: false, equity: false, lease: false, ownedYears: null, quietDays: null, stages: [], everyone: false };
  // The audience is what comes after "everyone who / anyone who / owners of / people with / customers in".
  const who = /\b(?:everyone|everybody|anyone|anybody|all|every|each|people|customers?|clients?|owners?|folks|those|them)\b/.exec(audienceText);
  const scope = who ? audienceText.slice(who.index) : audienceText;
  a.models = modelsIn(scope);
  a.makes = MAKES.filter((m) => new RegExp(`\\b${m.replace(/-/g, "\\-")}\\b`).test(scope)).map((m) => (m === "vw" ? "volkswagen" : m === "chevy" ? "chevrolet" : m === "mercedes-benz" ? "mercedes" : m));
  if (/\bnissan owners?\b|\bin a nissan\b|\bdrives? a nissan\b|\bown(?:s|ing)? a nissan\b|\bnissans?\b/.test(scope) && !a.models.length) a.nissan = true;
  const yr = scope.match(/\b((?:19|20)\d{2})\b/g) || [];
  if (/\b(older than|before|pre)\s+((?:19|20)\d{2})/.test(scope)) a.yearMax = Number(RegExp.$2) - 1;
  else if (/\b(newer than|after|since)\s+((?:19|20)\d{2})/.test(scope)) a.yearMin = Number(RegExp.$2) + 1;
  else if (/\b((?:19|20)\d{2})\s*(?:to|-|through|and)\s*((?:19|20)\d{2})\b/.test(scope)) { a.yearMin = Number(RegExp.$1); a.yearMax = Number(RegExp.$2); }
  else if (/\b((?:19|20)\d{2})\s*(?:or older|and older|or earlier)\b/.test(scope)) a.yearMax = Number(RegExp.$1);
  else if (/\b((?:19|20)\d{2})\s*(?:or newer|and newer|or later|\+)\b/.test(scope)) a.yearMin = Number(RegExp.$1);
  else if (yr.length === 1) { a.yearMin = Number(yr[0]); a.yearMax = Number(yr[0]); }
  if (/\bpaid[- ]off\b|\bno payment\b|\bown(?:s|ed)? (?:it|their car) outright\b/.test(scope)) a.paidOff = true;
  if (/\b(positive )?equity\b/.test(scope)) a.equity = true;
  if (/\blease\w*\s+(?:is |are |that's |that is )?(?:ending|maturing|coming due|up|expiring|due|almost up)\b|\bend of (?:their )?lease\b|\blease-?end\b/.test(scope)) a.lease = true;
  const owned = /\b(?:owned|had|driven|in (?:their|the) (?:car|vehicle))\b[^0-9]{0,30}?(\d+)\s*(?:\+\s*)?years?/.exec(scope) || /\bfor (?:more than |over )?(\d+)\s*years?\b/.exec(scope);
  if (owned) a.ownedYears = Number(owned[1]);
  const quiet = /\b(?:haven'?t|not|no)\b[^0-9]{0,40}?(?:contact|reach|heard|talk|touch|text|call)[^0-9]{0,30}?(\d+)\s*(days?|weeks?|months?)/.exec(scope);
  if (quiet) a.quietDays = Number(quiet[1]) * (/week/.test(quiet[2]) ? 7 : /month/.test(quiet[2]) ? 30 : 1);
  if (/\bpast customers?\b|\bprevious customers?\b|\bsold customers?\b|\bbought from (?:us|me)\b/.test(scope)) a.stages = ["sold", "delivered"];
  if (/\b(?:new )?leads?\b|\bprospects?\b/.test(scope) && !a.stages.length) a.stages = ["new", "working", "appointment", "negotiating"];
  a.everyone = !a.models.length && !a.makes.length && !a.nissan && a.yearMin == null && a.yearMax == null && !a.paidOff && !a.equity && !a.lease && a.ownedYears == null && a.quietDays == null && !a.stages.length;
  return { channel, audience: a, message, raw };
}

// Is this sentence a mass outreach at all? Needs a plural target and a way
// to reach them; a text to one named person is not.
export function isOutreach(text) {
  const t = lower(text);
  const verb = /\b(text|sms|message|email|e-mail|reach out to|blast|send (?:a )?(?:text|message|note|email)|let .* know|tell)\b/.test(t);
  const plural = /\b(everyone|everybody|anyone|anybody|all (?:my |the |of )?(?:customers|clients|owners|people|leads)|every (?:customer|owner|client|person|lead)|every [a-z0-9-]+ (?:owner|driver|customer)s?\b|customers who|people who|owners? (?:of|who|with)|(?:my |the )?[a-z0-9-]+ owners\b|mass|blast|campaign)\b/.test(t);
  return verb && plural;
}

/**
 * The audience, from the book: { included: [lead], excluded: [{ lead, why }] }.
 * `opts.channel` decides what "reachable" means; `opts.recentDays` (default
 * 20) keeps someone reached that recently out unless `opts.includeRecent`.
 */
export function audienceFor(spec, leads, opts = {}) {
  const a = spec.audience || spec;
  const channel = opts.channel || spec.channel || "text";
  const now = opts.now || Date.now();
  const recentDays = opts.recentDays != null ? opts.recentDays : 20;
  const included = [], excluded = [];
  for (const l of leads) {
    const c = classify(String(l.vehicleInterest || ""));
    const drive = lower(l.vehicleInterest);
    if (a.models.length && !a.models.some((m) => c.model === m || drive.includes(m))) continue;
    if (a.makes.length && !a.makes.includes(c.make)) continue;
    if (a.nissan && c.make !== "nissan") continue;
    if (a.yearMin != null && !(c.year && c.year >= a.yearMin)) continue;
    if (a.yearMax != null && !(c.year && c.year <= a.yearMax)) continue;
    if (a.paidOff && !(l.currentPayment == null || Number(l.currentPayment) === 0) && !(l.payoff != null && Number(l.payoff) === 0)) continue;
    if (a.equity && !(l.currentValue != null && l.payoff != null && Number(l.currentValue) - Number(l.payoff) >= 2000)) continue;
    if (a.lease) { const d = l.leaseEnd ? (new Date(l.leaseEnd) - now) / DAY : null; if (d == null || d < -30 || d > 120) continue; }
    if (a.ownedYears != null) { const p = l.purchaseDate ? (now - new Date(l.purchaseDate)) / (365.25 * DAY) : null; if (p == null || p < a.ownedYears) continue; }
    if (a.quietDays != null) { const last = l.lastContacted ? (now - new Date(l.lastContacted)) / DAY : Infinity; if (last < a.quietDays) continue; }
    if (a.stages.length && !a.stages.includes(l.stage)) continue;
    // They're in the audience. Can they be reached?
    let why = "";
    if (l.stage === "lost" || l.doNotContact) why = "do not contact";
    else if (channel === "text" && !l.phone) why = "no phone number";
    else if (channel === "email" && !l.email) why = "no email address";
    else if (channel === "text" && l.smsOptOut) why = "opted out of texts";
    else if (!opts.includeRecent && l.lastCampaignAt && (now - new Date(l.lastCampaignAt)) / DAY < recentDays) why = `reached ${Math.floor((now - new Date(l.lastCampaignAt)) / DAY)} days ago`;
    if (why) excluded.push({ lead: l, why }); else included.push(l);
  }
  return { included, excluded };
}

// "this month if they trade in their Sentra … they get double loyalty" →
// "This month, if you trade in your Sentra …, you get double loyalty."
export function toSecondPerson(message) {
  let m = norm(message);
  if (!m) return "";
  m = m.replace(/\bthey're\b/gi, "you're").replace(/\bthey've\b/gi, "you've").replace(/\bthey'll\b/gi, "you'll").replace(/\bthey'd\b/gi, "you'd")
    .replace(/\bthemselves\b/gi, "yourself").replace(/\btheirs\b/gi, "yours").replace(/\btheir\b/gi, "your").replace(/\bthem\b/gi, "you").replace(/\bthey\b/gi, "you")
    .replace(/\byou (?:get|gets)\b/gi, "you get").replace(/\byou (?:has|have)\b/gi, "you have").replace(/\byou (?:is|are)\b/gi, "you are").replace(/\byou (?:was|were)\b/gi, "you were")
    .replace(/\byou (\w+)s\b/gi, (w, v) => (/^(trade|bring|come|get|want|need|own|drive|buy|keep|book|call|text|stop|visit|swap|upgrade|move|switch|sign)$/i.test(v) ? "you " + v : w));
  // "the customer / customers" as the subject reads as "you" too.
  m = m.replace(/\b(?:the )?customers?\b/gi, "you");
  m = m.charAt(0).toUpperCase() + m.slice(1);
  if (!/[.!?]$/.test(m)) m += ".";
  return m;
}

// Figures never leave: a dollar amount or a percentage rate in a blast is
// the one thing the review must refuse.
export function figuresIn(message) {
  const hits = String(message || "").match(/\$\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%|\b\d[\d,]{2,}\s?(?:dollars|bucks)\b|\b\d+\s?(?:a|per)\s?month\b/gi) || [];
  return hits;
}

/**
 * One customer's draft: { body } for a text, { subject, body } for an email.
 * Written from the salesperson's words, never a template.
 */
export function draftFor(lead, spec, settings = {}) {
  const first = String(lead.name || "there").trim().split(/\s+/)[0] || "there";
  const me = settings.salesperson || "your salesperson";
  const store = settings.dealership || "the store";
  const car = String(lead.vehicleInterest || "").replace(/^\d{4}\s*/, "").trim();
  let offer = toSecondPerson(spec.message || "");
  // "your Sentra" already names their car; when the message says "your car",
  // name it.
  if (car && /\byour (?:car|vehicle)\b/i.test(offer)) offer = offer.replace(/\byour (?:car|vehicle)\b/gi, `your ${car}`);
  if (spec.channel === "email") {
    const short = (x) => { const y = x.replace(/[.!?]$/, ""); if (y.length <= 90) return y; const cutAt = y.lastIndexOf(" ", 80); return y.slice(0, cutAt > 30 ? cutAt : 80) + "…"; };
    const subject = spec.subject || (offer ? short(offer) : `A note from ${me} at ${store}`);
    const body = `Hi ${first},\n\n${offer || "I wanted to reach out about your " + (car || "vehicle") + "."}\n\nIf you'd like, I can go over what that looks like for you — it's a ten-minute conversation, no obligation. Reply here or call me any time.\n\n${me}\n${store}`;
    return { subject, body };
  }
  const body = `Hi ${first}, it's ${me} at ${store}. ${offer || "I wanted to reach out about your " + (car || "vehicle") + "."} Want me to see what that looks like for you? Reply STOP to opt out.`;
  return { body };
}

// A label for the audience, for the screen and the spoken reply: "Sentra owners".
export function describeAudience(spec) {
  const a = spec.audience || spec;
  const cap = (s) => s.split(/[\s-]+/).map((w) => (/^[a-z]{1,3}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  const bits = [];
  if (a.yearMin != null && a.yearMax != null && a.yearMin === a.yearMax) bits.push(String(a.yearMin));
  else if (a.yearMin != null && a.yearMax != null) bits.push(`${a.yearMin}–${a.yearMax}`);
  else if (a.yearMin != null) bits.push(`${a.yearMin} and newer`);
  else if (a.yearMax != null) bits.push(`${a.yearMax} and older`);
  if (a.models.length) bits.push(a.models.map(cap).join(" / ") + " owners");
  else if (a.makes.length) bits.push(a.makes.map(cap).join(" / ") + " owners");
  else if (a.nissan) bits.push("Nissan owners");
  else if (a.stages.length && a.stages.includes("sold")) bits.push("past customers");
  else if (a.stages.length) bits.push("open leads");
  else bits.push("everyone");
  const extra = [];
  if (a.paidOff) extra.push("paid off");
  if (a.equity) extra.push("with equity");
  if (a.lease) extra.push("lease ending");
  if (a.ownedYears != null) extra.push(`owned ${a.ownedYears}+ years`);
  if (a.quietDays != null) extra.push(`not reached in ${a.quietDays} days`);
  return bits.join(" ") + (extra.length ? " · " + extra.join(" · ") : "");
}
