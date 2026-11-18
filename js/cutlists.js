// The cuts on Outreach, and the saved filters, as one place the screens
// share: the reason cuts and the book's vehicle cuts, the salesperson's own
// lists as cuts, who passes which, and the filters saved under a name —
// so a list has a page of its own (views/lists.js) that reads the same
// people Outreach would show under the same cut.

import * as store from "./store.js";
import { assessAll, categoryOf } from "./assess.js";
import { reachState } from "./coverage.js";
import { inAudience, emptyAudience, isEveryone, describeAudience } from "./outreach.js";
import { queryPasses, describeQuery } from "./bookquery.js";
import { classify } from "./segments.js";
import { memberLists } from "./lists.js";

export const REASON_CUTS = [
  { key: "payment", label: "Same payment", cat: "payment" },
  { key: "equity", label: "Equity", cat: "equity" },
  { key: "ending", label: "Contract ending", cat: "ending" },
  { key: "cycle", label: "Owned 3+ yrs", cat: "cycle" },
  { key: "rate", label: "High rate", cat: "rate" },
  { key: "warranty", label: "Warranty ending", cat: "warranty" },
  { key: "service", label: "In service", cat: "service" },
  { key: "quiet", label: "Quiet 6+ mo" },
  // The goal's own cut: nobody has had a real conversation with them — a
  // message left or a text unanswered doesn't count (reachstate.js).
  { key: "unspoken", label: "Never spoken with" },
  { key: "callback", label: "Callback due" },
];
const BODY_LABEL = { suv: "SUVs", truck: "Trucks", car: "Sedans", van: "Vans", sports: "Sports cars" };

// The book's vehicles, as cuts: every model with a few owners (most
// first), then the body styles. Read once per change to the book.
let vehCache = { key: "", cuts: [] };
export function vehicleCuts() {
  const key = String(store.generation("leads"));
  if (vehCache.key === key) return vehCache.cuts;
  const models = new Map(), bodies = new Map();
  store.all("leads").forEach((l) => {
    const c = classify(String(l.vehicleInterest || ""));
    if (c.model) models.set(c.model, (models.get(c.model) || 0) + 1);
    if (c.body) bodies.set(c.body, (bodies.get(c.body) || 0) + 1);
  });
  const cap = (w) => String(w).replace(/\b\w/g, (ch) => ch.toUpperCase());
  const out = [
    ...[...models.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m]) => ({ key: `model:${m}`, label: cap(m), kind: "vehicle", spec: { models: [m] } })),
    ...[...bodies.entries()].filter(([b, n]) => n >= 3 && BODY_LABEL[b]).sort((a, b) => b[1] - a[1]).map(([b]) => ({ key: `body:${b}`, label: BODY_LABEL[b], kind: "vehicle", spec: { body: b } })),
  ];
  vehCache = { key, cuts: out };
  return out;
}
// The salesperson's own lists (lists.js) as cuts — "members:<id>".
let memCache = { key: "", cuts: [] };
export function memberCuts() {
  const key = store.generation("lists") + ":" + store.generation("leads");
  if (memCache.key === key) return memCache.cuts;
  memCache = { key, cuts: memberLists().map((x) => ({ key: `members:${x.id}`, label: x.name, kind: "list", members: new Set(x.ids), listId: x.id, always: true })) };
  return memCache.cuts;
}
export function cutDef(key) {
  return memberCuts().find((c) => c.key === key) || vehicleCuts().find((c) => c.key === key) || REASON_CUTS.find((c) => c.key === key) || (key === "nonumber" ? { key, label: "No number", kind: "fix" } : null);
}

// What a field query reads beyond the customer: the read of the book, the
// calendar, the to-dos, the sales, the calls and texts. Once per change.
let qMemo = { key: "", ctx: null };
export function queryContext() {
  const key = ["leads", "appointments", "tasks", "sales", "calls", "texts"].map((n) => store.generation(n)).join("|");
  const assess = assessAll().byId;
  if (!qMemo.ctx || qMemo.key !== key || qMemo.ctx.assess !== assess) qMemo = { key, ctx: { now: Date.now(), assess, appointments: store.all("appointments"), tasks: store.all("tasks"), sales: store.all("sales"), calls: store.all("calls"), texts: store.all("texts") } };
  return qMemo.ctx;
}

export function cutPass(key, l) {
  const d = cutDef(key);
  if (!d) return true;
  if (d.members) return d.members.has(l.id);
  if (d.kind === "vehicle") return inAudience({ ...emptyAudience(), ...d.spec }, l);
  if (d.key === "quiet") { const t = l.lastContacted ? new Date(l.lastContacted).getTime() : 0; return !t || Date.now() - t > 180 * 86400000; }
  if (d.key === "nonumber") return !l.phone || !!l.badPhone;
  if (d.key === "unspoken") { const r = reachState(l); return !!r && !r.conversation && r.state !== "unreachable"; }
  if (d.key === "callback") { const r = reachState(l); return !!r && r.state === "due"; }
  const a = assessAll().byId.get(l.id);
  return !!(a && (a.reasons || []).some((r) => categoryOf(r) === d.cat));
}
export function passesCuts(cuts, l) { for (const k of cuts) if (!cutPass(k, l)) return false; return true; }
export const cutLabels = (cuts) => [...cuts].map((k) => (cutDef(k) || { label: k }).label);

// ---- Saved filters: a set of cuts (and the sheet's ranges, and a field
// query) under a name, kept on the phone. ----
export const LISTS_KEY = "viniva:leads-lists";
export function savedLists() { try { return JSON.parse(localStorage.getItem(LISTS_KEY) || "[]"); } catch { return []; } }
export function writeSavedLists(arr) { try { localStorage.setItem(LISTS_KEY, JSON.stringify(arr)); } catch { /* fine */ } }
export function savedList(id) { return savedLists().find((x) => x.id === id) || null; }
export function removeSavedList(id) { writeSavedLists(savedLists().filter((x) => x.id !== id)); }
/** What the saved filter is, in words: "Rogue · Equity · 2018–2021 · payment over $500". */
export function savedLabel(x) {
  if (!x) return "";
  return [...cutLabels(x.cuts || []), x.aud && !isEveryone(x.aud) ? describeAudience(x.aud) : "", x.query ? x.query.label || describeQuery(x.query.spec) : ""].filter(Boolean).join(" · ");
}
/** The people a saved filter leaves, over the whole book (no chip, no search). */
export function savedMembers(x) {
  if (!x) return [];
  const cuts = new Set(x.cuts || []);
  const ctx = x.query ? queryContext() : null;
  return store.all("leads").filter((l) => (!x.aud || inAudience(x.aud, l)) && (!x.query || queryPasses(x.query.spec, l, ctx)) && passesCuts(cuts, l));
}
