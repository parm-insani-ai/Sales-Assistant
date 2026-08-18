// Email engine. Three optional tiers, lightest first:
//   1. Tap-to-email — mailto: links + templates (always available, no setup).
//   2. Automated sending — real emails through the Supabase function using a
//      Resend API key (secrets RESEND_API_KEY + EMAIL_FROM). When the
//      "emailAutoSend" setting is on, due cadence email steps go out
//      automatically each time the app opens.
//   3. Email history — every sent email (tap-to-email or automated) is logged
//      to the lead, and received emails can be logged by hand. Full inbox sync
//      would need OAuth/IT approval, so it's deliberately not built yet.

import * as store from "./store.js";
import { fillTemplate } from "./views/messages.js";

export function emailSendConfigured() {
  return !!(store.getSettings().agentUrl || "").trim();
}

// Send one real email through the Supabase function. Throws a plain-language
// message when a config step is missing.
export async function sendEmail({ to, subject, text }) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Set up the voice agent function first (Settings → Voice agent) — emails send through the same function");
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: { to, subject, text } }),
    });
  } catch {
    throw new Error("Couldn't reach your function — check your connection");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const msg = j.error || `HTTP ${res.status}`;
    if (/No messages/i.test(msg))
      throw new Error("Your Supabase function needs the email update — replace its code with the latest and redeploy");
    if (/RESEND_API_KEY|EMAIL_FROM/.test(msg))
      throw new Error(`${msg}. Add it in Supabase → Edge Functions → Secrets (RESEND_API_KEY from resend.com, EMAIL_FROM like "Parm <parm@yourdomain>").`);
    throw new Error(msg);
  }
  return true;
}

// Log an email against a lead so the conversation history lives on the lead.
export function logEmail(leadId, { direction = "out", subject = "", body = "", via = "" }) {
  return store.create("emails", { leadId, direction, subject, body, via });
}

export function emailsForLead(leadId) {
  return store.all("emails")
    .filter((e) => e.leadId === leadId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// Tier 2's automation: send any due cadence email steps. Called on app open.
// Caps at 5 per run and stops on the first failure (it's almost always config).
export async function autoSendDueEmails() {
  const s = store.getSettings();
  if (!s.emailAutoSend || !emailSendConfigured()) return { sent: 0, errors: [] };
  const today = new Date().toISOString().slice(0, 10);
  const due = store.all("tasks").filter((t) =>
    t.cadence && t.channel === "email" && !t.done && t.leadId && t.due && t.due <= today);
  if (!due.length) return { sent: 0, errors: [] };

  const templates = s.messageTemplates || [];
  const tpl = templates.find((t) => t.id === "tpl_email_follow") ||
    { subject: "Following up on the {vehicle}", body: "Hi {firstName},\n\nJust following up on the {vehicle} — any questions I can answer, or a good time for you to come by?\n\nBest,\n{salesperson}\n{dealership}" };

  let sent = 0;
  const errors = [];
  for (const t of due.slice(0, 5)) {
    const lead = store.get("leads", t.leadId);
    // Dead or unreachable lead → retire the step instead of retrying forever.
    if (!lead || !lead.email || ["sold", "delivered", "lost"].includes(lead.stage)) {
      if (lead && !lead.email) continue; // keep the task — they may add an email
      store.update("tasks", t.id, { done: true });
      continue;
    }
    const subject = fillTemplate(tpl.subject, lead);
    const body = fillTemplate(tpl.body, lead);
    try {
      await sendEmail({ to: lead.email, subject, text: body });
      store.update("tasks", t.id, { done: true });
      store.update("leads", lead.id, { lastContacted: new Date().toISOString() });
      store.logActivity("touch");
      logEmail(lead.id, { direction: "out", subject, body, via: "auto" });
      sent++;
    } catch (e) {
      errors.push(e && e.message ? e.message : String(e));
      break;
    }
  }
  return { sent, errors };
}
