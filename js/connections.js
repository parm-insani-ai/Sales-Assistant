// The app's connective tissue. Every input flows through here so a fact entered
// in one place updates everything related to it:
//   sale       → lead stage, retire pre-sale follow-ups, matched vehicle sold,
//                delivery prep created
//   delivery   → (completion) post-delivery follow-up plan into tasks/Comms
//   appointment→ lead stage moves to "appointment"
//   lost       → open follow-ups retire
// Views and the voice agent call these instead of hand-rolling partial updates.

import * as store from "./store.js";

// Find a lead by (case-insensitive) name — used to link records created from a
// typed name (sales, deliveries, appointments) back to the customer.
export function leadByName(name) {
  const q = String(name || "").trim().toLowerCase();
  if (!q) return null;
  const leads = store.all("leads");
  return leads.find((l) => (l.name || "").toLowerCase() === q) ||
    leads.find((l) => (l.name || "").toLowerCase().includes(q)) || null;
}

// Retire a lead's open pre-sale follow-up work (cadence steps + follow-up
// date). Post-delivery steps are kept — they're the point of a closed deal.
export function closeFollowUps(leadId) {
  if (!leadId) return 0;
  let n = 0;
  store.all("tasks").forEach((t) => {
    if (t.leadId === leadId && t.cadence && !t.postDelivery && !t.done) {
      store.update("tasks", t.id, { done: true });
      n++;
    }
  });
  const lead = store.get("leads", leadId);
  if (lead && lead.followUp) store.update("leads", leadId, { followUp: null });
  return n;
}

// After a sale is logged for a lead.
export function afterSale(leadId, { vehicle = "", fromDelivery = false } = {}) {
  const lead = leadId ? store.get("leads", leadId) : null;
  if (!lead) return;
  if (lead.stage !== "delivered") store.update("leads", lead.id, { stage: "sold" });
  closeFollowUps(lead.id);
  // The Deal Radar-matched inventory vehicle is no longer available.
  if (lead.vehicleId) {
    const v = store.get("vehicles", lead.vehicleId);
    if (v && v.status !== "sold") store.update("vehicles", v.id, { status: "sold" });
  }
  // Every sold car needs delivery prep — create it once.
  if (!fromDelivery) {
    const has = store.all("deliveries").some((d) => d.leadId === lead.id);
    if (!has) {
      const settings = store.getSettings();
      store.create("deliveries", {
        customerName: lead.name,
        vehicle: vehicle || lead.vehicleInterest || "",
        deliveryDate: "",
        status: "prep",
        notes: "",
        leadId: lead.id,
        checklist: (settings.deliveryChecklist || []).map((label) => ({ label, done: false })),
      });
    }
  }
}

// After a delivery completes: queue the post-delivery follow-up plan (once).
export function afterDeliveryComplete(d) {
  if (!d || !d.leadId) return 0;
  if (store.all("tasks").some((t) => t.leadId === d.leadId && t.postDelivery)) return 0;
  const lead = store.get("leads", d.leadId);
  const fn = String((lead && lead.name) || d.customerName || "them").trim().split(/\s+/)[0];
  const mk = (days, channel, label) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + days);
    const verb = channel === "text" ? "Text" : channel === "email" ? "Email" : "Call";
    store.create("tasks", {
      title: `${verb} ${fn} — ${label}`,
      due: dt.toISOString().slice(0, 10),
      priority: "normal",
      done: false,
      leadId: d.leadId,
      cadence: true,
      postDelivery: true,
      channel,
    });
  };
  mk(1, "text", "day-after thank you");
  mk(7, "call", "one-week check-in");
  mk(30, "text", "30-day referral ask");
  return 3;
}

// After an appointment is booked for a lead: the pipeline moves with it.
export function afterAppointmentBooked(leadId) {
  const lead = leadId ? store.get("leads", leadId) : null;
  if (lead && ["new", "working"].includes(lead.stage)) {
    store.update("leads", lead.id, { stage: "appointment" });
  }
}
