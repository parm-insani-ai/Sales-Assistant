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
import { cachedStore, myStore, isAdmin, isManager, memberName, cachedBoard, loadBoard, storeTotals, inviteLink, setViewMode, nudgeRep } from "../team.js";
import { openRepSheet, openCustomerSheet, apptState } from "./team.js";
import { findings } from "../insight.js";

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
    // Ordered by appointments set this month: that's the number the store runs on.
    const rows = stats ? stats.slice().sort((a, b) => ((b.insight ? b.insight.setThisMonth : -1) - (a.insight ? a.insight.setThisMonth : -1)) || memberName(a.member).localeCompare(memberName(b.member))) : [];
    const ins = t ? t.insight : null;
    const fx = ins ? findings(ins).filter((x) => x.kind !== "needs").slice(0, 3) : [];
    const today = now.toISOString().slice(0, 10);
    const setToday = (r) => (r.raw ? r.raw.appts.filter((a) => a.status !== "canceled" && String(a.createdAt || a.when).slice(0, 10) === today).length : 0);
    const attention = stats ? rows.filter((r) => !r.error && r.touches && r.insight).flatMap((r) => {
      // A manager with no book and no goal has nothing to be behind on.
      if (!r.leads.open && !r.goal.units && !r.sales.units) return [];
      const why = [];
      const i = r.insight;
      if (r.leads.untouched.length) why.push(`${r.leads.untouched.length} untouched lead${r.leads.untouched.length === 1 ? "" : "s"}`);
      if (i.needs.goal && !i.needs.onTrack && i.needs.perDay >= 1 && !setToday(r) && now.getHours() >= 12) why.push(`needs ${i.needs.perDay} appointment${i.needs.perDay === 1 ? "" : "s"} a day, none set today`);
      const thisWeek = i.weekly[i.weekly.length - 1];
      if (thisWeek && !thisWeek.set && now.getDay() >= 3) why.push("nothing set this week");
      if (r.leads.overdue.length >= 3) why.push(`${r.leads.overdue.length} overdue follow-ups`);
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
        <div class="stat"><div class="stat-value" style="color:var(--brand)">${ins.setThisMonth}</div><div class="stat-label">Appointments set in ${esc(monthName)} · ${rows.reduce((a, r) => a + setToday(r), 0)} today</div></div>
        <div class="stat"><div class="stat-value" style="${ins.needs.goal ? (ins.needs.onTrack ? "color:var(--success)" : "color:var(--danger)") : ""}">${ins.needs.goal ? ins.needs.apptsNeeded : "—"}</div><div class="stat-label">${ins.needs.goal ? `more to set for ${ins.needs.goal} units · ${ins.needs.perDay} a day` : "No unit goals set"}</div></div>
        <div class="stat"><div class="stat-value">${ins.funnel.shown}<span class="muted" style="font-size:0.9rem;font-weight:500"> · ${ins.history.showRate != null ? ins.history.showRate + "%" : "—"}</span></div><div class="stat-label">Shown · show rate over 8 weeks</div></div>
        <div class="stat"><div class="stat-value" style="${paceCls(t.units, t.goal, pace)}">${t.units}<span class="muted" style="font-size:0.9rem;font-weight:500"> / ${t.goal || "—"}</span></div><div class="stat-label">Units · ${currency(t.gross)} gross${t.goal ? ` · pace ${pace}` : ""}</div></div>
        <div class="stat"><div class="stat-value">${t.touchesToday}</div><div class="stat-label">Touches today${ins.touchesPerAppt ? ` · ${ins.touchesPerAppt} per appointment` : ""}</div></div>
        <div class="stat"><div class="stat-value" style="${t.untouched ? "color:var(--danger)" : ""}">${t.untouched}</div><div class="stat-label">Untouched new leads · ${t.overdue} overdue</div></div>
      </div>

      ${ins.needs.goal ? `<div class="card mg-plan" style="margin-bottom:14px">
        <div class="strong">${ins.needs.onTrack ? `On track: the calendar covers the rest of ${esc(monthName)}.` : `To hit ${ins.needs.goal} units: ${ins.needs.apptsNeeded} more appointments set by month end.`}</div>
        <div class="small muted" style="margin-top:4px">${ins.needs.sold} sold · ${ins.needs.futureSet} on the calendar (~${ins.needs.pipeline} units) · ${ins.needs.perAppt} units per appointment set (${ins.needs.showRate}% show × ${ins.needs.closeRate}% close${ins.needs.assumed ? ", typical rates until there's history" : ""})${ins.touchesPerDay && !ins.needs.onTrack ? ` · about ${ins.touchesPerDay} touches a day across the floor` : ""}</div>
        ${!ins.needs.onTrack ? `<div class="small" style="margin-top:8px">${rows.filter((r) => r.insight && r.insight.needs.goal).map((r) => `<span class="mg-need"><b>${esc(memberName(r.member))}</b> ${r.insight.needs.onTrack ? "on track" : r.insight.needs.perDay + "/day"}</span>`).join(" ")}</div>` : ""}
      </div>` : ""}

      ${fx.length ? `<div class="section-title">What the numbers say <span class="muted" style="font-weight:500;font-size:0.78rem">· <a href="#/insights" style="color:var(--brand)">all insights</a></span></div>
      <div class="card">${fx.map((x) => `<div class="row" style="padding:6px 0;align-items:flex-start;gap:10px"><span style="flex:none;color:var(--brand)">${icon("sparkles")}</span><div class="small">${esc(x.text)}</div></div>`).join("")}</div>` : ""}

      ${(() => {
        // Fresh leads waiting: every untouched new lead in the store with the
        // clock on it, newest arrivals that have waited longest first.
        const waiting = rows.flatMap((r) => (r.leads ? r.leads.untouched.map((l) => ({ l, r })) : [])).concat(
          rows.flatMap((r) => (r.raw ? r.raw.leads.filter((l) => l.stage === "new" && !l.firstContacted && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) <= 86400000 && now - new Date(l.createdAt) > 30 * 60000).map((l) => ({ l, r })) : []))
        ).filter((x, i, arr) => arr.findIndex((y) => y.l.id === x.l.id && y.r.member.user_id === x.r.member.user_id) === i)
         .sort((a, b) => String(a.l.createdAt).localeCompare(String(b.l.createdAt))).slice(0, 12);
        const age = (iso) => { const m = Math.max(0, Math.round((now - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
        return `<div class="section-title">Fresh leads waiting <span class="muted" style="font-weight:500;font-size:0.78rem">· ${waiting.length ? "untouched · oldest first" : "none"}</span></div>
        <div class="card">${waiting.length ? waiting.map(({ l, r }) => `<div class="row" style="padding:7px 0;align-items:center"><div class="row-main" data-cust="${esc(l.id)}" data-rep="${esc(r.member.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")} <span class="small" style="color:var(--danger);font-weight:600">${age(l.createdAt)}</span></div><div class="row-sub">${esc(memberName(r.member))}${l.source ? " · " + esc(l.source) : ""}</div></div><button class="btn btn-ghost btn-sm" data-nudge="${esc(r.member.user_id)}" data-lead="${esc(l.id)}" data-name="${esc(l.name || "A lead")}" data-age="${age(l.createdAt)}">${icon("bell")} Nudge</button></div>`).join("") : `<div class="muted small">Every lead has been touched. Leads set appointments in the first hour and rarely after the first day.</div>`}</div>`;
      })()}

      <div class="section-title">Today's huddle <span class="muted" style="font-weight:500;font-size:0.78rem">· <a href="#" data-act="copy-huddle" style="color:var(--brand)">copy for the group chat</a></span></div>
      <div class="card small" style="white-space:pre-wrap;line-height:1.5" id="mg-huddle">${esc(huddleText(team, t, ins, rows, fx, now))}</div>

      <div class="section-title">Needs a word <span class="muted" style="font-weight:500;font-size:0.78rem">· ${attention.length ? attention.length : "nobody"}</span></div>
      <div class="card">${attention.length ? attention.map(({ r, why }) => `<div class="row mg-rep" data-rep="${esc(r.member.user_id)}" style="padding:7px 0;cursor:pointer"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(memberName(r.member))}</div><div class="row-sub">${esc(why.join(" · "))}</div></div><span class="muted">›</span></div>`).join("") : `<div class="muted small">Every rep is on pace, touching leads, and current on follow-ups.</div>`}</div>

      <div class="section-title">Today's appointments <span class="muted" style="font-weight:500;font-size:0.78rem">· ${t.apptsToday.length}</span></div>
      <div class="card">${t.apptsToday.length ? t.apptsToday.map((a) => `<div class="row" style="padding:6px 0"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(String(a.when).slice(11, 16))} · ${esc(a.customerName || a.title || "Appointment")}</div><div class="row-sub">${esc(memberName(a.rep))}${a.type ? " · " + esc(a.type) : ""}</div></div><span class="small muted">${apptState(a)}</span></div>`).join("") : `<div class="muted small">Nothing on the store's calendar today.</div>`}</div>

      <div class="section-title">Reps <span class="muted" style="font-weight:500;font-size:0.78rem">· by appointments set · tap for their day</span></div>
      <div class="card" style="padding:6px 0">
        ${rows.map((r) => `
          <div class="team-row mg-rep" data-rep="${esc(r.member.user_id)}" style="padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer">
            <div class="row" style="align-items:center">
              <div class="row-main"><div class="row-title" style="font-size:0.98rem">${esc(memberName(r.member))}${r.member.role === "manager" ? ' <span class="badge badge-sold" style="margin-left:4px">Mgr</span>' : ""}</div>
                ${r.error ? `<div class="row-sub" style="color:var(--danger)">${esc(r.error)}</div>` : `<div class="row-sub">${r.insight ? r.insight.setThisMonth : r.appts.set} set · ${setToday(r)} today · ${r.appts.shown} shown · ${r.touches.today} touch${r.touches.today === 1 ? "" : "es"} today</div>`}</div>
              ${r.sales ? `<div class="row-meta"><div class="mono strong" style="${paceCls(r.sales.units, r.goal.units, r.goal.pace)}">${r.sales.units}<span class="muted" style="font-weight:500"> / ${r.goal.units || "—"}</span></div><div class="small muted">${r.insight && r.insight.needs.goal ? (r.insight.needs.onTrack ? "on track" : `needs ${r.insight.needs.apptsNeeded} · ${r.insight.needs.perDay}/day`) : "no goal set"}</div></div>` : ""}
            </div>
            ${r.leads ? `<div class="team-cells"><span style="${r.leads.untouched.length ? "color:var(--danger)" : ""}"><b>${r.leads.untouched.length}</b> untouched</span><span style="${r.leads.overdue.length ? "color:var(--warning)" : ""}"><b>${r.leads.overdue.length}</b> overdue</span><span><b>${r.leads.open}</b> open</span></div>` : ""}
          </div>`).join("")}
        ${!rows.length ? `<div class="muted small" style="padding:10px 16px">No reps on the board yet.</div>` : ""}
      </div>` : loading ? `<div class="card"><div class="muted small" style="text-align:center">Reading the reps' books…</div></div>` : `<div class="card"><div class="muted small">Tap Refresh to read the board.</div></div>`}`}

      <div class="section-title">Run the store</div>
      <div class="qa-grid" style="margin-bottom:14px">
        <button class="qa-tile" data-act="appointments"><span class="qa-ico">${icon("calendar")}</span><span class="qa-label">Appointments</span></button>
        <button class="qa-tile" data-act="insights"><span class="qa-ico">${icon("sparkles")}</span><span class="qa-label">Insights</span></button>
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
    on('[data-act="insights"]', () => navigate("/insights"));
    on('[data-act="appointments"]', () => navigate("/appointments"));
    on('[data-act="admin"]', () => navigate("/team"));
    on('[data-act="settings"]', () => navigate("/settings"));
    on('[data-act="sales"]', () => { setViewMode("sales"); location.hash = "#/"; location.reload(); });
    on('[data-act="copy-huddle"]', async (e) => { e.preventDefault(); const txt = el.querySelector("#mg-huddle")?.textContent || ""; try { await navigator.clipboard.writeText(txt); toast("Huddle copied", "success"); } catch { toast("Select the text to copy it", "warn"); } });
    el.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await nudgeRep(b.dataset.nudge, { title: `${b.dataset.name} has been waiting ${b.dataset.age}`, body: "A fresh lead — call or text them now. Leads set appointments in the first hour.", url: `./#/leads/${b.dataset.lead}`, tag: "lead-" + b.dataset.lead }); toast("Nudged", "success"); }
      catch (err) { toast(err.message || "Couldn't nudge", "danger"); b.disabled = false; }
    }));
    el.querySelectorAll("[data-cust]").forEach((n) => n.addEventListener("click", () => openCustomerSheet(n.dataset.rep, n.dataset.cust)));
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

// The morning huddle, written from the numbers: where the store stands,
// what each rep needs today, and the one thing the data says to do.
function huddleText(team, t, ins, rows, fx, now) {
  const L = [];
  L.push(`${team.name} · ${now.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })}`);
  L.push(`Units ${t.units}/${t.goal || "—"} · appointments set this month ${ins.setThisMonth} · show rate ${ins.history.showRate != null ? ins.history.showRate + "%" : "—"}`);
  if (ins.needs.goal) L.push(ins.needs.onTrack ? "On track — keep the calendar full." : `Need ${ins.needs.apptsNeeded} more appointments by month end: ${ins.needs.perDay} a day across the floor.`);
  if (t.apptsToday.length) L.push(`Today: ${t.apptsToday.map((a) => `${String(a.when).slice(11, 16)} ${a.customerName || ""} (${memberName(a.rep)})`).join(", ")}`);
  else L.push("Today: nothing on the calendar yet — first job is to change that.");
  const reps = rows.filter((r) => r.insight && (r.leads.open || r.goal.units));
  if (reps.length) L.push("Each of you today: " + reps.map((r) => { const i = r.insight; const bits = []; if (i.needs.goal) bits.push(i.needs.onTrack ? "on track" : `${i.needs.perDay} appt${i.needs.perDay === 1 ? "" : "s"}`); if (r.leads.untouched.length) bits.push(`${r.leads.untouched.length} untouched`); if (r.leads.overdue.length) bits.push(`${r.leads.overdue.length} overdue`); return `${memberName(r.member)} — ${bits.join(", ") || "keep touching"}`; }).join("; ") + ".");
  if (fx.length) L.push("The numbers say: " + fx[0].text);
  return L.join("\n");
}
