// Voice agent — a real tool-use loop. The request goes to a Claude gateway on
// the user's Supabase; Claude can call READ tools (look up customers, the deal
// radar, stats, today's schedule) and WRITE tools (book appointments, log sales,
// update customers…). We run each tool locally against the store, feed the
// results back, and let Claude take the next step until it's done — so it can
// answer questions and carry out multi-step tasks. All data stays on-device;
// the gateway only relays messages to the model.

import * as store from "./store.js";
import { navigate } from "./router.js";
import { maybeStartCadence, startCadence } from "./cadence.js";
import { openDealerSearch } from "./views/dealer.js";
import { topOpportunities } from "./views/dealbuilder.js";
import { apptFunnel, monthSummary } from "./views/goals.js";

export function agentConfigured() {
  return !!(store.getSettings().agentUrl || "").trim();
}

function buildContext() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()],
    nowTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    salesperson: store.getSettings().salesperson || "",
    counts: { leads: store.all("leads").length, appointments: store.all("appointments").length },
  };
}

async function callAgent(messages) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Voice agent isn't set up");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context: buildContext() }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Agent error (${res.status})`);
  }
  return res.json(); // { content:[...], stop_reason }
}

// ---- Entity resolution ----
function findLead(name) {
  if (!name) return null;
  const q = String(name).trim().toLowerCase();
  const leads = store.all("leads");
  return (
    leads.find((l) => (l.name || "").toLowerCase() === q) ||
    leads.find((l) => (l.name || "").toLowerCase().includes(q)) ||
    leads.find((l) => l.name && q.includes((l.name || "").toLowerCase())) || null
  );
}
function findAppt(customer) {
  const q = String(customer || "").trim().toLowerCase();
  const appts = store.all("appointments").filter((a) => a.status !== "canceled" && (a.customerName || "").toLowerCase().includes(q));
  if (!appts.length) return null;
  const now = Date.now();
  appts.sort((a, b) => Math.abs(new Date(a.when) - now) - Math.abs(new Date(b.when) - now));
  return appts[0];
}
const num = (v) => (v == null || v === "" ? null : Number(String(v).replace(/[^0-9.\-]/g, "")) || null);
const equityOf = (l) => (l.currentValue != null || l.payoff != null) ? (l.currentValue || 0) - (l.payoff || 0) : null;

const ROUTES = {
  home: "/", dashboard: "/", leads: "/leads", customers: "/leads", inventory: "/inventory",
  calculator: "/calculator", deliveries: "/deliveries", calendar: "/calendar", schedule: "/calendar",
  goals: "/goals", radar: "/deals", deals: "/deals", prospecting: "/prospecting", tools: "/tools",
  spiffs: "/spiffs", specials: "/specials", compare: "/compare", import: "/import", settings: "/settings",
};

// Run one tool. Returns { result, note } — `result` is what Claude sees (data
// object for reads, a short confirmation string for writes); `note` is a
// human-facing action summary (⚠ prefix = failure), or "" for silent reads.
function execTool(name, p = {}) {
  const t = (name || "").toLowerCase();
  switch (t) {
    // ---- READS ----
    case "find_customers": {
      let list = store.all("leads");
      const q = (p.query || "").toLowerCase();
      if (q) list = list.filter((l) => (l.name || "").toLowerCase().includes(q) || (l.vehicleInterest || "").toLowerCase().includes(q));
      if (p.stage) list = list.filter((l) => l.stage === p.stage);
      if (p.needsFollowUp) list = list.filter((l) => l.followUp);
      if (p.hasEquity) list = list.filter((l) => (equityOf(l) || 0) > 0);
      const customers = list.slice(0, 15).map((l) => ({ name: l.name, phone: l.phone || "", stage: l.stage, vehicle: l.vehicleInterest || "", payment: l.currentPayment ?? null, equity: equityOf(l), followUp: l.followUp || null }));
      return { result: { count: list.length, customers }, note: "" };
    }
    case "get_customer": {
      const l = findLead(p.name || p.customer);
      if (!l) return { result: { found: false }, note: "" };
      return { result: { found: true, name: l.name, phone: l.phone || "", email: l.email || "", stage: l.stage, vehicle: l.vehicleInterest || "", payment: l.currentPayment ?? null, payoff: l.payoff ?? null, value: l.currentValue ?? null, equity: equityOf(l), apr: l.currentApr ?? null, followUp: l.followUp || null, leaseEnd: l.leaseEnd || null }, note: "" };
    }
    case "get_appointments": {
      let list = store.all("appointments").filter((a) => a.status !== "canceled");
      if (p.date) list = list.filter((a) => String(a.when).slice(0, 10) === p.date);
      list = list.sort((a, b) => String(a.when).localeCompare(String(b.when))).slice(0, 25);
      return { result: { appointments: list.map((a) => ({ customer: a.customerName, when: a.when, type: a.type, confirmed: !!a.confirmed, outcome: a.outcome || "" })) }, note: "" };
    }
    case "deal_radar": {
      const opps = topOpportunities(p.limit || 8).map((o) => ({
        customer: o.lead.name, phone: o.lead.phone || "", pays: o.lead.currentPayment ?? null,
        vehicle: [o.best.vehicle.year, o.best.vehicle.make, o.best.vehicle.model].filter(Boolean).join(" "),
        monthly: Math.round(o.best.monthly), delta: o.best.delta != null ? Math.round(o.best.delta) : null,
        method: o.best.method, reasons: o.reasons,
      }));
      return { result: { opportunities: opps }, note: "" };
    }
    case "get_stats": {
      const f = apptFunnel(); const m = monthSummary(); const s = store.getSettings();
      return { result: { appointmentsSet: f.set, confirmed: f.confirmed, showed: f.showed, sold: f.sold, showRate: `${f.showRate}%`, appointmentToSold: `${f.closeRate}%`, unitsSold: m.units, commission: m.commission, goalAppointments: s.goalAppointments, goalUnits: s.goalUnits }, note: "" };
    }

    // ---- WRITES ----
    case "open_page": case "navigate": {
      const route = ROUTES[String(p.page || p.route || "").toLowerCase()] || (String(p.route || "").startsWith("/") ? p.route : null);
      if (!route) return { result: "no such page", note: "⚠ couldn't find that page" };
      navigate(route);
      return { result: `opened ${route}`, note: `opened ${route}` };
    }
    case "create_lead": {
      if (!p.name) return { result: "need a name", note: "⚠ need a name for the lead" };
      const lead = store.create("leads", { name: p.name, vehicleInterest: p.vehicle || "", phone: p.phone || "", email: p.email || "", stage: "new", source: "Voice", followUp: p.followUp || null, notes: p.notes || "" });
      maybeStartCadence(lead.id);
      return { result: `created lead ${lead.name}`, note: `added lead ${lead.name}` };
    }
    case "update_lead": {
      const lead = findLead(p.name || p.customer);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.name || p.customer}` };
      const patch = {};
      ["phone", "email", "stage", "followUp", "notes"].forEach((k) => { if (p[k] != null && p[k] !== "") patch[k] = p[k]; });
      if (p.vehicle) patch.vehicleInterest = p.vehicle;
      store.update("leads", lead.id, patch);
      return { result: `updated ${lead.name}`, note: `updated ${lead.name}` };
    }
    case "add_task": {
      if (!p.title) return { result: "need a task", note: "⚠ need a task" };
      store.create("tasks", { title: p.title, due: p.due || "", priority: p.priority || "normal", done: false });
      return { result: `added task`, note: `added to-do: ${p.title}` };
    }
    case "log_sale": {
      const lead = findLead(p.customer || p.name);
      store.create("sales", { customerName: p.customer || p.name || "Customer", vehicle: p.vehicle || "", saleDate: p.date || new Date().toISOString().slice(0, 10), commission: num(p.commission), frontGross: num(p.front ?? p.frontGross), backGross: num(p.back ?? p.backGross), leadId: lead ? lead.id : null, notes: "" });
      if (lead && lead.stage !== "delivered") store.update("leads", lead.id, { stage: "sold" });
      return { result: `logged sale`, note: `logged sale for ${p.customer || p.name || "customer"}` };
    }
    case "book_appointment": case "schedule_appointment": {
      const lead = findLead(p.customer || p.name);
      const type = ["testdrive", "delivery", "call", "appointment"].includes(p.type) ? p.type : "appointment";
      const label = { appointment: "Appointment", testdrive: "Test drive", delivery: "Delivery", call: "Phone call" }[type];
      const a2 = store.create("appointments", { type, title: label, customerName: p.customer || p.name || (lead ? lead.name : ""), vehicle: p.vehicle || (lead ? lead.vehicleInterest : "") || "", when: p.when || "", status: "scheduled", confirmed: false, outcome: "", leadId: lead ? lead.id : null, notes: "" });
      return { result: `booked ${label} with ${a2.customerName} at ${a2.when}`, note: `booked ${label.toLowerCase()} with ${a2.customerName || "customer"}` };
    }
    case "appointment_outcome": case "set_outcome": {
      const appt = findAppt(p.customer || p.name);
      if (!appt) return { result: "no appointment found", note: `⚠ no appointment found for ${p.customer || p.name}` };
      const o = String(p.outcome || "").toLowerCase();
      if (o === "confirmed" || o === "confirm") { store.update("appointments", appt.id, { confirmed: true }); return { result: "confirmed", note: `confirmed ${appt.customerName}` }; }
      if (o.includes("no")) { store.update("appointments", appt.id, { outcome: "no_show" }); return { result: "no-show", note: `marked ${appt.customerName} no-show` }; }
      if (o.includes("show")) { store.update("appointments", appt.id, { outcome: "showed", confirmed: true }); return { result: "showed", note: `marked ${appt.customerName} showed` }; }
      if (o === "sold") {
        store.update("appointments", appt.id, { outcome: "sold", confirmed: true });
        const logged = store.all("sales").some((s) => s.apptId === appt.id || (appt.leadId && s.leadId === appt.leadId));
        if (!logged) {
          store.create("sales", { customerName: appt.customerName, vehicle: appt.vehicle, saleDate: new Date().toISOString().slice(0, 10), frontGross: 0, backGross: 0, commission: 0, leadId: appt.leadId || null, apptId: appt.id });
          if (appt.leadId) { const l = store.get("leads", appt.leadId); if (l && l.stage !== "delivered") store.update("leads", appt.leadId, { stage: "sold" }); }
        }
        return { result: "sold", note: `marked ${appt.customerName} sold` };
      }
      return { result: "unknown outcome", note: "⚠ unknown outcome" };
    }
    case "start_cadence": case "start_followup": {
      const lead = findLead(p.name || p.customer);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.name || p.customer}` };
      startCadence(lead.id);
      return { result: "started", note: `started follow-up plan for ${lead.name}` };
    }
    case "search_inventory": case "find_vehicle": {
      openDealerSearch({ vehicleInterest: p.query || p.vehicle || "" });
      return { result: "opened search", note: `searching inventory${p.query ? " for " + p.query : ""}` };
    }
    default:
      return { result: `unknown tool ${t}`, note: `⚠ I can't do "${t}" yet` };
  }
}

// The agent loop. onProgress(note) is called as each action runs. Returns
// { say, notes } once Claude stops calling tools (or the step cap is hit).
export async function runAgent(transcript, onProgress) {
  const messages = [{ role: "user", content: transcript }];
  const notes = [];
  for (let step = 0; step < 6; step++) {
    const resp = await callAgent(messages);
    const content = resp.content || [];
    const toolUses = content.filter((b) => b.type === "tool_use");
    const text = content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();

    if (!toolUses.length || resp.stop_reason !== "tool_use") {
      return { say: text, notes };
    }

    const results = [];
    for (const tu of toolUses) {
      let out;
      try { out = execTool(tu.name, tu.input || {}); }
      catch (e) { out = { result: `error: ${e && e.message ? e.message : e}`, note: "" }; }
      if (out.note) { notes.push(out.note); if (onProgress) onProgress(out.note); }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: typeof out.result === "string" ? out.result : JSON.stringify(out.result) });
    }
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: results });
  }
  return { say: "That needed too many steps — try breaking it into smaller asks.", notes };
}
