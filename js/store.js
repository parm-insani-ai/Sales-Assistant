// localStorage-backed data store. All app data lives on the device.
// Collections: leads, tasks, vehicles, deliveries. Plus settings.

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

const DEFAULT_STATE = {
  leads: [],
  tasks: [],
  vehicles: [],
  deliveries: [],
  settings: {
    salesperson: "",
    taxRate: 6.5, // %
    docFee: 499,
    defaultTerm: 72,
    defaultApr: 7.9,
    deliveryChecklist: DEFAULT_DELIVERY_CHECKLIST,
  },
};

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
