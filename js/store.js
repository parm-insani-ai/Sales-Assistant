// localStorage-backed data store. All app data lives on the device.
// Collections: leads, tasks, vehicles, deliveries, appointments, sales, spifs,
// specials, activity. Plus settings.

import { uid } from "./utils.js";

const KEY = "sales-assistant:v1";

const DEFAULT_DELIVERY_CHECKLIST = [
  "Vehicle detailed / washed",
  "Full tank of gas / charged",
  "We-Owe items ordered",
  "Temp tag / plates & registration",
  "Insurance verified",
  "Financing / funding approved",
  "All paperwork signed",
  "Second key / owner's manual",
  "Pair phone & set up tech",
  "Full walk-around with customer",
  "Introduce to service department",
];

// Message templates. Placeholders: {name} {firstName} {vehicle} {salesperson} {dealership}
const DEFAULT_TEMPLATES = [
  // --- Owner outreach: the customer already has a car. Never say "thanks for
  // your interest in {vehicle}" here — {vehicle} is what they're DRIVING.
  // The offer is information about THEIR vehicle, not a pitch for ours: no
  // urgency, no "more than you'd expect", no assumption they want to buy.
  // Staying put is named as a real option, so the worst case for the customer
  // is that they end up knowing their own car a little better.
  // No figure ever goes out by text — not the trade value, not a payment. The
  // numbers get worked out with the customer at the desk, where a trade can
  // actually be looked at and a mistake can be corrected in person. So the ask
  // is always for the ten minutes, never "want me to send it over" (which
  // promises a text you then can't send). Withholding also keeps the reason to
  // reply intact. The messages never claim the value is high — the app cannot
  // know, and it would be a lie to anyone upside down. {tradeValue} stays
  // available for custom templates.
  { id: "tpl_equity", name: "Where they stand (owner)", channel: "sms", subject: "",
    body: "Hi {firstName}, it's {salesperson} at {dealership}. I went through where your {theirCar} sits today and there are a couple of directions worth a look. It's a ten-minute sit-down to go through properly — worst case you leave knowing your own car better. Want me to find you a time?" },
  { id: "tpl_paidoff", name: "Paid off — where they stand", channel: "sms", subject: "",
    body: "Hi {firstName}, it's {salesperson} at {dealership}. Your {theirCar} is paid off, which puts you somewhere worth understanding before you decide anything. Give me ten minutes in person and I'll show you exactly what you're sitting on — keeping it very much included." },
  { id: "tpl_leaseend", name: "Lease coming due", channel: "sms", subject: "",
    body: "Hi {firstName}, it's {salesperson} at {dealership}. Your lease on the {theirCar} comes due soon and you've got three choices: buy it, hand it back, or start something new. I'll walk you through what each one actually costs — it's a ten-minute sit-down. Want me to find you a time?" },
  { id: "tpl_first", name: "First contact (inbound)", channel: "sms", subject: "",
    body: "Hi {firstName}, it's {salesperson} at {dealership} — thanks for reaching out about the {vehicle}. Happy to answer anything, and if it turns out not to be the right fit I'll tell you. What would be most useful to know first?" },
  { id: "tpl_appt", name: "Appointment reminder", channel: "sms", subject: "",
    body: "Hi {firstName}, just confirming our appointment for the {vehicle}. Looking forward to seeing you! Text me if anything changes. - {salesperson}" },
  { id: "tpl_check", name: "Still interested?", channel: "sms", subject: "",
    body: "Hi {firstName}, {salesperson} here at {dealership}. Are you still in the market for the {vehicle}? I've got a couple of options I think you'll like." },
  { id: "tpl_price", name: "Numbers / follow-up", channel: "sms", subject: "",
    body: "Hi {firstName}, I ran some updated numbers on the {vehicle} and think we can make it work. Give me a call or text when you have a minute. - {salesperson}" },
  { id: "tpl_thanks", name: "Post-sale thank you", channel: "sms", subject: "",
    body: "Congratulations again on your {vehicle}, {firstName}! It was a pleasure working with you. If you ever need anything, I'm one text away. - {salesperson}" },
  { id: "tpl_referral", name: "Ask for referral", channel: "sms", subject: "",
    body: "Hi {firstName}, hope you're loving the {vehicle}! If you know anyone in the market for a vehicle, I'd be grateful for the introduction. - {salesperson}" },
  { id: "tpl_email_intro", name: "Email intro", channel: "email", subject: "Your inquiry on the {vehicle}",
    body: "Hi {name},\n\nThank you for reaching out about the {vehicle}. I'd love to help you find the right fit and answer any questions.\n\nWhat's the best day and time for you to stop by for a look and a test drive?\n\nBest,\n{salesperson}\n{dealership}" },
  { id: "tpl_email_follow", name: "Email follow-up", channel: "email", subject: "Following up on the {vehicle}",
    body: "Hi {firstName},\n\nJust following up on the {vehicle} — I'd hate for you to miss out if the right one comes through. Any questions I can answer, or a good time for you to come by?\n\nBest,\n{salesperson}\n{dealership}" },
  { id: "tpl_email_appt", name: "Email appointment confirm", channel: "email", subject: "See you soon — {vehicle}",
    body: "Hi {firstName},\n\nLooking forward to our appointment about the {vehicle}. If anything changes, just reply here and we'll find another time.\n\nBest,\n{salesperson}\n{dealership}" },
  { id: "tpl_email_delivered", name: "Email delivery thank-you", channel: "email", subject: "Congratulations on your {vehicle}!",
    body: "Hi {firstName},\n\nCongratulations again on your {vehicle} — it was a pleasure working with you. If you ever need anything, I'm one reply away.\n\nAnd if you know anyone in the market for a vehicle, I'd be grateful for the introduction.\n\nBest,\n{salesperson}\n{dealership}" },
];
export { DEFAULT_TEMPLATES };

// A proven multi-touch follow-up cadence, applied to new leads so none go cold.
const DEFAULT_CADENCE = [
  { day: 0, channel: "call", label: "Intro call" },
  { day: 0, channel: "text", label: "Intro text" },
  { day: 1, channel: "email", label: "Intro email" },
  { day: 2, channel: "call", label: "Follow-up call" },
  { day: 4, channel: "text", label: "Value follow-up" },
  { day: 7, channel: "call", label: "One-week call" },
  { day: 14, channel: "text", label: "Two-week check-in" },
  { day: 30, channel: "call", label: "30-day call" },
];

const DEFAULT_STATE = {
  leads: [],
  tasks: [],
  vehicles: [],
  deliveries: [],
  appointments: [],
  sales: [],
  activity: [],
  spifs: [],
  specials: [],
  emails: [], // logged emails per lead: { leadId, direction: "in"|"out", subject, body, via }
  links: [], // short-link payloads live in the cloud; rows land here on pull and are otherwise unused
  paychecks: [], // pay periods for reconciliation: { periodStart, periodEnd, payDate, commissionPaid, gross, net, notes }
  push: [], // this account's web-push subscriptions, one per device — the function reads these to send notifications
  outbox: {}, // pending cloud changes, keyed "collection:id" → { collection, id, deleted, at }
  settings: {
    salesperson: "",
    dealership: "",
    contactPhone: "",
    contactEmail: "",
    reviewLink: "", // Google review URL — folded into the day-after delivery text

    taxRate: 14, // % — Nova Scotia HST on a vehicle deal
    docFee: 699, // dealership documentation fee, every car sold (new or used)
    // New-vehicle fees (O'Regan's). AVP/freight/air tax/tire levy are taxable
    // add-ons; plate registration is a government fee (no tax). Used vehicles
    // use docFee instead.
    feeFreight: 2100,
    feeAirTax: 100,
    feePlateReg: 13.20,
    feeTireLevy: 22.50,
    avpRogue: 699, // Atlantic Value Package on new Rogues
    avpOther: 599, // Atlantic Value Package on every other new Nissan
    // Trade-value estimate knobs — the same levers a real appraisal uses:
    // expected km/yr, a per-km adjustment, the recon budget, and the margin
    // taken off a retail comp to get back to a wholesale number.
    tradeKmPerYear: 20000,
    tradeKmRate: 0.05,
    tradeRecon: 1500,
    tradeMarginPct: 9,
    defaultTerm: 72,
    defaultApr: 7.9,
    deliveryChecklist: DEFAULT_DELIVERY_CHECKLIST,
    messageTemplates: DEFAULT_TEMPLATES,
    goalUnits: 12, // sales per month
    goalCommission: 8000, // $ per month
    goalAppointments: 30, // appointments set per month — the north-star activity
    // Cloud sync (Supabase). Empty = local-only, exactly like before.
    supabaseUrl: "",
    supabaseAnonKey: "",
    cloudAutoSync: true,
    // External calendar feeds (Apple/Outlook/Google via .ics subscription),
    // fetched through a small proxy. Empty = no external calendars.
    calendarProxyUrl: "",
    calendarFeeds: [], // [{ id, name, url, enabled }]
    // Voice agent endpoint (a Supabase function that calls Claude). Empty = the
    // on-device command parser is used instead.
    agentUrl: "",
    // Automated sending: when on (and the function has RESEND_API_KEY +
    // EMAIL_FROM secrets), due cadence emails go out on app open.
    emailAutoSend: false,
    // Outlook inbox sync (Microsoft Graph, on-device OAuth). The client ID of
    // the user's own Entra app registration; empty = not connected.
    msClientId: "",
    msTenant: "common",
    // Self-serve booking page: bookable hours/days and slot length.
    bookStart: 9,
    bookEnd: 19,
    bookSlot: 30,
    bookDays: [1, 2, 3, 4, 5, 6], // Mon–Sat (JS weekday numbers)
    bookShort: null, // cached short booking link {code, s, sig} — re-minted when the config changes
    cadence: DEFAULT_CADENCE,
    autoCadence: true,
    dailyTouchGoal: 20,
    dealMatchBand: 50, // $/mo tolerance: new payment may exceed current by up to this
    dealMethod: "both", // "both" | "finance" | "lease"
    dealMaxPayment: 0, // $/mo ceiling on the radar; 0 = no cap
    leaseTerm: 36, // months
    leaseResidualPct: 58, // % of price retained at lease end (estimate)
    // Dealer inventory websites for the one-tap search launcher. The network
    // site is pre-filtered to Used to match the "used only from other stores"
    // rule. All editable in Settings so this works for any dealer group.
    storeSiteName: "My store",
    storeSiteUrl: "https://www.oregansnissanhalifax.com/inventory/?do-search=1",
    networkSiteName: "O'Regan's network",
    networkSiteUrl: "https://www.oregans.com/inventory/?do-search=1",
    networkUsedSuffix: "&search.vehicle-inventory-type-ids.0=2",
  },
};

export const APPT_TYPES = [
  { id: "appointment", label: "Appointment", icon: "users" },
  { id: "testdrive", label: "Test drive", icon: "car" },
  { id: "delivery", label: "Delivery", icon: "sparkles" },
  { id: "call", label: "Phone call", icon: "phone" },
  { id: "other", label: "Other", icon: "pin" },
];

export function apptType(id) {
  return APPT_TYPES.find((t) => t.id === id) || APPT_TYPES[0];
}

export const LEAD_STAGES = [
  { id: "new", label: "New", badge: "badge-new" },
  { id: "working", label: "Working", badge: "badge-working" },
  { id: "appointment", label: "Appointment", badge: "badge-appt" },
  { id: "negotiating", label: "Negotiating", badge: "badge-negotiating" },
  { id: "sold", label: "Sold", badge: "badge-sold" },
  { id: "delivered", label: "Delivered", badge: "badge-delivered" },
  { id: "lost", label: "Lost", badge: "badge-lost" },
];

export function stageMeta(id) {
  return LEAD_STAGES.find((s) => s.id === id) || LEAD_STAGES[0];
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    // Merge so new default fields appear for existing users.
    const merged = {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
    };
    // One-time correction: early builds shipped a 6.5% tax default. Nova Scotia
    // HST on a vehicle deal is 14%. Runs once (taxRateFixed), so a rate the
    // user sets deliberately afterwards is never overwritten.
    if (!merged.settings.taxRateFixed) {
      if (Number(merged.settings.taxRate) === 6.5) merged.settings.taxRate = 14;
      merged.settings.taxRateFixed = true;
    }
    // Same story for the doc fee: early builds defaulted to $499. O'Regan's
    // charges $699 on every car. Runs once so a hand-set fee is never touched.
    if (!merged.settings.docFeeFixed) {
      if (Number(merged.settings.docFee) === 499) merged.settings.docFee = 699;
      merged.settings.docFeeFixed = true;
    }
    // The old "First contact" template thanked the customer for their interest
    // in {vehicle} — but for an imported owner {vehicle} is the car they
    // already drive, so it read as nonsense. Templates live in settings, so a
    // new default never reaches an existing install: swap the stale body out
    // once, and only if it is still untouched.
    if (Number(merged.settings.firstTouchFixed || 0) < 4) {
      const superseded = [
        // The original: thanked an owner for their interest in their own trade.
        "Hi {firstName}, this is {salesperson} at {dealership}. Thanks for your interest in the {vehicle}! When would be a good time to come take a look or a test drive?",
        // The first rewrite: accurate, but it read like a pitch.
        "Hi {firstName}, it's {salesperson} at {dealership}. Your {theirCar} is worth about {tradeValue} right now — more than most people expect. With this month's Nissan rates that's enough to put you in a new one for close to {payment}. Want me to send you the exact numbers?",
        "Hi {firstName}, it's {salesperson} at {dealership}. Your {theirCar} is paid off and still worth about {tradeValue} — that's real money sitting in the driveway, and it's quietly dropping every month. Want me to show you what it could put you into with nothing out of pocket?",
        "Hi {firstName}, it's {salesperson} at {dealership}. Your lease on the {theirCar} is coming due, so you've got a decision to make. I've pulled two options that keep you at or under {payment}. Want me to text them over, or would a quick call be easier?",
        "Hi {firstName}, it's {salesperson} at {dealership} — thanks for reaching out about the {vehicle}. I've got one here I think you'd like. Are you free to see it this week, or are evenings and weekends better for you?",
        // v124: honest and unpushy, but it handed over the number for free.
        "Hi {firstName}, it's {salesperson} at {dealership}. I ran the current numbers on your {theirCar} — it's sitting around {tradeValue} today. Figured that's worth knowing either way. If it helps I can lay out your options from here, staying put included. Want me to send it over?",
        "Hi {firstName}, it's {salesperson} at {dealership}. Your {theirCar} is paid off and currently worth about {tradeValue} — just a useful thing to know about your own vehicle. If you're ever curious what that opens up, I'm happy to walk through it, keeping it included. Want the details?",
        // v125: withheld the figure, but still promised to text it — which the
        // desk rule says never happens. The ask is the appointment now.
        "Hi {firstName}, it's {salesperson} at {dealership}. I pulled what your {theirCar} is worth today — want me to send you the number? No agenda either way, it's just useful to know where you stand, staying put included.",
        "Hi {firstName}, it's {salesperson} at {dealership}. Your {theirCar} is paid off, and I just pulled what it's worth today. Want me to send you the number? Worth knowing what you're sitting on, even if you keep it.",
        "Hi {firstName}, it's {salesperson} at {dealership}. Your lease on the {theirCar} comes due soon, and you've got three choices: buy it, hand it back, or start something new. Happy to walk through what each one actually costs so you can decide properly. Want me to send a summary?",
      ];
      const list = merged.settings.messageTemplates;
      if (Array.isArray(list)) {
        list.forEach((t, i) => {
          if (!superseded.includes(String(t.body).trim())) return; // hand-edited: leave it
          const fresh = DEFAULT_TEMPLATES.find((d) => d.id === t.id);
          if (fresh) list[i] = { ...fresh };
        });
      }
      merged.settings.firstTouchFixed = 4;
    }
    return merged;
  } catch (e) {
    console.warn("Failed to load state, starting fresh.", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save. Storage may be full.", e);
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}
export function getSettings() {
  return state.settings;
}
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist();
}

// --- Cloud-sync change tracking ---
// The outbox records local changes to push to the cloud. It only accumulates
// while sync is turned on, so local-only users never grow it.
let trackChanges = false;
export function setSyncTracking(on) {
  trackChanges = !!on;
  if (!on) { state.outbox = {}; persist(); }
}
function markOutbox(name, id, deleted) {
  if (!trackChanges) return;
  state.outbox[`${name}:${id}`] = { collection: name, id, deleted: !!deleted, at: new Date().toISOString() };
}
export function getOutbox() {
  return Object.values(state.outbox || {});
}
export function clearOutboxKeys(keys) {
  keys.forEach((k) => { delete state.outbox[k]; });
  persist();
}
// Apply a change pulled from the cloud WITHOUT re-queuing it for push.
export function applyRemote(name, id, data) {
  if (!Array.isArray(state[name])) state[name] = [];
  const arr = state[name];
  const idx = arr.findIndex((x) => x.id === id);
  const rec = { ...data, id };
  // Short-link rows sync down only for their activity (label, opens, times) —
  // the shared page's payload lives in the cloud and would bloat localStorage.
  if (name === "links") delete rec.payload;
  if (idx >= 0) arr[idx] = rec; else arr.unshift(rec);
  persist();
}
export function applyRemoteDelete(name, id) {
  if (!Array.isArray(state[name])) return;
  const arr = state[name];
  const idx = arr.findIndex((x) => x.id === id);
  if (idx >= 0) { arr.splice(idx, 1); persist(); }
}

// --- Generic collection helpers ---
function collection(name) {
  return state[name];
}

export function all(name) {
  return collection(name).slice();
}

export function get(name, id) {
  return collection(name).find((x) => x.id === id) || null;
}

export function create(name, data) {
  const now = new Date().toISOString();
  const item = { id: uid(name.slice(0, 3)), createdAt: now, updatedAt: now, ...data };
  collection(name).unshift(item);
  markOutbox(name, item.id, false);
  persist();
  return item;
}

export function update(name, id, patch) {
  const item = get(name, id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  markOutbox(name, id, false);
  persist();
  return item;
}

export function remove(name, id) {
  const arr = collection(name);
  const idx = arr.findIndex((x) => x.id === id);
  if (idx >= 0) {
    arr.splice(idx, 1);
    markOutbox(name, id, true);
    persist();
    return true;
  }
  return false;
}

// Put back a record that was just removed (undo). Keeps the original id so
// cloud sync re-uploads it instead of creating a duplicate.
export function restore(name, item) {
  if (!item || !item.id) return null;
  const arr = collection(name);
  if (!arr.find((x) => x.id === item.id)) arr.unshift({ ...item });
  markOutbox(name, item.id, false);
  persist();
  return get(name, item.id);
}

// Every syncable collection (everything except settings/outbox metadata).
export const SYNC_COLLECTIONS = ["leads", "tasks", "vehicles", "deliveries", "appointments", "sales", "activity", "spifs", "specials", "emails", "paychecks", "push"];

// --- Activity tracking (prospecting touches) ---
// A "touch" is any outreach (call/text/logged contact). Used for the daily
// activity scoreboard.
export function logActivity(type) {
  return create("activity", { type });
}
export function activityCountToday(type) {
  const today = new Date().toISOString().slice(0, 10);
  return state.activity.filter((a) => (a.createdAt || "").slice(0, 10) === today && (!type || a.type === type)).length;
}

// --- Data export / import (backup) ---
export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(json) {
  const parsed = JSON.parse(json);
  state = {
    ...structuredClone(DEFAULT_STATE),
    ...parsed,
    settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
  };
  persist();
}

export function resetAll() {
  state = structuredClone(DEFAULT_STATE);
  persist();
}
