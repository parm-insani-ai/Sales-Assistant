// The occasions engine: reasons to reach out, generated from dates the app
// already knows — lease maturities (6/3/1-month tiers), birthdays, and
// purchase anniversaries. Each occasion appears once in the Comms queue with a
// ready-to-send message; acting on it (or dismissing it) logs a marker on the
// lead so it never nags twice.

import * as store from "./store.js";

const DAY = 86400000;

function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  const target = new Date(y, m - 1, d);
  return Math.round((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY);
}

// Next occurrence of a month/day (birthdays, anniversaries): days until it and
// which calendar year it lands in.
function nextAnnual(iso) {
  if (!iso) return null;
  const [, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!m || !d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(now.getFullYear(), m - 1, d);
  if (target < today) target = new Date(now.getFullYear() + 1, m - 1, d);
  return { days: Math.round((target - today) / DAY), year: target.getFullYear() };
}

function fill(text, lead, extra = {}) {
  const s = store.getSettings();
  const firstName = String(lead.name || "there").trim().split(/\s+/)[0];
  const map = {
    firstName,
    vehicle: lead.vehicleInterest || extra.vehicle || "vehicle",
    salesperson: s.salesperson || "",
    dealership: s.dealership || "",
    ...extra,
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => (map[k] != null ? map[k] : m));
}

const monthName = (iso) => {
  const [y, m] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: "long" });
};

// All live occasions, best first. Each: { lead, key, kind, label, message, rank }.
export function getOccasions() {
  const out = [];
  const sales = store.all("sales");
  store.all("leads").forEach((lead) => {
    if (lead.stage === "lost") return;
    const done = lead.occLog || {};

    // --- Lease maturity tiers (skip fresh buyers — their lease info is stale) ---
    const du = daysUntil(lead.leaseEnd);
    if (du != null && du >= 0 && du <= 200 && !["sold", "delivered"].includes(lead.stage)) {
      const tier = du <= 45 ? "lease1" : du <= 105 ? "lease3" : "lease6";
      const key = `${tier}:${lead.leaseEnd}`;
      if (!done[key]) {
        const msgs = {
          lease1: "Hi {firstName}, your lease is up in about a month — let's get your renewal appointment on the books so you're not rushed. What day works this week? — {salesperson}",
          lease3: "Hi {firstName}, your lease wraps up around {month}. This is the sweet spot to look at options — want to grab 15 minutes this week? — {salesperson}",
          lease6: "Hi {firstName}, {salesperson} here. Your lease comes due around {month} — no rush at all, but it's worth a quick options review so you know what's out there. Happy to run numbers anytime.",
        };
        const labels = { lease1: `Lease up in ${du} days`, lease3: "Lease due in ~3 months", lease6: "Lease due in ~6 months" };
        out.push({
          lead, key, kind: tier,
          label: labels[tier],
          message: fill(msgs[tier], lead, { month: monthName(lead.leaseEnd) }),
          rank: tier === "lease1" ? 0 : tier === "lease3" ? 2 : 4,
        });
      }
    }

    // --- Birthday (a relationship touch — no ask) ---
    const bd = nextAnnual(lead.dob);
    if (bd && bd.days <= 2) {
      const key = `bday:${bd.year}`;
      if (!done[key]) {
        out.push({
          lead, key, kind: "bday",
          label: bd.days === 0 ? "Birthday today 🎂" : `Birthday in ${bd.days} day${bd.days === 1 ? "" : "s"}`,
          message: fill("Happy birthday, {firstName}! 🎉 Hope it's a great one. — {salesperson}", lead),
          rank: 3,
        });
      }
    }

    // --- Purchase anniversary (from their sales) ---
    sales.filter((s) => s.leadId === lead.id && s.saleDate).forEach((s) => {
      const an = nextAnnual(s.saleDate);
      if (!an || an.days > 7) return;
      const years = an.year - Number(String(s.saleDate).slice(0, 4));
      if (years < 1) return;
      const key = `anniv:${s.id}:${an.year}`;
      if (done[key]) return;
      out.push({
        lead, key, kind: "anniv",
        label: `${years} year${years === 1 ? "" : "s"} since their ${s.vehicle || "purchase"}`,
        message: fill("Hi {firstName}, hard to believe it's been {years} year{plural} with your {vehicle}! Trade values are strong right now — curious what an upgrade would look like? I can run numbers, zero pressure. — {salesperson}", lead, { years, plural: years === 1 ? "" : "s", vehicle: s.vehicle || lead.vehicleInterest || "vehicle" }),
        rank: 3,
      });
    });
  });
  return out.sort((a, b) => a.rank - b.rank);
}

// Record that an occasion was acted on or dismissed — it won't reappear.
export function markOccasion(leadId, key) {
  const lead = store.get("leads", leadId);
  if (!lead) return;
  store.update("leads", leadId, { occLog: { ...(lead.occLog || {}), [key]: new Date().toISOString().slice(0, 10) } });
}
