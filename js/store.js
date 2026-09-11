// localStorage-backed data store. All app data lives on the device.
// Collections: leads, tasks, vehicles, deliveries, appointments, sales, spifs,
// specials, activity. Plus settings.

import { uid } from "./utils.js";

const KEY = "sales-assistant:v1";

// Batched-write state. Declared up here rather than beside bulk(): load() runs
// at module init and can persist a migration, which happens before a `let`
// declared further down the file exists at all.
let bulkDepth = 0;
let bulkDirty = false;

// The id of the single settings-mirror row.
//
// NOT "me". The cloud table's primary key is (user_id, id) and does not include
// the collection, so two collections using the same id are the same row up
// there. prefs had "me" first; giving config "me" as well made every full push
// send one key twice, which Postgres rejects outright:
//   "ON CONFLICT DO UPDATE command cannot affect row a second time"
// and had they landed in separate chunks they would have silently overwritten
// each other instead, which is worse.
export const CONFIG_ID = "config";

// Why the last save failed, or null.
let lastSaveError = null;
export function saveError() { return lastSaveError; }

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
  // Text messages, both directions, one row per message. Inbound rows are
  // written by the function when the carrier delivers them, so they arrive on
  // the next sync exactly like a self-booking does.
  //   { leadId, dir: "in"|"out", body, phone, at, read, draft }
  texts: [],
  // Calls, so the Messages tab shows the whole conversation and not only the
  // half that was typed: { leadId, dir, at, outcome, notes }
  calls: [],
  links: [], // short-link payloads live in the cloud; rows land here on pull and are otherwise unused
  prefs: [], // one synced row telling the server your timezone and quiet hours
  config: [], // one synced row mirroring `settings`, so a reinstall gets them back
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
    // The dedicated texting number (E.164, e.g. +19025550123). Empty = texts
    // still hand off to the phone's own SMS app and no replies come back.
    // Twilio's account SID, auth token and this number's webhook are configured
    // on the function; the app only needs to know the number to show it.
    smsFrom: "",
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
    // Proactive notifications (the server sweep — see the Edge Function).
    // Quiet hours are local 24h; the server can't know either of these unless
    // the app tells it, which is what the synced "prefs" record is for.
    proactive: true,
    quietFrom: 21,
    quietTo: 8,
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

// ---------------------------------------------------------------------------
// Persistence
//
// The store used to be one JSON blob in localStorage, rewritten in full on
// every write. That is fine at fifty customers and wrong at three thousand:
// each tap serialised and wrote ~3.4MB on the main thread (a third of a second
// on a desktop, a second on a phone), and localStorage's ~5MB ceiling was one
// import away. Past it, the save failed with a console line, the app carried
// on from memory, and the next launch loaded whatever had last fit — which is
// exactly "the customers don't remain if I click out for a few minutes".
//
// Now: IndexedDB, one row per record. A tap writes one record. There is no
// practical size ceiling. Writes are asynchronous, so nothing blocks the UI.
// The in-memory `state` is unchanged and every read in the app stays
// synchronous; only the write-behind changed. localStorage remains as the
// fallback if IndexedDB can't open, and the old blob is migrated across once —
// removed only after IndexedDB has confirmed the write.
// ---------------------------------------------------------------------------

const DB_NAME = "entoa";
const DB_VERSION = 1;
const SEP = "\u0000";                      // record key = collection + SEP + id
let db = null;
let backend = "idb";                       // "idb" | "ls"

let state = structuredClone(DEFAULT_STATE);
const listeners = new Set();

// What has changed in memory and not yet reached disk. Keys only — the value
// is read from `state` at flush time, so a record removed since it was touched
// is written as a delete, and one touched twice is written once.
const dirty = { records: new Set(), outbox: new Set(), kv: new Set(), rewriteAll: false, outboxClear: false };
const touch = (c, id) => dirty.records.add(c + SEP + id);
const touchOutbox = (key) => dirty.outbox.add(key);
const touchKv = (key) => dirty.kv.add(key);

/**
 * Merge a loaded snapshot over the defaults and apply the one-time migrations.
 * Shared by every load path — the IndexedDB read, the localStorage migration,
 * and the fallback.
 */
function hydrate(parsed) {
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
  // v150 shipped a credit-tier / lender-matrix feature and v151 took it back
  // out, because the rate sheet behind it was invented rather than sourced.
  // Nothing reads these fields any more, so they're dead weight that would
  // otherwise sit in the cloud forever. Clear them once.
  if (!merged.settings.lenderCleanup) {
    delete merged.settings.lenders;
    const now = new Date().toISOString();
    if (Array.isArray(merged.leads)) {
      merged.leads.forEach((l) => {
        if (!l || l.creditTier == null) return;
        delete l.creditTier;
        // Deleting it locally isn't enough: the cloud copy still carries the
        // field, and a fresh install would pull it straight back. Touch the
        // record and queue it so the cleaned version is what gets stored.
        // Only leads that actually had a tier are touched, so an install
        // that never used the feature sees no churn at all.
        l.updatedAt = now;
        merged.outbox = merged.outbox || {};
        merged.outbox[`leads:${l.id}`] = { collection: "leads", id: l.id, deleted: false, at: now };
      });
    }
    merged.settings.lenderCleanup = true;
    // load() only builds the in-memory object; nothing reaches localStorage
    // until a write happens. The other migrations can wait for one because
    // they're idempotent and cheap to redo. This one queues an outbox entry
    // that has to survive, so it asks to be written out immediately.
    merged.needsPersist = true;
  }
  // v176-v183 wrote the settings mirror as config/"me", which is the id the
  // prefs row already used. The cloud table's primary key is (user_id, id)
  // and excludes the collection, so those are one row up there — every full
  // push sent the same key twice and Postgres rejected the batch. Move it to
  // its own id, and drop the old row rather than leaving it to collide.
  if (Array.isArray(merged.config)) {
    const stale = merged.config.find((c) => c && c.id === "me");
    if (stale) {
      merged.config = merged.config.filter((c) => c && c.id !== "me");
      if (!merged.config.some((c) => c.id === CONFIG_ID)) {
        merged.config.push({ ...stale, id: CONFIG_ID, updatedAt: new Date().toISOString() });
      }
      // Nothing needs to delete config/"me" from the cloud: prefs/"me" owns
      // that key and republishes itself, so it wins the row back on the next
      // push. Just make sure the corrected row leaves this device.
      const now = new Date().toISOString();
      merged.outbox = merged.outbox || {};
      merged.outbox[`config:${CONFIG_ID}`] = { collection: "config", id: CONFIG_ID, deleted: false, at: now };
      delete merged.outbox["config:me"];
      merged.needsPersist = true;
    }
  }
  return merged;
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("records")) d.createObjectStore("records");
      if (!d.objectStoreNames.contains("outbox")) d.createObjectStore("outbox");
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

const reqDone = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("aborted")); });

async function readEverything(d) {
  const tx = d.transaction(["records", "outbox", "kv"], "readonly");
  const [recVals, recKeys, obVals, obKeys, kvVals, kvKeys] = await Promise.all([
    reqDone(tx.objectStore("records").getAll()), reqDone(tx.objectStore("records").getAllKeys()),
    reqDone(tx.objectStore("outbox").getAll()), reqDone(tx.objectStore("outbox").getAllKeys()),
    reqDone(tx.objectStore("kv").getAll()), reqDone(tx.objectStore("kv").getAllKeys()),
  ]);
  const snapshot = {};
  recVals.forEach((v, i) => {
    const key = String(recKeys[i]);
    const c = key.slice(0, key.indexOf(SEP));
    (snapshot[c] = snapshot[c] || []).push(v);
  });
  // Newest first, which is the order create() maintains in memory (unshift).
  Object.values(snapshot).forEach((arr) => arr.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
  snapshot.outbox = {};
  obVals.forEach((v, i) => { snapshot.outbox[String(obKeys[i])] = v; });
  const kv = {};
  kvVals.forEach((v, i) => { kv[String(kvKeys[i])] = v; });
  if (kv.settings) snapshot.settings = kv.settings;
  return { snapshot, kv, count: recVals.length };
}

// Write the whole in-memory state out (first migration, import, reset).
async function writeEverything(d) {
  const tx = d.transaction(["records", "outbox", "kv"], "readwrite");
  const rs = tx.objectStore("records"), os = tx.objectStore("outbox"), ks = tx.objectStore("kv");
  rs.clear(); os.clear(); ks.clear();
  Object.keys(state).forEach((c) => {
    if (!Array.isArray(state[c])) return;
    state[c].forEach((rec) => { if (rec && rec.id != null) rs.put(rec, c + SEP + rec.id); });
  });
  Object.entries(state.outbox || {}).forEach(([k, v]) => os.put(v, k));
  ks.put(state.settings, "settings");
  ks.put(1, "migrated");
  await txDone(tx);
}

// Write only what changed.
async function writeBatch(d, snap) {
  if (snap.rewriteAll) return writeEverything(d);
  const tx = d.transaction(["records", "outbox", "kv"], "readwrite");
  const rs = tx.objectStore("records"), os = tx.objectStore("outbox"), ks = tx.objectStore("kv");
  // Index each touched collection once — a 3,000-row import touches 3,000
  // records, and a find() per record would be quadratic again.
  const index = new Map();
  const lookup = (c, id) => {
    if (!index.has(c)) index.set(c, new Map((state[c] || []).map((x) => [x.id, x])));
    return index.get(c).get(id);
  };
  snap.records.forEach((key) => {
    const i = key.indexOf(SEP);
    const c = key.slice(0, i), id = key.slice(i + 1);
    const rec = lookup(c, id);
    if (rec) rs.put(rec, key); else rs.delete(key);
  });
  if (snap.outboxClear) os.clear();
  snap.outbox.forEach((key) => {
    const v = (state.outbox || {})[key];
    if (v) os.put(v, key); else os.delete(key);
  });
  snap.kv.forEach((key) => ks.put(state[key], key));
  await txDone(tx);
}

let flushChain = Promise.resolve();
let flushQueued = false;

/**
 * Push every pending change to disk. Returns a promise that settles when it
 * has landed (or failed — see saveError()). Called automatically after each
 * write; call it directly before deciding whether a save succeeded.
 */
export function flush() {
  const snap = {
    records: [...dirty.records], outbox: [...dirty.outbox], kv: [...dirty.kv],
    rewriteAll: dirty.rewriteAll, outboxClear: dirty.outboxClear,
  };
  dirty.records.clear(); dirty.outbox.clear(); dirty.kv.clear();
  dirty.rewriteAll = false; dirty.outboxClear = false;
  const empty = !snap.records.length && !snap.outbox.length && !snap.kv.length && !snap.rewriteAll && !snap.outboxClear;
  if (empty) return flushChain;
  flushChain = flushChain.then(async () => {
    if (backend === "ls") { persistBlob(); return; }
    try {
      await writeBatch(db, snap);
      lastSaveError = null;
    } catch (e) {
      lastSaveError = e;
      // Put the keys back so the next flush retries them rather than losing
      // the change silently.
      snap.records.forEach((k) => dirty.records.add(k));
      snap.outbox.forEach((k) => dirty.outbox.add(k));
      snap.kv.forEach((k) => dirty.kv.add(k));
      dirty.rewriteAll = dirty.rewriteAll || snap.rewriteAll;
      dirty.outboxClear = dirty.outboxClear || snap.outboxClear;
      console.error("Failed to save.", e);
    }
  });
  return flushChain;
}

function scheduleFlush() {
  if (flushQueued) return;
  flushQueued = true;
  // A microtask, so a burst of synchronous writes becomes one transaction.
  queueMicrotask(() => { flushQueued = false; flush(); });
}

// The old path, kept for environments where IndexedDB won't open.
function persistBlob() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    lastSaveError = null;
  } catch (e) {
    lastSaveError = e;
    console.error("Failed to save. Storage may be full.", e);
  }
}

/**
 * Resolves once the store has loaded. Nothing should read or write before
 * this — app.js awaits it before starting the router.
 */
export const ready = (async () => {
  try {
    db = await openDB();
    const { snapshot, kv, count } = await readEverything(db);
    const blob = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    if (!count && !kv.migrated && blob) {
      // First launch on this build with data in the old blob: bring it across.
      // The blob is removed only after the write has committed — a failure
      // here leaves it exactly where it was.
      state = hydrate(JSON.parse(blob));
      delete state.needsPersist;
      await writeEverything(db);
      try { localStorage.removeItem(KEY); } catch { }
      return;
    }
    state = hydrate(snapshot);
    if (state.needsPersist) {
      // A migration changed records and queued outbox entries; write it all.
      delete state.needsPersist;
      dirty.rewriteAll = true;
      await flush();
    }
  } catch (e) {
    // No IndexedDB (private mode, an old WebView): behave as before, from the
    // blob. Slower and capped, but never a blank screen.
    console.warn("IndexedDB unavailable, using localStorage.", e);
    backend = "ls";
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? hydrate(JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
    } catch (e2) {
      console.warn("Failed to load state, starting fresh.", e2);
      state = structuredClone(DEFAULT_STATE);
    }
    if (state.needsPersist) { delete state.needsPersist; persistBlob(); }
  }
})();

// Don't let a backgrounded app take unwritten changes with it. The flush is
// already queued as a microtask; this just makes sure it's issued before the
// page is frozen or torn down.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { flush(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}

/** Where data is being kept, for the diagnostics screen. */
export function storageInfo() {
  return { backend, pending: dirty.records.size + dirty.outbox.size + dirty.kv.size, lastError: lastSaveError ? String(lastSaveError.message || lastSaveError) : null };
}

// --- Bulk writes ---
//
// Every write notifies every subscriber. That is right for one edit and
// catastrophic for a file: an import of 3,235 customers used to persist 3,235
// times and re-run every listener each time, quadratic in the row count.
// bulk() collapses a batch into one notification and one disk transaction.

/**
 * Run a batch of writes as one save. Nests safely; returns whatever fn returns.
 * Anything that writes more than a handful of records should be inside this.
 */
export function bulk(fn) {
  bulkDepth++;
  try {
    return fn();
  } finally {
    bulkDepth--;
    if (bulkDepth === 0 && bulkDirty) {
      bulkDirty = false;
      persist();
    }
  }
}

// Notify subscribers now (from memory, so it's cheap) and queue the disk write.
function persist() {
  if (bulkDepth > 0) { bulkDirty = true; return true; }
  listeners.forEach((fn) => fn(state));
  scheduleFlush();
  return true;
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
// Settings that belong to THIS phone rather than to the person, and so must
// never be carried onto another device. The two credentials are here because
// they're what a device uses to reach the account in the first place: a stale
// copy arriving from the cloud and overwriting a working one would cut a device
// off from the very thing that sent it.
const DEVICE_ONLY_SETTINGS = ["supabaseUrl", "supabaseAnonKey", "cloudAutoSync"];

/**
 * Mirror the settings to the cloud as one record.
 *
 * These used to be deliberately local, on the reasoning that they were "this
 * phone's own configuration". That was wrong about almost all of them. The
 * dealership name, the tax rate, the doc fee and the new-vehicle fees, the
 * trade-appraisal knobs, the default term and rate, the monthly goals, the
 * message templates, the delivery checklist, the texting number, the agent URL
 * — none of that describes a phone. It describes a salesperson, and it took a
 * long time to enter.
 *
 * Reinstalling the app on iOS clears its storage, so all of it went, while
 * every customer, text and appointment came back from the cloud untouched. The
 * one category of data that was expensive to re-enter by hand was the only
 * category with no copy anywhere.
 */
export function publishConfig() {
  const payload = {};
  Object.keys(state.settings || {}).forEach((k) => {
    if (!DEVICE_ONLY_SETTINGS.includes(k)) payload[k] = state.settings[k];
  });
  const existing = get("config", CONFIG_ID);
  // Runs on every settings change and every launch, so only write when
  // something actually differs — otherwise each launch queues a pointless sync.
  if (existing) {
    const { id, updatedAt, createdAt, ...was } = existing;
    if (JSON.stringify(was) === JSON.stringify(payload)) return;
    update("config", CONFIG_ID, payload);
  } else {
    create("config", { id: CONFIG_ID, ...payload });
  }
}

/**
 * Fold a settings record pulled from the cloud back into the live settings.
 *
 * Called after a sync pull. The device-only keys are kept as they are on this
 * phone; everything else adopts what came down. Anything the cloud has never
 * heard of (a newer default shipped in an app update) survives too, because
 * this merges rather than replaces.
 */
export function adoptRemoteConfig() {
  const rec = get("config", CONFIG_ID);
  if (!rec) return false;
  const { id, updatedAt, createdAt, ...incoming } = rec;
  const next = { ...state.settings };
  let changed = false;
  Object.keys(incoming).forEach((k) => {
    if (DEVICE_ONLY_SETTINGS.includes(k)) return;
    if (JSON.stringify(next[k]) === JSON.stringify(incoming[k])) return;
    next[k] = incoming[k];
    changed = true;
  });
  if (!changed) return false;
  state.settings = next;
  touchKv("settings");
  persist();
  return true;
}

// The server sweep also has to know two things to notify sensibly: what time it
// is where you are, and when not to. Those go up as their own record.
export function publishPrefs() {
  const s = state.settings;
  const data = {
    id: "me",
    tzOffsetMinutes: new Date().getTimezoneOffset(),
    proactive: s.proactive !== false,
    quietFrom: Number(s.quietFrom ?? 21),
    quietTo: Number(s.quietTo ?? 8),
    updatedAt: new Date().toISOString(),
  };
  const existing = get("prefs", "me");
  // Only write when something actually changed — this runs on every launch and
  // an unconditional write would queue a sync every time the app opened.
  if (existing && ["tzOffsetMinutes", "proactive", "quietFrom", "quietTo"]
    .every((k) => existing[k] === data[k])) return;
  if (existing) update("prefs", "me", data);
  else create("prefs", data);
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  touchKv("settings");
  persist();
  // Queue the change for the cloud. Everything expensive to type by hand lives
  // in here, and until now none of it was backed up anywhere.
  try { publishConfig(); } catch { }
}

// --- Cloud-sync change tracking ---
// The outbox records local changes to push to the cloud. It only accumulates
// while sync is turned on, so local-only users never grow it.
let trackChanges = false;
export function setSyncTracking(on) {
  trackChanges = !!on;
  if (!on) { state.outbox = {}; dirty.outboxClear = true; persist(); }
}
function markOutbox(name, id, deleted) {
  if (!trackChanges) return;
  state.outbox[`${name}:${id}`] = { collection: name, id, deleted: !!deleted, at: new Date().toISOString() };
  touchOutbox(`${name}:${id}`);
}
export function getOutbox() {
  return Object.values(state.outbox || {});
}
export function clearOutboxKeys(keys) {
  keys.forEach((k) => { delete state.outbox[k]; touchOutbox(k); });
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
  touch(name, id);
  persist();
}
export function applyRemoteDelete(name, id) {
  if (!Array.isArray(state[name])) return;
  const arr = state[name];
  const idx = arr.findIndex((x) => x.id === id);
  if (idx >= 0) { arr.splice(idx, 1); touch(name, id); persist(); }
}

// --- Generic collection helpers ---
function collection(name) {
  // An unknown collection reads as empty, not as undefined.
  //
  // The cloud is one generic records table and the whole point of that design
  // is that a new collection needs no migration — the Edge Function itself
  // writes collections the app has never declared ("nudgelog", which it uses to
  // remember what it has already nudged about). A pull hands those rows
  // straight to get(), which called .find() on undefined and threw:
  //   "undefined is not an object (evaluating 'collection(name).find')"
  // One unrecognised row from the server killed the entire sync — not that
  // collection, all of it — and the same would happen to an older install
  // pulling down a collection a newer build had added.
  if (!Array.isArray(state[name])) state[name] = [];
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
  touch(name, item.id);
  persist();
  return item;
}

export function update(name, id, patch) {
  const item = get(name, id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  markOutbox(name, id, false);
  touch(name, id);
  persist();
  return item;
}

export function remove(name, id) {
  const arr = collection(name);
  const idx = arr.findIndex((x) => x.id === id);
  if (idx >= 0) {
    arr.splice(idx, 1);
    markOutbox(name, id, true);
    touch(name, id);
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
  touch(name, item.id);
  persist();
  return get(name, item.id);
}

// Every syncable collection (everything except settings/outbox metadata).
// "config" is the settings mirror and "prefs" the sweep's timezone/quiet-hours
// record. Both hold exactly one row.
export const SYNC_COLLECTIONS = ["leads", "tasks", "vehicles", "deliveries", "appointments", "sales", "activity", "spifs", "specials", "emails", "texts", "calls", "paychecks", "push", "config", "prefs"];

// --- Calls ---
// Logged when you tap to call, so the thread reads as a conversation rather
// than only the parts that happened to be typed.
export function logCall(leadId, patch = {}) {
  const rec = create("calls", { leadId, dir: "out", at: new Date().toISOString(), outcome: "", notes: "", ...patch });
  update("leads", leadId, { lastContacted: rec.at });
  logActivity("touch");
  return rec;
}

export function callsFor(leadId) {
  return state.calls.filter((c) => c.leadId === leadId);
}

// --- Links ---
// Every short link the salesperson has sent that belongs to this customer.
// Attribution comes from meta.leadId, stamped when the link is minted.
export function linksForLead(leadId) {
  return state.links
    .filter((lk) => lk.meta && lk.meta.leadId === leadId)
    .sort((a, b) => String(b.lastOpenAt || b.createdAt || "").localeCompare(String(a.lastOpenAt || a.createdAt || "")));
}

// --- Texts ---
// Phones are compared on their last ten digits, so "(902) 555-1111",
// "9025551111" and "+19025551111" are one customer.
export function phoneKey(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

export function leadByPhone(phone) {
  const k = phoneKey(phone);
  if (k.length < 10) return null;
  return state.leads.find((l) => phoneKey(l.phone) === k) || null;
}

export function textsFor(leadId) {
  return state.texts
    .filter((t) => t.leadId === leadId)
    .sort((a, b) => String(a.at || a.createdAt).localeCompare(String(b.at || b.createdAt)));
}

export function unreadTexts() {
  return state.texts.filter((t) => t.dir === "in" && !t.read);
}

export function markThreadRead(leadId) {
  let touched = false;
  state.texts.forEach((t) => {
    if (t.leadId === leadId && t.dir === "in" && !t.read) {
      t.read = true;
      t.updatedAt = new Date().toISOString();
      markOutbox("texts", t.id, false);
      touch("texts", t.id);
      touched = true;
    }
  });
  if (touched) persist();
}

// A customer who texts STOP is opted out until they text back. Campaigns and
// the cadence both check this — an opt-out that only half the app respects is
// worse than none, because it reads as deliberate.
export function optedOut(lead) {
  return !!(lead && lead.smsOptOut);
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
  dirty.rewriteAll = true;
  persist();
}

export function resetAll() {
  state = structuredClone(DEFAULT_STATE);
  dirty.rewriteAll = true;
  persist();
}
