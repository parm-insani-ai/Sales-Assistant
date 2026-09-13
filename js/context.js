// What we know about a customer beyond their name and number.
//
// "Parm is looking for a Rogue, loves the SV moonroof, open to new or used,
// wants to be around thirty." Said once, in passing, and it is the whole
// reason the next five texts can be about *his* car rather than "a vehicle".
// So none of it is allowed to fall on the floor: the structured parts land in
// `profile`, where the follow-up plan and the drafter can read them, and the
// sentence itself is kept in the notes, dated, so nothing the salesperson
// heard is lost to the fields they happened to be given.

import * as store from "./store.js";

// The facts that change what you'd say to someone. Each has a label for the
// profile card and a one-line hint for the model that extracts it.
export const PROFILE_FIELDS = [
  { key: "trim", label: "Trim", type: "string", hint: "trim level they want or like (SV, SL, Platinum…)" },
  { key: "features", label: "Must-haves", type: "list", hint: "features they mentioned wanting (moonroof, AWD, tow package, heated seats…)" },
  { key: "newUsed", label: "New or used", type: "enum", values: ["new", "used", "either"], hint: "new, used, or either" },
  { key: "budget", label: "Budget", type: "money", hint: "their price ceiling or payment target in dollars, as a number" },
  { key: "budgetNote", label: "Budget note", type: "string", hint: "how they phrased the budget if it isn't a plain number ('under thirty', 'around $450 a month')" },
  { key: "timeline", label: "Timeline", type: "string", hint: "when they want to buy ('this month', 'when the lease is up in March', 'just looking')" },
  { key: "tradeIn", label: "Trade-in", type: "string", hint: "what they'd trade, if anything" },
  { key: "financing", label: "Financing", type: "string", hint: "cash, finance, lease, pre-approved, credit concerns" },
  { key: "hotButtons", label: "What matters to them", type: "list", hint: "why they're shopping and what would win them: safety for a new baby, fuel economy, a colour, a bad experience elsewhere" },
  { key: "people", label: "Who else", type: "string", hint: "spouse, co-signer, who else is in the decision" },
];

const first = (name) => String(name || "there").trim().split(/\s+/)[0];
const today = () => new Date().toISOString().slice(0, 10);

function asList(v) {
  if (v == null || v === "") return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v).split(/,|;|\band\b/).map((x) => x.trim()).filter(Boolean);
}
function union(a, b) {
  const out = [...asList(a)];
  asList(b).forEach((x) => { if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x); });
  return out;
}
// "thirty", "twenty-five", "thirty five hundred", "four fifty" — a budget is
// usually said, not typed, and speech engines write small numbers as words.
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToNumber(s) {
  const words = String(s).toLowerCase().replace(/-/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  let total = 0, cur = 0, seen = false;
  for (const w of words) {
    if (w in SMALL) { cur += SMALL[w]; seen = true; }
    else if (w in TENS) { cur += TENS[w]; seen = true; }
    else if (w === "hundred") { cur = (cur || 1) * 100; seen = true; }
    else if (w === "thousand" || w === "grand" || w === "k") { total += (cur || 1) * 1000; cur = 0; seen = true; }
    else if (seen) break;
  }
  return seen ? total + cur : null;
}
function asMoney(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).toLowerCase().replace(/,/g, "");
  const m = /(\d+(?:\.\d+)?)\s*(k|grand|thousand)?/.exec(s);
  let n;
  if (m) { n = Number(m[1]); if (m[2]) n *= 1000; }
  else { n = wordsToNumber(s); if (n == null) return null; }
  // "30" on its own for a car is thirty thousand, not thirty dollars.
  if (n < 1000 && !/(month|mo\b|\/m)/.test(s)) n *= 1000;
  return n;
}

/**
 * Add what was just learned about a customer. `note` is the sentence as
 * spoken or typed; everything else is a PROFILE_FIELDS key. Lists merge,
 * scalars replace, and the note is appended to the customer's notes with
 * today's date. Returns what changed.
 */
export function addContext(leadId, input = {}) {
  const lead = store.get("leads", leadId);
  if (!lead) return null;
  const profile = { ...(lead.profile || {}) };
  const changed = [];
  PROFILE_FIELDS.forEach((f) => {
    const v = input[f.key];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    if (f.type === "list") { const merged = union(profile[f.key], v); if (merged.length !== asList(profile[f.key]).length) changed.push(f.key); profile[f.key] = merged; }
    else if (f.type === "money") { const n = asMoney(v); if (n != null && n !== profile[f.key]) { profile[f.key] = n; changed.push(f.key); } }
    else if (f.type === "enum") { const s = String(v).toLowerCase().trim(); const val = f.values.includes(s) ? s : /both|open|any/.test(s) ? "either" : null; if (val && val !== profile[f.key]) { profile[f.key] = val; changed.push(f.key); } }
    else { const s = String(v).trim(); if (s && s !== profile[f.key]) { profile[f.key] = s; changed.push(f.key); } }
  });
  const patch = { profile };
  const note = String(input.note || "").trim();
  if (note) {
    const line = `${today()} — ${note}`;
    const existing = String(lead.notes || "").trim();
    // The same sentence twice (a retried voice command) is one note.
    if (!existing.includes(note)) patch.notes = existing ? `${existing}\n${line}` : line;
    changed.push("note");
  }
  if (input.vehicle && input.vehicle !== lead.vehicleInterest) { patch.vehicleInterest = input.vehicle; changed.push("vehicle"); }
  if (!changed.length) return { lead, changed };
  store.update("leads", lead.id, patch);
  return { lead: store.get("leads", lead.id), changed };
}

// The profile as short label/value pairs, for the customer's page.
export function profileLines(lead) {
  const p = (lead && lead.profile) || {};
  const out = [];
  PROFILE_FIELDS.forEach((f) => {
    const v = p[f.key];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    if (f.type === "list") out.push({ label: f.label, value: v.join(", ") });
    else if (f.type === "money") out.push({ label: f.label, value: "$" + Math.round(v).toLocaleString("en-CA") + (p.budgetNote ? "" : "") });
    else if (f.key === "budgetNote" && p.budget != null) return; // folded into Budget when there's a number
    else if (f.type === "enum") out.push({ label: f.label, value: v === "either" ? "Open to either" : v[0].toUpperCase() + v.slice(1) });
    else out.push({ label: f.label, value: v });
  });
  return out;
}

export function hasContext(lead) {
  return !!(lead && ((lead.notes && lead.notes.trim()) || profileLines(lead).length));
}

/**
 * The brief a message-writer gets. Everything qualitative; the budget in
 * particular is never handed over as a figure. The customer said it, but a
 * text that quotes it back reads as a price, and no price leaves this app
 * before the customer is at the desk.
 */
export function briefFor(lead) {
  const p = (lead && lead.profile) || {};
  const lines = [];
  lines.push(`Name: ${first(lead.name)}`);
  if (lead.vehicleInterest) lines.push(`Looking at: ${lead.vehicleInterest}`);
  if (p.trim) lines.push(`Trim they like: ${p.trim}`);
  if (asList(p.features).length) lines.push(`Must-haves: ${asList(p.features).join(", ")}`);
  if (p.newUsed) lines.push(`New or used: ${p.newUsed === "either" ? "open to either" : p.newUsed}`);
  if (p.budget != null || p.budgetNote) lines.push(`Budget: they have one in mind (do NOT state it — never put a dollar figure in a message)`);
  if (p.timeline) lines.push(`Timeline: ${p.timeline}`);
  if (p.tradeIn) lines.push(`Trade-in: ${p.tradeIn}`);
  if (p.financing) lines.push(`Financing: ${p.financing}`);
  if (asList(p.hotButtons).length) lines.push(`What matters to them: ${asList(p.hotButtons).join("; ")}`);
  if (p.people) lines.push(`Also involved: ${p.people}`);
  const notes = String(lead.notes || "").trim();
  if (notes) lines.push(`Notes from the salesperson:\n${redactMoney(notes.split("\n").slice(-8).join("\n"))}`);
  return lines.join("\n");
}

// Take the figures out of a note before a message-writer sees it. The note
// keeps them for the salesperson; the model never gets a number to repeat.
export function redactMoney(text) {
  // Dates are not figures. Set them aside first, put them back after.
  const dates = [];
  const kept = String(text || "").replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => { dates.push(d); return `${dates.length - 1}`; });
  return kept
    .replace(/\$\s?[\d,.]+\s*(k|grand|thousand)?\b/gi, "[a figure]")
    .replace(/\b\d{1,3}\s?(k|grand)\b/gi, "[a figure]")
    .replace(/\b\d{1,3}(,\d{3})+\b/g, "[a figure]")
    .replace(/\b\d{4,6}\b(?!\s*(km|kms|kilomet))/g, "[a figure]")
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|[a-z]+teen|ten|hundred)([\s-]+(one|two|three|four|five|six|seven|eight|nine|hundred))*\s+(thousand|grand|k)\b/gi, "[a figure]")
    .replace(/(\d+)/g, (m, i) => dates[Number(i)]);
}
