// The blast's message, written by the agent for the audience when the
// sentence only said who. The model is told who the people are and why
// they were picked, never a figure; the text that comes back is checked for
// one anyway. The template (outreach.js messageFor) is on screen first and
// stays if the agent can't be reached or keeps quoting a number.

import * as store from "./store.js";
import * as backend from "./backend.js";
import { looksLikeMoney } from "./money.js";
import { describeAudience, stripFigures } from "./outreach.js";

// The rep's own message with the figure taken out and the meaning kept —
// by the agent, or by the plain substitution when it can't be reached.
export async function rewordWithoutFigures(message, settings = store.getSettings()) {
  const plain = stripFigures(message);
  if (!canWrite()) return plain;
  const system = "You rewrite one short text message a car salesperson is sending to customers. Keep the meaning, the tone and the length. Remove every dollar amount, price, payment, rate and percentage, and say it the way a salesperson would without the number: '0% financing' becomes 'special financing', '$2,000 over book' becomes 'a strong offer on your trade'. No greeting, no sign-off, no emojis. Answer with the rewritten message alone.";
  const url = (settings.agentUrl || "").trim().replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ system, messages: [{ role: "user", content: message }], max_tokens: 400 }), signal: ctl.signal });
    if (!res.ok) return plain;
    const j = await res.json().catch(() => ({}));
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim().replace(/^["\u201c']|["\u201d']$/g, "");
    return text && !looksLikeMoney(text) && text.length >= 10 ? text : plain;
  } catch { return plain; } finally { clearTimeout(timer); }
}

export function canWrite() {
  return !!((store.getSettings().agentUrl || "").trim() && backend.currentUser());
}

export async function writeBlastMessage(spec, settings = store.getSettings()) {
  if (!canWrite()) return null;
  const who = describeAudience(spec);
  const me = settings.salesperson || "the salesperson", at = settings.dealership || "the dealership";
  const system = [
    `You write the one text message a car salesperson, ${me} at ${at}, sends to many customers at once. The customers: ${who}.`,
    "Write ONLY the middle of the message, 1-3 short sentences, under 260 characters, in the second person ('you', 'your car'), warm and plain, about why they in particular are worth a call now, ending with one easy question that invites a reply.",
    "No greeting, no name, no sign-off — those are added for each customer. No dollar amounts, prices, payments, rates or percentages of any kind, and no promises about value. No emojis, no exclamation marks, no 'exciting news'. Say 'your car' rather than guessing the model.",
    "Answer with the message text alone.",
  ].join("\n");
  const url = (settings.agentUrl || "").trim().replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const ask = async (messages) => {
      const res = await fetch(url, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ system, messages, max_tokens: 400 }), signal: ctl.signal });
      if (!res.ok) return "";
      const j = await res.json().catch(() => ({}));
      return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim().replace(/^["\u201c']|["\u201d']$/g, "");
    };
    let text = await ask([{ role: "user", content: "Write the message." }]);
    if (!text) return null;
    if (looksLikeMoney(text)) {
      text = await ask([{ role: "user", content: "Write the message." }, { role: "assistant", content: text }, { role: "user", content: "That contains a figure. Rewrite it with no dollar amount, price, payment, rate or percentage." }]);
      if (!text || looksLikeMoney(text)) return null;
    }
    // Strip a greeting or sign-off the model added anyway.
    text = text.replace(/^(hi|hello|hey)\b[^,.!]*[,.!]?\s*/i, "").replace(/\s*[-—]\s*[A-Z][a-z]+(\s+at\s+[^.]+)?\.?$/, "").trim();
    return text.length >= 20 ? text : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
