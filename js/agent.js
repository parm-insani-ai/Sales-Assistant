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
import { findSpec, queueCompare } from "./views/compare.js";
import { topOpportunities, dealsForLead } from "./views/dealbuilder.js";
import { apptFunnel, monthSummary } from "./views/goals.js";
import { afterSale, afterAppointmentBooked, afterDeliveryComplete, closeFollowUps } from "./connections.js";
import { getOccasions } from "./occasions.js";
import { computeDeal } from "./views/calculator.js";
import { sendEmail, logEmail } from "./email.js";
import { smsHref, telHref } from "./utils.js";
import { bookingLink, cachedShortBookingLink } from "./views/settings.js";
import { weekStart, weekStats, coachInsights } from "./views/coach.js";
import { getPlays } from "./plays.js";
import * as backend from "./backend.js";

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

// The agent's brain lives here in the app (not on the server), so it can be
// improved and shipped via the normal auto-update — no Supabase redeploy.
const TOOLS = [
  { name: "ask_user", description: "Ask the salesperson ONE short question when a required detail is genuinely missing or ambiguous (e.g. which customer, or a time you can't reasonably assume). Only use when you truly can't proceed.", input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  { name: "find_customers", description: "Look up customers/leads by name/vehicle query, stage, needsFollowUp, or hasEquity.", input_schema: { type: "object", properties: { query: { type: "string" }, stage: { type: "string" }, needsFollowUp: { type: "boolean" }, hasEquity: { type: "boolean" } } } },
  { name: "get_customer", description: "Full details for one customer by name.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "get_appointments", description: "List appointments, optionally for a date (YYYY-MM-DD).", input_schema: { type: "object", properties: { date: { type: "string" } } } },
  { name: "deal_radar", description: "Top trade-up opportunities (customer, matched vehicle, monthly, delta).", input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_stats", description: "This month's appointment funnel, units, commission, goals.", input_schema: { type: "object", properties: {} } },
  { name: "get_tasks", description: "List open to-dos ('what's on my plate?'). dueToday also includes overdue.", input_schema: { type: "object", properties: { dueToday: { type: "boolean" } } } },
  { name: "get_deliveries", description: "Upcoming deliveries with prep progress ('when's Sara's delivery?', 'what's left to prep?').", input_schema: { type: "object", properties: {} } },
  { name: "get_occasions", description: "Reasons to reach out — upcoming birthdays, lease maturities, purchase anniversaries, each with a ready-to-send message.", input_schema: { type: "object", properties: {} } },
  { name: "get_specials", description: "Current manufacturer/monthly specials on file (APRs, lease deals, cash offers).", input_schema: { type: "object", properties: {} } },
  { name: "get_spiffs", description: "Current spifs/bonuses on file.", input_schema: { type: "object", properties: {} } },
  { name: "payment_quote", description: "Estimate a monthly car payment. Uses the salesperson's saved tax rate, doc fee, APR and term for anything not given.", input_schema: { type: "object", properties: { price: { type: "number" }, down: { type: "number" }, trade: { type: "number", description: "trade-in allowance" }, payoff: { type: "number", description: "trade-in payoff owed" }, apr: { type: "number" }, term: { type: "number", description: "months" } }, required: ["price"] } },
  { name: "deal_options", description: "Payment-matched vehicles from inventory for one customer ('what could I put Dana in?').", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "get_booking_link", description: "The salesperson's self-serve booking link (customers pick their own appointment time). Pair with text_customer to send it.", input_schema: { type: "object", properties: {} } },
  { name: "get_link_activity", description: "Opens on links the salesperson has sent (booking page, comparisons) — 'did anyone look at what I sent?', 'anything hot?'. Recent opens mean the customer is engaging right now.", input_schema: { type: "object", properties: {} } },
  { name: "get_plays", description: "The ranked play sheet — 'what should I do right now?', 'what are my plays?'. Warm link opens, unconfirmed appointments, no-show recoveries, due follow-ups, occasions, radar opportunities — best first.", input_schema: { type: "object", properties: {} } },
  { name: "get_coach", description: "The weekly sales-coach readout — 'how am I doing this week?', 'give me my weekly review'. This week's scorecard (units, commission, appointments, show rate, touches), last week for comparison, and the coach's insights.", input_schema: { type: "object", properties: {} } },
  { name: "open_page", description: "Open a screen.", input_schema: { type: "object", properties: { page: { type: "string", enum: ["home", "leads", "inventory", "calculator", "deliveries", "calendar", "goals", "radar", "prospecting", "comms", "soldlog", "coach", "pay", "spiffs", "specials", "compare", "import", "settings"] } }, required: ["page"] } },
  { name: "create_lead", description: "Add a new customer/lead. Use this when someone 'wants', 'is looking for', or 'is interested in' a vehicle — that is interest, NOT a sale.", input_schema: { type: "object", properties: { name: { type: "string" }, vehicle: { type: "string" }, phone: { type: "string" }, followUp: { type: "string" } }, required: ["name"] } },
  { name: "update_lead", description: "Update an existing customer (match by name).", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, stage: { type: "string", enum: ["new", "working", "appointment", "negotiating", "sold", "delivered", "lost"] }, followUp: { type: "string" }, vehicle: { type: "string" } }, required: ["name"] } },
  { name: "add_task", description: "Add a to-do/reminder.", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string" } }, required: ["title"] } },
  { name: "complete_task", description: "Check off an open to-do (match by words from its title — 'mark the plates thing done').", input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "complete_delivery", description: "Mark a customer's delivery as delivered/handed over. Kicks off the post-delivery follow-up plan.", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "text_customer", description: "Open Messages prefilled with a text to a customer — YOU write a natural message; the salesperson just hits send. Use for 'text Ken that his car is ready', or to send the booking link / a comparison.", input_schema: { type: "object", properties: { customer: { type: "string" }, message: { type: "string" } }, required: ["customer", "message"] } },
  { name: "call_customer", description: "Open the phone dialer with a customer's number ('call Moe').", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "send_email", description: "Actually send an email to a customer (needs their email on file and email sending set up). YOU write the subject and body.", input_schema: { type: "object", properties: { customer: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["customer", "subject", "body"] } },
  { name: "add_special", description: "Save a manufacturer/monthly special ('0% for 60 months on Rogues till Monday').", input_schema: { type: "object", properties: { model: { type: "string" }, financeApr: { type: "number" }, financeTerm: { type: "number" }, leasePayment: { type: "number" }, leaseTerm: { type: "number" }, leaseDown: { type: "number" }, cash: { type: "number" }, expiry: { type: "string", description: "YYYY-MM-DD" }, notes: { type: "string" } }, required: ["model"] } },
  { name: "add_spif", description: "Save a spif/bonus ('$500 on every Pathfinder this weekend').", input_schema: { type: "object", properties: { title: { type: "string" }, amount: { type: "number" }, match: { type: "string", description: "keyword a sale's vehicle must contain to count" }, expiry: { type: "string", description: "YYYY-MM-DD" }, notes: { type: "string" } }, required: ["title"] } },
  { name: "log_sale", description: "Log a CLOSED sale. Use ONLY when the salesperson clearly says the deal is done — 'sold', 'bought', 'signed', 'took delivery', 'made $X on'. Never for interest ('wants/looking at a Rogue' is create_lead or update_lead, not a sale). Capture tracker details when spoken: lead type, new/used, stock #, business manager, front vs business-office commission.", input_schema: { type: "object", properties: { customer: { type: "string" }, commission: { type: "number" }, front: { type: "number" }, back: { type: "number" }, vehicle: { type: "string" }, leadType: { type: "string", enum: ["Walk-in", "Hand Off", "Referral", "Facebook", "BDC", "Service", "Auto Alert", "Other"] }, newUsed: { type: "string", enum: ["New", "Used"] }, stock: { type: "string" }, bm: { type: "string", description: "business manager who worked the deal" }, frontComm: { type: "number", description: "front commission $" }, boComm: { type: "number", description: "business office commission $" } }, required: ["customer"] } },
  { name: "undo_sale", description: "Remove a sale that was logged by mistake (e.g. 'I didn't sell that car', 'that wasn't a sale'). Deletes the customer's most recent sale record and moves their stage back from sold.", input_schema: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "book_appointment", description: "Book an appointment with a customer.", input_schema: { type: "object", properties: { customer: { type: "string" }, type: { type: "string", enum: ["appointment", "testdrive", "delivery", "call"] }, when: { type: "string", description: "YYYY-MM-DDTHH:MM" }, vehicle: { type: "string" } }, required: ["customer", "when"] } },
  { name: "appointment_outcome", description: "Set a customer's appointment outcome.", input_schema: { type: "object", properties: { customer: { type: "string" }, outcome: { type: "string", enum: ["confirmed", "showed", "no_show", "sold"] } }, required: ["customer", "outcome"] } },
  { name: "start_cadence", description: "Start the follow-up plan for a customer.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "search_inventory", description: "Search the dealership's live inventory for a vehicle in stock. NOT for comparing models against each other — that's compare_vehicles.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "compare_vehicles", description: "Open the side-by-side comparison tool with the named vehicles, using the built-in 2026 Canadian spec database. Use whenever the salesperson wants to compare models or a customer is cross-shopping — 'compare the Kicks with the CR-V', 'how does the Rogue stack up against the RAV4'.", input_schema: { type: "object", properties: { vehicles: { type: "array", items: { type: "string" }, description: "Vehicle names, e.g. [\"Nissan Kicks\", \"Honda CR-V\"]" } }, required: ["vehicles"] } },
];

function buildSystem(ctx) {
  return [
    `You are entoa's hands-free assistant for a car salesperson${ctx.salesperson ? " named " + ctx.salesperson : ""}. Today is ${ctx.weekday} ${ctx.today}, time ${ctx.nowTime} (local).`,
    `Understand plain, casual speech — the user will NOT use command words. Infer what they want from whatever they tell you. A bare fact usually implies an action: "Ken's coming in Thursday at 4" → book an appointment; "sold one to Moe, made 800" → log a sale; "Sara's cell is 902-555-1212" → update Sara's phone; "who should I call?" → check the deal radar / follow-ups; "compare the Kicks with the CR-V" or "customer's cross-shopping the RAV4" → compare_vehicles (never search_inventory for that).`,
    `CRITICAL distinction: "X wants / is looking for / is interested in a <vehicle>" means INTEREST — create the lead (or update their vehicle of interest). It is NOT a sale. Log a sale only when the words clearly say the deal closed: "sold", "bought", "signed", "took delivery", "made $X on the deal". If they say a sale was logged by mistake, use undo_sale.`,
    `Strongly prefer ACTING on reasonable assumptions over asking. Resolve relative dates/times to YYYY-MM-DD or YYYY-MM-DDTHH:MM; if no time is given for an appointment, pick a sensible business-hours time; default appointment type to a general appointment unless a test drive, delivery, or call is implied.`,
    `Use READ tools to look things up before acting when helpful (deal_radar, find_customers, get_appointments, get_customer, get_stats, get_tasks, get_deliveries, get_occasions, get_specials, get_spiffs). You can take multiple steps.`,
    `More examples: "what's on my plate?" → get_tasks; "mark the plates thing done" → complete_task; "Sara's car is handed over" → complete_delivery; "let Ken know his car's ready" → text_customer (write the message yourself, warm and short); "what's the payment on 42 grand over 72 months?" → payment_quote; "what could I put Dana in?" → deal_options; "any birthdays or leases ending?" → get_occasions; "how am I doing this week?" → get_coach; "what should I do right now?" → get_plays; "0% on Rogues till Monday" → add_special; "text Ken my booking link" → get_booking_link then text_customer with the link in the message.`,
    `Only call ask_user when a REQUIRED detail is genuinely missing or ambiguous — e.g. several customers match the name, or no customer is named at all. Ask ONE short question, then continue once answered. Never ask for something you can reasonably assume.`,
    `Match people to existing customers by name; create a new lead only if clearly new.`,
    `When finished, reply with ONE short, natural spoken sentence — what you did, or the answer.`,
    ctx.counts ? `The salesperson has ${ctx.counts.leads} customers and ${ctx.counts.appointments} appointments on file.` : ``,
  ].filter(Boolean).join("\n");
}

// Turn an HTTP failure into a message that says what to actually fix.
async function describeAgentError(res) {
  const j = await res.json().catch(() => ({}));
  const msg = j.error || j.message || "";
  if (res.status === 404)
    return "No function at that URL (404). Open Settings → Voice agent and tap Test connection — it will find the right function and fix the URL for you.";
  if (res.status === 401 || res.status === 403)
    return `The function rejected the call (${res.status}). Turn OFF "Verify JWT" for it in Supabase.`;
  return msg || `Agent error (${res.status})`;
}

async function callAgent(messages) {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Voice agent isn't set up");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: buildSystem(buildContext()), tools: TOOLS, messages, max_tokens: 1024 }),
  });
  if (!res.ok) throw new Error(await describeAgentError(res));
  return res.json(); // { content:[...], stop_reason }
}

// Cheap end-to-end check used by Settings: hits the saved URL with a tiny
// request so the user can verify the function name, JWT setting, and API key
// without opening voice mode. Resolves true or throws a fix-it message.
export async function testAgent() {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("Paste your function URL first");
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Reply with the word OK." }], max_tokens: 8 }),
    });
  } catch {
    throw new Error("Couldn't reach that URL — check it for typos and make sure you're online.");
  }
  if (!res.ok) throw new Error(await describeAgentError(res));
  return true;
}

// When the saved URL 404s, the function exists under a different name — scan
// the same project for it. Supabase's gateway answers 404 (with CORS) for names
// that don't exist, and anything else for ones that do, so a tiny POST per
// candidate tells them apart. Returns the working URL or null.
const FN_CANDIDATES = [
  "quick-api", "voice-agent", "voice_agent", "voiceagent", "voice",
  "agent", "assistant", "claude", "smart-api", "hello-world", "rapid-api", "super-api",
];
export async function findAgentFunction() {
  const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
  const m = url.match(/^(https?:\/\/[^/]+\/functions\/v1)(?:\/|$)/);
  if (!m) return null;
  const base = m[1];
  const current = url.slice(base.length).replace(/^\//, "");
  for (const name of FN_CANDIDATES) {
    if (name === current) continue;
    try {
      const res = await fetch(`${base}/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}", // our function answers 400 "No messages" — cheap, no Claude call
      });
      if (res.status !== 404) return `${base}/${name}`;
    } catch { /* network/CORS — can't tell, keep scanning */ }
  }
  return null;
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
  goals: "/goals", radar: "/deals", deals: "/deals", prospecting: "/prospecting",
  comms: "/comms", communication: "/comms", messages: "/comms",
  soldlog: "/soldlog", sold: "/soldlog", tracker: "/soldlog",
  coach: "/coach",
  pay: "/pay", paycheck: "/pay", paychecks: "/pay",
  spiffs: "/spiffs", specials: "/specials", compare: "/compare", import: "/import", settings: "/settings",
};

// Run one tool. Returns { result, note } — `result` is what Claude sees (data
// object for reads, a short confirmation string for writes); `note` is a
// human-facing action summary (⚠ prefix = failure), or "" for silent reads.
// Async because a few tools (send_email) do real network work. Exported so
// tests can exercise every tool without a live Claude relay.
export async function execTool(name, p = {}) {
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
    case "get_tasks": {
      let list = store.all("tasks").filter((x) => !x.done);
      if (p.dueToday) {
        const today = new Date(); const pad2 = (n) => String(n).padStart(2, "0");
        const iso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
        list = list.filter((x) => x.due && String(x.due).slice(0, 10) <= iso);
      }
      list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      return { result: { count: list.length, tasks: list.slice(0, 20).map((x) => ({ title: x.title, due: x.due || null, priority: x.priority || "normal" })) }, note: "" };
    }
    case "get_deliveries": {
      const list = store.all("deliveries").filter((d) => d.status !== "delivered")
        .sort((a, b) => (a.deliveryDate || "9999").localeCompare(b.deliveryDate || "9999"));
      return { result: { count: list.length, deliveries: list.slice(0, 15).map((d) => {
        const items = d.checklist || [];
        return { customer: d.customerName || "", vehicle: d.vehicle || "", date: d.deliveryDate || null, prepDone: `${items.filter((i) => i.done).length}/${items.length}`, remaining: items.filter((i) => !i.done).map((i) => i.label).slice(0, 10) };
      }) }, note: "" };
    }
    case "get_occasions": {
      const occ = getOccasions().slice(0, 12).map((o) => ({ customer: o.lead.name, phone: o.lead.phone || "", occasion: o.label, suggestedMessage: o.message }));
      return { result: { occasions: occ }, note: "" };
    }
    case "get_specials": {
      const today = new Date().toISOString().slice(0, 10);
      const list = store.all("specials").filter((x) => !x.expiry || x.expiry >= today);
      return { result: { specials: list.map((x) => ({ model: x.model, financeApr: x.financeApr ?? null, financeTerm: x.financeTerm ?? null, leasePayment: x.leasePayment ?? null, leaseTerm: x.leaseTerm ?? null, leaseDown: x.leaseDown ?? null, cash: x.cash ?? null, expires: x.expiry || null, notes: x.notes || "" })) }, note: "" };
    }
    case "get_spiffs": {
      const today = new Date().toISOString().slice(0, 10); const mo = today.slice(0, 7);
      const list = store.all("spifs").filter((x) => (x.expiry ? x.expiry >= today : (x.month || mo) === mo));
      return { result: { spiffs: list.map((x) => ({ title: x.title, amount: x.amount ?? null, countsWhenVehicleContains: x.match || null, target: x.target ?? null, expires: x.expiry || null, notes: x.notes || "" })) }, note: "" };
    }
    case "payment_quote": case "quote_payment": {
      const price = num(p.price);
      if (!price) return { result: "need a price", note: "" };
      const s = store.getSettings();
      const apr = p.apr != null ? Number(p.apr) : (s.defaultApr || 0);
      const term = p.term != null ? Number(p.term) : (s.defaultTerm || 72);
      const d = computeDeal({ price, down: num(p.down) || 0, tradeAllowance: num(p.trade) || 0, tradePayoff: num(p.payoff) || 0, fees: p.fees != null ? num(p.fees) : (s.docFee || 0), taxRate: p.taxRate != null ? Number(p.taxRate) : (s.taxRate || 0), apr, term });
      return { result: { monthly: Math.round(d.monthly), amountFinanced: Math.round(d.amountFinanced), tax: Math.round(d.tax), term: d.term, aprUsed: apr, assumptions: "salesperson's saved tax rate/doc fee/APR/term fill in anything not stated" }, note: "" };
    }
    case "deal_options": case "match_deals": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: "" };
      const rows = dealsForLead(lead).slice(0, 5).map((r) => ({ vehicle: [r.vehicle.year, r.vehicle.make, r.vehicle.model].filter(Boolean).join(" "), monthly: Math.round(r.monthly), delta: r.delta != null ? Math.round(r.delta) : null, method: r.method, special: r.special || null, inStock: !r.vehicle.lineup }));
      return { result: { customer: lead.name, currentPayment: lead.currentPayment ?? null, options: rows }, note: "" };
    }
    case "get_plays": {
      const plays = getPlays(6).map((p) => ({ play: p.title, why: p.sub, oneTapReady: !!p.href }));
      return { result: { plays, note: plays.length ? "ordered hottest first" : "nothing urgent — a good time for prospecting calls" }, note: "" };
    }
    case "get_coach": case "weekly_review": {
      const mon = weekStart();
      const weeks = Array.from({ length: 8 }, (_, i) => {
        const d = new Date(mon); d.setDate(d.getDate() - 7 * i);
        return weekStats(d);
      });
      const brief = (w) => ({ units: w.units, commission: Math.round(w.total), front: Math.round(w.front), backOffice: Math.round(w.bo), apptsSet: w.apptsSet, showRate: w.showRate, newLeads: w.leadsNew, touches: w.touches, linkOpens: w.linksOpened });
      return { result: {
        thisWeek: brief(weeks[0]), lastWeek: brief(weeks[1]),
        insights: coachInsights(weeks, { current: true }).map((i) => i.text),
      }, note: "" };
    }
    case "get_link_activity": {
      const links = store.all("links")
        .slice()
        .sort((a, b) => (b.lastOpenAt || b.createdAt || "").localeCompare(a.lastOpenAt || a.createdAt || ""))
        .slice(0, 10)
        .map((lk) => ({
          link: (lk.meta && lk.meta.label) || (lk.kind === "book" ? "Booking link" : "Comparison"),
          opens: Number(lk.opens) || 0,
          lastOpened: lk.lastOpenAt || null,
          sent: lk.createdAt || null,
        }));
      return { result: { links, note: "opens sync in from the cloud — a very recent open is a hot signal" }, note: "" };
    }
    case "get_booking_link": {
      try {
        if (!backend.currentUser()) return { result: "booking links need Cloud sync — the salesperson should sign in under Settings", note: "" };
        if (!(store.getSettings().agentUrl || "").trim()) return { result: "booking links need the agent function set up in Settings", note: "" };
        return { result: { link: cachedShortBookingLink() || bookingLink() }, note: "" };
      } catch (e) {
        return { result: `booking link unavailable: ${e && e.message ? e.message : e}`, note: "" };
      }
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
      // Stage changes ripple: sold sets up delivery prep + retires follow-ups,
      // lost just retires them.
      if (patch.stage === "sold") afterSale(lead.id, { vehicle: p.vehicle || "" });
      else if (patch.stage === "lost") closeFollowUps(lead.id);
      return { result: `updated ${lead.name}`, note: `updated ${lead.name}` };
    }
    case "add_task": {
      if (!p.title) return { result: "need a task", note: "⚠ need a task" };
      store.create("tasks", { title: p.title, due: p.due || "", priority: p.priority || "normal", done: false });
      return { result: `added task`, note: `added to-do: ${p.title}` };
    }
    case "complete_task": case "finish_task": {
      const ql = String(p.title || "").trim().toLowerCase();
      if (!ql) return { result: "which to-do?", note: "" };
      const open = store.all("tasks").filter((x) => !x.done);
      const titleOf = (x) => (x.title || "").toLowerCase();
      // Spoken references are loose ("the plates thing") — drop filler words,
      // then match all remaining words, then settle for a unique partial match.
      const STOP = new Set(["the", "that", "this", "thing", "task", "todo", "item", "one", "for", "and", "done", "off", "mark", "with", "about"]);
      const tokens = ql.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
      let hit = open.find((x) => titleOf(x).includes(ql));
      if (!hit && tokens.length) hit = open.find((x) => tokens.every((w) => titleOf(x).includes(w)));
      if (!hit && tokens.length) {
        const partial = open.filter((x) => tokens.some((w) => titleOf(x).includes(w)));
        if (partial.length === 1) hit = partial[0];
      }
      if (!hit) return { result: `no open to-do matching "${p.title}"`, note: `⚠ no to-do matching "${p.title}"` };
      store.update("tasks", hit.id, { done: true });
      return { result: `done: ${hit.title}`, note: `checked off: ${hit.title}` };
    }
    case "complete_delivery": case "mark_delivered": {
      const q = String(p.customer || p.name || "").trim().toLowerCase();
      const d = q ? store.all("deliveries").find((x) => x.status !== "delivered" && (x.customerName || "").toLowerCase().includes(q)) : null;
      if (!d) return { result: "no active delivery found", note: `⚠ no active delivery for ${p.customer || "that customer"}` };
      store.update("deliveries", d.id, { status: "delivered", checklist: (d.checklist || []).map((i) => ({ ...i, done: true })) });
      afterDeliveryComplete(d);
      const dl = d.leadId ? store.get("leads", d.leadId) : findLead(d.customerName);
      if (dl && dl.stage === "sold") store.update("leads", dl.id, { stage: "delivered" });
      return { result: `marked delivered — post-delivery follow-ups queued`, note: `marked ${d.customerName}'s delivery complete` };
    }
    case "text_customer": case "text": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.customer || p.name}` };
      if (!lead.phone) return { result: `${lead.name} has no phone number on file`, note: `⚠ no phone on file for ${lead.name}` };
      location.href = smsHref(lead.phone, String(p.message || ""));
      return { result: `opened a prefilled text to ${lead.name} — the salesperson just hits send`, note: `texting ${lead.name}` };
    }
    case "call_customer": case "call": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.customer || p.name}` };
      if (!lead.phone) return { result: `${lead.name} has no phone number on file`, note: `⚠ no phone on file for ${lead.name}` };
      location.href = telHref(lead.phone);
      return { result: `dialing ${lead.name}`, note: `calling ${lead.name}` };
    }
    case "send_email": case "email_customer": {
      const lead = findLead(p.customer || p.name);
      if (!lead) return { result: "not found", note: `⚠ couldn't find ${p.customer || p.name}` };
      const to = String(p.to || lead.email || "").trim();
      if (!to) return { result: `${lead.name} has no email on file`, note: `⚠ no email on file for ${lead.name}` };
      if (!p.subject || !p.body) return { result: "need a subject and body", note: "" };
      try {
        await sendEmail({ to, subject: p.subject, text: p.body });
        logEmail(lead.id, { direction: "out", subject: p.subject, body: p.body, via: "voice" });
        return { result: `email sent to ${to}`, note: `emailed ${lead.name}` };
      } catch (e) {
        return { result: `email failed: ${e && e.message ? e.message : e}`, note: `⚠ email failed: ${e && e.message ? e.message : e}` };
      }
    }
    case "add_special": {
      if (!p.model) return { result: "need the model", note: "" };
      store.create("specials", { model: p.model, financeApr: num(p.financeApr), financeTerm: num(p.financeTerm), leasePayment: num(p.leasePayment), leaseTerm: num(p.leaseTerm), leaseDown: num(p.leaseDown), cash: num(p.cash), expiry: p.expiry || "", notes: p.notes || "" });
      return { result: `saved special on ${p.model}`, note: `added special: ${p.model}` };
    }
    case "add_spif": case "log_spif": {
      if (!p.title) return { result: "need the spif", note: "" };
      store.create("spifs", { title: p.title, amount: num(p.amount), match: p.match || "", target: num(p.target), expiry: p.expiry || "", notes: p.notes || "", month: new Date().toISOString().slice(0, 7) });
      return { result: `saved spif`, note: `added spif: ${p.title}` };
    }
    case "log_sale": {
      const name = p.customer || p.name || "Customer";
      // Every sale gets a customer — create one if the name doesn't match.
      const lead = findLead(name) ||
        store.create("leads", { name, vehicleInterest: p.vehicle || "", stage: "sold", source: "Voice" });
      const frontComm = num(p.frontComm), boComm = num(p.boComm);
      const commission = frontComm != null || boComm != null ? (frontComm || 0) + (boComm || 0) : num(p.commission);
      store.create("sales", { customerName: name, vehicle: p.vehicle || "", saleDate: p.date || new Date().toISOString().slice(0, 10), commission, frontGross: num(p.front ?? p.frontGross), backGross: num(p.back ?? p.backGross), leadType: p.leadType || "", newUsed: p.newUsed || "", stock: p.stock || "", bm: p.bm || "", frontComm, boComm, makeReady: {}, leadId: lead.id, notes: "" });
      afterSale(lead.id, { vehicle: p.vehicle || "" });
      return { result: `logged sale`, note: `logged sale for ${name}` };
    }
    case "undo_sale": {
      const q = String(p.customer || p.name || "").trim().toLowerCase();
      const sales = store.all("sales")
        .filter((s) => (s.customerName || "").toLowerCase().includes(q))
        .sort((a, b) => (b.createdAt || b.saleDate || "").localeCompare(a.createdAt || a.saleDate || ""));
      if (!q || !sales.length) return { result: "not found", note: `⚠ no sale found for ${p.customer || "that customer"}` };
      const sale = sales[0];
      store.remove("sales", sale.id);
      const lead = sale.leadId ? store.get("leads", sale.leadId) : findLead(sale.customerName);
      if (lead && lead.stage === "sold") store.update("leads", lead.id, { stage: "working" });
      return { result: `removed sale for ${sale.customerName}`, note: `removed the sale for ${sale.customerName}` };
    }
    case "book_appointment": case "schedule_appointment": {
      // Everyone with an appointment is a customer — create the lead if new.
      const who = p.customer || p.name || "Customer";
      const lead = findLead(who) ||
        store.create("leads", { name: who, vehicleInterest: p.vehicle || "", stage: "new", source: "Voice" });
      const type = ["testdrive", "delivery", "call", "appointment"].includes(p.type) ? p.type : "appointment";
      const label = { appointment: "Appointment", testdrive: "Test drive", delivery: "Delivery", call: "Phone call" }[type];
      const a2 = store.create("appointments", { type, title: label, customerName: lead.name, vehicle: p.vehicle || lead.vehicleInterest || "", when: p.when || "", status: "scheduled", confirmed: false, outcome: "", leadId: lead.id, notes: "" });
      afterAppointmentBooked(lead.id);
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
          if (appt.leadId) afterSale(appt.leadId, { vehicle: appt.vehicle || "" });
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
    case "compare_vehicles": case "compare": {
      const wanted = (Array.isArray(p.vehicles) ? p.vehicles : [p.a, p.b, p.query]).filter(Boolean);
      if (!wanted.length) return { result: "need vehicle names", note: "⚠ which vehicles should I compare?" };
      const found = [], missing = [];
      wanted.forEach((q) => { const v = findSpec(q); if (v) found.push(v); else missing.push(q); });
      if (!found.length) return { result: `not in the spec database: ${missing.join(", ")}. Tell the salesperson they can add it manually on the compare screen.`, note: `⚠ ${missing.join(" and ")} not in the vehicle database` };
      queueCompare(found);
      navigate("/compare");
      const names = found.map((v) => v.label).join(" vs ");
      return { result: `opened the comparison: ${names}${missing.length ? `. Not in the database (can be entered manually on that screen): ${missing.join(", ")}` : ""}`, note: `comparing ${names}` };
    }
    default:
      return { result: `unknown tool ${t}`, note: `⚠ I can't do "${t}" yet` };
  }
}

// A conversational agent session. It keeps the message history so the agent can
// ask a follow-up question (via the ask_user tool) and continue once you answer.
// send(text) runs the tool-use loop and returns:
//   { say, done:true }              — finished (spoken reply)
//   { say:question, done:false }    — needs an answer; call send(answer) next
export function createAgentSession() {
  const messages = [];
  let pending = null; // { results:[...], askId } while awaiting a human answer

  async function loop(onProgress) {
    for (let step = 0; step < 8; step++) {
      const resp = await callAgent(messages);
      const content = resp.content || [];
      const toolUses = content.filter((b) => b.type === "tool_use");
      const text = content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();

      if (!toolUses.length || resp.stop_reason !== "tool_use") return { say: text, done: true };

      messages.push({ role: "assistant", content });
      const results = [];
      let askId = null, question = null;
      for (const tu of toolUses) {
        if (tu.name === "ask_user") {
          askId = tu.id;
          question = (tu.input && tu.input.question) || "Could you give me a bit more detail?";
        } else {
          let out;
          try { out = await execTool(tu.name, tu.input || {}); }
          catch (e) { out = { result: `error: ${e && e.message ? e.message : e}`, note: "" }; }
          if (out.note && onProgress) onProgress(out.note);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: typeof out.result === "string" ? out.result : JSON.stringify(out.result) });
        }
      }
      // If the agent asked something, hold the other results and wait for the
      // human — we'll answer all tool calls together on the next send().
      if (askId) { pending = { results, askId }; return { say: question, done: false }; }
      messages.push({ role: "user", content: results });
    }
    return { say: "That needed too many steps — try breaking it into smaller asks.", done: true };
  }

  async function send(text, onProgress) {
    if (pending) {
      const results = pending.results;
      results.push({ type: "tool_result", tool_use_id: pending.askId, content: String(text) });
      messages.push({ role: "user", content: results });
      pending = null;
    } else {
      messages.push({ role: "user", content: String(text) });
    }
    return loop(onProgress);
  }

  return { send };
}
