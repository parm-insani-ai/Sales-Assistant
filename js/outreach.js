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
import { moneyIn } from "./money.js";

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
// The sentence as a person would hear it. The mic hands over the closest
// words it knows — "lease sending", "least ending", "paid of", "rouge" —
// and the parser's keywords are few enough to take a near-miss for the word
// it was. A word one or two letters off "ending" right after "lease" is
// "ending"; the rest is a short table of what the mic actually says.
const MISHEARD = [
  [/\bleas(?:e|es|ed|t)\s+(?:is\s+|are\s+)?(?:s|sp)?ending\b/g, "lease ending"],
  [/\b(?:lisa|lease a|leases)\s+ending\b/g, "lease ending"],
  [/\blease\s+(?:and|an|end)\s+ing\b/g, "lease ending"],
  [/\blease\s+(?:x|ex)\s*pir(?:ing|ed)\b/g, "lease expiring"],
  [/\bpa(?:id|yed|y)\s+(?:of|off|or)\b/g, "paid off"],
  [/\bs\.?\s?u\.?\s?v\.?s?\b/g, "suv"],
  [/\brouge\b/g, "rogue"],
  [/\bcentra\b/g, "sentra"],
  [/\bultima\b/g, "altima"],
  [/\bpath\s+finder\b/g, "pathfinder"],
  [/\bfront\s+tier\b/g, "frontier"],
  [/\bmoreno\b/g, "murano"],
  [/\bequ[ia]t+y\b|\bequity's\b/g, "equity"],
];
const near = (a, b) => { // edit distance, for the handful of keywords the parser leans on
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
};
export function heard(t) {
  let s = String(t || "");
  MISHEARD.forEach(([re, to]) => { s = s.replace(re, to); });
  s = s.replace(/\b(leases?)\s+(?:(is|are)\s+)?([a-z]{4,9})\b/g, (m, l, is, w) => {
    const want = ["ending", "expiring", "maturing"].find((k) => near(w, k) <= 2);
    return want ? `${l} ${is ? is + " " : ""}${want}` : m;
  });
  return s;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthEnd = (y, m) => ymd(new Date(y, m + 1, 0));
const monthStart = (y, m) => ymd(new Date(y, m, 1));

export function parseOutreach(text, now = Date.now()) {
  const raw = norm(text);
  const t = heard(lower(raw));
  const channel = /\b(e-?mail)\b/.test(t) ? "email" : "text";
  // Split at the message: "… that <message>", "… saying <message>",
  // "… telling them <message>", "… : <message>", "… to let them know <message>".
  let audienceText = t, message = "";
  // "that" starts the message unless it introduces the audience ("customers that own a Sentra").
  // "telling them", "telling him" (what the mic makes of it), "tell her",
  // "let them know", "saying", "to say", "mention that", "with the message".
  const WHO = "(?:them|him|her|everyone|everybody|people|all of them|each of them|the customer|the customers)";
  const cut = new RegExp(String.raw`\b(?:that(?!\s+(?:own|owns|drive|drives|have|has|had|bought|are|is|were|lease|leased|got|still)\b)|saying(?: that)?|(?:and |to )?say(?: that)?|telling ${WHO}(?: that)?|tell ${WHO}(?: that)?|(?:to )?let ${WHO} know(?: that)?|letting ${WHO} know(?: that)?|(?:and |to )?mention(?:ing)?(?: to ${WHO})?(?: that)?|with (?:the |a )?message(?: that| saying)?|about)\b[:,]?\s+`).exec(t.slice(4));
  if (cut) cut.index += 4;
  const colon = t.indexOf(":");
  if (cut && (colon < 0 || cut.index < colon)) { audienceText = t.slice(0, cut.index); message = raw.slice(cut.index + cut[0].length); }
  else if (colon > 0) { audienceText = t.slice(0, colon); message = raw.slice(colon + 1); }
  // A quoted message wins.
  const q = /["“]([^"”]{8,})["”]/.exec(raw);
  if (q) { message = q[1]; audienceText = t.replace(q[0].toLowerCase(), " "); }
  message = norm(message).replace(/^(that|saying)\s+/i, "");

  const a = { ...emptyAudience(), text: norm(audienceText) };
  // The audience is the whole clause after the verb ("text", "send a note
  // to", "reach out to"): "my Altima owners" names a model as surely as
  // "everyone who owns an Altima" does.
  let scope = audienceText.replace(/^\s*(?:please |can you |could you |i want to |i'd like to |let's )?(?:send (?:out )?(?:a |an )?(?:quick )?(?:text|sms|message|note|email|e-mail|blast) (?:out )?to|text|sms|message|email|e-mail|reach out to|blast|let|tell|remind|contact|get in touch with|get hold of|reach|ping|follow up with|touch base with|write to|drop a (?:line|note) to|send out to)\s+/, " ");
  // Every piece of the clause the parser reads is blanked out as it goes;
  // whatever is left over with meaning is what it did not understand.
  let rest = " " + scope + " ";
  const take = (re) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " ".repeat(m[0].length)); return m; };
  a.models = modelsIn(scope);
  a.models.forEach((k) => take(new RegExp(`(?<![a-z0-9])${k.replace(/[-.]/g, (c) => "\\" + c)}s?(?![a-z0-9])`)));
  a.makes = MAKES.filter((m) => take(new RegExp(`\\b${m.replace(/-/g, "\\-")}s?\\b`))).map((m) => (m === "vw" ? "volkswagen" : m === "chevy" ? "chevrolet" : m === "mercedes-benz" ? "mercedes" : m));
  if (a.makes.includes("nissan") && !a.models.length) a.nissan = true;
  if (take(/\b(?:suvs?|crossovers?|cuvs?)\b/)) a.body = "suv";
  else if (take(/\b(?:trucks?|pickups?|pick-ups?)\b/)) a.body = "truck";
  else if (take(/\b(?:sedans?|hatchbacks?|coupes?|compacts?)\b/)) a.body = "car";
  else if (take(/\b(?:mini)?vans?\b/)) a.body = "van";
  else if (take(/\bsports? cars?\b/)) a.body = "sports";
  if (take(/\b(older than|before|pre)\s+((?:19|20)\d{2})/)) a.yearMax = Number(RegExp.$2) - 1;
  else if (take(/\b(newer than|after|since)\s+((?:19|20)\d{2})/)) a.yearMin = Number(RegExp.$2) + 1;
  else if (take(/\b((?:19|20)\d{2})\s*(?:to|-|through|and)\s*((?:19|20)\d{2})\b/)) { a.yearMin = Number(RegExp.$1); a.yearMax = Number(RegExp.$2); }
  else if (take(/\b((?:19|20)\d{2})\s*(?:or older|and older|or earlier)\b/)) a.yearMax = Number(RegExp.$1);
  else if (take(/\b((?:19|20)\d{2})\s*(?:or newer|and newer|or later|\+)\b/)) a.yearMin = Number(RegExp.$1);
  else { const yr = scope.match(/\b((?:19|20)\d{2})\b/g) || []; if (yr.length === 1) { take(/\b(?:19|20)\d{2}\b/); a.yearMin = Number(yr[0]); a.yearMax = Number(yr[0]); } }
  if (take(/\bpaid[- ]off\b|\bno payments?\b|\bown(?:s|ed)? (?:it|their (?:car|vehicle)) outright\b|\bpaid (?:it |their (?:car|vehicle) )?off\b/)) a.paidOff = true;
  if (take(/\b(?:positive |in )?equity\b/)) a.equity = true;
  if (take(/\blease\w*\s+(?:is |are |that's |that is )?(?:ending|ends|end|maturing|matures|coming due|comes due|up|expiring|expires|due|almost up|running out|runs out|over|finishing|finishes)\b|\bend of (?:their )?lease\b|\blease-?end\b|\bleases? ending\b/)) {
    a.lease = true;
    // When: "this year", "next month", "in March", "by June", "in the next
    // three months", "within 60 days". Nothing said: the next four months.
    const d = new Date(now), y = d.getFullYear(), mo = d.getMonth();
    const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, "a couple of": 2, "a couple": 2, "a few": 3, a: 1, an: 1 };
    let m;
    if (take(/\b(?:this|the) (?:calendar )?year\b/)) a.leaseUntil = `${y}-12-31`;
    else if (take(/\bnext year\b/)) { a.leaseFrom = `${y + 1}-01-01`; a.leaseUntil = `${y + 1}-12-31`; }
    else if (take(/\bthis month\b/)) a.leaseUntil = monthEnd(y, mo);
    else if (take(/\bnext month\b/)) { a.leaseFrom = monthStart(y, mo + 1); a.leaseUntil = monthEnd(y, mo + 1); }
    else if ((m = take(new RegExp(`\\b(?:in|by|before|through|until|till|up to|through) (?:the end of )?(${MONTHS.join("|")})\\b`)))) {
      const target = MONTHS.indexOf(m[1]); const yy = target >= mo ? y : y + 1;
      if (/^(by|before|until|till|up to|through)/.test(m[0])) a.leaseUntil = monthEnd(yy, target);
      else { a.leaseFrom = monthStart(yy, target); a.leaseUntil = monthEnd(yy, target); }
    }
    else if ((m = take(/\b(?:in|within|over|during) (?:the )?next (\d+|a couple of|a couple|a few|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an) (months?|weeks?|days?)\b/)) || (m = take(/\b(?:in|within) (\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (months?|weeks?|days?)\b/))) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]] || 1;
      const days = /month/.test(m[2]) ? n * 30 : /week/.test(m[2]) ? n * 7 : n;
      a.leaseUntil = ymd(new Date(now + days * DAY));
    }
  }
  const owned = take(/\b(?:owned|had|driven|in (?:their|the) (?:car|vehicle))\b[^0-9]{0,30}?(\d+)\s*(?:\+\s*)?years?\b/) || take(/\bfor (?:more than |over )?(\d+)\s*(?:\+\s*)?years?\b/);
  if (owned) a.ownedYears = Number(owned[1]);
  const quiet = take(/\b(?:haven'?t|hasn'?t|not|no|didn'?t)\b[^0-9]{0,40}?(?:contact|reach|heard|talk|touch|text|call|spoke)[^0-9]{0,30}?(\d+)\s*(days?|weeks?|months?)\b/);
  if (quiet) a.quietDays = Number(quiet[1]) * (/week/.test(quiet[2]) ? 7 : /month/.test(quiet[2]) ? 30 : 1);
  if (take(/\b(?:past|previous|sold|delivered|existing|current) (?:customers?|clients?|owners?)\b|\bbought from (?:us|me)\b/)) a.stages = ["sold", "delivered"];
  if (take(/\b(?:new |open |active |fresh )?(?:leads?|prospects?)\b/) && !a.stages.length) a.stages = ["new", "working", "appointment", "negotiating"];
  a.unknown = leftovers(rest);
  a.everyone = !a.unknown.length && isEveryone(a);
  return { channel, audience: a, message, raw };
}

// A blank audience: the shape every filter starts from.
export function emptyAudience() {
  return { text: "", models: [], makes: [], nissan: false, body: "", yearMin: null, yearMax: null, paidOff: false, equity: false, lease: false, leaseFrom: null, leaseUntil: null, ownedYears: null, quietDays: null, stages: [], everyone: true, unknown: [] };
}

// Nothing narrows it: the whole book.
export function isEveryone(a) {
  return !a.models.length && !a.makes.length && !a.nissan && !a.body && a.yearMin == null && a.yearMax == null && !a.paidOff && !a.equity && !a.lease && a.ownedYears == null && a.quietDays == null && !a.stages.length;
}

// Does this customer fit the audience? The one set of rules, whether the
// audience was said in a sentence or picked in the Leads filter.
export function inAudience(a, l, now = Date.now()) {
  const c = classify(String(l.vehicleInterest || ""));
  const drive = lower(l.vehicleInterest);
  if (a.models.length && !a.models.some((m) => c.model === m || drive.includes(m))) return false;
  if (a.makes.length && !a.makes.includes(c.make)) return false;
  if (a.nissan && c.make !== "nissan") return false;
  if (a.body && c.body !== a.body) return false;
  if (a.yearMin != null && !(c.year && c.year >= a.yearMin)) return false;
  if (a.yearMax != null && !(c.year && c.year <= a.yearMax)) return false;
  if (a.paidOff && !(l.currentPayment == null || Number(l.currentPayment) === 0) && !(l.payoff != null && Number(l.payoff) === 0)) return false;
  if (a.equity && !(l.currentValue != null && l.payoff != null && Number(l.currentValue) - Number(l.payoff) >= 2000)) return false;
  if (a.lease) {
    const d = l.leaseEnd ? (new Date(l.leaseEnd) - now) / DAY : null; if (d == null || d < -30) return false;
    const end = String(l.leaseEnd).slice(0, 10);
    if (a.leaseUntil ? end > a.leaseUntil : d > 120) return false;
    if (a.leaseFrom && end < a.leaseFrom) return false;
  }
  if (a.ownedYears != null) { const p = l.purchaseDate ? (now - new Date(l.purchaseDate)) / (365.25 * DAY) : null; if (p == null || p < a.ownedYears) return false; }
  if (a.quietDays != null) { const last = l.lastContacted ? (now - new Date(l.lastContacted)) / DAY : Infinity; if (last < a.quietDays) return false; }
  if (a.stages.length && !a.stages.includes(l.stage)) return false;
  return true;
}

// Words that only carry the shape of the sentence: they can be left over
// without meaning anything is missing.
const FILLER = new Set(("everyone everybody anyone anybody all every each people person customer customers client clients owner owners driver drivers folks guys those them they who whose whom which that what own owns owned owning drive drives driving driven have has had having got get bought buy purchased leased leasing in on at to for from of with and or a an the my our your his her their its it is are was were be been being still currently already now ever i me us we you one ones car cars vehicle vehicles ride rides know please just also too as so out up").split(" "));

// What the clause still says once every recognised piece is blanked out:
// runs of meaningful words, in the sentence's own words.
function leftovers(rest) {
  const words = [];
  const re = /[^\s]+/g;
  let m;
  while ((m = re.exec(rest))) {
    const w = m[0].replace(/'(s|re|ve|d|ll|m)$/i, "").replace(/^[^a-z0-9$%]+|[^a-z0-9$%]+$/g, "");
    if (w.length > 1 && !FILLER.has(w)) words.push({ at: m.index, end: m.index + m[0].length, w });
  }
  const runs = [];
  for (const x of words) {
    const last = runs[runs.length - 1];
    // A run continues across one filler word, so "but not a lease" stays whole.
    if (last && rest.slice(last.end, x.at).trim().split(/\s+/).filter(Boolean).length <= 1) last.end = x.end;
    else runs.push({ at: x.at, end: x.end });
  }
  return runs.map((r) => rest.slice(r.at, r.end).replace(/\s+/g, " ").replace(/^[^a-z0-9$]+|[^a-z0-9$%]+$/g, "").trim()).filter(Boolean);
}

// Is this sentence a mass outreach at all? Needs a plural target and a way
// to reach them; a text to one named person is not.
export function isOutreach(text) {
  const t = lower(text);
  const verb = /\b(text|sms|message|email|e-mail|reach out to|blast|send (?:a )?(?:text|message|note|email)|let .* know|tell|contact|get in touch with|get hold of|reach|ping|follow up with|touch base with|write to|drop a (?:line|note) to|send out to)\b/.test(t);
  const plural = /\b(everyone|everybody|anyone|anybody|all (?:my |the |of |our )?(?:[a-z0-9-]+ )?(?:customers|clients|owners|people|leads|prospects)|every (?:customer|owner|client|person|lead)|every [a-z0-9-]+ (?:owner|driver|customer)s?\b|customers who|people who|owners? (?:of|who|with)|(?:my |the |our )?[a-z0-9-]+ (?:owners|people|customers|clients|leads|prospects)\b|mass|blast|campaign)\b/.test(t);
  return verb && plural;
}

/**
 * The audience, from the book: { included: [lead], excluded: [{ lead, why }] }.
 * `opts.channel` decides what "reachable" means; `opts.recentDays` (default
 * 20) keeps someone reached that recently out unless `opts.includeRecent`.
 * `opts.reach(lead, channel)` may return a reason to leave someone out
 * (the app passes texting consent through here).
 */
export function audienceFor(spec, leads, opts = {}) {
  const a = spec.audience || spec;
  const channel = opts.channel || spec.channel || "text";
  const now = opts.now || Date.now();
  const recentDays = opts.recentDays != null ? opts.recentDays : 20;
  const included = [], excluded = [];
  // A clause the parser couldn't read is never rounded down to "everyone":
  // nobody is picked until it's reworded.
  if (a.unknown && a.unknown.length) return { included, excluded, unknown: a.unknown.slice() };
  for (const l of leads) {
    if (!inAudience(a, l, now)) continue;
    // They're in the audience. Can they be reached?
    let why = "";
    if (l.stage === "lost" || l.doNotContact) why = "do not contact";
    else if (channel === "text" && !l.phone) why = "no phone number";
    else if (channel === "email" && !l.email) why = "no email address";
    else if (channel === "text" && l.smsOptOut) why = "opted out of texts";
    else if (opts.reach && (why = String(opts.reach(l, channel) || ""))) { /* the caller's own rule, e.g. consent */ }
    else if (!opts.includeRecent && l.lastCampaignAt && (now - new Date(l.lastCampaignAt)) / DAY < recentDays) why = `reached ${Math.floor((now - new Date(l.lastCampaignAt)) / DAY)} days ago`;
    if (why) excluded.push({ lead: l, why }); else included.push(l);
  }
  return { included, excluded, unknown: [] };
}

// What the parser can read, for the reply that says it didn't understand.
export const AUDIENCE_HELP = "a model, a make, Nissan, SUV / truck / sedan / van, a year or a range of years, paid off, with equity, lease ending (this year, in March, in the next three months), owned so many years, not heard from in so many days, past customers, or open leads";

// "I didn't understand \"under 60,000 km\"…" — empty when everything was read.
export function unknownNote(spec) {
  const a = spec.audience || spec;
  if (!a.unknown || !a.unknown.length) return "";
  return `I didn't understand ${a.unknown.map((u) => `"${u}"`).join(" or ")} in the audience. I can pick people by ${AUDIENCE_HELP}.`;
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
  // Advertised figures — a current special on file — aren't figures here.
  return moneyIn(message).map((m) => m.text);
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

// What to tell them when the sentence only said who: a message written to
// the reason they were picked, in the second person, with no figure in it.
// "your car" is named per customer by draftFor. The agent can write a
// better one (outreachdraft.js); this is the one that's always there.
export function messageFor(spec) {
  const a = spec.audience || spec;
  const when = a.leaseFrom && a.leaseUntil && a.leaseFrom.slice(0, 7) === a.leaseUntil.slice(0, 7) ? ` in ${new Date(a.leaseUntil + "T12:00:00").toLocaleDateString("en-CA", { month: "long" })}` : a.leaseUntil ? (a.leaseUntil.slice(5) === "12-31" ? " this year" : ` by ${new Date(a.leaseUntil + "T12:00:00").toLocaleDateString("en-CA", { month: "long" })}`) : " soon";
  if (a.lease) return `your lease on your car is coming up${when}. Before it's due, I can walk you through your options — keep it, hand it back, or move into something newer — in about ten minutes, no pressure.`;
  if (a.paidOff) return `your car is paid off, which puts you in a strong spot if you've thought about something newer. I'd be glad to show you what that could look like, no pressure.`;
  if (a.equity) return `you're likely sitting in a good position on your car right now. If a newer one has crossed your mind, I can show you where you stand in a few minutes.`;
  if (a.quietDays != null) return `it's been a while — I hope your car is treating you well. If anything has come up, or you're curious what's next, I'm a text away.`;
  if (a.stages.length && a.stages.every((s) => ["sold", "delivered"].includes(s))) return `I hope your car is still treating you well. If you've thought about what's next, or just want to know where you stand, I'd love to help.`;
  if (a.stages.length) return `I wanted to check in — if you're still looking, I can line a few things up for you to see this week.`;
  if (a.models.length || a.makes.length || a.nissan || a.body || a.yearMin != null || a.yearMax != null) return `I'm working with owners like you this week — if you've thought about what's next, or just want a quick look at where you stand, I'd be glad to help.`;
  return `I wanted to say hello — if anything's on your mind about your car or what's next, I'm a text away.`;
}

// Why nobody matched, said plainly: what the audience needs on file and how
// many have it, so "0 will be texted" explains itself. Empty when someone
// matched, or when the sentence wasn't read.
export function audienceGaps(spec, leads, now = Date.now()) {
  const a = spec.audience || spec;
  if ((a.unknown && a.unknown.length) || !leads.length) return leads.length ? "" : "Nobody on file yet.";
  if (leads.some((l) => inAudience(a, l, now))) return "";
  const n = leads.length.toLocaleString();
  const bits = [];
  if (a.lease) {
    const with_ = leads.filter((l) => l.leaseEnd);
    if (!with_.length) bits.push(`none of the ${n} customers on file has a lease end date — it comes in with the owner book (a lease end column) or on the customer's page`);
    else bits.push(`${with_.length} of ${n} have a lease end on file, none in ${a.leaseUntil ? `the window (${a.leaseFrom ? a.leaseFrom + " to " : "by "}${a.leaseUntil})` : "the next four months"}`);
  }
  if (a.paidOff) { const w = leads.filter((l) => l.currentPayment != null || l.payoff != null); bits.push(w.length ? `${w.length} of ${n} have a payment or payoff on file, none paid off` : `none of the ${n} customers has a payment or payoff on file, which "paid off" needs`); }
  if (a.equity) { const w = leads.filter((l) => l.currentValue != null && l.payoff != null); bits.push(w.length ? `${w.length} of ${n} have a value and a payoff on file, none with equity to speak of` : `none of the ${n} customers has both a value and a payoff on file, which "equity" needs`); }
  if (a.models.length || a.makes.length || a.nissan || a.body || a.yearMin != null || a.yearMax != null) {
    const v = { ...emptyAudience(), models: a.models, makes: a.makes, nissan: a.nissan, body: a.body, yearMin: a.yearMin, yearMax: a.yearMax };
    const w = leads.filter((l) => inAudience(v, l, now));
    bits.push(w.length ? `${w.length} of ${n} drive what was named; none meet the rest` : `nobody on file drives what was named`);
  }
  if (a.ownedYears != null) { const w = leads.filter((l) => l.purchaseDate); if (!w.length) bits.push(`none of the ${n} customers has a purchase date on file, which "owned so many years" needs`); }
  if (a.stages.length && !bits.length) bits.push(`nobody on file is at that stage`);
  return bits.length ? `Nobody matched: ${bits.join("; ")}.` : `Nobody on file matched.`;
}

// The message with its figures taken out, the way a salesperson would say
// it without the number: "0% financing" becomes "special financing", "$2,000
// over book" becomes "a strong offer". The agent does it better
// (outreachdraft.js); this always works.
export function stripFigures(message) {
  const src = String(message || "");
  const hits = moneyIn(src); // the advertised ones stay
  let out = src;
  for (const h of hits.slice().reverse()) {
    const after = src.slice(h.end, h.end + 24);
    const before = src.slice(Math.max(0, h.at - 12), h.at);
    let rep = "a strong offer", eat = 0;
    const t = h.text.toLowerCase();
    if (/%|percent/.test(t)) {
      const w = /^\s*(financing|apr|interest|rate)\b/i.exec(after);
      if (w) rep = "special";
      else if (/^\s*off\b/i.test(after)) { rep = "a real discount"; eat = /^\s*off\b/i.exec(after)[0].length; }
      else rep = "a special rate";
    } else if (/^apr$/i.test(t)) rep = "rate";
    else if (/(?:a|per)\s?(?:month|mo|week|wk)$/i.test(t)) rep = "a payment that works";
    else if (/^(?:up to|over|an extra|another)\s*$/i.test(before.trim().split(/\s+/).slice(-2).join(" ")) || /^(?:up to|over|an extra|another)\s*$/i.test(before.trim().split(/\s+/).slice(-1).join(" "))) {
      const lead = /(?:up to|over|an extra|another)\s*$/i.exec(before)[0];
      out = out.slice(0, h.at - lead.length) + out.slice(h.at); // drop "up to"
      const shift = lead.length;
      out = out.slice(0, h.at - shift) + rep + out.slice(h.end - shift + eat);
      continue;
    }
    out = out.slice(0, h.at) + rep + out.slice(h.end + eat);
  }
  return out.replace(/\b(a strong offer)\s+(a strong offer)\b/g, "$1").replace(/\s{2,}/g, " ").trim();
}

// A label for the audience, for the screen and the spoken reply: "Sentra owners".
export function describeAudience(spec) {
  const a = spec.audience || spec;
  const cap = (s) => s.split(/[\s-]+/).map((w) => (/^[a-z]{1,3}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  if (a.unknown && a.unknown.length) return `nobody yet — didn't understand ${a.unknown.map((u) => `"${u}"`).join(", ")}`;
  const bits = [];
  if (a.yearMin != null && a.yearMax != null && a.yearMin === a.yearMax) bits.push(String(a.yearMin));
  else if (a.yearMin != null && a.yearMax != null) bits.push(`${a.yearMin}–${a.yearMax}`);
  else if (a.yearMin != null) bits.push(`${a.yearMin} and newer`);
  else if (a.yearMax != null) bits.push(`${a.yearMax} and older`);
  const BODY = { suv: "SUV", truck: "truck", car: "sedan / hatchback", van: "van", sports: "sports car" };
  const kind = a.body ? BODY[a.body] || a.body : "";
  if (a.models.length) bits.push(a.models.map(cap).join(" / ") + " owners");
  else if (a.makes.length) bits.push(a.makes.map(cap).join(" / ") + (kind ? " " + kind : "") + " owners");
  else if (a.nissan) bits.push("Nissan " + (kind ? kind + " " : "") + "owners");
  else if (kind) bits.push(kind + " owners");
  else if (a.stages.length && a.stages.every((s) => ["sold", "delivered"].includes(s))) bits.push("past customers");
  else if (a.stages.length && a.stages.every((s) => ["new", "working", "appointment", "negotiating"].includes(s))) bits.push("open leads");
  else if (a.stages.length) bits.push(a.stages.join(" / ") + " customers");
  else bits.push("everyone");
  const extra = [];
  if (a.models.length && kind) extra.push(kind);
  if (a.paidOff) extra.push("paid off");
  if (a.equity) extra.push("with equity");
  if (a.lease) {
    const say = (iso) => { const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-CA", { month: "short", year: "numeric" }); };
    extra.push(a.leaseFrom && a.leaseUntil && a.leaseFrom.slice(0, 7) === a.leaseUntil.slice(0, 7) ? `lease ending ${say(a.leaseUntil)}` : a.leaseUntil ? `lease ending by ${say(a.leaseUntil)}` : "lease ending");
  }
  if (a.ownedYears != null) extra.push(`owned ${a.ownedYears}+ years`);
  if (a.quietDays != null) extra.push(`not reached in ${a.quietDays} days`);
  return bits.join(" ") + (extra.length ? " · " + extra.join(" · ") : "");
}
