// Insights — what moves the appointment count, for the store or one rep.
//
// Everything on this screen answers "how do we set more appointments, and
// make them show": the funnel, what it takes to hit goal, speed to lead,
// which sources set, when they get set, what confirming and lead time do
// to the show rate, and the eight-week trend. A chip row switches between
// the store and each rep; the findings at the top are the sentences a
// manager can take into the morning meeting.

import { icon } from "../icons.js";
import { esc, formatDateTime } from "../utils.js";
import { cachedStore, myStore, isManager, memberName, cachedBoard, loadBoard, storeTotals } from "../team.js";
import { findings, DAYS, hourLabel } from "../insight.js";

const bar = (v, max, cls = "") => `<div class="ibar ${cls}"><span style="width:${max ? Math.round((v / max) * 100) : 0}%"></span></div>`;
const pc = (v) => (v == null ? "—" : v + "%");

export function renderInsights(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  let team = cachedStore();
  let board = cachedBoard();
  let who = "store";
  let loading = false, error = "";

  async function refresh(force = false) {
    if (loading) return;
    loading = true; draw();
    try { team = await myStore(); if (team && isManager(team)) board = await loadBoard(team, { force }); error = ""; }
    catch (e) { error = e && e.message ? e.message : "couldn't reach the store"; }
    loading = false; draw();
  }

  function draw() {
    const bar0 = document.getElementById("page-title"); if (bar0) bar0.textContent = "Insights";
    if (!team || !isManager(team)) {
      el.innerHTML = `<div class="hero"><div class="hero-greeting">Insights</div><div class="hero-title">${team ? "For managers" : "No store yet"}</div></div><div class="card muted small">${team ? "The store's numbers are the manager's. Your own are under Goals in the sales view." : "Set up the store under Team first."}</div>`;
      return;
    }
    const stats = board && board.storeId === team.id ? board.stats.filter((r) => !r.error && r.insight) : null;
    if (!stats) {
      el.innerHTML = `<div class="hero"><div class="hero-greeting">Insights</div><div class="hero-title">${esc(team.name)}</div></div><div class="card"><div class="muted small" style="text-align:center">${loading ? "Reading the reps' books…" : "Nothing read yet."}</div>${loading ? "" : `<button class="btn btn-primary btn-block" data-act="refresh" style="margin-top:10px">Read the board</button>`}</div>`;
      const b = el.querySelector('[data-act="refresh"]'); if (b) b.addEventListener("click", () => refresh(true));
      return;
    }
    const totals = storeTotals(stats);
    const rep = who === "store" ? null : stats.find((r) => r.member.user_id === who);
    const ins = rep ? rep.insight : totals.insight;
    const label = rep ? memberName(rep.member) : team.name;
    const fx = findings(ins);
    const f = ins.funnel, h = ins.history, n = ins.needs;
    const maxWeek = Math.max(1, ...ins.weekly.map((w) => Math.max(w.set, w.shown)));
    const maxT = Math.max(1, ...ins.weekly.map((w) => w.touches));
    const maxDay = Math.max(1, ...ins.times.day), maxHour = Math.max(1, ...ins.times.hour);
    const srcMax = Math.max(1, ...ins.sources.map((s) => s.appts));

    el.innerHTML = `
      <div class="hero"><div class="hero-greeting">Insights · appointments</div><div class="hero-title">${esc(label)}</div></div>
      ${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}
      <div class="lead-chips" style="margin-bottom:12px">
        <button class="btn btn-sm ${who === "store" ? "btn-primary" : "btn-ghost"}" data-who="store">Store</button>
        ${stats.map((r) => `<button class="btn btn-sm ${who === r.member.user_id ? "btn-primary" : "btn-ghost"}" data-who="${esc(r.member.user_id)}">${esc(memberName(r.member))}</button>`).join("")}
      </div>
      <div class="row" style="margin:0 2px 8px"><span class="small muted">As of ${esc(formatDateTime(board.at))} · last 8 weeks</span><button class="btn btn-ghost btn-sm" data-act="refresh" ${loading ? "disabled" : ""}>${loading ? "Reading…" : "Refresh"}</button></div>

      <div class="section-title">What the numbers say</div>
      <div class="card">${fx.length ? fx.map((x) => `<div class="row" style="padding:6px 0;align-items:flex-start;gap:10px"><span style="flex:none;color:var(--brand)">${icon("sparkles")}</span><div class="small">${esc(x.text)}</div></div>`).join("") : `<div class="muted small">Not enough history yet to say. The findings write themselves as appointments and leads build up — usually after a couple of weeks of use.</div>`}</div>

      <div class="section-title">What it takes <span class="muted" style="font-weight:500;font-size:0.78rem">· ${esc(label)} · this month</span></div>
      <div class="card">
        ${n.goal ? `
        <div class="stat-grid" style="margin-bottom:10px">
          <div class="stat"><div class="stat-value" style="${n.onTrack ? "color:var(--success)" : "color:var(--danger)"}">${n.apptsNeeded}</div><div class="stat-label">more appointments to set</div></div>
          <div class="stat"><div class="stat-value">${n.perDay}</div><div class="stat-label">a day · ${n.daysLeft} day${n.daysLeft === 1 ? "" : "s"} left</div></div>
        </div>
        <div class="kv"><span class="k">Goal</span><span class="v">${n.goal} units · ${n.sold} sold · ${n.futureSet} on the calendar (~${n.pipeline} units)</span></div>
        <div class="kv"><span class="k">Per appointment set</span><span class="v">${n.perAppt} units <span class="muted small">(${n.showRate}% show × ${n.closeRate}% close${n.assumed ? ", typical" : ", own history"})</span></span></div>
        <div class="kv"><span class="k">Touches per appointment</span><span class="v">${ins.touchesPerAppt != null ? ins.touchesPerAppt : "—"}${ins.touchesPerDay ? ` <span class="muted small">→ ~${ins.touchesPerDay} touches a day</span>` : ""}</span></div>
        ${n.assumed ? `<div class="hint">Planned on typical rates (${n.showRate}% show, ${n.closeRate}% close) until there are ${8} past appointments to read a real rate from.</div>` : ""}` : `<div class="muted small">No unit goal set${rep ? " for " + esc(label) : ""}. Goals live in each rep's Settings.</div>`}
      </div>

      ${!rep ? `
      <div class="section-title">By rep</div>
      <div class="card" style="padding:6px 0">
        <div class="irow ihead"><span>Rep</span><span>Set</span><span>Show</span><span>Need</span><span>/day</span><span>Touch/day</span></div>
        ${stats.slice().sort((a, b) => b.insight.setThisMonth - a.insight.setThisMonth).map((r) => { const i = r.insight; return `<div class="irow" data-who="${esc(r.member.user_id)}" style="cursor:pointer"><span class="strong">${esc(memberName(r.member))}</span><span>${i.setThisMonth}</span><span>${pc(i.history.showRate)}</span><span style="${i.needs.onTrack ? "color:var(--success)" : "color:var(--danger)"}">${i.needs.goal ? i.needs.apptsNeeded : "—"}</span><span>${i.needs.goal ? i.needs.perDay : "—"}</span><span>${i.touchesPerDay || "—"}</span></div>`; }).join("")}
        <div class="hint" style="padding:0 16px">Set this month · show rate over 8 weeks · appointments still needed to hit goal · per day · touches a day at their ratio. Tap a rep.</div>
      </div>` : ""}

      <div class="section-title">The funnel <span class="muted" style="font-weight:500;font-size:0.78rem">· this month</span></div>
      <div class="stat-grid" style="margin-bottom:6px">
        <div class="stat"><div class="stat-value" style="color:var(--brand)">${f.set}</div><div class="stat-label">Set${f.upcoming ? ` · ${f.upcoming} upcoming` : ""}</div></div>
        <div class="stat"><div class="stat-value">${f.confirmed}</div><div class="stat-label">Confirmed</div></div>
        <div class="stat"><div class="stat-value">${f.shown}</div><div class="stat-label">Shown · ${pc(f.showRate)} of ${f.past} past</div></div>
        <div class="stat"><div class="stat-value" style="color:var(--success)">${f.sold}</div><div class="stat-label">Sold · ${pc(f.closeRate)} of shown</div></div>
      </div>
      <div class="card small muted" style="margin-bottom:14px">Over 8 weeks: ${h.set} set, ${pc(h.showRate)} show, ${pc(h.closeRate)} close, ${pc(h.setToSold)} of appointments end in a sale${f.noShow ? ` · ${f.noShow} no-show${f.noShow === 1 ? "" : "s"} this month` : ""}.</div>

      <div class="section-title">Speed to lead <span class="muted" style="font-weight:500;font-size:0.78rem">· leads from the last 90 days${ins.speed.medianMinutes != null ? ` · median ${fmtMin(ins.speed.medianMinutes)} to first touch` : ""}</span></div>
      <div class="card">
        ${ins.speed.buckets.map((b) => `<div class="irow2"><span>${esc(b.label)}</span><span class="muted small">${b.leads} lead${b.leads === 1 ? "" : "s"}</span>${bar(b.setRate || 0, 100)}<span class="mono strong">${pc(b.setRate)}</span></div>`).join("")}
        <div class="hint">Share of leads that got an appointment, by how long their first touch took. First touch is stamped from now on; older leads read from their last contact.</div>
      </div>

      <div class="section-title">By source</div>
      <div class="card">
        ${ins.sources.length ? ins.sources.slice(0, 8).map((s) => `<div class="irow2"><span>${esc(s.source)}</span><span class="muted small">${s.leads} · ${s.appts} appt${s.appts === 1 ? "" : "s"}</span>${bar(s.appts, srcMax)}<span class="mono strong">${pc(s.setRate)}</span></div>`).join("") : `<div class="muted small">No leads with a source in the last 90 days.</div>`}
        <div class="hint">Leads · appointments they produced · set rate. The source comes from each lead's Source field.</div>
      </div>

      <div class="section-title">When appointments get set</div>
      <div class="card">
        <div class="ibars">${ins.times.day.map((v, i) => `<div class="ibarv" title="${DAYS[i]}: ${v}"><span style="height:${Math.round((v / maxDay) * 100)}%"></span><b>${DAYS[i].slice(0, 2)}</b></div>`).join("")}</div>
        <div class="ibars" style="margin-top:10px">${ins.times.hour.map((v, i) => (i >= 7 && i <= 21 ? `<div class="ibarv" title="${hourLabel(i)}: ${v}"><span style="height:${Math.round((v / maxHour) * 100)}%"></span><b>${i % 3 === 0 ? (i > 12 ? i - 12 : i) : ""}</b></div>` : "")).join("")}</div>
        <div class="hint">${ins.times.bestDay != null ? `Most get set on ${DAYS[ins.times.bestDay]}s, around ${hourLabel(ins.times.bestHour)}. That's the hour to protect for calls.` : "Nothing set in the last 8 weeks."}</div>
      </div>

      <div class="section-title">What makes them show</div>
      <div class="card">
        <div class="irow2"><span>Confirmed</span><span class="muted small">${ins.confirm.confirmed.past} past</span>${bar(ins.confirm.confirmed.showRate || 0, 100, "good")}<span class="mono strong">${pc(ins.confirm.confirmed.showRate)}</span></div>
        <div class="irow2"><span>Not confirmed</span><span class="muted small">${ins.confirm.unconfirmed.past} past</span>${bar(ins.confirm.unconfirmed.showRate || 0, 100)}<span class="mono strong">${pc(ins.confirm.unconfirmed.showRate)}</span></div>
        <div style="height:8px"></div>
        ${ins.leadTime.map((b) => `<div class="irow2"><span>${esc(b.label)}</span><span class="muted small">${b.past} past</span>${bar(b.showRate || 0, 100)}<span class="mono strong">${pc(b.showRate)}</span></div>`).join("")}
        <div class="hint">Show rate by whether the appointment was confirmed, and by how far out it was booked.</div>
      </div>

      <div class="section-title">Eight weeks <span class="muted" style="font-weight:500;font-size:0.78rem">· set · shown · touches</span></div>
      <div class="card">
        <div class="ibars tall">${ins.weekly.map((w) => `<div class="ibarv" title="${w.weekStart}: ${w.set} set, ${w.shown} shown, ${w.touches} touches"><span class="s2" style="height:${Math.round((w.touches / maxT) * 100)}%"></span><span style="height:${Math.round((w.set / maxWeek) * 100)}%"></span><span class="s3" style="height:${Math.round((w.shown / maxWeek) * 100)}%"></span><b>${w.weekStart.slice(5)}</b></div>`).join("")}</div>
        <div class="hint">Green: set that week. Dark: shown that week. Grey: touches. Touches should lead sets by a week or so; if touches climb and sets don't, the conversations aren't asking for the appointment.</div>
      </div>
    `;
    el.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => { who = b.dataset.who; draw(); view.scrollTop = 0; }));
    const rb = el.querySelector('[data-act="refresh"]'); if (rb) rb.addEventListener("click", () => refresh(true));
  }

  draw();
  refresh(false);
}

function fmtMin(m) { return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; }
