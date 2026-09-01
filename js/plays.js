// The play sheet — the agent's ranked answer to "what should I do right
// now?". It scores every signal the app already collects and returns the
// top plays, hottest first, each with a one-tap action already loaded
// (prefilled text, dial, or the right screen). The dashboard renders it,
// the morning push points at it, and voice reads it aloud.

import * as store from "./store.js";
import { smsHref, telHref, daysFromToday } from "./utils.js";
import { getOccasions, markOccasion } from "./occasions.js";
import { topOpportunities } from "./views/dealbuilder.js";

const HOT_MS = 24 * 3600 * 1000;
const first = (name) => String(name || "").trim().split(/\s+/)[0];

// ---- Dismissals ----
// A dismissed play stays gone for the rest of the day (per device); tomorrow
// is a new sheet. Occasions are the exception — dismissing one marks it on
// the lead permanently, same as the ✕ in Comms. Comms shares these keys, so
// dismissing an appointment reminder there hides the matching play here too.
const DKEY = "entoa:playdismiss";
const dToday = () => new Date().toISOString().slice(0, 10);
function dmap() {
  try { return JSON.parse(localStorage.getItem(DKEY) || "{}"); } catch { return {}; }
}
export function isDismissedToday(key) {
  return dmap()[key] === dToday();
}
export function dismissToday(key) {
  const today = dToday();
  const m = dmap();
  Object.keys(m).forEach((k) => { if (m[k] !== today) delete m[k]; }); // prune old days
  m[key] = today;
  try { localStorage.setItem(DKEY, JSON.stringify(m)); } catch {}
}
export function dismissPlay(p) {
  if (p.kind === "occasion" && p.leadId && p.occKey) markOccasion(p.leadId, p.occKey);
  else if (p.key) dismissToday(p.key);
}

// Returns [{rank, icon, title, sub, kind, href?, route?}] best first.
// href = one-tap send/dial; route = screen to open instead.
export function getPlays(limit = 6) {
  const plays = [];
  const now = Date.now();
  const s = store.getSettings();
  const me = first(s.salesperson);
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const todayK = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const leads = store.all("leads");
  const leadById = (id) => leads.find((l) => l.id === id) || null;

  // 1. Warm link opens (last 24h) — the customer is reading right now.
  store.all("links")
    .filter((lk) => lk.lastOpenAt && now - new Date(lk.lastOpenAt).getTime() < HOT_MS)
    .sort((a, b) => (b.lastOpenAt || "").localeCompare(a.lastOpenAt || ""))
    .slice(0, 2)
    .forEach((lk) => {
      const label = (lk.meta && lk.meta.label) || (lk.kind === "book" ? "your booking link" : "a comparison");
      plays.push({
        key: `hl:${lk.id}:${lk.opens || 0}`,
        rank: 100, icon: "sparkles", kind: "hotlink",
        title: `${label} was just opened`,
        sub: `Opened ${lk.opens || 1}× — they're engaging. Strike while it's warm.`,
        route: "/comms",
      });
    });

  // 2. Today's unconfirmed appointments — the no-show killers.
  store.all("appointments")
    .filter((a) => a.status === "scheduled" && !a.confirmed && !a.outcome && String(a.when).slice(0, 10) === todayK)
    .slice(0, 3)
    .forEach((a) => {
      const lead = a.leadId ? leadById(a.leadId) : null;
      const phone = a.phone || (lead && lead.phone) || "";
      const time = String(a.when).slice(11, 16);
      const fn = first(a.customerName);
      plays.push({
        key: `cf:${a.id}`,
        rank: 90, icon: "calendar", kind: "confirm",
        title: `Confirm ${a.customerName || "today's appointment"} — ${time}`,
        sub: phone ? "One tap sends the confirmation text." : "No phone on file — open the appointment.",
        href: phone ? smsHref(phone, `Hi ${fn}! ${me ? `It's ${me} — ` : ""}looking forward to seeing you today at ${time}. I'll have everything ready. See you soon!`) : null,
        route: phone ? null : "/calendar",
      });
    });

  // 3. Yesterday's no-shows — recover them while it's fresh.
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const yestK = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;
  store.all("appointments")
    .filter((a) => a.outcome === "no_show" && String(a.when).slice(0, 10) === yestK)
    .slice(0, 2)
    .forEach((a) => {
      const lead = a.leadId ? leadById(a.leadId) : null;
      const phone = a.phone || (lead && lead.phone) || "";
      const fn = first(a.customerName);
      plays.push({
        key: `ns:${a.id}`,
        rank: 80, icon: "alert", kind: "noshow",
        title: `Rebook ${a.customerName || "yesterday's no-show"}`,
        sub: "Missed yesterday — a friendly rebook text recovers most of these.",
        href: phone ? smsHref(phone, `Hi ${fn}, ${me ? `it's ${me} — ` : ""}sorry we missed each other yesterday! Life happens. Want to grab another time this week?`) : null,
        route: phone ? null : "/calendar",
      });
    });

  // 4. Follow-ups due today (with a ready one-tap when the task carries a body).
  store.all("tasks")
    .filter((t) => !t.done && t.leadId && t.channel && t.due && t.due <= todayK)
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""))
    .slice(0, 3)
    .forEach((t) => {
      const lead = leadById(t.leadId);
      const phone = lead && lead.phone;
      plays.push({
        key: `fu:${t.id}`,
        rank: 70, icon: t.channel === "call" ? "phone" : "message", kind: "followup",
        title: t.title,
        sub: daysFromToday(t.due) < 0 ? "Overdue — clear it today." : "Due today.",
        href: !phone ? null : t.channel === "call" ? telHref(phone) : smsHref(phone, t.body || ""),
        route: phone ? null : "/comms",
      });
    });

  // 5. Top occasion (birthday / lease maturity / anniversary).
  getOccasions().slice(0, 2).forEach((o) => {
    plays.push({
      key: `oc:${o.lead.id}:${o.key}`, leadId: o.lead.id, occKey: o.key,
      rank: 60, icon: "sparkles", kind: "occasion",
      title: `${o.lead.name}: ${o.label}`,
      sub: "A ready-to-send message is loaded.",
      href: o.lead.phone ? smsHref(o.lead.phone, o.message || "") : null,
      route: o.lead.phone ? null : "/comms",
    });
  });

  // 6. If the sheet is still light, pull from the Deal Radar.
  if (plays.length < limit) {
    topOpportunities(2).forEach((o) => {
      plays.push({
        key: `rd:${o.lead.id}`,
        rank: 40, icon: "target", kind: "radar",
        title: `${o.lead.name} could trade up`,
        sub: o.reasons && o.reasons.length ? o.reasons[0] : "Payment-matched vehicle in stock.",
        route: "/deals",
      });
    });
  }

  return plays.filter((p) => !isDismissedToday(p.key)).sort((a, b) => b.rank - a.rank).slice(0, limit);
}
