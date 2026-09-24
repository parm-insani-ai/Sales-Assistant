// The manager's Home — the store's day on one screen.
//
// What a sales manager keeps on a whiteboard, filled in from the reps'
// phones: units against the store's goal and where it should be by today,
// appointments set and shown, touches, untouched leads and overdue
// follow-ups; the reps ordered by units with pace colouring; the ones who
// need a word today; every appointment on the store's calendar today. Tap a
// rep for the lists behind their numbers, a customer for their page,
// read-only. An admin also sees their stores and the way to the admin tools.

import * as backend from "../backend.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { toast } from "../components.js";
import { esc, formatDateTime, currency } from "../utils.js";
import { cachedStore, myStore, isAdmin, isManager, memberName, cachedBoard, loadBoard, storeTotals, inviteLink, setViewMode } from "../team.js";
import { openRepSheet, apptState } from "./team.js";

export function renderManageHome(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  const me = backend.currentUser();
  let team = cachedStore();
  let board = cachedBoard();
  let loading = false, error = "";
  const now = new Date();
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthName = now.toLocaleDateString("en-CA", { month: "long" });

  async function refresh(force = false) {
    if (loading) return;
    loading = true; draw();
    try {
      team = await myStore();
      if (team && isManager(team)) board = await loadBoard(team, { force });
      error = "";
    } catch (e) { error = e && e.message ? e.message : "couldn't reach the store"; }
    loading = false; draw();
  }

  function draw() {
    const bar = document.getElementById("page-title"); if (bar) bar.textContent = isAdmin(team) ? "Admin" : "Manager";
    if (!team) { drawNoStore(); return; }
    const manager = isManager(team);
    const stats = board && board.storeId === team.id ? board.stats : null;
    const t = stats ? storeTotals(stats) : null;
    const pace = t && t.goal ? Math.round((t.goal * now.getDate()) / daysIn) : 0;
    const paceCls = (units, goal, p) => (!goal ? "" : units >= p ? "color:var(--success)" : units < p * 0.6 ? "color:var(--danger)" : "color:var(--warning)");
    const rows = stats ? stats.slice().sort((a, b) => ((b.sales ? b.sales.units : -1) - (a.sales ? a.sales.units : -1)) || memberName(a.member).localeCompare(memberName(b.member))) : [];
    const attention = stats ? rows.filter((r) => !r.error && r.touches).flatMap((r) => {
      // A manager with no book and no goal has nothing to be behind on.
      if (!r.leads.open && !r.goal.units && !r.sales.units) return [];
      const why = [];
      if (r.leads.untouched.length) why.push(`${r.leads.untouched.length} untouched lead${r.leads.untouched.length === 1 ? "" : "s"}`);
      if (r.leads.overdue.length >= 3) why.push(`${r.leads.overdue.length} overdue follow-ups`);
      if (r.goal.units && r.sales.units < r.goal.pace * 0.6) why.push(`behind pace (${r.sales.units} of ${r.goal.pace} by today)`);
      if (!r.touches.today && now.getHours() >= 12) why.push("no touches yet today");
      return why.length ? [{ r, why }] : [];
    }) : [];

    el.innerHTML = `
      <div class="hero">
        <div class="hero-greeting">${esc(now.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" }))}</div>
        <div class="hero-title">${esc(team.name)}</div>
      </div>
      ${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}
      ${!manager ? `<div class="card">You're on ${esc(team.name)}'s team as a rep. The board is the manager's; your own numbers are in the sales view.</div>` : `
      <div class="row" style="margin:0 2px 8px"><span class="small muted">${board && board.storeId === team.id ? "As of " + esc(formatDateTime(board.at)) : loading ? "Reading the reps…" : "Not read yet"}</span><button class="btn btn-ghost btn-sm" data-act="refresh" ${loading ? "disabled" : ""}>${loading ? "Reading…" : "Refresh"}</button></div>
      ${t ? `
      <div class="stat-grid" style="margin-bottom:12px">
        <div class="stat"><div class="stat-value" style="${paceCls(t.units, t.goal, pace)}">${t.units}<span class="muted" style="font-size:0.9rem;font-weight:500"> / ${t.goal || "—"}</span></div><div class="stat-label">Units in ${esc(monthName)}${t.goal ? ` · pace ${pace}` : ""}</div></div>
        <div class="stat"><div class="stat-value mono" style="font-size:1.25rem">${currency(t.gross)}</div><div class="stat-label">Gross this month</div></div>
        <div class="stat"><div class="stat-value" style="color:var(--brand)">${t.set}</div><div class="stat-label">Appointments set · ${t.shown} shown${t.showRate != null ? ` (${t.showRate}%)` : ""}</div></div>
        <div class="stat"><div class="stat-value">${t.touchesToday}</div><div class="stat-label">Touches today · ${t.touchesMonth} this month</div></div>
        <div class="stat"><div class="stat-value" style="${t.untouched ? "color:var(--danger)" : ""}">${t.untouched}</div><div class="stat-label">Untouched new leads</div></div>
        <div class="stat"><div class="stat-value" style="${t.overdue ? "color:var(--warning)" : ""}">${t.overdue}</div><div class="stat-label">Overdue follow-ups · ${t.open} open</div></div>
      </div>

      <div class="section-title">Needs a word <span class="muted" style="font-weight:500;font-size:0.78rem">· ${attention.length ? attention.length : "nobody"}</span></div>
      <div class="card">${attention.length ? attention.map(({ r, why }) => `<div class="row mg-rep" data-rep="${esc(r.member.user_id)}" style="padding:7px 0;cursor:pointer"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(memberName(r.member))}</div><div class="row-sub">${esc(why.join(" · "))}</div></div><span class="muted">›</span></div>`).join("") : `<div class="muted small">Every rep is on pace, touching leads, and current on follow-ups.</div>`}</div>

      <div class="section-title">Today's appointments <span class="muted" style="font-weight:500;font-size:0.78rem">· ${t.apptsToday.length}</span></div>
      <div class="card">${t.apptsToday.length ? t.apptsToday.map((a) => `<div class="row" style="padding:6px 0"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(String(a.when).slice(11, 16))} · ${esc(a.customerName || a.title || "Appointment")}</div><div class="row-sub">${esc(memberName(a.rep))}${a.type ? " · " + esc(a.type) : ""}</div></div><span class="small muted">${apptState(a)}</span></div>`).join("") : `<div class="muted small">Nothing on the store's calendar today.</div>`}</div>

      <div class="section-title">Reps <span class="muted" style="font-weight:500;font-size:0.78rem">· by units · tap for their day</span></div>
      <div class="card" style="padding:6px 0">
        ${rows.map((r) => `
          <div class="team-row mg-rep" data-rep="${esc(r.member.user_id)}" style="padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer">
            <div class="row" style="align-items:center">
              <div class="row-main"><div class="row-title" style="font-size:0.98rem">${esc(memberName(r.member))}${r.member.role === "manager" ? ' <span class="badge badge-sold" style="margin-left:4px">Mgr</span>' : ""}</div>
                ${r.error ? `<div class="row-sub" style="color:var(--danger)">${esc(r.error)}</div>` : `<div class="row-sub">${r.touches.today} touch${r.touches.today === 1 ? "" : "es"} today · ${r.appts.set} set · ${r.appts.shown} shown</div>`}</div>
              ${r.sales ? `<div class="row-meta"><div class="mono strong" style="${paceCls(r.sales.units, r.goal.units, r.goal.pace)}">${r.sales.units}<span class="muted" style="font-weight:500"> / ${r.goal.units || "—"}</span></div><div class="small muted">${r.goal.units ? "pace " + r.goal.pace : "no goal set"}</div></div>` : ""}
            </div>
            ${r.leads ? `<div class="team-cells"><span style="${r.leads.untouched.length ? "color:var(--danger)" : ""}"><b>${r.leads.untouched.length}</b> untouched</span><span style="${r.leads.overdue.length ? "color:var(--warning)" : ""}"><b>${r.leads.overdue.length}</b> overdue</span><span><b>${r.leads.open}</b> open</span></div>` : ""}
          </div>`).join("")}
        ${!rows.length ? `<div class="muted small" style="padding:10px 16px">No reps on the board yet.</div>` : ""}
      </div>` : loading ? `<div class="card"><div class="muted small" style="text-align:center">Reading the reps' books…</div></div>` : `<div class="card"><div class="muted small">Tap Refresh to read the board.</div></div>`}`}

      <div class="section-title">Run the store</div>
      <div class="qa-grid" style="margin-bottom:14px">
        <button class="qa-tile" data-act="team"><span class="qa-ico">${icon("users")}</span><span class="qa-label">Team</span></button>
        ${manager ? `<button class="qa-tile" data-act="invite"><span class="qa-ico">${icon("send")}</span><span class="qa-label">Invite a rep</span></button>` : ""}
        ${isAdmin(team) ? `<button class="qa-tile" data-act="admin"><span class="qa-ico">${icon("store")}</span><span class="qa-label">Admin</span></button>` : ""}
        <button class="qa-tile" data-act="settings"><span class="qa-ico">${icon("settings")}</span><span class="qa-label">Settings</span></button>
        <button class="qa-tile" data-act="sales"><span class="qa-ico">${icon("car")}</span><span class="qa-label">Sales view</span></button>
      </div>
      <div class="hint" style="margin:0 2px">Signed in as ${esc(me ? me.email || "" : "")}. The board reads the reps' synced records, so a rep's numbers are as current as their last sync.</div>
    `;
    const on = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on('[data-act="refresh"]', () => refresh(true));
    on('[data-act="team"]', () => navigate("/team"));
    on('[data-act="admin"]', () => navigate("/team"));
    on('[data-act="settings"]', () => navigate("/settings"));
    on('[data-act="sales"]', () => { setViewMode("sales"); location.hash = "#/"; location.reload(); });
    on('[data-act="invite"]', async () => { try { await navigator.clipboard.writeText(inviteLink(team.code)); toast("Invite link copied — send it to the rep", "success"); } catch { navigate("/team"); } });
    el.querySelectorAll("[data-rep]").forEach((n) => n.addEventListener("click", () => {
      const r = stats && stats.find((x) => x.member.user_id === n.dataset.rep);
      const m = (team.members || []).find((x) => x.user_id === n.dataset.rep);
      if (!r || r.error || !r.touches) { toast("Refresh the board first", "warn"); return; }
      openRepSheet(r, m);
    }));
  }

  function drawNoStore() {
    el.innerHTML = `
      <div class="hero"><div class="hero-greeting">${isAdmin() ? "Admin" : "Manager"}</div><div class="hero-title">No store yet</div></div>
      <div class="card">
        <div class="strong">${isAdmin() ? "Set up the store to start the board." : "You're not in a store yet."}</div>
        <div class="small muted" style="margin-top:4px">${isAdmin() ? "Name it, and you get an invite link for the reps. Then appoint managers by their sign-in email." : "Ask the admin to add you, or join with the invite link."}</div>
        <button class="btn btn-primary btn-block" data-act="team" style="margin-top:10px">${icon("store")} Open Team</button>
      </div>
      <div class="qa-grid" style="margin-top:14px">
        <button class="qa-tile" data-act="settings"><span class="qa-ico">${icon("settings")}</span><span class="qa-label">Settings</span></button>
        <button class="qa-tile" data-act="sales"><span class="qa-ico">${icon("car")}</span><span class="qa-label">Sales view</span></button>
      </div>`;
    el.querySelector('[data-act="team"]').addEventListener("click", () => navigate("/team"));
    el.querySelector('[data-act="settings"]').addEventListener("click", () => navigate("/settings"));
    el.querySelector('[data-act="sales"]').addEventListener("click", () => { setViewMode("sales"); location.hash = "#/"; location.reload(); });
  }

  draw();
  refresh(false);
}
