// The store and its team.
//
// A store is a group of accounts sharing one Supabase project: reps and one
// or more managers. A manager can read every member's records — that fills
// the board and opens a rep's customer page — and nothing else; each rep's
// book stays their own and reps never see each other's. Membership lives in
// two small tables and a handful of database functions (supabase/schema.sql);
// this module talks to them and turns a rep's records into the numbers a
// manager runs the day on.

import * as backend from "./backend.js";

const KEY = "viniva:store";

// The last store read, so the Team screen paints before the network answers.
export function cachedStore() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function remember(s) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* fine */ }
}

export async function myStore() {
  const s = await backend.rpc("my_store", {});
  remember(s || null);
  return s || null;
}
export async function createStore(name, displayName = "") {
  const s = await backend.rpc("create_store", { store_name: name, display_name: displayName });
  remember(s); return s;
}
export async function joinStore(code, displayName = "") {
  const s = await backend.rpc("join_store", { code, display_name: displayName });
  remember(s); return s;
}
export async function setMyName(displayName) {
  const s = await backend.rpc("set_my_name", { display_name: displayName });
  remember(s); return s;
}
export async function setMemberRole(userId, role) {
  const s = await backend.rpc("set_member_role", { member: userId, new_role: role });
  remember(s); return s;
}
export async function leaveStore() {
  await backend.rpc("leave_store", {});
  remember(null);
}
export function isManager(s = cachedStore()) {
  return !!(s && s.role === "manager");
}
export function inviteLink(code) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  return `${base}#/join/${code}`;
}
// What to call a member on the board.
export function memberName(m) {
  return (m && (m.name || (m.email || "").split("@")[0])) || "Rep";
}

// ---- The board ----

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? 0 : Number(v));
const OPEN = ["new", "working", "appointment", "negotiating"];

/**
 * One rep's numbers, read from their records: today and month to date.
 *   touches: { today, month }
 *   appts:   { set, shown, sold, noShow, today: [appointments today] }
 *   sales:   { units, gross }
 *   goal:    { units, pace }   pace = where they should be by today
 *   leads:   { untouched: [...], overdue: [...], open }
 */
export async function repStats(userId, { now = new Date() } = {}) {
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const today = ymd(now);
  const [activity, appts, sales, leads, config] = await Promise.all([
    backend.readRecords(userId, "activity", { "data->>createdAt": `gte.${monthStart}` }, { select: "data" }),
    backend.readRecords(userId, "appointments", { "data->>when": `gte.${monthStart}` }, { select: "id,data" }),
    backend.readRecords(userId, "sales", { "data->>saleDate": `gte.${monthStart}` }, { select: "data" }),
    backend.readRecords(userId, "leads", { "data->>stage": `in.(${OPEN.join(",")})` }, { select: "id,data" }),
    backend.readRecords(userId, "config", {}, { select: "data", limit: 2 }),
  ]);
  const rows = (xs) => xs.map((r) => r.data || {});
  const acts = rows(activity).filter((a) => a.type === "touch" || a.type === "text");
  const touches = { today: acts.filter((a) => String(a.createdAt || "").slice(0, 10) === today).length, month: acts.length };

  const live = rows(appts).filter((a) => a.status !== "canceled");
  const apptStats = {
    set: live.length,
    shown: live.filter((a) => a.outcome === "showed" || a.outcome === "sold").length,
    sold: live.filter((a) => a.outcome === "sold").length,
    noShow: live.filter((a) => a.outcome === "no_show").length,
    past: live.filter((a) => { const t = new Date(a.when).getTime(); return !isNaN(t) && t < now.getTime(); }).length,
    today: live.filter((a) => String(a.when || "").slice(0, 10) === today).sort((a, b) => String(a.when).localeCompare(String(b.when))),
  };
  apptStats.showRate = apptStats.past ? Math.round((apptStats.shown / apptStats.past) * 100) : null;

  const s = rows(sales);
  const saleStats = { units: s.length, gross: s.reduce((a, x) => a + num(x.frontGross) + num(x.backGross), 0) };

  const cfg = (config[0] && config[0].data) || {};
  const goalUnits = num(cfg.goalUnits);
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const goal = { units: goalUnits, appts: num(cfg.goalAppointments), touchesDay: num(cfg.dailyTouchGoal), pace: goalUnits ? Math.round((goalUnits * now.getDate()) / daysIn * 10) / 10 : 0 };

  const open = rows(leads);
  const untouched = open.filter((l) => l.stage === "new" && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) > DAY)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const overdue = open.filter((l) => l.followUp && String(l.followUp).slice(0, 10) < today)
    .sort((a, b) => String(a.followUp).localeCompare(String(b.followUp)));
  return { userId, touches, appts: apptStats, sales: saleStats, goal, leads: { untouched, overdue, open: open.length }, at: now.toISOString() };
}

// Every member's numbers, in parallel, in the order given.
export async function boardStats(members, opts = {}) {
  return Promise.all(members.map((m) => repStats(m.user_id, opts).then((st) => ({ member: m, ...st }), (e) => ({ member: m, error: e && e.message ? e.message : "couldn't read" }))));
}

// One customer of a rep's, for the read-only page: the lead and their last texts.
export async function repLead(userId, leadId) {
  const [lead, texts] = await Promise.all([
    backend.readRecords(userId, "leads", { id: `eq.${leadId}` }, { select: "data", limit: 1 }),
    backend.readRecords(userId, "texts", { "data->>leadId": `eq.${leadId}` }, { select: "data", limit: 200 }),
  ]);
  const l = lead[0] && lead[0].data;
  const thread = texts.map((t) => t.data).sort((a, b) => String(b.at || b.createdAt || "").localeCompare(String(a.at || a.createdAt || ""))).slice(0, 8);
  return l ? { lead: l, texts: thread } : null;
}
