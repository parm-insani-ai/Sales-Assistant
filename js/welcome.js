// The manager's welcome text: the rules, in one place.
//
// When a rep logs a customer who came in, the manager's message goes out on
// its own — but not on the rep's heels, and never at a machine's pace: a
// delay of an hour or two that differs per customer, never within half an
// hour of the rep's own text, only during the store's day, once. The
// function's ten-minute sweep applies these same rules on the server
// (supabase/functions/voice-agent/index.ts, welcomePass); this copy lets the
// manager's screen say who's due and lets node pin the rules.

const MIN = 60000;

export const DEFAULT_WELCOME = {
  enabled: false,
  manager: "",                 // the manager's name in the text
  template: "Hi {first}, it's {manager}, the sales manager at {store}. Thanks for coming in to see {rep} — we'd love to help in any way we can. If there's anything at all, you can reach me right here.",
  minMinutes: 45,              // never sooner than this after the customer is logged
  maxMinutes: 150,             // and, per customer, somewhere up to this
  gapMinutes: 30,              // never within this of the rep's own text, either side
  hourFrom: 9, hourTo: 20,     // the store's day, local
  maxAgeDays: 3,               // after this it's too late to be a welcome
  tzOffsetMinutes: 180,        // Halifax in daylight time; the app keeps it current
};

// A stable 0–1 for a customer id, so the same person always gets the same
// delay and two customers logged together don't get texted together.
export function hashPct(id) {
  let h = 2166136261;
  for (const ch of String(id || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 1000) / 1000;
}

// This customer's own delay, in minutes.
export function delayFor(lead, cfg = DEFAULT_WELCOME) {
  const min = Number(cfg.minMinutes ?? 45), max = Math.max(min, Number(cfg.maxMinutes ?? 150));
  return Math.round(min + hashPct(lead.id) * (max - min));
}

// The local hour where the store is, from a UTC time and the store's offset
// (minutes behind UTC, e.g. 180 for ADT).
export function localHour(now, tzOffsetMinutes) {
  return new Date(now - Number(tzOffsetMinutes || 0) * MIN).getUTCHours();
}

/**
 * Should the welcome go to this customer now?
 *   lead:  the customer's row
 *   texts: the rep's texts with this customer [{ dir, at, via }]
 *   cfg:   the store's welcome config (DEFAULT_WELCOME shape)
 *   now:   ms
 * Returns { due, why } — `why` says what's holding it when it isn't.
 */
export function welcomeDue(lead, texts, cfg = DEFAULT_WELCOME, now = Date.now()) {
  const c = { ...DEFAULT_WELCOME, ...(cfg || {}) };
  if (!c.enabled) return { due: false, why: "off" };
  if (lead.managerWelcomeAt) return { due: false, why: "already welcomed" };
  if (!lead.phone) return { due: false, why: "no phone" };
  if (lead.smsOptOut || lead.doNotContact || (lead.consent && lead.consent.basis === "withdrawn")) return { due: false, why: "opted out" };
  if (String(lead.source || "").toLowerCase() === "text") return { due: false, why: "came in by text, not in person" };
  if (!["new", "working", "appointment"].includes(lead.stage)) return { due: false, why: "not a fresh enquiry" };
  if (lead.purchaseDate) return { due: false, why: "an owner on file, not a visit" };
  const created = new Date(lead.createdAt || "").getTime();
  if (!isFinite(created)) return { due: false, why: "no arrival time" };
  const ageMin = (now - created) / MIN;
  if (ageMin > c.maxAgeDays * 1440) return { due: false, why: "too late to be a welcome" };
  const delay = delayFor(lead, c);
  if (ageMin < delay) return { due: false, why: `waits until ${delay} min after arrival`, inMinutes: Math.ceil(delay - ageMin) };
  const h = localHour(now, c.tzOffsetMinutes);
  if (!(h >= c.hourFrom && h < c.hourTo)) return { due: false, why: "outside the store's hours" };
  // Not on the rep's heels, and not into the middle of a conversation.
  const gap = c.gapMinutes * MIN;
  for (const t of texts || []) {
    const at = new Date(t.at || t.createdAt || "").getTime();
    if (!isFinite(at)) continue;
    if (t.dir === "out" && !/manager/.test(String(t.via || "")) && Math.abs(now - at) < gap) return { due: false, why: `the rep texted them ${Math.round((now - at) / MIN)} min ago` };
    if (t.dir === "in" && now - at < 15 * MIN) return { due: false, why: "they're texting the rep right now" };
  }
  return { due: true, why: "" };
}

// The text itself, in the store's words.
export function welcomeText(lead, { manager = "", store = "", rep = "" } = {}, template = DEFAULT_WELCOME.template) {
  const first = String(lead.name || "there").trim().split(/\s+/)[0] || "there";
  let t = String(template || DEFAULT_WELCOME.template)
    .replace(/\{first\}/g, first).replace(/\{manager\}/g, manager || "the sales manager").replace(/\{store\}/g, store || "the store").replace(/\{rep\}/g, rep || "us");
  // A template written without the rep's name still reads well.
  t = t.replace(/ to see us\b/g, " to see us").replace(/\s{2,}/g, " ").trim();
  return t;
}
