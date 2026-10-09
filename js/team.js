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
import * as store from "./store.js";
import { repInsight, storeInsight } from "./insight.js";
import { targetSheet, targetPlan, shoppingOf } from "./target.js";
import { loggedInMonth, loggedAtOf } from "./logbook.js";

const KEY = "viniva:store";

// The last store read, so the Team screen paints before the network answers.
export function cachedStore() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function remember(s) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* fine */ }
  // In a store, the manager's board is built from this phone's synced
  // records: a rep who switched syncing off would sit on the board with
  // last week's numbers. While they're in a store it stays on.
  if (s) { try { if (!store.getSettings().cloudAutoSync) store.updateSettings({ cloudAutoSync: true }); } catch { /* fine */ } }
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
  // Two minutes: the board is the floor as it is, and reps sync as they go.
  if (have && !force && have.storeId === team.id && Date.now() - new Date(have.at) < 2 * 60000) return have;
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
    // Customers logged (the target sheet's "spoken with") and what came of it.
    loggedToday: sum((r) => r.loggedToday || 0), loggedMonth: sum((r) => (r.sheet ? r.sheet.spoke : 0)),
    closing: (() => { const sp = sum((r) => (r.sheet ? r.sheet.spoke : 0)), so = sum((r) => (r.sheet ? r.sheet.sold : 0)); return sp ? Math.round((so / sp) * 100) : null; })(),
    // Everything the floor did today, newest first.
    feed: ok.flatMap((r) => (r.events || []).map((e) => ({ ...e, rep: r.member }))).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    // Everyone logged this month across the store, newest first, with their rep.
    logged: ok.flatMap((r) => (r.logged || []).map((l) => ({ ...l, rep: r.member }))).sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt))),
    // The floor: customers waiting on a reply, longest first; appointments
    // at risk, soonest first; no-shows to rebook; each rep's plays; who
    // was logged today and not yet welcomed.
    waiting: ok.flatMap((r) => (r.waiting || []).map((w) => ({ ...w, rep: r.member }))).sort((a, b) => a.at.localeCompare(b.at)),
    // Texts drafted and not sent, by rep, the rep with the oldest first.
    textsDue: ok.filter((r) => r.textsDue && r.textsDue.length).map((r) => ({ rep: r.member, texts: r.textsDue, oldest: r.textsDue[0].readyAt })).sort((a, b) => a.oldest.localeCompare(b.oldest)),
    // Texts in their hold, by rep, the one that sends soonest first.
    textsHeld: ok.filter((r) => r.textsHeld && r.textsHeld.length).map((r) => ({ rep: r.member, texts: r.textsHeld, next: r.textsHeld[0].readyAt })).sort((a, b) => a.next.localeCompare(b.next)),
    atRisk: ok.flatMap((r) => (r.atRisk || []).map((a) => ({ ...a, rep: r.member }))).sort((a, b) => a.when.localeCompare(b.when)),
    noShows: ok.flatMap((r) => (r.noShows || []).map((a) => ({ ...a, rep: r.member }))).sort((a, b) => b.when.localeCompare(a.when)),
    playsByRep: ok.filter((r) => r.plays).map((r) => ({ rep: r.member, ...r.plays })),
    welcomes: { logged: sum((r) => (r.welcomes ? r.welcomes.logged : 0)), welcomed: sum((r) => (r.welcomes ? r.welcomes.welcomed : 0)), pending: ok.flatMap((r) => (r.welcomes ? r.welcomes.pending.map((l) => ({ ...l, rep: r.member })) : [])) },
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
export async function addRepTask(userId, task) {
  return backend.rpc("manager_add_task", { member: userId, task });
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

// How current a rep's numbers are: when their phone last wrote to the
// cloud. Stale past a day — their phone has been off, or isn't syncing.
export function syncedAgo(iso, now = Date.now()) {
  const t = new Date(iso || "").getTime();
  if (!iso || isNaN(t)) return { text: "never synced", stale: true };
  const m = Math.max(0, Math.round((now - t) / 60000));
  const text = m < 2 ? "synced just now" : m < 60 ? `synced ${m} min ago` : m < 1440 ? `synced ${Math.round(m / 60)} h ago` : `synced ${Math.round(m / 1440)} d ago`;
  return { text, stale: m >= 1440 };
}

export function memberName(m) {
  return (m && (m.name || (m.email || "").split("@")[0])) || "Rep";
}

// ---- The board ----

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? 0 : Number(v));
// The local day of a stored value: a plain date or wall-clock time as
// written ("2026-10-06", "2026-10-06T15:30"), a full timestamp in this
// phone's time.
const dayKey = (v) => { const x = String(v || ""); if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(x)) return x.slice(0, 10); const d = new Date(x); return isNaN(d) ? "" : ymd(d); };
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
  const [activity, apptsSet, apptsMonth, sales, openLeads, recentLeads, config, loggedLeads, lastWrite, planTasks, textsWeek, emailsWeek, callsToday, playsToday] = await Promise.all([
    backend.readRecords(userId, "activity", { "data->>createdAt": `gte.${since(56)}` }, { select: "data" }),
    backend.readRecords(userId, "appointments", { "data->>createdAt": `gte.${since(56)}` }, { select: "id,data" }),
    backend.readRecords(userId, "appointments", { "data->>when": `gte.${monthStart}` }, { select: "id,data" }),
    backend.readRecords(userId, "sales", { "data->>saleDate": `gte.${monthStart}` }, { select: "data" }),
    backend.readRecords(userId, "leads", { "data->>stage": `in.(${OPEN.join(",")})` }, { select: "id,data" }),
    backend.readRecords(userId, "leads", { "data->>createdAt": `gte.${since(90)}` }, { select: "id,data" }),
    backend.readRecords(userId, "config", {}, { select: "data", limit: 2 }),
    // Customers logged this month, however long they've been on file: an
    // owner moved over from Outreach today was added years ago.
    backend.readRecords(userId, "leads", { "data->>loggedAt": `gte.${monthStart}` }, { select: "id,data" }),
    backend.lastWrite(userId).catch(() => null),
    // The follow-up plan's steps, done and to come, for the plan status
    // on each logged customer.
    backend.readRecords(userId, "tasks", { "data->>cadence": "eq.true" }, { select: "data", limit: 5000 }).catch(() => []),
    // The week's texts and emails: who is waiting on a reply, who was
    // reached today. Today's calls. The night read's plays for today.
    backend.readRecords(userId, "texts", { "data->>at": `gte.${since(7)}` }, { select: "data", limit: 3000 }).catch(() => []),
    backend.readRecords(userId, "emails", { "data->>createdAt": `gte.${since(7)}` }, { select: "data", limit: 1000 }).catch(() => []),
    backend.readRecords(userId, "calls", { "data->>at": `gte.${today}` }, { select: "data", limit: 500 }).catch(() => []),
    backend.readRecords(userId, "agentplays", { id: `eq.agentplays:${today}` }, { select: "data", limit: 1 }).catch(() => []),
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
  // Without either, the rep's own target sheet (new + used) is the goal.
  const goalUnits = target && num(target.goal_units) ? num(target.goal_units) : num(cfg.goalUnits) || targetPlan(cfg).target;
  const goalAppts = target && num(target.goal_appts) ? num(target.goal_appts) : num(cfg.goalAppointments);
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const goal = { units: goalUnits, appts: goalAppts, touchesDay: num(cfg.dailyTouchGoal), pace: goalUnits ? Math.round((goalUnits * now.getDate()) / daysIn * 10) / 10 : 0, fromStore: !!(target && (num(target.goal_units) || num(target.goal_appts))) };

  const open = rows(openLeads);
  // A row from a file isn't a lead waiting on a call: the owner book is
  // worked from Outreach, not chased as untouched leads.
  const untouched = open.filter((l) => l.stage === "new" && !l.importedAt && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) > DAY)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const overdue = open.filter((l) => l.followUp && String(l.followUp).slice(0, 10) < today)
    .sort((a, b) => String(a.followUp).localeCompare(String(b.followUp)));
  const slimLeads = rows(recentLeads).map((l) => ({ id: l.id, name: l.name || "", source: l.source || "", vehicleInterest: l.vehicleInterest || "", createdAt: l.createdAt || "", importedAt: l.importedAt || "", firstContacted: l.firstContacted || "", lastContacted: l.lastContacted || "", stage: l.stage || "" }));
  const raw = { appts: allAppts, leads: slimLeads, touches: touches.month, touchesByDay, goalUnits, sold: saleStats.units };
  const insight = repInsight({ ...raw, now });

  // The rep's own sales-target sheet, worked from their settings and book
  // exactly as their Home works it — with the store's target, when there is
  // one, as the unit goal.
  const byId = new Map();
  [...rows(recentLeads), ...open, ...rows(loggedLeads)].forEach((l) => { if (l && l.id) byId.set(l.id, l); });
  const book = [...byId.values()];
  const settings = { ...cfg, ...(goal.fromStore && goalUnits ? { goalUnits } : {}) };
  const sheet = targetSheet({ settings, leads: book, sales: s, appointments: allAppts, now });
  // Who they logged this month, newest first.
  const mKey = monthStart.slice(0, 7);
  // Each customer's follow-up plan: how far through it is and the next
  // step, from the plan's tasks. No tasks: no plan was started.
  const plans = new Map();
  rows(planTasks).forEach((t) => {
    if (!t.leadId) return;
    const pl = plans.get(t.leadId) || { of: 0, done: 0, next: null, last: "" };
    pl.of = Math.max(pl.of, num(t.of), num(t.step));
    if (t.done) { pl.done++; if (String(t.doneAt || t.updatedAt || "") > pl.last) pl.last = String(t.doneAt || t.updatedAt || ""); }
    else if (!pl.next || String(t.due || "") < String(pl.next.due || "") || (String(t.due || "") === String(pl.next.due || "") && num(t.step) < num(pl.next.step))) pl.next = { step: num(t.step), channel: t.channel || "", due: t.due || "", title: t.title || "", intent: t.intent || "" };
    plans.set(t.leadId, pl);
  });
  const logged = loggedInMonth(mKey, book).map((l) => ({ id: l.id, name: l.name || "", phone: l.phone || "", vehicleInterest: l.vehicleInterest || "", stage: l.stage || "", shopping: shoppingOf(l), source: l.source || "", loggedAt: loggedAtOf(l), lastContacted: l.lastContacted || "", followUp: l.followUp || "", plan: plans.get(l.id) || null }));
  const loggedToday = logged.filter((l) => dayKey(l.loggedAt) === today).length;

  // What they did today, as it happened: customers logged, appointments
  // set, cars sold. The manager's feed is everyone's of these, newest first.
  const events = [
    ...logged.filter((l) => dayKey(l.loggedAt) === today).map((l) => ({ kind: "logged", at: l.loggedAt, leadId: l.id, name: l.name, detail: [l.vehicleInterest, l.shopping].filter(Boolean).join(" · ") })),
    ...allAppts.filter((a) => a.status !== "canceled" && a.createdAt && dayKey(a.createdAt) === today).map((a) => ({ kind: "appt", at: a.createdAt, leadId: a.leadId, name: a.customerName, when: a.when, detail: a.type || "" })),
    ...s.filter((x) => dayKey(x.saleDate || x.createdAt) === today).map((x) => ({ kind: "sold", at: x.createdAt || x.saleDate, leadId: x.leadId || "", name: x.customerName || "", detail: x.vehicle || "" })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // --- The floor: who is waiting, who was reached, what's at risk ---
  const nameOf = (leadId, fallback = "") => { const l = byId.get(leadId); return (l && l.name) || fallback || ""; };
  // Texts drafted on the rep's phone and not sent: a plan step whose
  // moment has come (the welcome five minutes after a customer was added,
  // a follow-up due today) sits on their Right now until they tap Send.
  // The same rule as the rep's list, read from the same tasks.
  const nowISO = now.toISOString();
  const slimText = (t) => ({ id: t.id, leadId: t.leadId || "", name: nameOf(t.leadId), intent: t.intent || "", title: String(t.title || "").replace(/^Text \S+ — /, ""), readyAt: String(t.readyAt), hasPhone: !!((byId.get(t.leadId) || {}).phone) });
  const openTexts = rows(planTasks).filter((t) => t.channel === "text" && !t.done && t.readyAt);
  const textsDue = openTexts.filter((t) => String(t.readyAt) <= nowISO && now - new Date(t.readyAt) < 24 * 3600000)
    .map(slimText).sort((a, b) => a.readyAt.localeCompare(b.readyAt));
  // Drafted and waiting out their hold — the welcome in the five minutes
  // after a customer was added. On the rep's Right now from the start,
  // locked until their minute; here too, so a customer just logged shows
  // on the Floor as soon as the rep's phone syncs. Same window as the rep's.
  const textsHeld = openTexts.filter((t) => String(t.readyAt) > nowISO && new Date(t.readyAt) - now <= 15 * 60000)
    .map(slimText).sort((a, b) => a.readyAt.localeCompare(b.readyAt));
  // What the board actually found in their plan, so an empty card can say
  // why: nothing planned, a text still in its hold, or one that lapsed —
  // as opposed to a phone that hasn't synced or a store this account
  // doesn't manage (then onFile is 0 and lastWrite null).
  const planTexts = (() => {
    const open = rows(planTasks).filter((t) => t.channel === "text" && !t.done);
    const future = open.filter((t) => t.readyAt && String(t.readyAt) > nowISO).map((t) => String(t.readyAt)).sort();
    return { onFile: open.length, steps: rows(planTasks).length, customers: byId.size, next: future[0] || null, lapsed: open.filter((t) => t.readyAt && now - new Date(t.readyAt) >= 24 * 3600000).length };
  })();
  const texts = rows(textsWeek), mails = rows(emailsWeek), calls = rows(callsToday);
  // The last message with each customer, text or email. If it came from
  // them and nobody answered, they're waiting.
  const lastMsg = new Map();
  const note = (key, m) => { if (!key) return; const cur = lastMsg.get(key); if (!cur || m.at > cur.at) lastMsg.set(key, m); };
  texts.forEach((t) => note(t.leadId || t.phone, { leadId: t.leadId || "", phone: t.phone || "", channel: "text", in: t.dir === "in", read: !!t.read, at: String(t.at || t.createdAt || ""), preview: String(t.body || "").slice(0, 90), name: t.name || "" }));
  mails.forEach((e) => note(e.leadId || e.from, { leadId: e.leadId || "", phone: "", channel: "email", in: e.direction === "in", read: !!e.read, at: String(e.receivedAt || e.createdAt || ""), preview: String(e.subject || e.snippet || e.body || "").slice(0, 90), name: e.fromName || e.from || "" }));
  const waiting = [...lastMsg.values()].filter((m) => m.in && !m.read).map((m) => ({ ...m, name: nameOf(m.leadId, m.name || m.phone) })).sort((a, b) => a.at.localeCompare(b.at));
  // Reached today: a text, an email or a call out to them.
  const touchedToday = new Set();
  texts.forEach((t) => { if (t.dir === "out" && t.leadId && dayKey(t.at || t.createdAt) === today) touchedToday.add(t.leadId); });
  mails.forEach((e) => { if (e.direction === "out" && e.leadId && dayKey(e.createdAt) === today) touchedToday.add(e.leadId); });
  calls.forEach((c) => { if (c.leadId && dayKey(c.at) === today) touchedToday.add(c.leadId); });
  // Appointments at risk: inside 24 hours and not confirmed; recent
  // no-shows nobody has rebooked.
  const nowLocal = `${today}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const in24 = (() => { const d = new Date(now.getTime() + 86400000); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; })();
  const liveAppts = allAppts.filter((a) => a.status !== "canceled");
  const atRisk = liveAppts.filter((a) => !a.confirmed && !a.outcome && a.when > nowLocal && a.when <= in24).sort((a, b) => a.when.localeCompare(b.when));
  const noShows = liveAppts.filter((a) => a.outcome === "no_show" && String(a.when).slice(0, 10) >= since(3) && !liveAppts.some((b) => b.leadId && b.leadId === a.leadId && b.when > nowLocal)).sort((a, b) => b.when.localeCompare(a.when));
  // Today's plays from the night read, and which were reached.
  const night = playsToday[0] && playsToday[0].data;
  const plays = night && Array.isArray(night.plays) ? {
    summary: night.summary || "",
    items: night.plays.map((pl) => ({ customer: pl.customer || "", leadId: pl.leadId || "", action: pl.action || "other", title: pl.title || "", why: pl.why || "",
      reached: !!(pl.leadId && (touchedToday.has(pl.leadId) || (pl.action === "confirm" && liveAppts.some((a) => a.leadId === pl.leadId && a.confirmed)) || (pl.action === "book" && liveAppts.some((a) => a.leadId === pl.leadId && dayKey(a.createdAt) === today)))) })),
  } : null;
  if (plays) plays.reached = plays.items.filter((x) => x.reached).length;
  // Welcomed today: everyone logged today, and whether a text or an email
  // went out to them today — the rep's own or the manager's.
  const loggedTodayList = logged.filter((l) => dayKey(l.loggedAt) === today);
  const welcomes = {
    logged: loggedTodayList.length,
    welcomed: loggedTodayList.filter((l) => touchedToday.has(l.id)).length,
    pending: loggedTodayList.filter((l) => !touchedToday.has(l.id)).map((l) => ({ ...l, email: (byId.get(l.id) || {}).email || "", optOut: !!((byId.get(l.id) || {}).smsOptOut || (byId.get(l.id) || {}).doNotContact) })),
  };

  return { userId, touches, appts: apptStats, sales: saleStats, goal, leads: { untouched, overdue, open: open.length }, raw, insight, sheet, logged, loggedToday, events, lastWrite, waiting, atRisk, noShows, plays, welcomes, textsDue, textsHeld, planTexts, at: now.toISOString() };
}

// The board's self-check: for each member, what the server holds against
// what a read brings back, and the few counts the Floor is built on —
// so "their phone shows it and the board doesn't" is answered with
// numbers rather than guesses. Each read reports its own error.
export async function boardCheck(team, { now = new Date() } = {}) {
  const me = (backend.currentUser() || {}).id;
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const nowISO = now.toISOString();
  const out = [];
  for (const m of team.members || []) {
    if (m.user_id === me) continue;
    const r = { member: m };
    const step = async (name, fn) => { try { r[name] = await fn(); } catch (e) { r[name] = `error: ${e && e.message ? e.message : e}`; } };
    await step("lastWrite", () => backend.lastWrite(m.user_id));
    await step("leadsServer", () => backend.countFor(m.user_id, "leads"));
    await step("leadsRead", async () => (await backend.readRecords(m.user_id, "leads", {}, { select: "id", limit: 20000 })).length);
    await step("loggedMonth", async () => (await backend.readRecords(m.user_id, "leads", { "data->>loggedAt": `gte.${monthStart}` }, { select: "id", limit: 20000 })).length);
    await step("planSteps", async () => {
      const ts = (await backend.readRecords(m.user_id, "tasks", { "data->>cadence": "eq.true" }, { select: "data", limit: 5000 })).map((x) => x.data || {});
      const open = ts.filter((t) => t.channel === "text" && !t.done && t.readyAt);
      return { steps: ts.length, due: open.filter((t) => String(t.readyAt) <= nowISO && now - new Date(t.readyAt) < DAY).length, held: open.filter((t) => String(t.readyAt) > nowISO && new Date(t.readyAt) - now <= 15 * 60000).length };
    });
    out.push(r);
  }
  return out;
}

// Every member's numbers, in parallel, in the order given.
export async function boardStats(members, opts = {}) {
  // The store's targets for the month, once, then each rep in parallel.
  let targets = [];
  if (opts.storeId) { try { targets = await targetsForStore(opts.storeId); } catch { targets = []; } }
  const tFor = (id) => targets.find((t) => t.user_id === id) || null;
  return Promise.all(members.map((m) => repStats(m.user_id, { ...opts, target: tFor(m.user_id) }).then((st) => ({ member: m, ...st }), (e) => ({ member: m, error: e && e.message ? e.message : "couldn't read" }))));
}

// ---- The store's whole book ----
// Every rep's customers, slimmed to what the manager's read and the list
// need, kept in memory for the session and refreshed on demand.
const KEEP = ["id", "name", "phone", "email", "stage", "vehicleInterest", "source", "purchaseDate", "leaseEnd", "dealType", "currentPayment", "payoff", "currentValue", "currentApr", "paymentsLeft", "paymentsLeftAsOf", "currentTerm", "odometer", "alertType", "priority", "serviceAppt", "lastContacted", "firstContacted", "lastCampaignAt", "createdAt", "importedAt", "updatedAt", "followUp", "smsOptOut", "consent", "doNotContact"];
let bookCache = { storeId: null, at: 0, rows: [] };
export function cachedBook() { return bookCache.storeId ? bookCache : null; }
export async function loadBook(team, { force = false } = {}) {
  if (!force && bookCache.storeId === team.id && Date.now() - bookCache.at < 10 * 60000) return bookCache;
  const members = team.members || [];
  const per = await Promise.all(members.map((m) => backend.readRecords(m.user_id, "leads", {}, { select: "data", limit: 20000 }).then((rs) => rs.map((r) => {
    const d = r.data || {}, slim = {};
    for (const k of KEEP) if (d[k] != null && d[k] !== "") slim[k] = d[k];
    const notes = String(d.notes || "");
    if (/AutoAlert:|Priority:|Service appt|Deal type:/i.test(notes)) slim.notes = notes.slice(0, 300);
    return { lead: slim, rep: m };
  }), () => [])));
  bookCache = { storeId: team.id, at: Date.now(), rows: per.flat() };
  return bookCache;
}

// ---- Store config: the manager's welcome text ----
let cfgCache = { storeId: null, data: null };
export function cachedConfig() { return cfgCache.data; }
export async function loadConfig(team) {
  const data = (await backend.rpc("store_config_get", { store: team.id })) || {};
  cfgCache = { storeId: team.id, data };
  return data;
}
export async function saveConfig(team, patch) {
  const data = (await backend.rpc("store_config_set", { store: team.id, patch })) || {};
  cfgCache = { storeId: team.id, data };
  return data;
}
// Send the welcome to one customer now, through the function.
export async function sendWelcomeNow(repId, leadId) {
  const s = (await import("./store.js")).getSettings();
  const fn = (s.agentUrl || "").trim().replace(/\/+$/, "");
  if (!fn) throw new Error("Set up the cloud function in Settings first");
  const res = await fetch(fn, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ welcome: { rep: repId, leadId } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Couldn't send (${res.status})`);
  return j;
}
// The manager's text to one of a rep's customers: sent from the store's
// number, filed in the rep's thread marked as the manager's. A reply comes
// back to the rep's thread like any other. (The function's `mtext` door.)
export async function sendManagerText(repId, leadId, body) {
  const s = (await import("./store.js")).getSettings();
  const fn = (s.agentUrl || "").trim().replace(/\/+$/, "");
  if (!fn) throw new Error("Set up the cloud function in Settings first");
  const res = await fetch(fn, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ mtext: { rep: repId, leadId, body } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(/No messages/.test(j.error || "") ? "Paste the latest function into quick-api to text as the manager" : j.error || `Couldn't send (${res.status})`);
  // The draft the agent held for this customer, if any, is spent.
  try { if (store.get("agentdrafts", `reply:${leadId}`)) store.remove("agentdrafts", `reply:${leadId}`); } catch { /* fine */ }
  return j;
}
// The reply the agent drafted for a waiting customer, held for the
// manager's tap (the function writes it to the manager's own records).
export function heldDraft(leadId) {
  try { return store.get("agentdrafts", `reply:${leadId}`) || null; } catch { return null; }
}
// Welcomes sent across the store in the last `days`, newest first.
export async function welcomeLog(team, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const per = await Promise.all((team.members || []).map((m) => backend.readRecords(m.user_id, "texts", { "data->>via": "eq.manager-welcome", "data->>at": `gte.${since}` }, { select: "data" }).then((rs) => rs.map((r) => ({ ...(r.data || {}), rep: m })), () => [])));
  return per.flat().sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ---- The store's shared lot ----
let lotCache = { storeId: null, at: 0, rows: [] };
export function cachedInventory() { return lotCache.storeId ? lotCache : null; }
export async function loadInventory(team, { force = false } = {}) {
  if (!force && lotCache.storeId === team.id && Date.now() - lotCache.at < 10 * 60000) return lotCache;
  const rows = (await backend.rpc("store_inventory", { store: team.id, since: null })) || [];
  lotCache = { storeId: team.id, at: Date.now(), rows: rows.filter((r) => !r.deleted).map((r) => ({ ...(r.data || {}), id: r.id })) };
  return lotCache;
}
// The signed-in rep's store lot, for their own app: rows changed since a cursor.
export async function pullStoreInventory(since = null) {
  const s = cachedStore();
  if (!s) return { rows: [], storeId: null };
  const rows = (await backend.rpc("store_inventory", { store: s.id, since })) || [];
  return { rows, storeId: s.id };
}

// One customer of a rep's, for the read-only page: the lead, their last
// texts and their last emails.
export async function repLead(userId, leadId) {
  const [lead, texts, emails] = await Promise.all([
    backend.readRecords(userId, "leads", { id: `eq.${leadId}` }, { select: "data", limit: 1 }),
    backend.readRecords(userId, "texts", { "data->>leadId": `eq.${leadId}` }, { select: "data", limit: 200 }),
    backend.readRecords(userId, "emails", { "data->>leadId": `eq.${leadId}` }, { select: "data", limit: 100 }).catch(() => []),
  ]);
  const l = lead[0] && lead[0].data;
  const thread = texts.map((t) => t.data).sort((a, b) => String(b.at || b.createdAt || "").localeCompare(String(a.at || a.createdAt || ""))).slice(0, 8);
  const mail = emails.map((e) => e.data).sort((a, b) => String(b.receivedAt || b.createdAt || "").localeCompare(String(a.receivedAt || a.createdAt || ""))).slice(0, 6);
  return l ? { lead: l, texts: thread, emails: mail } : null;
}

// ---- The manager's email ----
// A real email to one of a rep's customers, from the manager, through the
// function: it sends (Resend) and files the email in the rep's book, marked
// as the manager's, so the rep sees it on the customer's page.
export async function sendManagerEmail(repId, leadId, { subject, text }) {
  const s = (await import("./store.js")).getSettings();
  const fn = (s.agentUrl || "").trim().replace(/\/+$/, "");
  if (!fn) throw new Error("Set up the cloud function in Settings first");
  const res = await fetch(fn, { method: "POST", headers: await backend.fnHeaders(), body: JSON.stringify({ memail: { rep: repId, leadId, subject, text } }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Couldn't send (${res.status})`);
  return j;
}
// File an email (one the manager received, say) into a rep's book against
// their customer, through the one narrow door the database allows.
export async function logRepEmail(repId, email) {
  return backend.rpc("manager_log_email", { member: repId, email });
}
// Every email across the store in the last `days`, newest first, with the
// customer's name and rep on each.
export async function loadMail(team, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const book = cachedBook();
  const per = await Promise.all((team.members || []).map((m) => backend.readRecords(m.user_id, "emails", { "data->>createdAt": `gte.${since}` }, { select: "data", limit: 500 }).then((rs) => rs.map((r) => {
    const e = r.data || {};
    const row = book ? book.rows.find((x) => x.rep.user_id === m.user_id && x.lead.id === e.leadId) : null;
    return { ...e, rep: m, customer: row ? row.lead.name || "Customer" : "Customer", email: row ? row.lead.email || "" : "" };
  }), () => [])));
  return per.flat().sort((a, b) => String(b.receivedAt || b.createdAt || "").localeCompare(String(a.receivedAt || a.createdAt || "")));
}
