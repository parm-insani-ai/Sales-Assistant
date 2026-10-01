// The assistant writes the email; the salesperson reads it and taps send.
//
// A reply is written from the message being answered and the whole
// conversation with that customer — texts, emails, calls — plus what's on
// their profile. A new email is written from the customer's profile and
// conversation and whatever the salesperson has typed so far (a subject,
// a few rough words), which it treats as the brief. Same rule as every
// other drafter here: no figure of any kind reaches the model, so none
// can come back out (context.js redactMoney; replies.js looksLikeMoney as
// the backstop).

import * as store from "./store.js";
import * as backend from "./backend.js";
import { agentConfigured } from "./agentcfg.js";
import { briefFor, redactMoney } from "./context.js";
import { conversationFor, transcript } from "./convo.js";
import { looksLikeMoney } from "./replies.js";
import { customerFor, parseAddress, splitAddrs } from "./mailbox.js";
import { repStyle, TONES } from "./style.js";

const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";

function systemFor({ lead, toLabel, replyTo, subject, notes }) {
  const s = store.getSettings();
  const who = lead ? briefFor(lead) : `Name: ${toLabel || "the recipient"} (not a customer on file)`;
  const convo = lead ? transcript(conversationFor(lead.id, { limit: 10 }), { name: lead.name, maxChars: 500 }).map((l) => redactMoney(l)) : [];
  const original = replyTo ? redactMoney(`From: ${replyTo.from.name || replyTo.from.addr}\nSubject: ${replyTo.subject || "(no subject)"}\n\n${String(replyTo.body || replyTo.snippet || "").slice(0, 3000)}`) : "";
  return `You are writing ONE email on behalf of ${s.salesperson || "the salesperson"}, who sells cars at ${s.dealership || "the dealership"}. They will read it, change what they like, and send it themselves — write it exactly as they would send it.

WHO IT'S TO
${who}
${convo.length ? `\nTHE CONVERSATION SO FAR (oldest first)\n${convo.join("\n")}\n` : ""}${original ? `\nTHE EMAIL BEING ANSWERED\n${original}\n` : ""}${subject && !replyTo ? `\nSUBJECT THEY'VE GIVEN IT: ${redactMoney(subject)}\n` : ""}${notes ? `\nWHAT THEY WANT IT TO SAY (their rough words — write it properly from these)\n${redactMoney(notes)}\n` : ""}
THE ONE RULE THAT CANNOT BEND
Never state a dollar amount, a monthly payment, a price, a trade-in value, an interest rate, a percentage, or a discount — not the customer's budget, not an estimate, not a range. You have not been given any figures and must not invent one. If money is the point, offer to go through it properly in person.

HOW TO WRITE
- It's an email, not a text: a short greeting with their first name, two to five short sentences, one easy next step, and a sign-off${repStyle().signoff ? ` — exactly "${repStyle().signoff}"` : ` with ${first(s.salesperson) || "the salesperson's first name"}`}.
- Tone: ${TONES[repStyle().tone].say}.
- Answer what they actually asked or said before anything else. Continue from the conversation — never ask what they've already told you, never repeat what was already sent.
- Plain, warm, direct. No "I hope this finds you well", no stacked exclamation marks, no corporate hedging.
- Never claim a vehicle is in stock, on sale or on a program unless the conversation or the notes say so.
- Refer to the specific vehicle, trim or feature they wanted — that's the whole point of knowing it.
${replyTo ? "- Reply with the email text and nothing else — no subject line, no quotes, no preamble." : '- Reply with the subject on the first line as "Subject: …", then a blank line, then the email — nothing else.'}`;
}

async function ask(system, user) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ system, messages: [{ role: "user", content: user }], max_tokens: 600 }), signal: ctl.signal });
    if (!res.ok) throw new Error(`The agent couldn't be reached (${res.status})`);
    const j = await res.json();
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "The agent timed out" : (e.message || "No connection to the agent"));
  } finally { clearTimeout(timer); }
}

function split(out) {
  const m = /^\s*Subject:\s*(.+?)\s*\n+([\s\S]*)$/i.exec(out);
  return m ? { subject: m[1].trim(), body: m[2].trim() } : { subject: "", body: String(out || "").trim().replace(/^["']|["']$/g, "") };
}

/**
 * Draft the email. `to` is the address line as typed, `replyTo` the
 * mailbox message being answered (or null), `subject`/`notes` what's in
 * the fields so far. Returns { subject, body } — subject empty on a reply.
 */
export async function draftEmail({ to = "", replyTo = null, subject = "", notes = "" } = {}) {
  if (!agentConfigured()) throw new Error("Set up the voice agent function in Settings to have emails written for you");
  const addr = replyTo ? replyTo.from : parseAddress(splitAddrs(to)[0] || to);
  const lead = addr && addr.addr ? customerFor(addr.addr, addr.name) : null;
  const toLabel = addr ? (addr.name ? `${addr.name} <${addr.addr}>` : addr.addr) : "";
  if (!replyTo && !addr.addr && !notes && !subject) throw new Error("Give it someone to write to, or a few words about what to say");
  const system = systemFor({ lead, toLabel, replyTo, subject, notes });
  const user = replyTo ? "Write the reply." : "Write the email.";
  let out = await ask(system, user);
  if (!out) throw new Error("The agent came back empty");
  if (looksLikeMoney(out)) {
    out = await ask(system, `${user}\n\nYour previous draft contained a figure:\n${out}\n\nYou have not been given any numbers and must not state one. Write it again with no dollar amount, price, rate or percentage.`);
    if (!out || looksLikeMoney(out)) throw new Error("The draft kept quoting a figure — write this one yourself");
  }
  const r = split(out);
  return { subject: replyTo ? "" : r.subject, body: r.body, customer: lead ? lead.name : "" };
}
