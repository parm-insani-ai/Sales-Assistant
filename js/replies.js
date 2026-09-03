// The agent's half of a text conversation.
//
// It drafts; you send. Nothing here reaches a customer on its own — the draft
// lands in the compose box for you to read, edit or throw away.
//
// The load-bearing design choice is what the model is *told*, not what it's
// asked to withhold. No dollar figure is ever put in the prompt: the model
// learns that a customer is in a strong position or an awkward one, never by
// how much. An instruction not to quote prices can be argued around by a
// determined customer ("just ballpark it"); a model that was never given the
// number cannot leak it. The regex check afterwards is a backstop, not the
// mechanism.

import * as store from "./store.js";
import { agentConfigured } from "./agent.js";
import { bestPitch, equityDetail } from "./views/dealbuilder.js";
import { cachedShortBookingLink, bookingLink } from "./views/settings.js";

export function draftingAvailable() {
  return agentConfigured();
}

// Qualitative only — see the note at the top of the file.
function standing(lead) {
  const eq = equityDetail(lead);
  if (!eq || eq.v == null) return "unknown — their position hasn't been worked out yet";
  if (eq.v > 2000) return "good — their car is worth more than what's left owing, which gives them room to move";
  if (eq.v > -1000) return "roughly break-even — what it's worth and what's owed are close";
  return "tight — they owe more than the car is worth right now, so any move needs care and shouldn't be promised as easy";
}

function pitchVehicle(lead) {
  try {
    const row = bestPitch(lead, null, { preferReplacement: true });
    if (!row || !row.vehicle) return "";
    const v = row.vehicle;
    return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

function buildSystem(lead) {
  const s = store.getSettings();
  const link = cachedShortBookingLink() || bookingLink();
  const pitch = pitchVehicle(lead);
  const first = String(lead.name || "there").split(" ")[0];

  return `You are drafting a single SMS reply on behalf of ${s.salesperson || "the salesperson"}, who sells cars at ${s.dealership || "the dealership"}. The draft is reviewed by them before it sends — write it as if they will send it word for word.

WHO YOU'RE WRITING TO
Name: ${first}
Currently drives: ${lead.vehicleInterest || "unknown"}
Their position: ${standing(lead)}
${pitch ? `The vehicle that suits them: ${pitch}` : "No specific replacement picked yet."}
Booking link: ${link}

THE ONE RULE THAT CANNOT BEND
Never state a dollar amount, a monthly payment, a trade-in value, an interest rate, a percentage, or a discount. Not an estimate, not a range, not a ballpark, not "around" or "roughly" a figure. You have not been told any of these numbers and you must not invent one.

If they ask for a number — and they will — do not dodge and do not stall. Tell them the truth: a trade number that means anything requires actually looking at the car, and a payment depends on their trade, so quoting a figure by text would either be a guess or a number that changes when they arrive. Neither is fair to them. Then offer to do it properly, in person, in about ten minutes. Say it like someone being straight with them, not like someone protecting a sales process.

HOW TO WRITE
- One to three sentences. This is a text message, not an email.
- Plain, warm, direct. No exclamation marks stacked up, no "Absolutely!", no "I'd be happy to assist", no corporate hedging.
- Never open with "Thanks for your interest" — they already own a car.
- Answer what they actually asked before steering anywhere.
- The goal is a booked appointment. Offer two specific times, or send the booking link — not both in the same message.
- Never promise approval, a payment, or that a deal will be easy. You do not know.
- If they say no, or not now: accept it gracefully in one line and leave the door open. Do not counter-offer.
- If they've asked to stop hearing from you, acknowledge it and say nothing else.
- Never claim a vehicle is in stock, discounted, or on a program unless the salesperson said so above.
- Sign off only if it reads naturally; they know who it's from.

Reply with the message text and nothing else — no quotation marks, no preamble, no alternatives.`;
}

// Any figure that could be read as money or a rate. Deliberately broad: the
// cost of a false positive is one regenerated draft, the cost of a miss is a
// number the salesperson has to walk back with a real customer.
const MONEY = /(\$\s?\d|\d+\s?(%|percent)|\bapr\b|\b\d{2,3}\s?(a|per)\s?(month|mo)\b|\$\d|\b\d{3,}\s?(dollars|bucks)\b|\bmonthly\s+(payment|is)\s+\d)/i;

function looksLikeMoney(text) {
  return MONEY.test(String(text || ""));
}

async function ask(lead, messages) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: buildSystem(lead), messages, max_tokens: 400 }),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, error: `The agent couldn't be reached (${res.status}).` };
    const j = await res.json();
    const text = (j.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!text) return { ok: false, error: "The agent came back empty." };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "The agent timed out." : "No connection to the agent." };
  } finally {
    clearTimeout(timer);
  }
}

// Draft a reply to wherever the conversation currently stands.
export async function draftReply(lead) {
  if (!draftingAvailable()) return { ok: false, error: "Set up the agent function in Settings to draft replies." };
  if (!lead) return { ok: false, error: "No customer." };

  const thread = store.textsFor(lead.id).slice(-12);
  if (!thread.length) return { ok: false, error: "Nothing to reply to yet." };

  const messages = thread.map((t) => ({
    role: t.dir === "in" ? "user" : "assistant",
    content: t.body,
  }));
  // The relay needs the conversation to start with the customer; if we spoke
  // first, lead in with the situation rather than dropping our own message in
  // as if they'd sent it.
  if (messages[0].role === "assistant") {
    messages.unshift({ role: "user", content: `(${lead.name || "The customer"} hasn't replied yet — this is the thread so far.)` });
  }

  let out = await ask(lead, messages);
  if (!out.ok) return out;

  // Backstop. If a figure slipped through, say so once and try again with the
  // slip quoted back — then give up rather than send something unchecked.
  if (looksLikeMoney(out.text)) {
    const retry = await ask(lead, [
      ...messages,
      { role: "assistant", content: out.text },
      { role: "user", content: "That draft contains a figure. You have not been told any numbers and must not state one. Rewrite it without any dollar amount, rate or percentage — offer to go through it in person instead." },
    ]);
    if (retry.ok && !looksLikeMoney(retry.text)) return retry;
    return { ok: false, error: "The draft kept quoting a figure, so it wasn't used. Write this one yourself." };
  }
  return out;
}
