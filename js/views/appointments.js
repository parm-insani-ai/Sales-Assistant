// The appointment board — every appointment in the store, and what a
// manager does about them.
//
// Today, tomorrow, this week, and the no-shows to rebook: each row is a
// time, a customer, a rep and where it stands. Tap one to mark it
// confirmed, showed, no-show or sold — written into the rep's own record
// through the one narrow door the database allows a manager — or to nudge
// the rep's phone to confirm it. The confirmation queue at the top is the
// tactical list: tomorrow's appointments nobody has confirmed yet.

import { icon } from "../icons.js";
import { toast, openModal } from "../components.js";
import { esc, formatDateTime } from "../utils.js";
import { cachedStore, myStore, isManager, memberName, cachedBoard, loadBoard, updateRepAppointment, nudgeRep } from "../team.js";
import { apptState, openCustomerSheet } from "./team.js";

const DAY = 86400000;
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const live = (a) => a.status !== "canceled";
const hhmm = (when) => String(when || "").slice(11, 16) || "—";
const dayLabel = (iso, today) => { const d = String(iso).slice(0, 10); if (d === today) return "Today"; if (d === ymd(Date.now() + DAY)) return "Tomorrow"; return new Date(d + "T12:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }); };

export function renderAppointments(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  let team = cachedStore();
  let board = cachedBoard();
  let tab = "today";
  let loading = false, error = "";

  async function refresh(force = false) {
    if (loading) return;
    loading = true; draw();
    try { team = await myStore(); if (team && isManager(team)) board = await loadBoard(team, { force }); error = ""; }
    catch (e) { error = e && e.message ? e.message : "couldn't reach the store"; }
    loading = false; draw();
  }

  // Every appointment we know of across the store, with its rep, fresh from
  // the board's raw rows.
  function all() {
    const stats = board && team && board.storeId === team.id ? board.stats.filter((r) => !r.error && r.raw) : [];
    return stats.flatMap((r) => r.raw.appts.map((a) => ({ ...a, rep: r.member })));
  }

  function draw() {
    const bar = document.getElementById("page-title"); if (bar) bar.textContent = "Appointments";
    if (!team || !isManager(team)) {
      el.innerHTML = `<div class="hero"><div class="hero-greeting">Appointments</div><div class="hero-title">${team ? "For managers" : "No store yet"}</div></div><div class="card muted small">${team ? "The store's board is the manager's. Your own appointments are under Calendar in the sales view." : "Set up the store under Team first."}</div>`;
      return;
    }
    const now = new Date(), today = ymd(now), tomorrow = ymd(now.getTime() + DAY);
    const weekEnd = ymd(now.getTime() + 7 * DAY);
    const A = all().filter(live);
    const on = (d) => A.filter((a) => String(a.when).slice(0, 10) === d).sort((a, b) => String(a.when).localeCompare(String(b.when)));
    const lists = {
      today: on(today),
      tomorrow: on(tomorrow),
      week: A.filter((a) => { const d = String(a.when).slice(0, 10); return d > tomorrow && d <= weekEnd; }).sort((a, b) => String(a.when).localeCompare(String(b.when))),
      noshow: A.filter((a) => a.outcome === "no_show" && String(a.when).slice(0, 10) >= ymd(now.getTime() - 14 * DAY)).sort((a, b) => String(b.when).localeCompare(String(a.when))),
      unlogged: A.filter((a) => !a.outcome && new Date(a.when).getTime() < now.getTime() - 2 * 3600000 && String(a.when).slice(0, 10) >= ymd(now.getTime() - 14 * DAY)).sort((a, b) => String(b.when).localeCompare(String(a.when))),
    };
    const queue = lists.tomorrow.filter((a) => !a.confirmed);
    const todayLeft = lists.today.filter((a) => !a.outcome && new Date(a.when).getTime() >= now.getTime());
    const rows = lists[tab] || [];
    const row = (a) => `
      <div class="row ap-row" data-id="${esc(a.id)}" data-rep="${esc(a.rep.user_id)}" style="padding:9px 0;cursor:pointer;align-items:center">
        <div class="row-main"><div class="row-title" style="font-size:0.96rem">${tab === "today" || tab === "tomorrow" ? hhmm(a.when) : esc(dayLabel(a.when, today)) + " " + hhmm(a.when)} · ${esc(a.customerName || "Appointment")}</div>
          <div class="row-sub">${esc(memberName(a.rep))}${a.type ? " · " + esc(a.type) : ""}${a.managerNote ? " · " + esc(a.managerNote) : ""}</div></div>
        <span class="badge ${a.outcome === "sold" ? "badge-sold" : a.outcome === "showed" ? "badge-appt" : a.outcome === "no_show" ? "badge-lost" : a.confirmed ? "badge-working" : "badge-new"}">${apptState(a)}</span>
      </div>`;
    el.innerHTML = `
      <div class="hero"><div class="hero-greeting">${esc(now.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" }))}</div><div class="hero-title">Appointments</div></div>
      ${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}
      <div class="row" style="margin:0 2px 8px"><span class="small muted">${board ? "As of " + esc(formatDateTime(board.at)) : loading ? "Reading…" : "Not read yet"}</span><button class="btn btn-ghost btn-sm" data-act="refresh" ${loading ? "disabled" : ""}>${loading ? "Reading…" : "Refresh"}</button></div>
      <div class="stat-grid" style="margin-bottom:12px">
        <div class="stat"><div class="stat-value" style="color:var(--brand)">${lists.today.length}</div><div class="stat-label">Today · ${todayLeft.length} still to come</div></div>
        <div class="stat"><div class="stat-value" style="${queue.length ? "color:var(--danger)" : "color:var(--success)"}">${queue.length}</div><div class="stat-label">Tomorrow's not yet confirmed</div></div>
        <div class="stat"><div class="stat-value">${lists.week.length + lists.tomorrow.length}</div><div class="stat-label">Set for the next 7 days</div></div>
        <div class="stat"><div class="stat-value" style="${lists.noshow.length ? "color:var(--warning)" : ""}">${lists.noshow.length}</div><div class="stat-label">No-shows to rebook · 14 days</div></div>
      </div>
      ${queue.length ? `<div class="card ap-queue" style="margin-bottom:14px;border-left:4px solid var(--danger)">
        <div class="strong">Confirm tomorrow: ${queue.length} appointment${queue.length === 1 ? "" : "s"} unconfirmed.</div>
        <div class="small muted" style="margin-top:4px">Confirmed appointments show far more often. One tap nudges each rep's phone with the list.</div>
        <div class="btn-row" style="margin-top:8px"><button class="btn btn-primary btn-sm btn-block" data-act="nudge-queue">${icon("bell")} Nudge the reps to confirm</button></div>
      </div>` : ""}
      ${lists.unlogged.length ? `<div class="card" style="margin-bottom:14px"><div class="strong small">${lists.unlogged.length} past appointment${lists.unlogged.length === 1 ? "" : "s"} with no outcome logged.</div><div class="small muted" style="margin-top:2px">Showed, no-show or sold — the show rate is only as true as this. <a href="#" data-act="tab-unlogged" style="color:var(--brand)">Log them</a>.</div></div>` : ""}
      <div class="lead-chips" style="margin-bottom:10px">
        ${[["today", "Today", lists.today.length], ["tomorrow", "Tomorrow", lists.tomorrow.length], ["week", "This week", lists.week.length], ["noshow", "No-shows", lists.noshow.length], ["unlogged", "Unlogged", lists.unlogged.length]].map(([k, l, n]) => `<button class="btn btn-sm ${tab === k ? "btn-primary" : "btn-ghost"}" data-tab="${k}">${l} ${n}</button>`).join("")}
      </div>
      <div class="card">${rows.length ? rows.map(row).join("") : `<div class="muted small">${tab === "today" ? "Nothing on the store's calendar today." : tab === "noshow" ? "No no-shows in the last two weeks." : tab === "unlogged" ? "Every past appointment has an outcome." : "Nothing set."}</div>`}</div>
      <div class="hint" style="margin:0 2px">Tap an appointment to mark it confirmed, showed, no-show or sold, or to nudge the rep. Marks land in the rep's own calendar on their next sync.</div>
    `;
    const on2 = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on2('[data-act="refresh"]', () => refresh(true));
    on2('[data-act="tab-unlogged"]', (e) => { e.preventDefault(); tab = "unlogged"; draw(); });
    el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; draw(); }));
    el.querySelectorAll(".ap-row").forEach((r) => r.addEventListener("click", () => openAppt(r.dataset.rep, r.dataset.id)));
    on2('[data-act="nudge-queue"]', async () => {
      // One nudge per rep, naming their unconfirmed appointments.
      const byRep = new Map();
      queue.forEach((a) => { const k = a.rep.user_id; if (!byRep.has(k)) byRep.set(k, { rep: a.rep, list: [] }); byRep.get(k).list.push(a); });
      let sent = 0, failed = [];
      for (const { rep, list } of byRep.values()) {
        try { await nudgeRep(rep.user_id, { title: `Confirm tomorrow's ${list.length === 1 ? "appointment" : list.length + " appointments"}`, body: list.map((a) => `${hhmm(a.when)} ${a.customerName || ""}`).join(" · ").slice(0, 200), url: "./#/calendar", tag: "confirm" }); sent++; }
        catch (e) { failed.push(`${memberName(rep)}: ${e.message}`); }
      }
      toast(sent ? `Nudged ${sent} rep${sent === 1 ? "" : "s"}${failed.length ? " · " + failed.join(" · ") : ""}` : failed.join(" · ") || "Nobody to nudge", failed.length ? "warn" : "success");
    });
  }

  function openAppt(repId, id) {
    const a = all().find((x) => x.id === id && x.rep.user_id === repId);
    if (!a) return;
    const stat = board.stats.find((r) => r.member.user_id === repId);
    openModal(a.customerName || "Appointment", (close) => {
      const root = document.createElement("div");
      const mark = (outcome, label, cls) => `<button class="btn ${a.outcome === outcome ? "btn-primary" : cls || "btn-ghost"} btn-sm" data-o="${outcome}" style="flex:1">${label}</button>`;
      root.innerHTML = `
        <div class="card">
          <div class="kv"><span class="k">When</span><span class="v">${esc(dayLabel(a.when, ymd(Date.now())))} ${hhmm(a.when)}</span></div>
          <div class="kv"><span class="k">Rep</span><span class="v">${esc(memberName(a.rep))}</span></div>
          ${a.type ? `<div class="kv"><span class="k">Type</span><span class="v">${esc(a.type)}</span></div>` : ""}
          <div class="kv"><span class="k">Status</span><span class="v">${apptState(a)}</span></div>
          ${a.leadId ? `<div class="kv" data-act="customer" style="cursor:pointer"><span class="k">Customer</span><span class="v" style="color:var(--brand)">Open their page ›</span></div>` : ""}
        </div>
        <div class="section-title">Mark it</div>
        <div class="card">
          <label class="switch" style="margin-bottom:10px"><input type="checkbox" id="ap-confirmed" ${a.confirmed ? "checked" : ""}><span>Confirmed with the customer</span></label>
          <div class="btn-row">${mark("showed", "Showed")}${mark("no_show", "No-show")}${mark("sold", "Sold", "btn-ghost")}${a.outcome ? `<button class="btn btn-ghost btn-sm" data-o="" style="flex:0 0 auto">Clear</button>` : ""}</div>
          <div class="field" style="margin-top:10px;margin-bottom:0"><label>Manager note</label><input id="ap-note" value="${esc(a.managerNote || "")}" placeholder="Rebooked for Saturday, bring the trade…"></div>
          <div class="hint">Written into the rep's own record; they see it on their next sync.</div>
        </div>
        <div class="section-title">Nudge ${esc(memberName(a.rep))}</div>
        <div class="card">
          <div class="btn-row">
            <button class="btn btn-ghost btn-sm btn-block" data-n="confirm">${icon("bell")} Confirm this one</button>
            <button class="btn btn-ghost btn-sm btn-block" data-n="rebook">${icon("bell")} Rebook the no-show</button>
          </div>
          <div class="hint">A notification on their phone that opens their calendar.</div>
        </div>`;
      const save = async (patch) => {
        try { const data = await updateRepAppointment(a.rep.user_id, a.id, patch); Object.assign(a, data); if (stat) { const raw = stat.raw.appts.find((x) => x.id === a.id); if (raw) Object.assign(raw, data); } toast("Marked", "success"); draw(); }
        catch (e) { toast(e.message || "Couldn't mark it", "danger"); }
      };
      root.querySelector("#ap-confirmed").addEventListener("change", (e) => save({ confirmed: !!e.target.checked }));
      root.querySelectorAll("[data-o]").forEach((b) => b.addEventListener("click", async () => { await save({ outcome: b.dataset.o }); close(); }));
      root.querySelector("#ap-note").addEventListener("change", (e) => save({ managerNote: e.target.value.trim() }));
      const cust = root.querySelector('[data-act="customer"]'); if (cust) cust.addEventListener("click", () => openCustomerSheet(a.rep.user_id, a.leadId));
      root.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", async () => {
        const kind = b.dataset.n;
        try {
          await nudgeRep(a.rep.user_id, kind === "confirm"
            ? { title: "Confirm an appointment", body: `${a.customerName || "Your appointment"} · ${dayLabel(a.when, ymd(Date.now()))} ${hhmm(a.when)} — please confirm with them.`, url: "./#/calendar", tag: "confirm-" + a.id }
            : { title: "Rebook a no-show", body: `${a.customerName || "A customer"} didn't show ${dayLabel(a.when, ymd(Date.now())).toLowerCase()} — get them back on the calendar.`, url: a.leadId ? `./#/leads/${a.leadId}` : "./#/calendar", tag: "rebook-" + a.id });
          toast(`Nudged ${memberName(a.rep)}`, "success");
        } catch (e) { toast(e.message || "Couldn't nudge", "danger"); }
      }));
      return root;
    });
  }

  draw();
  refresh(false);
}
