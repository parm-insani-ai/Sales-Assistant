// The occasions engine: reasons to reach out, generated from dates the app
// already knows — lease maturities (6/3/1-month tiers), birthdays, and
// purchase anniversaries. Each occasion appears once in the Comms queue with a
// ready-to-send message; acting on it (or dismissing it) logs a marker on the
// lead so it never nags twice.

import * as store from "./store.js";
import { careRules, mmddSay } from "./cadence.js";

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

// An owner: someone in a car from us — delivered or sold, a sale on file,
// or a purchase date from the book. Their vehicle, and when they got it.
function ownerOf(lead, sales) {
  const mine = sales.filter((s) => s.leadId === lead.id && (s.deliveredAt || s.saleDate)).sort((a, b) => String(b.deliveredAt || b.saleDate).localeCompare(String(a.deliveredAt || a.saleDate)));
  const sale = mine[0] || null;
  const got = (sale && (sale.deliveredAt || sale.saleDate)) || lead.deliveredAt || lead.purchaseDate || null;
  if (!got && !["sold", "delivered"].includes(lead.stage)) return null;
  return { got: got ? String(got).slice(0, 10) : null, vehicle: (sale && sale.vehicle) || lead.vehicleInterest || "vehicle" };
}
const addMonths = (iso, n) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); const t = new Date(y, m - 1 + n, Math.min(d || 1, 28)); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

// All live occasions, best first. Each: { lead, key, kind, label, message, rank }.
export function getOccasions() {
  const out = [];
  const sales = store.all("sales");
  const care = careRules();
  const openServiceTask = new Set(store.all("tasks").filter((t) => !t.done && t.postDelivery && t.intent === "service").map((t) => t.leadId));
  store.all("leads").forEach((lead) => {
    if (lead.stage === "lost") return;
    const done = lead.occLog || {};

    // --- Service & tires (owners) — the Service & tires rule on the Plans page ---
    const owner = ownerOf(lead, sales);
    if (owner) {
      const booked = lead.serviceAppt && daysUntil(lead.serviceAppt) != null && daysUntil(lead.serviceAppt) >= -1;
      // Service: every N months from the last service (or the delivery);
      // shown from two weeks before the day to a month after, unless a visit
      // is booked or the delivery plan's own service text is still open.
      const anchor = lead.lastService ? String(lead.lastService).slice(0, 10) : owner.got;
      if (anchor && !booked && !openServiceTask.has(lead.id)) {
        let due = addMonths(anchor, care.serviceMonths);
        let guard = 0;
        while (daysUntil(due) < -30 && guard++ < 60) due = addMonths(due, care.serviceMonths);
        const du = daysUntil(due);
        if (du != null && du <= 14) {
          const key = `service:${due}`;
          if (!done[key]) out.push({
            lead, key, kind: "service",
            label: du >= 0 ? `Service due in ${du} day${du === 1 ? "" : "s"}` : `Service due — ${-du} day${du === -1 ? "" : "s"} ago`,
            message: fill("Hi {firstName}, {salesperson} here — the {vehicle} is coming up on a service. Want me to get you booked in so it's easy? Reply with a day that suits.", lead, { vehicle: owner.vehicle }),
            rank: 4,
          });
        }
      }
      // Tires: the swap each autumn and spring, from two weeks before the
      // date to a month after.
      [["winter", care.winterTires, care.winterDate], ["summer", care.summerTires, care.summerDate]].forEach(([season, on, date]) => {
        if (!on || booked) return;
        const now = new Date();
        const [m, d] = String(date).split("-").map(Number);
        for (const y of [now.getFullYear() - 1, now.getFullYear()]) {
          const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const du = daysUntil(iso);
          if (du == null || du > 14 || du < -30) continue;
          if (owner.got && owner.got > iso) continue; // not before they had the car
          const key = `tires:${season}:${y}`;
          if (done[key]) continue;
          out.push({
            lead, key, kind: "tires",
            label: season === "winter" ? `Winter tires — ${mmddSay(date)}` : `Summer tires — ${mmddSay(date)}`,
            message: fill(season === "winter"
              ? "Hi {firstName}, {salesperson} here — winter's on its way. Want me to book the {vehicle} in for its winter tires and a quick check-over before the rush? Reply with a day that suits."
              : "Hi {firstName}, {salesperson} here — time to get the winters off the {vehicle}. Want me to book the swap before the rush? Reply with a day that suits.", lead, { vehicle: owner.vehicle }),
            rank: 4,
          });
        }
      });
    }

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
        message: fill("Hi {firstName}, hard to believe it's been {years} year{plural} with your {vehicle}! If you're ever curious what an upgrade would look like, I can run the numbers with you in ten minutes — zero pressure. — {salesperson}", lead, { years, plural: years === 1 ? "" : "s", vehicle: s.vehicle || lead.vehicleInterest || "vehicle" }),
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
