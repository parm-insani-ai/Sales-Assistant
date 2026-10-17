// Advanced statistics — the event log read into the questions a store
// runs on. For a manager, every rep's log together; for a rep, their own.
// Each read shows its sample and says what it still needs, so nothing on
// the page is a guess from a handful. The agent sends the same sentences
// as a push each week (statsPass in the function).

import * as store from "../store.js";
import * as backend from "../backend.js";
import { esc } from "../utils.js";
import { cachedStore, myStore, isManager, memberName, loadBoard } from "../team.js";
import { allStats, insights, inWindow } from "../stats.js";
import { onPull } from "../pulltorefresh.js";

const DAYS_KEY = "viniva:stats-days";

export function renderStats(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  const manager = document.body.classList.contains("management");
  let days = 28; try { days = Number(sessionStorage.getItem(DAYS_KEY)) || 28; } catch { /* 28 */ }
  let team = cachedStore(), events = null, appts = [], names = {}, loading = false, error = "";

  async function load(force = false) {
    if (loading) return;
    loading = true; error = ""; draw();
    try {
      if (manager) {
        team = await myStore();
        if (!team || !isManager(team)) throw new Error("The store's statistics are the manager's.");
        const all = [];
        for (const m of team.members || []) {
          names[m.user_id] = String(memberName(m)).split(" ")[0];
          const rows = await backend.readRecords(m.user_id, "events", {}, { select: "data", limit: 50000 }).catch(() => []);
          rows.forEach((r) => { if (r.data) all.push({ ...r.data, rep: m.user_id }); });
        }
        events = all;
        try { const b = await loadBoard(team, { force }); appts = b.stats.filter((r) => !r.error && r.raw).flatMap((r) => r.raw.appts || []); } catch { appts = []; }
      } else {
        const me = (backend.currentUser() || {}).id || "me";
        events = store.all("events").map((e) => ({ ...e, rep: me }));
        appts = store.all("appointments");
        names[me] = store.getSettings().salesperson || "You";
      }
    } catch (e) { error = e && e.message ? e.message : "couldn't read the log"; events = events || []; }
    loading = false; draw();
  }

  const pc = (v) => (v == null ? "—" : `${v}%`);
  const need = (have, want) => `<div class="small muted">Needs ${want} to read; has ${have}.</div>`;
  const table = (heads, rows) => rows.length ? `<table class="st-table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c == null ? "—" : esc(String(c))}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "";
  const sec = (title, sub, body, cls = "") => `<div class="section-title">${esc(title)}${sub ? ` <span class="muted" style="font-weight:500;font-size:0.78rem">· ${esc(sub)}</span>` : ""}</div><div class="card st-sec ${cls}">${body}</div>`;

  function draw() {
    const chips = [7, 28, 90].map((d) => `<button class="btn btn-sm ${d === days ? "btn-primary" : "btn-ghost"}" data-days="${d}">${d} days</button>`).join("");
    const head = `<div class="hero"><div class="hero-title">Advanced statistics</div></div><div class="row" style="margin:4px 2px 10px;align-items:center"><div class="lead-chips" style="margin:0">${chips}</div><span class="small muted st-count">${events ? `${events.length.toLocaleString()} events` : loading ? "reading…" : ""}</span></div>${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}`;
    if (!events) { el.innerHTML = head + `<div class="card muted small">Reading the log…</div>`; wire(); return; }
    const now = Date.now();
    const ev = inWindow(events, { now, days });
    const s = allStats(ev, { appointments: appts, now });
    const lines = insights(s, { who: manager ? "manager" : "rep", names });
    const say = `<div class="card st-say">${lines.length ? lines.map((l) => `<div class="row st-line" data-key="${esc(l.key)}" style="padding:6px 0;align-items:flex-start;gap:10px"><span style="flex:none;color:var(--brand)">●</span><div>${esc(l.text)}</div></div>`).join("") : `<div class="muted small">Not enough in the log yet to say anything with confidence. Each read below says what it needs. ${ev.length ? `${ev.length} events in these ${days} days.` : ""}</div>`}</div>`;

    const sp = s.speed;
    const speed = sec("Speed to lead", sp.n ? `${sp.n} leads` : "", sp.n >= 8
      ? `<div><b>${sp.medianMin} min</b> at the median · <b>${sp.p75Min} min</b> at the 75th · <b>${pc(sp.within10Pct)}</b> inside ten minutes</div>
         ${manager && sp.byRep.length ? table(["Rep", "Leads", "Median min", "Inside 10"], sp.byRep.map((r) => [names[r.rep] || r.rep, r.n, r.medianMin, pc(r.within10Pct)])) : ""}
         ${sp.byHour.filter((h) => h.n >= 3).length ? table(["Arrived at", "Leads", "Median min"], sp.byHour.filter((h) => h.n >= 3).map((h) => [h.label, h.n, h.medianMin])) : ""}`
      : need(sp.n, "8 leads with a first contact"));

    const pu = s.pushes;
    const pushes = sec("Pushes", pu.received ? `${pu.received} received` : "", pu.received >= 10
      ? `<div><b>${pc(pu.openPct)}</b> opened${pu.medianOpenMin != null ? ` (${pu.medianOpenMin} min after landing)` : ""} · <b>${pc(pu.actPct)}</b> led to something done inside half an hour</div>
         ${table(["Push", "Received", "Opened", "Acted"], pu.byTag.map((r) => [r.tag, r.received, r.opened, r.acted]))}`
      : need(pu.received, "10 pushes"));

    const st = s.steps;
    const steps = sec("Which follow-up step books", st.n ? `${st.n} texts` : "", st.steps.length
      ? `${st.best && st.worst && st.best.step !== st.worst.step ? `<div>"<b>${esc(st.best.step)}</b>" books ${pc(st.best.bookPct)}; "${esc(st.worst.step)}" ${pc(st.worst.bookPct)}.</div>` : need(st.steps.reduce((a, r) => Math.max(a, r.n), 0), "8 texts of a step")}
         ${table(["Step", "Sent", "Replied", "Booked in a day"], st.steps.map((r) => [r.step, r.n, pc(r.replyPct), pc(r.bookPct)]))}`
      : need(0, "texts with a step on them"));

    const w = s.welcome;
    const welcome = sec("Welcome timing", w.n ? `${w.n} welcomes` : "", w.n
      ? table(["Sent", "Welcomes", "Replied in a day", "Booked in two"], w.buckets.filter((b) => b.n).map((b) => [b.label, b.n, b.n >= 6 ? pc(b.replyPct) : "needs 6", b.n >= 6 ? pc(b.bookPct) : "needs 6"]))
      : need(0, "welcome texts"));

    const c = s.confirm;
    const confirm = sec("Confirmations and showing", c.n ? `${c.n} with an outcome` : "", c.confirmed.n >= 6 && c.unconfirmed.n >= 6
      ? `<div>Confirmed show <b>${pc(c.confirmed.showPct)}</b> (${c.confirmed.n}); unconfirmed <b>${pc(c.unconfirmed.showPct)}</b> (${c.unconfirmed.n}).</div>`
      : `<div>Confirmed ${c.confirmed.n}, unconfirmed ${c.unconfirmed.n}.</div>${need(Math.min(c.confirmed.n, c.unconfirmed.n), "6 of each")}`);

    const tp = s.taps;
    const taps = manager ? sec("Your taps", tp.n ? `${tp.n} in ${days} days` : "", tp.n >= 6
      ? `<div><b>${pc(tp.pct)}</b> had an appointment set within a day.</div>${table(["Tap", "Count", "Booked in a day"], tp.kinds.map((r) => [r.label, r.n, pc(r.pct)]))}`
      : need(tp.n, "6 taps")) : "";

    const ag = s.agent;
    const agent = sec("The agent", "", `
      <div class="st-kv"><span>Confirmation texts</span><span>${ag.confirm.n >= 6 ? `${ag.confirm.n} · <b>${pc(ag.confirm.showedPct)}</b> showed` : `${ag.confirm.n} · needs 6`}</span></div>
      <div class="st-kv"><span>No-show texts</span><span>${ag.noshow.n >= 6 ? `${ag.noshow.n} · <b>${pc(ag.noshow.rebookedPct)}</b> rebooked in a week` : `${ag.noshow.n} · needs 6`}</span></div>
      <div class="st-kv"><span>Hand-outs</span><span>${ag.handed.n >= 8 ? `${ag.handed.n} · <b>${pc(ag.handed.workedPct)}</b> worked in two days · <b>${pc(ag.handed.bookedPct)}</b> booked in a week` : `${ag.handed.n} · needs 8`}</span></div>`);

    const wh = s.when;
    const hours = wh.hours.filter((h) => h.logged || h.set || h.showed);
    const when = sec("When things happen", wh.n ? `${wh.n} events` : "", wh.n >= 20
      ? `${table(["Hour", "Logged", "Set", "Showed"], hours.map((h) => [h.label, h.logged, h.set, h.showed]))}
         ${table(["Day", "Logged", "Set", "Showed"], wh.days.map((d) => [d.label, d.logged, d.set, d.showed]))}`
      : need(wh.n, "20 events"));

    const dc = s.discipline;
    const disc = sec("Discipline", "", `
      <div class="st-kv"><span>Past appointments with an outcome</span><span>${dc.pastN ? `<b style="${dc.outcomesPct < 80 ? "color:var(--danger)" : ""}">${pc(dc.outcomesPct)}</b> of ${dc.pastN}` : "—"}</span></div>
      <div class="st-kv"><span>Leads that got a first text or call</span><span>${dc.leadsN ? `<b style="${dc.touchedPct < 90 ? "color:var(--danger)" : ""}">${pc(dc.touchedPct)}</b> of ${dc.leadsN}` : "—"}</span></div>`);

    el.innerHTML = head + `<div class="section-title" style="margin-top:0">What the numbers say <span class="muted" style="font-weight:500;font-size:0.78rem">· last ${days} days</span></div>` + say + speed + pushes + steps + welcome + confirm + taps + agent + when + disc;
    wire();
  }
  function wire() {
    el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { days = Number(b.dataset.days); try { sessionStorage.setItem(DAYS_KEY, String(days)); } catch { /* fine */ } draw(); }));
  }

  draw();
  load(false);
  onPull(() => load(true));
}
