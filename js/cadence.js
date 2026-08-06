// Follow-up cadence engine. Applies the salesperson's multi-touch sequence to a
// lead as a series of dated reminders (tasks), so every lead gets worked and
// none go cold — the single biggest lever for turning leads into appointments.

import * as store from "./store.js";

function firstName(name) {
  return String(name || "there").trim().split(/\s+/)[0];
}
function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// True if this lead already has cadence tasks (so we don't duplicate them).
export function hasCadence(leadId) {
  return store.all("tasks").some((t) => t.leadId === leadId && t.cadence && !t.done);
}

// Create the cadence's reminder tasks for a lead. Returns the number created.
export function startCadence(leadId) {
  const lead = store.get("leads", leadId);
  if (!lead) return 0;
  const steps = store.getSettings().cadence || [];
  const fn = firstName(lead.name);
  let created = 0;
  steps.forEach((step) => {
    const verb = step.channel === "text" ? "Text" : step.channel === "email" ? "Email" : "Call";
    store.create("tasks", {
      title: `${verb} ${fn} — ${step.label}`,
      due: addDaysISO(step.day || 0),
      priority: (step.day || 0) <= 2 ? "high" : "normal",
      done: false,
      leadId,
      cadence: true,
      channel: step.channel,
    });
    created++;
  });
  return created;
}

// Called after a lead is created; starts the cadence if auto-cadence is on and
// the lead doesn't already have one.
export function maybeStartCadence(leadId) {
  if (!store.getSettings().autoCadence) return 0;
  if (hasCadence(leadId)) return 0;
  return startCadence(leadId);
}
