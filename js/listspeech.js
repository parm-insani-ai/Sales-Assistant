// A list, said out loud: "Rogue owners with equity I haven't reached in
// ninety days, highest rate first, call it Rogue equity."
//
// One sentence becomes what the Outreach screen already has switches for:
// the cuts on the row (same payment, equity, contract ending, high rate,
// warranty, in service, quiet, no number), the sheet's audience (what they
// drive, the years, paid off, lease ending by when, owned so long, quiet
// so many days, past customers or open leads), the chip (Best now,
// Follow up, Contacted, All), the order, and a name to save it under.
// Pure functions over strings, so node can test them; the screen applies
// the result.

import { parseOutreach, isEveryone, listAudienceGaps, heard, isBlast, isProspecting, aboutPeople, aboutTheLot, describeAudience } from "./outreach.js";

const norm = (s) => String(s || "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100 };

// The order, in the words a person uses for it.
const SORT_SAID = [
  { key: "rate", re: /\b(?:highest|biggest|worst|steepest) (?:interest )?(?:rates?|aprs?)(?: first)?\b|\bby (?:interest )?rate\b|\brate first\b|\bworst rate first\b/ },
  { key: "equity", re: /\bmost equity(?: first)?\b|\bby equity\b|\bequity first\b|\bbiggest equity(?: first)?\b/ },
  { key: "quiet", re: /\blongest quiet(?: first)?\b|\bquietest first\b|\bby (?:last contact|silence|quiet)\b|\bleast recently (?:contacted|reached)(?: first)?\b|\boldest contact first\b|\bhaven'?t (?:talked to|spoken to|reached|contacted|heard from) (?:in |for )?the longest(?: first)?\b/ },
  { key: "timing", re: /\bsoonest (?:window|first)\b|\bby (?:timing|window|when)\b|\bwindow first\b|\bsoonest\b/ },
  { key: "best", re: /\bbest first\b|\bby best\b|\bbest ones first\b/ },
];

// The chip: which work state the list sits over.
const CHIP_SAID = [
  { key: "due", re: /\bfollow[- ]?ups?\b|\b(?:over)?due\b/ },
  { key: "contacted", re: /\b(?:already|i'?ve|i have|we'?ve|been|that were|who were|that i'?ve|who i'?ve|that i|who i) (?:contacted|reached|called|talked to|spoken to|texted)\b|\bcontacted (?:already|before|ones|people|customers)\b|\bthe contacted\b/ },
  // "haven't contacted" with no number is the untouched book; with a number
  // ("in 90 days") it's how long since, which the audience reads.
  { key: "tocontact", re: /\b(?:never|not yet|haven'?t(?: been)?|not(?: been)?|still to be|yet to be|un)[ -]?(?:contacted|reached|called|talked to|spoken to|touched|worked)\b(?![^.]{0,25}\d+\s*(?:days?|weeks?|months?|years?))|\bbest now\b|\btoday'?s batch\b|\bnew to me\b|\bfresh ones\b/ },
];

// The reasons on the row, as said. Equity is read by the audience parser
// and moved onto the row (it's a chip there).
const CUT_SAID = [
  { key: "payment", re: /\bsame (?:or (?:lower|cheaper|less) )?payments?\b|\b(?:lower|cheaper|better|lesser) payments?\b|\bpayment (?:match|play|swap)\b|\bon (?:the |a )?(?:same )?payment\b|\bpayment people\b|\bpayment\b/ },
  { key: "ending", re: /\b(?:contract|term|finance|financing|loan|financing term)s? (?:is |are |that'?s )?(?:ending|ends|coming up|almost up|up|almost (?:done|paid|over)|nearly (?:done|over)|finishing|about to end|running out)\b|\bend of (?:their |the )?(?:contract|term|loan|financing)\b|\bcoming to the end\b|\bcontract ending\b|\bcontracts ending\b|\bout of (?:their )?(?:contract|term)\b/ },
  { key: "cycle", re: /\b(?:trade|buying|replacement) cycle\b|\bdue for a (?:trade|new one|new car|new vehicle)\b|\bin (?:the |their )?cycle\b|\btime to trade\b|\bowned (?:for )?(?:3|three)\+? ?(?:plus |or more )?years\b|\bthree[- ]plus years\b|\b3\+ years\b/ },
  { key: "rate", re: /\bhigh(?:er)? (?:interest )?(?:rates?|aprs?)\b|\bhigh (?:interest|apr)\b|\bbad rates?\b|\bpaying too much interest\b|\bexpensive (?:rates?|money)\b|\brates? (?:over|above|more than) \d+(?:\.\d+)?\s*(?:%|percent)?\b|\b(?:over|above|more than) \d+(?:\.\d+)?\s*(?:%|percent)(?: interest| rate| apr)?\b/ },
  { key: "warranty", re: /\bwarrant(?:y|ies)(?: (?:ending|ends|running out|expiring|expires|almost up|up))?\b/ },
  { key: "service", re: /\bin (?:the )?(?:service|drive|shop|service (?:lane|drive|bay))\b|\bservice (?:appointments?|appts?|visits?|booked|customers|lane|drive)\b|\bcoming in for service\b|\bbooked (?:in|for) service\b|\bin for service\b/ },
  { key: "quiet", re: /\b(?:gone |been )?quiet(?: ones| people| customers)?\b(?![^.]{0,12}\bfirst\b)|\bhaven'?t heard from\b(?![^.]{0,25}\d)|\bnot heard from\b(?![^.]{0,25}\d)|\bno contact\b|\b(?:haven'?t|hasn'?t|not)(?: been)? (?:contacted|reached|talked to|spoken to|texted|called)\s+(?:in|for)\s+(?:a while|ages|months|a long time|forever)\b|\bsilent\b/ },
  { key: "nonumber", re: /\b(?:no|without|missing|need|needs|needing) (?:a )?(?:phone )?numbers?\b|\bno phone\b|\bwithout a phone\b|\bwrong numbers?\b|\bbad numbers?\b/ },
];

// "call it Rogue equity", "save it as my Friday list", "named Hot Rogues".
const NAME_RE = /\b(?:and )?(?:(?:call|name|label|title) (?:it|this|that|the list|them)|save (?:it |this |that |them |the list )?(?:as|under|called)|named?|called)\s+["“]?([^"”]{2,60}?)["”]?\s*[.!]?\s*$/;

// Word numbers before a unit become digits, so "in three months" reads the
// same as "in 3 months" everywhere downstream.
function digitsFor(t) {
  return t
    // Words the mic splits or bends.
    .replace(/\bequ\s+ity\b/g, "equity").replace(/\bpay\s+ment\b/g, "payment").replace(/\bwar\s+ranty\b/g, "warranty").replace(/\bcon\s+tract\b/g, "contract").replace(/\bfollow\s+up'?s\b/g, "follow-ups")
    .replace(/\b(a couple of|a couple|a few|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety|hundred)\s+(days?|weeks?|months?|years?|percent|%)\b/g, (m, w, u) => `${/couple/.test(w) ? 2 : w === "a few" ? 3 : NUM[w]} ${u}`)
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:and a half\s+)?(?:percent|%)\b/g, (m, w) => `${NUM[w]}%`);
}

/**
 * Read the sentence.
 *   { said, name, save, sort, chip, cuts, audience, unknown, empty }
 *   cuts: keys on the Cut row; audience: the sheet's spec, or null when
 *   nothing narrows there; unknown: the words that read as nothing.
 */
export function parseList(text, now = Date.now()) {
  const said = norm(text);
  let t = " " + digitsFor(heard(said.toLowerCase())) + " ";
  const out = { said, name: "", save: false, sort: null, chip: null, cuts: [], audience: null, unknown: [], empty: true };
  const take = (re) => { const m = re.exec(t); if (m) t = t.replace(m[0], " "); return m; };
  // The name keeps the case it was said in; the rest is read lowercased.
  const nm = take(NAME_RE);
  if (nm) {
    const asSaid = new RegExp(NAME_RE.source, "i").exec(said);
    out.name = norm(asSaid ? asSaid[1] : nm[1]).replace(/^(?:the|a|my)\s+/i, "").replace(/\s+list$/i, "") || "";
    out.save = !!out.name;
  }
  for (const s of SORT_SAID) if (take(s.re)) { out.sort = s.key; break; }
  for (const c of CHIP_SAID) if (take(c.re)) { out.chip = c.key; break; }
  for (const c of CUT_SAID) if (take(c.re)) out.cuts.push(c.key);
  // Everything else is what they drive and where they stand.
  const { audience: a, message } = parseOutreach(t, now);
  if (a.equity && !out.cuts.includes("equity")) out.cuts.push("equity");
  a.equity = false;
  const unknown = listAudienceGaps(a.unknown.concat(message ? [message] : []));
  out.unknown = unknown;
  a.unknown = [];
  out.audience = isEveryone(a) ? null : { ...a, everyone: false, text: said };
  out.empty = !out.cuts.length && !out.audience && !out.chip && !out.sort;
  return out;
}

// The list in words, for the voice reply and a saved name: "Rogue owners ·
// Equity · Quiet 6+ mo on Best now, highest rate first".
const CUT_LABEL = { payment: "Same payment", equity: "Equity", ending: "Contract ending", cycle: "Owned 3+ yrs", rate: "High rate", warranty: "Warranty ending", service: "In service", quiet: "Quiet 6+ mo", nonumber: "No number" };
const SORT_LABEL = { best: "best", timing: "soonest window", quiet: "longest quiet", equity: "most equity", rate: "highest rate" };
const CHIP_LABEL = { tocontact: "Best now", due: "Follow up", contacted: "Contacted", all: "All" };
export function describeList(spec) {
  const bits = [spec.audience ? describeAudience(spec.audience) : "", ...spec.cuts.map((k) => CUT_LABEL[k] || k)].filter(Boolean);
  let s = bits.length ? bits.join(" · ") : "everyone";
  if (spec.chip) s += ` on ${CHIP_LABEL[spec.chip] || spec.chip}`;
  if (spec.sort && spec.sort !== "best") s += `, ${SORT_LABEL[spec.sort]} first`;
  return s;
}

// Said to the Home mic, is this a list for Outreach? A sentence about the
// people on file (or one that names a chip, or asks to save) that reads as
// something — not a blast, not a question about the lot. "What's the
// payment on a Rogue" names a reason and a model and is still not a list:
// nothing in it is about people.
export function isListRequest(text, now = Date.now()) {
  const t = String(text || "").toLowerCase();
  if (aboutTheLot(t) || isBlast(t, now) || isProspecting(t)) return false;
  const spec = parseList(t, now);
  if (spec.empty) return false;
  // From Home, words it couldn't place mean the sentence is the assistant's
  // to weigh whole — unless a name was given, which says "a list" plainly.
  if (spec.unknown.length && !spec.save) return false;
  return aboutPeople(t) || /\b(?:a |the |my )?lists?\b|\broster\b|\bline ?up\b/.test(t) || !!spec.chip || spec.save;
}

// What the screen can read, for the sheet's own hint and the voice reply.
export const LIST_HELP = "what they drive (a model, SUV / truck / sedan, years), where they stand (paid off, equity, same payment, contract or lease ending, high rate, warranty ending, in service, owned 3+ years, quiet, not reached in 90 days, no number), the chip (not contacted, contacted, follow-ups), the order (highest rate first, most equity, longest quiet, soonest window) — and \"call it …\" to save it";
