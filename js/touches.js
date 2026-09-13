// Writing the plan's texts.
//
// Every text in a follow-up plan is drafted for the person it's going to, from
// what the salesperson said about them, at the moment it's due — so a day-four
// message knows what happened on days one to three. The draft lands in the
// compose box; the salesperson reads it and taps send, or doesn't. Nothing
// here reaches a customer on its own.
//
// Same discipline as replies.js: the model is never given a number, and a
// draft that contains one anyway is rewritten or replaced.

import * as store from "./store.js";
import { agentConfigured } from "./agent.js";
import { briefFor } from "./context.js";
import { looksLikeMoney } from "./replies.js";
import { isInbound } from "./cadence.js";
import { candidateFor } from "./prospects.js";
import { openText } from "./sms.js";
import { navigate } from "./router.js";
import { smsHref } from "./utils.js";
import { cachedShortBookingLink, bookingLink } from "./views/settings.js";

const first = (name) => String(name || "there").trim().split(/\s+/)[0];

// What each step is trying to do, in words the model can act on.
const INTENTS = {
  intro:   "This is the welcome text, minutes after you met them (or after they enquired — the brief says which). Thank them for coming in (or for reaching out), then prove you listened: name the specific thing they're after — the trim, the feature, new or used — and add ONE genuinely useful detail about it from the brief or common knowledge of that vehicle. Close with the one thing you'll do next for them. Warm, specific, short.",
  value:   "Day one. Give them something useful about the specific vehicle/trim/feature they asked for — a detail, an option, what to look for — and offer to show them in person. Not a sales pitch: a helpful note from someone who listened.",
  options: "Day four. Lay out two ways to get them what they want (for example new vs. used, two trims, in-stock vs. incoming) and ask which they'd rather see. No prices.",
  nudge:   "About ten days in. A light, low-pressure check-in — has anything changed, any questions — and an easy way to book.",
  fresh:   "Three weeks in. Give them a fresh reason to look again: new stock arriving, a program, a colour they wanted. Only mention what the salesperson's notes actually support; never invent stock or offers.",
  month:   "A month in. A friendly check-in that assumes nothing — they may have bought elsewhere, they may be waiting. Leave the door wide open.",
  nurture: "A long-term touch. One or two lines that keep you the person they think of when they're ready. No pressure at all.",
  check:   "A short check-in.",
  week:    "A one-week check-in.",
  twoweek: "A two-week check-in.",
  prospect: "This is an opener to a customer who already drives something (a past customer or an imported owner) and hasn't heard from the salesperson in a while. You're reaching out because of the reasons listed under WHY. Lead with something true about THEIR situation — their vehicle, their timing — not with a pitch. Offer to work out what a move would look like properly, in person, in about ten minutes. One easy next step. Never a figure, never a promise, never 'trade values are at record highs' or any market claim.",
};

function systemFor(lead, task) {
  const s = store.getSettings();
  const link = cachedShortBookingLink() || bookingLink();
  const dayN = task.step ? `step ${task.step} of ${task.of || "?"}` : "";
  return `You are drafting ONE follow-up text on behalf of ${s.salesperson || "the salesperson"}, who sells cars at ${s.dealership || "the dealership"}. They will read it and tap send, or not — write it exactly as they would send it.

WHO IT'S TO
${briefFor(lead)}
How they arrived: ${isInbound(lead) ? "they enquired online or by phone — they have NOT been in yet" : "they came in to the dealership in person"}

WHAT THIS TEXT IS FOR (${dayN})
${INTENTS[task.intent] || INTENTS.nudge}
${Array.isArray(task.why) && task.why.length ? `\nWHY YOU'RE REACHING OUT (true facts; use one or two, in your own words)\n${task.why.map((w) => `- ${w}`).join("\n")}\n` : ""}
Booking link, if a time to come in is the natural next step: ${link}

THE ONE RULE THAT CANNOT BEND
Never state a dollar amount, a monthly payment, a price, a trade-in value, an interest rate, a percentage, or a discount — not the customer's own budget either, and not an estimate, a range or a ballpark. You have not been given any figures and must not invent one. If money is the point, offer to work it out properly in person.

HOW TO WRITE
- One to three sentences. It's a text.
- Plain, warm, direct. Use their first name once at most. No stacked exclamation marks, no "Absolutely!", no "I hope this finds you well".
- Refer to the specific vehicle, trim or feature they wanted — that is the whole point of knowing it.
- Never claim a vehicle is in stock, on sale, or on a program unless the notes above say so.
- If earlier messages are shown, continue naturally from them; don't repeat what was already said.
- End with one easy next step, or nothing. Never two asks.

Reply with the message text and nothing else — no quotes, no preamble, no options.`;
}

// Without the agent: a handwritten version of each intent, filled from the
// profile. Plain and safe, and never a number.
export function templateTouch(lead, task) {
  const s = store.getSettings();
  const me = first(s.salesperson) || "me";
  const fn = first(lead.name);
  const p = lead.profile || {};
  const car = lead.vehicleInterest || "the right vehicle";
  const want = p.trim ? `${car} ${p.trim}`.replace(/\s+/g, " ") : car;
  const feat = Array.isArray(p.features) && p.features.length ? p.features[0] : "";
  switch (task.intent) {
    case "intro":   return `Hi ${fn}, it's ${me}${s.dealership ? ` at ${s.dealership}` : ""}. ${isInbound(lead) ? "Thanks for reaching out" : "Thanks for coming in today"} — I've got you down for a ${want}${feat ? ` with the ${feat}` : ""}${p.newUsed === "either" ? ", new or used" : ""}. I'll keep an eye out and be in touch as soon as I have something worth seeing.`;
    case "value":   return `Hi ${fn}, ${me} here. Quick one on the ${want}${feat ? ` — the ${feat} is worth seeing in person` : ""}. Want me to set one aside for you to look at this week?`;
    case "options": return `Hi ${fn}, there are a couple of ways to get you into a ${car}${p.newUsed === "either" ? " — new or a low-km used one" : ""}. Happy to walk you through both. Which day works better, a weekday or the weekend?`;
    case "nudge":   return `Hi ${fn}, just checking in — any questions on the ${car}? No rush at all, I'm here whenever you're ready.`;
    case "fresh":   return `Hi ${fn}, ${me} here. Still keeping an eye out for the ${want} for you. Anything changed on your end, or want to come take a look at what's here now?`;
    case "month":   return `Hi ${fn}, it's ${me}. Been about a month — are you still thinking about the ${car}? Happy to help whenever the timing's right.`;
    case "prospect": {
      const why = Array.isArray(task.why) ? task.why.join(" ") : "";
      const lease = /lease/.test(why);
      const owned = lead.vehicleInterest ? `your ${lead.vehicleInterest}` : "your current vehicle";
      if (lease) return `Hi ${fn}, it's ${me}${s.dealership ? ` at ${s.dealership}` : ""}. Your lease is coming up, and it's worth knowing your options before the clock runs down. Want to grab ten minutes this week and go through them properly?`;
      return `Hi ${fn}, it's ${me}${s.dealership ? ` at ${s.dealership}` : ""}. Quick one — ${owned} may put you in a better spot to move than you'd think, and I'd rather show you real numbers than guess by text. Ten minutes in person, whenever suits?`;
    }
    default:        return `Hi ${fn}, ${me} here. Just keeping in touch — when you're ready to look at a ${car}, I'm one text away.`;
  }
}

async function ask(system, messages) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, messages, max_tokens: 300 }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim().replace(/^["']|["']$/g, "");
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The text for a plan step, ready for the compose box. Drafted by the agent
 * when there is one, from the template when there isn't or it fails, and
 * never with a figure in it. Returns { body, via: "agent"|"template" }.
 */
export async function draftTouch(lead, task) {
  const fallback = () => ({ body: templateTouch(lead, task), via: "template" });
  if (!lead || !task) return { body: "", via: "template" };
  if (!agentConfigured()) return fallback();

  const system = systemFor(lead, task);
  // The conversation so far, so day four doesn't repeat day one.
  const thread = store.textsFor(lead.id).slice(-8).map((t) => ({ role: t.dir === "in" ? "user" : "assistant", content: t.body }));
  const messages = [];
  if (thread.length) {
    messages.push({ role: "user", content: `The conversation so far, oldest first:\n${thread.map((m) => `${m.role === "user" ? first(lead.name) : "Me"}: ${m.content}`).join("\n")}\n\nNow write the next text.` });
  } else {
    messages.push({ role: "user", content: "Write the text." });
  }
  let text = await ask(system, messages);
  if (!text) return fallback();
  if (looksLikeMoney(text)) {
    text = await ask(system, [...messages, { role: "assistant", content: text }, { role: "user", content: "That contains a figure. You have not been given any numbers and must not state one. Rewrite it with no dollar amount, price, rate or percentage." }]);
    if (!text || looksLikeMoney(text)) return fallback();
  }
  return { body: text, via: "agent" };
}

/**
 * The "yes" path. Draft the step's text for its customer and put it in front
 * of the salesperson: the conversation opens with the draft in the compose
 * box (or the phone's Messages app, when there's no texting number). Called
 * from the Home queue, the "right now" list, and a push notification's URL.
 * Resolves true when a draft was put on screen.
 */
export async function reviewTouch(taskId) {
  const task = store.get("tasks", taskId);
  const lead = task && task.leadId ? store.get("leads", task.leadId) : null;
  if (!task || !lead) { navigate("/"); return false; }
  if (task.done) { navigate(lead.phone ? `/inbox/${lead.id}` : `/leads/${lead.id}`); return false; }
  if (!lead.phone) { navigate(`/leads/${lead.id}`); return false; }
  const { body } = await draftTouch(lead, task);
  if (!openText(lead.phone, body)) window.location.href = smsHref(lead.phone, body);
  return true;
}

/**
 * The same, for a prospect the app brought up: no task, just the customer
 * and the reasons it found. Drafts the opener and opens the conversation.
 */
export async function reviewProspect(leadId) {
  const lead = store.get("leads", leadId);
  if (!lead) { navigate("/"); return false; }
  if (!lead.phone) { navigate(`/leads/${lead.id}`); return false; }
  const c = candidateFor(leadId);
  const { body } = await draftTouch(lead, { intent: "prospect", why: c ? c.why : [], step: 0 });
  if (!openText(lead.phone, body)) window.location.href = smsHref(lead.phone, body);
  return true;
}
