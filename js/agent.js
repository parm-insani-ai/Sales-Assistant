// Voice agent brain. Sends the spoken request (plus a compact snapshot of the
// user's data) to a Claude-backed endpoint on their Supabase, receives a short
// spoken reply plus a list of actions, and runs those actions against the local
// store. Everything the agent "does" happens here on-device; the endpoint only
// decides *what* to do. Falls back to the on-device parser when not configured.

import * as store from "./store.js";
import { navigate } from "./router.js";
import { maybeStartCadence, startCadence } from "./cadence.js";
import { openDealerSearch } from "./views/dealer.js";

export function agentConfigured() {
  return !!(store.getSettings().agentUrl || "").trim();
}

// A small, privacy-conscious snapshot to help the agent resolve "Ken", "my 3pm",
// "the Rogue deal" to real records. Only names/stages/times — no notes.
function buildContext() {
  const now = new Date();
  const leads = store.all("leads")
    .filter((l) => !["lost"].includes(l.stage))
    .slice(0, 60)
    .map((l) => ({ name: l.name, stage: l.stage, hasPhone: !!l.phone, vehicle: l.vehicleInterest || "" }));
  const appts = store.all("appointments")
    .filter((a) => a.status !== "canceled")
    .slice(0, 40)
    .map((a) => ({ customer: a.customerName, when: a.when, type: a.type, outcome: a.outcome || "" }));
  const pad = (n) => String(n).padStart(2, "0");
  return {
    today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()],
    nowTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    salesperson: store.getSettings().salesperson || "",
    leads,
    appts,
  };
}

// Ask the agent what to do. Returns { say, actions } or throws.
export async function runAgent(transcript) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Voice agent isn't set up");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, context: buildContext() }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Agent error (${res.status})`);
  }
  const data = await res.json();
  return { say: data.say || "", actions: Array.isArray(data.actions) ? data.actions : [] };
}

// ---- Executing the agent's actions against the local store ----
function findLead(name) {
  if (!name) return null;
  const q = String(name).trim().toLowerCase();
  const leads = store.all("leads");
  return (
    leads.find((l) => (l.name || "").toLowerCase() === q) ||
    leads.find((l) => (l.name || "").toLowerCase().includes(q)) ||
    leads.find((l) => q.includes((l.name || "").toLowerCase()) && l.name) ||
    null
  );
}
function findAppt(customer) {
  const q = String(customer || "").trim().toLowerCase();
  const appts = store.all("appointments").filter((a) => a.status !== "canceled" && (a.customerName || "").toLowerCase().includes(q));
  if (!appts.length) return null;
  const now = Date.now();
  // Prefer the nearest appointment (upcoming first, else most recent).
  appts.sort((a, b) => Math.abs(new Date(a.when) - now) - Math.abs(new Date(b.when) - now));
  return appts[0];
}
const num = (v) => (v == null || v === "" ? null : Number(String(v).replace(/[^0-9.\-]/g, "")) || null);

const ROUTES = {
  home: "/", dashboard: "/", leads: "/leads", customers: "/leads", inventory: "/inventory",
  calculator: "/calculator", deliveries: "/deliveries", calendar: "/calendar", schedule: "/calendar",
  goals: "/goals", radar: "/deals", deals: "/deals", prospecting: "/prospecting", tools: "/tools",
  spiffs: "/spiffs", specials: "/specials", compare: "/compare", import: "/import", settings: "/settings",
};

// Runs one action; returns a short note (used to enrich the spoken reply and to
// know where to land). Unknown/failed actions return a note starting with "⚠".
function runAction(a) {
  const t = (a.tool || a.action || "").toLowerCase();
  const p = a.args || a.input || a;
  switch (t) {
    case "open_page": case "navigate": {
      const route = ROUTES[String(p.page || p.route || "").toLowerCase()] || (String(p.route || "").startsWith("/") ? p.route : null);
      if (!route) return "⚠ couldn't find that page";
      navigate(route);
      return `opened ${route}`;
    }
    case "create_lead": {
      if (!p.name) return "⚠ need a name for the lead";
      const lead = store.create("leads", {
        name: p.name, vehicleInterest: p.vehicle || p.vehicleInterest || "", phone: p.phone || "",
        email: p.email || "", stage: "new", source: "Voice", followUp: p.followUp || null, notes: p.notes || "",
      });
      maybeStartCadence(lead.id);
      return `added lead ${lead.name}`;
    }
    case "update_lead": {
      const lead = findLead(p.name || p.customer);
      if (!lead) return `⚠ couldn't find ${p.name || p.customer}`;
      const patch = {};
      ["phone", "email", "stage", "followUp", "notes"].forEach((k) => { if (p[k] != null && p[k] !== "") patch[k] = p[k]; });
      if (p.vehicle || p.vehicleInterest) patch.vehicleInterest = p.vehicle || p.vehicleInterest;
      store.update("leads", lead.id, patch);
      return `updated ${lead.name}`;
    }
    case "add_task": {
      if (!p.title) return "⚠ need a task";
      store.create("tasks", { title: p.title, due: p.due || "", priority: p.priority || "normal", done: false });
      return `added to-do: ${p.title}`;
    }
    case "log_sale": {
      const lead = findLead(p.customer || p.name);
      store.create("sales", {
        customerName: p.customer || p.name || "Customer", vehicle: p.vehicle || "",
        saleDate: p.date || new Date().toISOString().slice(0, 10),
        commission: num(p.commission), frontGross: num(p.front ?? p.frontGross), backGross: num(p.back ?? p.backGross),
        leadId: lead ? lead.id : null, notes: "",
      });
      if (lead && lead.stage !== "delivered") store.update("leads", lead.id, { stage: "sold" });
      return `logged sale for ${p.customer || p.name || "customer"}`;
    }
    case "book_appointment": case "schedule_appointment": {
      const lead = findLead(p.customer || p.name);
      const type = ["testdrive", "delivery", "call", "appointment"].includes(p.type) ? p.type : "appointment";
      const label = { appointment: "Appointment", testdrive: "Test drive", delivery: "Delivery", call: "Phone call" }[type];
      const a2 = store.create("appointments", {
        type, title: label, customerName: p.customer || p.name || (lead ? lead.name : ""),
        vehicle: p.vehicle || (lead ? lead.vehicleInterest : "") || "", when: p.when || "",
        status: "scheduled", confirmed: false, outcome: "", leadId: lead ? lead.id : null, notes: "",
      });
      return `booked ${label.toLowerCase()} with ${a2.customerName || "customer"}`;
    }
    case "appointment_outcome": case "set_outcome": {
      const appt = findAppt(p.customer || p.name);
      if (!appt) return `⚠ no appointment found for ${p.customer || p.name}`;
      const o = String(p.outcome || "").toLowerCase();
      if (o === "confirmed" || o === "confirm") { store.update("appointments", appt.id, { confirmed: true }); return `confirmed ${appt.customerName}`; }
      if (o === "no_show" || o === "no-show" || o === "noshow") { store.update("appointments", appt.id, { outcome: "no_show" }); return `marked ${appt.customerName} no-show`; }
      if (o === "showed" || o === "show") { store.update("appointments", appt.id, { outcome: "showed", confirmed: true }); return `marked ${appt.customerName} showed`; }
      if (o === "sold") {
        store.update("appointments", appt.id, { outcome: "sold", confirmed: true });
        const logged = store.all("sales").some((s) => s.apptId === appt.id || (appt.leadId && s.leadId === appt.leadId));
        if (!logged) {
          store.create("sales", { customerName: appt.customerName, vehicle: appt.vehicle, saleDate: new Date().toISOString().slice(0, 10), frontGross: 0, backGross: 0, commission: 0, leadId: appt.leadId || null, apptId: appt.id });
          if (appt.leadId) { const l = store.get("leads", appt.leadId); if (l && l.stage !== "delivered") store.update("leads", appt.leadId, { stage: "sold" }); }
        }
        return `marked ${appt.customerName} sold`;
      }
      return "⚠ unknown outcome";
    }
    case "start_cadence": case "start_followup": {
      const lead = findLead(p.name || p.customer);
      if (!lead) return `⚠ couldn't find ${p.name || p.customer}`;
      startCadence(lead.id);
      return `started follow-up plan for ${lead.name}`;
    }
    case "search_inventory": case "find_vehicle": {
      openDealerSearch({ vehicleInterest: p.query || p.vehicle || "" });
      return `searching inventory${p.query ? " for " + p.query : ""}`;
    }
    case "answer": case "reply":
      return ""; // nothing to do; the spoken reply carries the answer
    default:
      return `⚠ I can't do "${t}" yet`;
  }
}

// Execute all actions in order; return { notes, landed } where landed is the
// last route navigated to (so the panel can leave the user in a useful place).
export function executeActions(actions) {
  const notes = [];
  actions.forEach((a) => { const n = runAction(a); if (n) notes.push(n); });
  return { notes };
}
