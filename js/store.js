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
  { id: "tpl_first", name: "First contact", channel: "sms", subject: "",
    body: "Hi {firstName}, this is {salesperson} at {dealership}. Thanks for your interest in the {vehicle}! When would be a good time to come take a look or a test drive?" },
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
];

// A proven multi-touch follow-up cadence, applied to new leads so none go cold.
const DEFAULT_CADENCE = [
  { day: 0, channel: "call", label: "Intro call" },
  { day: 0, channel: "text", label: "Intro text" },
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
  settings: {
    salesperson: "",
    dealership: "",
    contactPhone: "",
    taxRate: 6.5, // %
    docFee: 499,
    defaultTerm: 72,
    defaultApr: 7.9,
    deliveryChecklist: DEFAULT_DELIVERY_CHECKLIST,
    messageTemplates: DEFAULT_TEMPLATES,
    goalUnits: 12, // sales per month
    goalCommission: 8000, // $ per month
    cadence: DEFAULT_CADENCE,
    autoCadence: true,
    dailyTouchGoal: 20,
    dealMatchBand: 50, // $/mo tolerance: new payment may exceed current by up to this
    dealMethod: "both", // "both" | "finance" | "lease"
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
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
    };
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
  persist();
  return item;
}

export function update(name, id, patch) {
  const item = get(name, id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  persist();
  return item;
}

export function remove(name, id) {
  const arr = collection(name);
  const idx = arr.findIndex((x) => x.id === id);
  if (idx >= 0) {
    arr.splice(idx, 1);
    persist();
    return true;
  }
  return false;
}

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
