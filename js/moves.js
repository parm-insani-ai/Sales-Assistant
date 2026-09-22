// Next moves — what the app does with what you just learned.
//
// A note is not filed and forgotten. Each thing it says maps to a move that
// raises the odds of closing, taken right away and shown back:
//
//   "coming Saturday at 2"        → the appointment is booked, the plan steps
//                                   aside for it, a confirmation text is drafted
//   "loves the SV, wants a moonroof" → the SVs in stock are found and a text
//                                   about them is drafted; none in stock → a
//                                   task to locate one
//   "around thirty" / "$450 a month" → the vehicles that fit are counted and a
//                                   task to build the options
//   "wife has to sign off"        → a task to get her in the room; the next
//                                   text invites them both
//   "trading a 2019 Altima"       → a task to appraise it
//   "thinking about it" / "price" → a second option to prepare, and a text
//                                   two days out
//   "when the lease is up in March" / "next month" / "just looking"
//                                 → the plan waits for the moment, and a
//                                   check-back is dated
//   "needs financing"             → a task to line it up
//   "brother is looking too"      → a task to ask for the number
//   nothing in particular         → the follow-up plan runs, and its next text
//                                   is written from the note
//
// Tasks and appointments are created directly — they are the salesperson's
// own list and undo in one tap. Anything that goes TO the customer is a
// drafted text held for approval, as always; nothing here sends.

import * as store from "./store.js";
import { planSteps, deferPlan, hasCadence, startCadence } from "./cadence.js";
import { dealsForLead } from "./views/dealbuilder.js";
import { addDaysISO } from "./cadence.js";
import { relativeDay, formatDateTime } from "./utils.js";

const first = (name) => String(name || "there").trim().split(/\s+/)[0];
const lower = (s) => String(s || "").toLowerCase();
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MAKES = /\b(honda|toyota|hyundai|kia|mazda|ford|chev(y|rolet)?|gmc|subaru|vw|volkswagen|jeep|ram|dodge|tesla|bmw|audi|mercedes|lexus|acura|volvo|mitsubishi)\b/;

// --- When did they say? -----------------------------------------------------
// "Saturday at 2", "tomorrow at 10:30", "Friday afternoon", "coming in
// Thursday". A day and a clock time books; a day alone is a time to pin down.
export function parseWhen(text, now = new Date()) {
  const t = lower(text).replace(/\bo'?clock\b/g, "");
  let day = null, dayWord = null;
  if (/\btomorrow\b/.test(t)) { day = new Date(now); day.setDate(day.getDate() + 1); dayWord = "tomorrow"; }
  else if (/\b(today|tonight|this afternoon|this evening|this morning)\b/.test(t)) { day = new Date(now); dayWord = "today"; }
  else {
    for (let i = 0; i < 7; i++) {
      const re = new RegExp(`\\b(next\\s+)?(${DAYS[i]}|${SHORT[i]})\\b`);
      const m = re.exec(t);
      if (!m) continue;
      day = new Date(now);
      let ahead = (i - now.getDay() + 7) % 7;
      if (ahead === 0 && !m[1]) ahead = /\b(this|today)\b/.test(t) ? 0 : 7; // "Saturday" on a Saturday means next week, unless "this Saturday"
      if (m[1] && ahead === 0) ahead = 7;
      day.setDate(day.getDate() + ahead);
      dayWord = DAYS[i];
      break;
    }
    if (!day && /\bthis weekend\b/.test(t)) { day = new Date(now); day.setDate(day.getDate() + ((6 - now.getDay() + 7) % 7 || 7)); dayWord = "saturday"; }
  }
  if (!day) return null;
  // The clock.
  let h = null, min = 0;
  const clock = /\b(?:at|around|about|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/.exec(t) || /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/.exec(t);
  if (clock) {
    h = Number(clock[1]); min = Number(clock[2] || 0);
    const ap = (clock[3] || "").replace(/\./g, "");
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 7) h += 12; // "at 2" at a dealership is 2 in the afternoon
    if (h > 23 || min > 59) h = null;
  } else if (/\bnoon\b/.test(t)) h = 12;
  else if (/\bmorning\b/.test(t)) h = 10;
  else if (/\bafternoon\b/.test(t)) h = 14;
  else if (/\b(evening|tonight|after work)\b/.test(t)) h = 18;
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return { date, time: h == null ? null : `${pad(h)}:${pad(min)}`, when: h == null ? null : `${date}T${pad(h)}:${pad(min)}`, dayWord };
}

// A far-off moment: "next month", "in the spring", "in March", "in two
// weeks", "when the lease is up in March", "just looking". Returns YYYY-MM-DD.
export function parseLater(text, now = new Date()) {
  const t = lower(text);
  const d = new Date(now);
  const iso = (x) => x.toISOString().slice(0, 10);
  let m;
  if ((m = /\bin\s+(a|one|two|three|four|five|six|\d+)\s+(week|month)s?\b/.exec(t))) {
    const n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[m[1]] ?? Number(m[1]);
    d.setDate(d.getDate() + n * (m[2] === "week" ? 7 : 30));
    return iso(d);
  }
  if (/\bnext month\b/.test(t)) { d.setMonth(d.getMonth() + 1, 1); return iso(d); }
  if (/\bnext year\b/.test(t)) { d.setFullYear(d.getFullYear() + 1, 0, 15); return iso(d); }
  if (/\b(end of (the )?month)\b/.test(t)) { d.setMonth(d.getMonth() + 1, 0); return iso(d); }
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${MONTHS[i]}\\b`).test(t)) {
      const x = new Date(d.getFullYear(), i, 1);
      if (x <= d) x.setFullYear(x.getFullYear() + 1);
      return iso(x);
    }
  }
  const season = { spring: [2, 15], summer: [5, 15], fall: [8, 15], autumn: [8, 15], winter: [11, 15] };
  for (const [w, [mo, da]] of Object.entries(season)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) { const x = new Date(d.getFullYear(), mo, da); if (x <= d) x.setFullYear(x.getFullYear() + 1); return iso(x); }
  }
  if (/\b(just looking|no rush|not in a hurry|few months|down the road|not (until|till))\b/.test(t)) { d.setDate(d.getDate() + 21); return iso(d); }
  return null;
}

// Money in a note: "$30k", "30,000", "around thirty", "450 a month".
const SMALL = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function parseMoney(text) {
  const t = lower(text).replace(/,/g, "");
  let m;
  if ((m = /\$\s?(\d+(?:\.\d+)?)\s*(k|grand|thousand)?\b/.exec(t)) || (m = /\b(\d{2,3}(?:\.\d)?)\s*(k|grand|thousand)\b/.exec(t)) || (m = /\b(\d{3,6})\b(?=\s*(?:dollars|bucks|a month|per month|\/mo|monthly|budget|max|tops|total|out the door|all in))/.exec(t))) {
    let n = Number(m[1]);
    if (m[2]) n *= 1000;
    return n;
  }
  if ((m = /\b(around|about|under|below|max(?:imum)?|up to|budget(?: of| is)?|at)\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\b/.exec(t))) {
    return (SMALL[m[2]] + (m[3] ? SMALL[m[3]] : 0)) * 1000;
  }
  if ((m = /\b(\d{3})\s*(?:a|per)\s*month\b/.exec(t))) return Number(m[1]);
  return null;
}

// --- The moves ------------------------------------------------------------
function openTasksFor(leadId) {
  return store.all("tasks").filter((t) => t.leadId === leadId && !t.done);
}
function haveTask(leadId, title) {
  return openTasksFor(leadId).some((t) => t.title === title);
}
function vehicleName(v) { return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ").trim(); }
function inStock() { return store.all("vehicles").filter((v) => (v.status || "available") === "available"); }

// The model they're after, from the note or what's on file.
function wantedModel(lead, t) {
  const stock = inStock();
  const models = new Set(stock.map((v) => lower(v.model)).filter(Boolean));
  ["rogue", "kicks", "sentra", "altima", "pathfinder", "murano", "frontier", "titan", "ariya", "leaf", "versa", "armada", "z"].forEach((m) => models.add(m));
  const found = [...models].filter((m) => m.length > 1 && new RegExp(`\\b${m}\\b`).test(t));
  if (found.length) return found.sort((a, b) => b.length - a.length)[0];
  const vi = lower(lead.vehicleInterest);
  return [...models].find((m) => m.length > 1 && new RegExp(`\\b${m}\\b`).test(vi)) || null;
}
const TRIMS = ["platinum", "sl", "sv", "sr", "s", "pro-4x", "pro4x", "rock creek", "midnight", "nismo"];
function wantedTrim(lead, t) {
  const p = (lead.profile || {});
  const said = TRIMS.find((x) => new RegExp(`\\b${x.replace(/[-]/g, "[- ]?")}\\b`).test(t));
  return said || (p.trim ? lower(p.trim) : null);
}
function matchesFeatures(v, feats) {
  if (!feats.length) return true;
  const hay = lower([v.notes, v.trim, v.model, v.color].join(" "));
  return feats.every((f) => hay.includes(f));
}

/**
 * Work out and take the moves for a note. Returns { moves } where each move
 * is { kind, title, detail? , taskId?, appointmentId? }. Idempotent for the
 * same note: a task already open with the same title is not made twice.
 */
export function nextMoves(leadId, note) {
  const lead = store.get("leads", leadId);
  if (!lead) return { moves: [] };
  const t = lower(note);
  const fn = first(lead.name);
  const moves = [];
  const today = new Date().toISOString().slice(0, 10);

  const task = (title, { due = today, priority = "normal", channel = "", intent = "", why = [], cadence = false } = {}) => {
    if (haveTask(leadId, title)) return null;
    const rec = store.create("tasks", { title, due, priority, done: false, leadId, source: "context", channel, intent, why, cadence, readyAt: null });
    return rec.id;
  };
  const textStep = (label, intent, why, dueISO) => {
    // A drafted text, held for the salesperson's OK on Home like every plan step.
    const title = `Text ${fn} — ${label}`;
    if (haveTask(leadId, title)) return null;
    const steps = planSteps(leadId);
    const rec = store.create("tasks", { title, due: dueISO || today, priority: "high", done: false, leadId, source: "context", cadence: true, channel: "text", intent, why, readyAt: null, step: steps.length + 1, of: steps.length + 1 });
    return rec.id;
  };

  store.bulk(() => {
    // 0. Where they stand. A note that reads as shopping — a visit, a
    // vehicle, a number, "looking" — from someone filed as sold, delivered
    // or lost means they're back in the market: they become a customer
    // being worked, and the plan starts. The plan starts for anyone active
    // who doesn't have one; a note is an explicit act, so the automatic-
    // plan setting doesn't gate it here.
    const shopping = /\b(want|wants|looking|interested|shopping|come|coming|visit|test[- ]?drive|budget|trade|lease|financ)\w*/.test(t) || !!parseMoney(note) || !!parseWhen(note);
    let stage = lead.stage;
    if (["sold", "delivered", "lost"].includes(stage) && shopping) {
      stage = "working";
      store.update("leads", leadId, { stage });
      moves.push({ kind: "stage", title: "Back in the market — moved to Working", detail: `They were filed as ${lead.stage}.` });
    }
    const active = ["new", "working", "appointment", "negotiating"].includes(stage);
    const started = active && !hasCadence(leadId) ? startCadence(leadId) : 0;

    // 1. A day they named. "Call me Saturday" is a call to make; anything
    // else with a day is a visit — booked when there's a time, a time to pin
    // down when there isn't. The plan steps aside for a visit either way.
    const when = parseWhen(note);
    const callish = /\b(call|ring|phone|text|reach|get (back|hold of)|follow up with)\b[^.]{0,30}\b(me|him|her|them|back)\b|\b(call|ring|phone|text) (me|him|her|them)\b/.test(t);
    const visitish = /\b(com(e|es|ing)|stop(ping)? (by|in)|swing by|drop(ping)? (in|by)|appointment|appt|test[- ]?drive|meet|see (me|us|you|the|it|them)|look at|look(ing)? for|check (it )?out|book(ed)?|visit|be (in|here|there)|pop (in|by))\b/.test(t);
    if (when && callish && !visitish) {
      const label = when.when ? formatDateTime(when.when) : `${when.dayWord[0].toUpperCase()}${when.dayWord.slice(1)}`;
      const id = task(`Call ${fn} — they asked for ${label}`, { due: when.date, priority: "high", channel: "call" });
      if (id) moves.push({ kind: "task", title: `Call them ${label}`, detail: "They asked for it — on your list for that day.", taskId: id });
    } else if (when) {
      const label = when.when ? formatDateTime(when.when) : `${when.dayWord[0].toUpperCase()}${when.dayWord.slice(1)}`;
      const kind = /test[- ]?drive/.test(t) ? "testdrive" : "appointment";
      const already = store.all("appointments").find((a) => a.leadId === leadId && String(a.when || "").slice(0, 10) === when.date && a.status !== "cancelled");
      if (when.when && !already) {
        const a = store.create("appointments", { type: kind, title: kind === "testdrive" ? "Test drive" : "Appointment", customerName: lead.name, vehicle: lead.vehicleInterest || "", when: when.when, status: "scheduled", confirmed: false, outcome: "", leadId, notes: note });
        if (["new", "working"].includes(stage)) store.update("leads", leadId, { stage: "appointment" });
        deferPlan(leadId, when.date);
        moves.push({ kind: "appointment", title: `Booked ${fn} for ${label}`, detail: "On your calendar. The plan waits for the visit.", appointmentId: a.id });
        const id = textStep(`confirm ${label}`, "confirm", [`they said they're coming in ${label}`], today);
        if (id) moves.push({ kind: "text", title: "Confirmation text drafted", detail: "Waiting for your OK on Home.", taskId: id });
      } else if (when.when && already) {
        moves.push({ kind: "appointment", title: `Already booked for ${formatDateTime(already.when)}`, appointmentId: already.id });
      } else {
        const id = task(`Pin down a time with ${fn} for ${label}`, { priority: "high", channel: "call" });
        if (id) moves.push({ kind: "task", title: `Pin down a time for ${label}`, detail: "They named the day, not the hour.", taskId: id });
        deferPlan(leadId, when.date);
      }
    }

    // 1b. Voicemail. A short "tried you" text now, and the call again
    // tomorrow — the two things that turn a missed call into a conversation.
    if (/\b(voicemail|voice mail|left (him |her |them )?a message|no answer|didn'?t (pick up|answer)|no pick ?up|went to (voicemail|machine)|straight to voicemail)\b/.test(t)) {
      const tid = textStep("tried you — easy way back", "missed", ["you just called and got their voicemail"], today);
      if (tid) moves.push({ kind: "text", title: "\u201cTried you\u201d text drafted", detail: "Waiting for your OK on Home.", taskId: tid });
      const id = task(`Call ${fn} again — voicemail last time`, { due: addDaysISO(1), priority: "high", channel: "call" });
      if (id) moves.push({ kind: "task", title: "Call again tomorrow", detail: "A voicemail with no second call goes nowhere.", taskId: id });
    }

    // 2. The vehicle. What's in stock that fits, or the fact that nothing is.
    // The car they're trading is not the car they want.
    const tradeless = t.replace(/\b(trad(?:e|ing)(?:[- ]in)?|payoff on|owes? on)\b[^,.;]*/g, " ");
    const model = wantedModel(lead, tradeless);
    const trim = wantedTrim(lead, t);
    const feats = ["moonroof", "sunroof", "awd", "all-wheel", "tow", "heated", "leather", "navigation", "hybrid", "third row", "7 seat", "apple carplay"].filter((f) => t.includes(f));
    const trimSaid = !!trim && TRIMS.some((x) => new RegExp(`\\b${x.replace(/[-]/g, "[- ]?")}\\b`).test(tradeless));
    const vehicleTalk = !!(model && (new RegExp(`\\b${model}\\b`).test(tradeless) || trimSaid || feats.length)) || (!model && (trimSaid || feats.length));
    if (vehicleTalk) {
      const fits = model ? inStock().filter((v) => lower(v.model) === model && (!trim || lower(v.trim) === trim || !v.trim) && matchesFeatures(v, feats)) : [];
      const what = [model ? model[0].toUpperCase() + model.slice(1) : "", trim ? trim.toUpperCase() : "", !model && !trim && feats.length ? `with ${feats.join(", ")}` : ""].filter(Boolean).join(" ") || "vehicle";
      if (!inStock().length) {
        // No inventory on file to check against: the checking is the move.
        const id = task(`Check stock for a ${what} for ${fn}`, { priority: "high" });
        if (id) moves.push({ kind: "stock", title: `Check stock for a ${what}`, detail: "No inventory is loaded in the app to match against — see what's on the lot.", taskId: id });
      } else if (fits.length) {
        const names = fits.slice(0, 3).map((v) => `${vehicleName(v)}${v.stock ? ` (#${v.stock})` : ""}`).join(", ");
        const id = task(`Show ${fn} the ${fits.length} ${what}${fits.length === 1 ? "" : "s"} in stock — ${names}`, { priority: "high" });
        if (id) moves.push({ kind: "stock", title: `${fits.length} ${what}${fits.length === 1 ? "" : "s"} in stock`, detail: names, taskId: id });
        const tid = textStep(`the ${what} in stock`, "stock", [`${fits.length} ${what} in stock right now: ${names}`], today);
        if (tid) moves.push({ kind: "text", title: "Text about the ones in stock drafted", detail: "Waiting for your OK on Home.", taskId: tid });
      } else {
        const id = task(`Locate a ${what} for ${fn} — none in stock`, { due: addDaysISO(1), priority: "high" });
        if (id) moves.push({ kind: "task", title: `No ${what} in stock — locate one`, detail: "Check incoming and the dealer group.", taskId: id });
      }
    }

    // 3. Money. What fits their number, counted; never sent.
    const money = parseMoney(note);
    if (money) {
      if (money >= 5000) {
        const under = inStock().filter((v) => Number(v.price) > 0 && Number(v.price) <= money * 1.05 && (!model || lower(v.model) === model));
        const id = task(`${under.length} in stock under ${fn}'s budget — line up the options`, { priority: "high" });
        if (id) moves.push({ kind: "budget", title: `${under.length} in stock under their budget`, detail: under.slice(0, 3).map(vehicleName).join(", ") || "Nothing fits yet — worth a used search.", taskId: id });
      } else {
        let fits = [];
        try { fits = dealsForLead(lead).filter((o) => o.monthly <= money * 1.05); } catch { fits = []; }
        const seen = new Set(); fits = fits.filter((o) => { const k = o.vehicle && o.vehicle.id; if (seen.has(k)) return false; seen.add(k); return true; });
        const id = task(`${fits.length} vehicles fit ${fn}'s payment target — build the deal`, { priority: "high" });
        if (id) moves.push({ kind: "budget", title: `${fits.length} fit their payment target`, detail: fits.slice(0, 3).map((o) => vehicleName(o.vehicle)).join(", ") || "Nothing fits yet — check their numbers.", taskId: id });
      }
    }

    // 4. Who else decides.
    const who = /\b(wife|husband|partner|spouse|girlfriend|boyfriend|fianc[eé]e?|dad|mom|mother|father|parents|co-?signer|brother|sister|son|daughter)\b/.exec(t);
    if (who && /\b(sign|decid|has to|needs to|approv|check with|talk to|ask|bring|run it by|together|both)\b/.test(t)) {
      const id = task(`Get ${fn}'s ${who[1]} in the room — invite them to the next visit`, { priority: "high" });
      if (id) moves.push({ kind: "people", title: `Their ${who[1]} decides too`, detail: "Next visit is for both of them; the next text says so.", taskId: id });
    }

    // 5. A trade.
    if (/\btrad(e|ing)\b|trade-?in|\bpay ?off\b|owes? on/.test(t)) {
      const car = /\b((?:19|20)\d\d\s+[a-z]+(?:\s+[a-z0-9-]+)?)/.exec(t);
      const id = task(`Appraise ${fn}'s trade${car ? ` — ${car[1]}` : ""}`, { priority: "high" });
      if (id) moves.push({ kind: "trade", title: `Appraise the trade${car ? `: ${car[1]}` : ""}`, detail: "Get it looked at before the numbers conversation.", taskId: id });
    }

    // 6. Hesitation. A second option, and a reason to come back in two days.
    if (/\btoo (expensive|much|high|pricey)\b|\b(price|cheaper|better (deal|price)|thinking about it|think about it|sleep on it|shop(ping)? around|not sure|hesitant|on the fence|going to look at)\b/.test(t) || MAKES.test(t)) {
      const id = task(`Bring ${fn} a second option — a lower payment or a step down in trim`, { due: addDaysISO(1), priority: "high" });
      if (id) moves.push({ kind: "objection", title: "Prepare a second option", detail: "Lower payment, a step down in trim, or a used one.", taskId: id });
      const tid = textStep("a second way to do it", "options", ["they were weighing the price / looking elsewhere"], addDaysISO(2));
      if (tid) moves.push({ kind: "text", title: "Options text drafted for two days out", taskId: tid });
    }

    // 7. Later. The plan waits; a check-back is dated.
    const later = parseLater(note);
    if (later && !when) {
      const back = addDaysISO(-3, new Date(later + "T12:00:00"));
      deferPlan(leadId, addDaysISO(-14, new Date(later + "T12:00:00")));
      store.update("leads", leadId, { followUp: back });
      const id = task(`Check back with ${fn} — ${relativeDay(back)}`, { due: back, priority: "high", channel: "call" });
      if (id) moves.push({ kind: "later", title: `Check back ${relativeDay(back)}`, detail: "The plan waits until closer to then.", taskId: id });
    }

    // 8. Financing.
    if (/\b(credit|pre-?approv\w*|financ\w*|co-?sign\w*|bank|interest rate|approval)\b/.test(t)) {
      const id = task(`Line up financing for ${fn} with the business office`, { priority: "high" });
      if (id) moves.push({ kind: "finance", title: "Line up financing", detail: "Have the business office ready before they're back.", taskId: id });
    }

    // 9. A referral in passing.
    const ref = /\b(brother|sister|friend|coworker|co-worker|buddy|cousin|neighbou?r|mom|dad|son|daughter|roommate)\b[^.]{0,40}\b(also|too|as well|looking|needs|wants|shopping)\b/.exec(t);
    if (ref) {
      const id = task(`Ask ${fn} for their ${ref[1]}'s number — they're looking too`, { priority: "normal" });
      if (id) moves.push({ kind: "referral", title: `Ask for the ${ref[1]}'s number`, taskId: id });
    }

    // 10. Always: the plan runs, and its next text is written from this.
    if (started) moves.push({ kind: "plan", title: `${started}-step follow-up plan started`, detail: "Every text in it is written from this note." });
    else if (!moves.length) {
      const next = planSteps(leadId)[0];
      moves.push(next
        ? { kind: "plan", title: `Next: ${next.title.replace(/^\w+ \S+ — /, "")} ${relativeDay(next.due)}`, detail: "Written from this note when it's due.", taskId: next.id }
        : { kind: "plan", title: "Noted", detail: "On their profile for the next conversation." });
    }
  });
  return { moves };
}

// Take a move back (a task or appointment it created).
export function undoMove(m) {
  if (m.taskId && store.get("tasks", m.taskId)) store.remove("tasks", m.taskId);
  if (m.appointmentId && store.get("appointments", m.appointmentId)) store.remove("appointments", m.appointmentId);
}
