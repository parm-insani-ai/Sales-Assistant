// Auto-send: the plan's texts go out by themselves.
//
// Off, every text the app writes waits for a tap — the plan's steps, the
// chase's "when's good?", the appointment confirmations. On, the ones with a
// defined purpose and a defined moment are sent at their moment, inside the
// same rules a person would keep: a working number, consent on file, inside
// the day's hours, never to someone who just wrote back (that conversation
// is the salesperson's), never with a figure in it, and never more than the
// day's cap. Replies to a customer's message are always drafted for a tap;
// nothing here answers a person.
//
// The sweep runs while the app is open — on launch, when it comes back to
// the front, and every few minutes. A text whose moment passed while the
// phone was in a pocket goes at the next sweep inside its day; after that
// it's on the Log for a tap like before.

import * as store from "./store.js";
import { draftTouch } from "./touches.js";
import { sendText, smsReady } from "./sms.js";
import { consentStatus } from "./consent.js";
import { setPending } from "./outcomes.js";
import { lockedUntil } from "./cadence.js";

const DAY = 86400000;
const WINDOW_MS = 24 * 3600000;   // a text more than a day past its moment waits for a tap
export const DEFAULT_CAP = 60;

export function autoOn() { return store.getSettings().autoSend === "plan"; }
export function autoCap() { const n = Number(store.getSettings().autoDailyCap); return n > 0 ? n : DEFAULT_CAP; }

// Inside the salesperson's hours? (Settings; 9 to 6 when unset.)
export function insideHours(now = new Date()) {
  const s = store.getSettings();
  const from = Number(s.hoursFrom ?? 9), to = Number(s.hoursTo ?? 18);
  const h = now.getHours() + now.getMinutes() / 60;
  return h >= from && h < to;
}

// Texts sent by the sweep today.
export function sentToday(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return store.all("texts").filter((t) => t && t.auto && t.dir === "out" && String(t.at || "").slice(0, 10) === day).length;
}

// The text tasks the sweep considers: plan steps, the chase's texts, and
// appointment confirmations — each with a moment that has come.
export function autoCandidates(now = Date.now()) {
  return store.all("tasks").filter((t) => {
    if (!t || t.done || t.channel !== "text" || !t.leadId) return false;
    if (!(t.cadence || t.sequence || t.apptPlan === "confirm")) return false;
    const at = t.readyAt ? new Date(t.readyAt).getTime() : t.due ? new Date(t.due + "T10:15:00").getTime() : NaN;
    return isFinite(at) && at <= now && now - at < WINDOW_MS;
  }).sort((a, b) => String(a.readyAt || a.due).localeCompare(String(b.readyAt || b.due)));
}

/**
 * May this text go by itself, right now? { ok, why } — `why` is the one
 * reason it can't, in words the Log can show.
 */
export function autoEligible(task, lead, now = new Date()) {
  if (!autoOn()) return { ok: false, why: "auto-send is off" };
  if (!task || task.done) return { ok: false, why: "already done" };
  if (!lead) return { ok: false, why: "no customer" };
  if (!lead.phone || lead.badPhone) return { ok: false, why: "no number that works" };
  if (store.optedOut(lead) || lead.doNotContact) return { ok: false, why: "opted out" };
  if (lead.autoHold) return { ok: false, why: "auto-send held for this customer" };
  if (["sold", "lost"].includes(lead.stage) && !task.postDelivery) return { ok: false, why: lead.stage === "sold" ? "they bought" : "marked lost" };
  if (!consentStatus(lead).ok) return { ok: false, why: "no texting consent on file" };
  if (!insideHours(now)) return { ok: false, why: "outside your hours" };
  if (lockedUntil(task, now.getTime())) return { ok: false, why: "not its minute yet" };
  // A customer who wrote back in the last three days is in a conversation
  // with a person, not a plan.
  const since = now.getTime() - 3 * DAY;
  if (store.all("texts").some((x) => x.leadId === lead.id && x.dir === "in" && new Date(x.at || x.createdAt || 0).getTime() >= since)) return { ok: false, why: "they replied recently — yours to answer" };
  // An appointment coming up: the confirmation is the only text that goes.
  const upcoming = store.all("appointments").some((a) => a.leadId === lead.id && a.status !== "canceled" && !a.outcome && new Date(a.when).getTime() > now.getTime());
  if (upcoming && task.apptPlan !== "confirm") return { ok: false, why: "an appointment is booked — the confirmation goes, the plan waits" };
  if (sentToday(now) >= autoCap()) return { ok: false, why: `today's cap of ${autoCap()} reached` };
  if (!smsReady()) return { ok: false, why: "texting isn't set up (Settings → Email & texting)" };
  return { ok: true, why: "" };
}

let running = false;
/**
 * One pass: every eligible text is drafted and sent, its task ticked as
 * sent automatically. Returns { sent, skipped: [{ taskId, why }] }. `send`
 * is injectable for tests.
 */
export async function autoSendSweep({ now = new Date(), send = sendText, limit = 20 } = {}) {
  const out = { sent: 0, skipped: [], failed: 0 };
  if (running || !autoOn()) return out;
  running = true;
  try {
    const list = autoCandidates(now.getTime());
    for (const task of list) {
      if (out.sent >= limit) break;
      const lead = store.get("leads", task.leadId);
      const e = autoEligible(task, lead, now);
      if (!e.ok) { out.skipped.push({ taskId: task.id, why: e.why }); continue; }
      let body = String(task.body || "").trim();
      if (!body) { try { body = (await draftTouch(lead, task)).body; } catch { body = ""; } }
      if (!body) { out.skipped.push({ taskId: task.id, why: "nothing drafted" }); continue; }
      setPending({ leadId: lead.id, kind: task.apptPlan ? "appointment" : task.sequence ? "sequence" : "plan", intent: task.intent || task.apptPlan || "", reasons: [], score: null, tier: "", auto: true });
      let r;
      try { r = await send(lead, body, { auto: true, task }); } catch (err) { r = { ok: false, error: (err && err.message) || "send failed" }; }
      if (r && r.ok) {
        store.bulk(() => {
          if (r.id && store.get("texts", r.id)) store.update("texts", r.id, { auto: true, taskId: task.id, intent: task.intent || task.apptPlan || "" });
          if (store.get("tasks", task.id) && !store.get("tasks", task.id).done) store.update("tasks", task.id, { done: true, doneBy: "auto", doneAt: new Date().toISOString() });
          else if (store.get("tasks", task.id)) store.update("tasks", task.id, { doneBy: "auto" });
          store.logEvent("auto_send", { leadId: lead.id, meta: { taskId: task.id, intent: task.intent || task.apptPlan || "", textId: r.id || "" } });
        });
        out.sent++;
      } else {
        out.failed++;
        out.skipped.push({ taskId: task.id, why: (r && r.error) || "send failed" });
        store.logEvent("auto_send_failed", { leadId: lead.id, meta: { taskId: task.id, error: (r && r.error) || "" } });
      }
    }
  } finally { running = false; }
  return out;
}

// The sweep's clock: on launch, on coming back to the front, every five
// minutes while open. Idempotent.
let started = false;
export function startAutoSend() {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = () => { if (document.hidden) return; autoSendSweep().catch(() => {}); };
  setTimeout(tick, 20000);
  setInterval(tick, 5 * 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(tick, 3000); });
}

// For the Log and Home: what auto-send would do with this text right now.
export function autoStatus(task, now = new Date()) {
  if (!autoOn()) return null;
  const lead = task && task.leadId ? store.get("leads", task.leadId) : null;
  const e = autoEligible(task, lead, now);
  return e.ok ? "sends automatically at the next sweep" : `waiting for your tap — ${e.why}`;
}
