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
import { repInsight, storeInsight } from "./insight.js";

const KEY = "viniva:store";

// The last store read, so the Team screen paints before the network answers.
export function cachedStore() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function remember(s) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* fine */ }
}

// The store, and whether the signed-in user is an admin (kept beside it so
// the screen knows without a store). Admins are set in the database by the
// project owner; the app only reads the flag.
export async function myStore() {
  const [s, admin] = await Promise.all([backend.rpc("my_store", {}), backend.rpc("is_admin", {}).catch(() => false)]);
  const out = s ? { ...s, admin: !!(s.admin || admin) } : null;
  remember(out);
  try { localStorage.setItem(KEY + ":admin", admin ? "1" : ""); } catch { /* fine */ }
  return out;
}
// The admin check on its own, with the reason when it can't be made — so
// the screen can say "the database doesn't have is_admin yet" rather than
// silently treating the person as a rep.
export async function checkAdmin() {
  try { return { admin: (await backend.rpc("is_admin", {})) === true, error: "" }; }
  catch (e) { return { admin: false, error: e && e.message ? e.message : "couldn't reach the database" }; }
}
export function cachedAdmin() {
  try { return localStorage.getItem(KEY + ":admin") === "1"; } catch { return false; }
}
export async function adminStores() { return (await backend.rpc("admin_stores", {})) || []; }
export async function adminAddMember(storeId, email, role, displayName = "") { return backend.rpc("admin_add_member", { store: storeId, member_email: email, new_role: role, display_name: displayName }); }
export async function adminSetStore(storeId, { name = null, remove = false } = {}) { return backend.rpc("admin_set_store", { store: storeId, new_name: name, remove }); }
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
export async function setMemberRole(userId, role, storeId = null) {
  const s = await backend.rpc("set_member_role", { member: userId, new_role: role, store: storeId });
  if (!storeId) remember(s);
  return s;
}
export async function leaveStore() {
  await backend.rpc("leave_store", {});
  remember(null);
}
export function isManager(s = cachedStore()) {
  return !!(s && s.role === "manager");
}
export function isAdmin(s = cachedStore()) {
  return !!((s && s.admin) || cachedAdmin());
}

// ---- Which app this is ----
// An admin, or a manager without a book of their own, runs the store: their
// Home is the board and their tabs are Home, Team and Settings. Everyone
// else gets the salesperson's app. A manager who also sells can switch
// between the two; the choice is remembered on the device.
const MODE_KEY = "viniva:mode";
export function viewModeOverride() {
  try { return localStorage.getItem(MODE_KEY) || ""; } catch { return ""; }
}
export function setViewMode(mode) {
  try { if (mode) localStorage.setItem(MODE_KEY, mode); else localStorage.removeItem(MODE_KEY); } catch { /* fine */ }
}
// `leadsCount` is the size of this device's book; team.js doesn't read the store.
export function managementMode(leadsCount = 0) {
  const o = viewModeOverride();
  if (o === "manage") return isAdmin() || isManager();
  if (o === "sales") return false;
  return isAdmin() || (isManager() && leadsCount === 0);
}
// Could this account run the store at all? (Whether the switch is offered.)
export function canManage() {
  return isAdmin() || isManager();
}

// ---- The board, cached for the session ----
const BOARD_KEY = "viniva:team-board";
export function cachedBoard() {
  try { return JSON.parse(sessionStorage.getItem(BOARD_KEY) || "null"); } catch { return null; }
}
export async function loadBoard(team, { force = false } = {}) {
  const have = cachedBoard();
  if (have && !force && have.storeId === team.id && Date.now() - new Date(have.at) < 10 * 60000) return have;
  const stats = await boardStats(team.members || [], { storeId: team.id });
  const board = { at: new Date().toISOString(), storeId: team.id, stats };
  try { sessionStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch { /* fine */ }
  return board;
}

// The store's day, added up from the reps' numbers. `stats` is boardStats'.
export function storeTotals(stats) {
  const ok = stats.filter((r) => !r.error && r.touches);
  const sum = (f) => ok.reduce((a, r) => a + f(r), 0);
  const past = sum((r) => r.appts.past), shown = sum((r) => r.appts.shown);
  return {
    reps: ok.length, units: sum((r) => r.sales.units), goal: sum((r) => r.goal.units), gross: sum((r) => r.sales.gross),
    set: sum((r) => r.appts.set), shown, sold: sum((r) => r.appts.sold), showRate: past ? Math.round((shown / past) * 100) : null,
    touchesToday: sum((r) => r.touches.today), touchesMonth: sum((r) => r.touches.month),
    untouched: sum((r) => r.leads.untouched.length), overdue: sum((r) => r.leads.overdue.length), open: sum((r) => r.leads.open),
    apptsToday: ok.flatMap((r) => r.appts.today.map((a) => ({ ...a, rep: r.member }))).sort((a, b) => String(a.when).localeCompare(String(b.when))),
    // The store's appointment picture, from everyone's rows together.
    insight: storeInsight(ok.map((r) => r.raw).filter(Boolean)),
  };
}
export function inviteLink(code) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  return `${base}#/join/${code}`;
}
// What to call a member on the board.
// ---- What a manager can write ----
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export { monthKey };
export async function setTarget(userId, { units = 0, appts = 0, month = monthKey() } = {}) {
  return (await backend.rpc("set_target", { member: userId, target_month: month, units, appts })) || [];
}
export async function targetsForStore(storeId, month = monthKey()) {
  return (await backend.rpc("targets_for_store", { store: storeId, target_month: month })) || [];
}
export async function myTarget(month = monthKey()) {
  return backend.rpc("my_target", { target_month: month });
}
export async function updateRepAppointment(userId, apptId, patch) {
  return backend.rpc("manager_update_appointment", { member: userId, appt_id: apptId, patch });
}
// A push to a rep's phone, from their manager, through the function.
export async function nudgeRep(userId, { title, body, url = "./#/", tag = "" }) {
  const s = (await import("./store.js")).getSettings();
  const fn = (s.agentUrl || "").trim().replace(/\/+$/, "");
  if (!fn) throw new Error("Set up the cloud function in Settings first");
  const res = await fetch(fn, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ nudge: { to: userId, title, body, url, tag } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Couldn't reach them (${res.status})`);
  if (!j.sent) throw new Error(j.errors && j.errors[0] ? j.errors[0] : "They haven't turned on notifications yet");
  return j.sent;
}

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
export async function repStats(userId, { now = new Date(), target = null } = {}) {
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const today = ymd(now);
  // Eight weeks of appointments and touches for the trend and the rates, 90
  // days of leads for speed-to-lead and sources; the month for the board.
  const since = (days) => ymd(new Date(now.getTime() - days * DAY));
  const [activity, apptsSet, apptsMonth, sales, openLeads, recentLeads, config] = await Promise.all([
    backend.readRecords(userId, "activity", { "data->>createdAt": `gte.${since(56)}` }, { select: "data" }),
    backend.readRecords(userId, "appointments", { "data->>createdAt": `gte.${since(56)}` }, { select: "id,data" }),
    backend.readRecords(userId, "appointments", { "data->>when": `gte.${monthStart}` }, { select: "id,data" }),
    backend.readRecords(userId, "sales", { "data->>saleDate": `gte.${monthStart}` }, { select: "data" }),
    backend.readRecords(userId, "leads", { "data->>stage": `in.(${OPEN.join(",")})` }, { select: "id,data" }),
    backend.readRecords(userId, "leads", { "data->>createdAt": `gte.${since(90)}` }, { select: "id,data" }),
    backend.readRecords(userId, "config", {}, { select: "data", limit: 2 }),
  ]);
  const rows = (xs) => xs.map((r) => r.data || {});
  const acts = rows(activity).filter((a) => a.type === "touch" || a.type === "text");
  const touchesByDay = {};
  acts.forEach((a) => { const d = String(a.createdAt || "").slice(0, 10); if (d) touchesByDay[d] = (touchesByDay[d] || 0) + 1; });
  const touches = { today: touchesByDay[today] || 0, month: acts.filter((a) => String(a.createdAt || "").slice(0, 10) >= monthStart).length };

  // Every appointment we know of, once, slimmed to what the engine reads.
  const seenA = new Map();
  [...apptsSet, ...apptsMonth].forEach((r) => { const a = r.data || {}; if (a.id || r.id) seenA.set(a.id || r.id, a); });
  const allAppts = [...seenA.values()].map((a) => ({ id: a.id, leadId: a.leadId || "", createdAt: a.createdAt || "", when: a.when || "", confirmed: !!a.confirmed, outcome: a.outcome || "", status: a.status || "", type: a.type || "", customerName: a.customerName || a.title || "" }));
  const appts = allAppts.filter((a) => String(a.when).slice(0, 10) >= monthStart);
  const live = appts.filter((a) => a.status !== "canceled");
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
  // The store's target for the rep wins over the rep's own setting.
  const goalUnits = target && num(target.goal_units) ? num(target.goal_units) : num(cfg.goalUnits);
  const goalAppts = target && num(target.goal_appts) ? num(target.goal_appts) : num(cfg.goalAppointments);
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const goal = { units: goalUnits, appts: goalAppts, touchesDay: num(cfg.dailyTouchGoal), pace: goalUnits ? Math.round((goalUnits * now.getDate()) / daysIn * 10) / 10 : 0, fromStore: !!(target && (num(target.goal_units) || num(target.goal_appts))) };

  const open = rows(openLeads);
  const untouched = open.filter((l) => l.stage === "new" && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) > DAY)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const overdue = open.filter((l) => l.followUp && String(l.followUp).slice(0, 10) < today)
    .sort((a, b) => String(a.followUp).localeCompare(String(b.followUp)));
  const slimLeads = rows(recentLeads).map((l) => ({ id: l.id, name: l.name || "", source: l.source || "", vehicleInterest: l.vehicleInterest || "", createdAt: l.createdAt || "", firstContacted: l.firstContacted || "", lastContacted: l.lastContacted || "", stage: l.stage || "" }));
  const raw = { appts: allAppts, leads: slimLeads, touches: touches.month, touchesByDay, goalUnits, sold: saleStats.units };
  const insight = repInsight({ ...raw, now });
  return { userId, touches, appts: apptStats, sales: saleStats, goal, leads: { untouched, overdue, open: open.length }, raw, insight, at: now.toISOString() };
}

// Every member's numbers, in parallel, in the order given.
export async function boardStats(members, opts = {}) {
  // The store's targets for the month, once, then each rep in parallel.
  let targets = [];
  if (opts.storeId) { try { targets = await targetsForStore(opts.storeId); } catch { targets = []; } }
  const tFor = (id) => targets.find((t) => t.user_id === id) || null;
  return Promise.all(members.map((m) => repStats(m.user_id, { ...opts, target: tFor(m.user_id) }).then((st) => ({ member: m, ...st }), (e) => ({ member: m, error: e && e.message ? e.message : "couldn't read" }))));
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
