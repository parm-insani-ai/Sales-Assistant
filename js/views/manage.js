// The store's app — four screens, each one thing.
//
//   Home   the store's numbers: units against goal and pace, appointments
//          set and shown, touches, customers logged, closing, untouched
//          leads, and what it takes to hit the month.
//   Floor  the day as it happens: every customer logged, appointment set and
//          car sold today, what the numbers say, fresh leads waiting, who to
//          reach out to, the huddle, who needs a word, today's appointments.
//   Reps   each rep with their stats and goals, tap for their day; and a
//          second chip of everyone logged this month across the store with
//          the follow-up plan and where it stands.
//   Admin  the store itself: members and roles, the invite link, the
//          account (js/views/team.js).
// Everything else — email, welcome, nudges, reach-outs, targets, invites,
// the appointment board, customers, timing, insights, settings — is under
// the "+".
//
// All three board screens read the same board: every rep's synced records,
// added up (js/team.js). Pull down to re-read; coming back to the app
// re-reads too.

import * as backend from "../backend.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { toast, openModal } from "../components.js";
import { esc, formatDateTime } from "../utils.js";
import { cachedStore, myStore, isAdmin, isManager, memberName, cachedBoard, loadBoard, restoreBoard, restoreBook, storeTotals, inviteLink, setViewMode, nudgeRep, syncedAgo, sendManagerText, sendWelcomeNow, heldDraft, LOOP_DAYS, loadConfig, cachedConfig } from "../team.js";
import { storePlan, paceRead, sourceKey } from "../opmodel.js";
import { looksLikeMoney } from "../replies.js";
import { openRepSheet, openCustomerSheet, apptState, openTargetSheet } from "./team.js";
import { findings, ASSUMED } from "../insight.js";
import { cachedBook, loadBook, addRepTask, cachedInventory, loadInventory } from "../team.js";
import { makeMatcher } from "../match.js";
import { rankBook, taskFor } from "../reach.js";
import * as store from "../store.js";
import { pullStoreMailIfStale } from "../msmail.js";
import { onPull } from "../pulltorefresh.js";

// ---- One board, three screens ----
// A screen gives paint (the HTML for what it knows) and wire (its own
// handlers); this reads the store and the board, draws, and re-reads on a
// pull or on coming back to the app. needBook: the screen also wants every
// rep's customers and the lot (the reach-out card).
function boardScreen(view, { needBook = false, paint, wire = null }) {
  const el = document.createElement("div");
  view.appendChild(el);
  const st = { team: cachedStore(), board: cachedBoard(), book: cachedBook(), lot: cachedInventory(), loading: false, error: "" };

  async function refresh(force = false) {
    if (st.loading) return;
    st.loading = true; draw();
    try {
      st.team = await myStore();
      if (st.team && isManager(st.team)) { try { await loadConfig(st.team); } catch { /* the plan shows defaults */ } st.board = await loadBoard(st.team, { force }); }
      st.error = "";
    } catch (e) { st.error = e && e.message ? e.message : "couldn't reach the store"; }
    st.loading = false; draw();
    if (needBook && st.team && isManager(st.team)) {
      try { [st.book, st.lot] = await Promise.all([loadBook(st.team, { force }), loadInventory(st.team, { force }).catch(() => st.lot)]); draw(); } catch { /* the card says so */ }
      try { pullStoreMailIfStale(st.team); } catch { /* next time */ }
    }
  }

  function draw() {
    if (!st.team) { drawNoStore(el); return; }
    const now = new Date();
    const manager = isManager(st.team);
    const stats = st.board && st.board.storeId === st.team.id ? st.board.stats : null;
    const t = stats ? storeTotals(stats) : null;
    // Ordered by appointments set this month: that's the number the store runs on.
    const rows = stats ? stats.slice().sort((a, b) => ((b.insight ? b.insight.setThisMonth : -1) - (a.insight ? a.insight.setThisMonth : -1)) || memberName(a.member).localeCompare(memberName(b.member))) : [];
    const ctx = { ...st, el, now, manager, stats, t, ins: t ? t.insight : null, rows, draw, refresh };
    el.innerHTML = paint(ctx);
    wireCommon(ctx);
    if (wire) wire(ctx);
  }

  // The last read, from the device, paints first; the re-read runs behind
  // it. Without one the page says it's reading until the first read lands.
  st.loading = true; draw();
  Promise.all([restoreBoard(), needBook ? restoreBook() : null]).then(([b, bk]) => {
    if (b && !st.board) st.board = b;
    if (bk) { if (bk.book && !st.book) st.book = bk.book; if (bk.lot && !st.lot) st.lot = bk.lot; }
  }).catch(() => {}).then(() => { st.loading = false; refresh(false); });
  onPull(() => refresh(true));
  const back = () => {
    if (!el.isConnected) { document.removeEventListener("visibilitychange", back); return; }
    if (document.visibilityState === "visible") refresh(false);
  };
  document.addEventListener("visibilitychange", back);
}

// The taps every board screen has: a customer opens read-only, a rep opens
// their day.
function wireCommon({ el, stats, team }) {
  el.querySelectorAll("[data-cust]").forEach((n) => n.addEventListener("click", () => openCustomerSheet(n.dataset.rep, n.dataset.cust)));
  el.querySelectorAll("[data-fcust]").forEach((n) => n.addEventListener("click", () => openCustomerSheet(n.dataset.frep, n.dataset.fcust)));
  el.querySelectorAll(".mg-rep[data-rep]").forEach((n) => n.addEventListener("click", (ev) => {
    if (ev.target.closest("button")) return;
    const r = stats && stats.find((x) => x.member.user_id === n.dataset.rep);
    const m = (team.members || []).find((x) => x.user_id === n.dataset.rep);
    if (!r || r.error || !r.touches) { toast("Pull down to read the board first", "warn"); return; }
    openRepSheet(r, m);
  }));
}

// The day as this phone sees it. toISOString() is UTC, and at nine in the
// evening in Halifax that is already tomorrow: appointments are stored as
// wall-clock times, so "today" has to be the local date or the evening's
// cards read as if the day were over.
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const asOf = ({ board, team, loading }) => `<div class="row" style="margin:4px 2px 10px"><span class="small muted">${esc(new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" }))} · ${board && board.storeId === team.id ? "As of " + esc(formatDateTime(board.at).replace(/^[^,]*, /, "")) + (loading ? " · reading…" : " · pull down to refresh") : loading ? "Reading the reps…" : "Not read yet"}</span></div>`;
const notRead = ({ loading }) => (loading ? `<div class="card"><div class="muted small" style="text-align:center">Reading the reps' books…</div></div>` : `<div class="card"><div class="muted small">Pull down to read the board.</div></div>`);
const repNotice = (team) => `<div class="card">You're on ${esc(team.name)}'s team as a rep. The board is the manager's; your own numbers are in the sales view.</div>`;
const errLine = (error) => (error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : "");
const setToday = (r, today) => (r.raw ? r.raw.appts.filter((a) => a.status !== "canceled" && String(a.createdAt || a.when).slice(0, 10) === today).length : 0);
const paceCls = (units, goal, p) => (!goal ? "" : units >= p ? "color:var(--success)" : units < p * 0.6 ? "color:var(--danger)" : "color:var(--warning)");

// ---- Home: the numbers ----
export function renderManageHome(view) {
  boardScreen(view, {
    paint: (c) => {
      const { team, now, manager, t, ins, rows, error } = c;
      const monthName = now.toLocaleDateString("en-CA", { month: "long" });
      const today = localDay(now);
      // The month's math: the targets at the store's ratios back to customers
      // and appointments, where each should be today against where it is,
      // ups by source needed against logged, and each rep's day.
      const plan = t ? storePlan((cachedConfig() || {}).plan || {}, { members: (team.members || []).filter((m) => m.role !== "manager" || rows.some((r) => r.member.user_id === m.user_id && !r.error && r.sheet && (r.sheet.spoke || (r.sales && r.sales.units)))), now }) : null;
      const planRead = plan ? paceRead(plan, { units: t.units, customers: t.loggedMonth, appts: ins.setThisMonth }) : [];
      const upsBySrc = t ? (t.logged || []).reduce((acc, l) => { const k = sourceKey(l.source); acc[k] = (acc[k] || 0) + 1; return acc; }, {}) : {};
      // Appointments set this month per source, from the same logged customers: the converter's number.
      const setBySrc = t ? (() => { const out = {}; rows.forEach((r) => { if (!r.raw) return; const byLead = new Map((r.logged || []).map((l) => [l.id, sourceKey(l.source)])); const seen = new Set(); r.raw.appts.forEach((a) => { if (a.status === "canceled" || !byLead.has(a.leadId) || seen.has(a.leadId)) return; seen.add(a.leadId); const k = byLead.get(a.leadId); out[k] = (out[k] || 0) + 1; }); }); return out; })() : {};
      const stateCls = (st) => (st === "ahead" ? "color:var(--success)" : st === "behind" ? "color:var(--danger)" : "color:var(--muted)");
      // Three bars, one read, the rest folded: where each number stands
      // against the month's pace, what it takes a day from here, and the
      // sources as a ranked list. The arithmetic is there for whoever wants it.
      const whole = (n) => Math.round(Number(n) || 0).toLocaleString();
      const paceRow = (x, target, sub = "") => {
        const have = Number(x.have) || 0, want = Number(x.want) || 0, tgt = Number(target) || 0;
        const pct = tgt ? Math.min(100, Math.round((have / tgt) * 100)) : 0, tick = tgt ? Math.min(100, Math.round((want / tgt) * 100)) : 0;
        const diff = Math.round(have - want);
        const read = diff >= 0 ? (diff > 0 ? `${diff} ahead` : "on pace") : `${Math.abs(diff)} behind pace`;
        return `<div class="mg-pace" data-k="${esc(x.label)}" data-have="${have}" data-want="${want}">
          <div class="row" style="align-items:baseline"><div class="row-main"><span class="mg-pace-label">${esc(x.label)}</span></div><span class="mg-pace-n"><b>${whole(have)}</b><span class="muted"> of ${whole(tgt)}</span></span></div>
          <div class="progress mg-pace-bar"><span style="width:${pct}%"></span><i class="mg-pace-tick" style="left:${tick}%" title="where it should be today"></i></div>
          <div class="small mg-pace-read" style="${x.state === "ahead" ? "color:var(--success)" : x.state === "behind" ? "color:var(--danger)" : "color:var(--muted)"}">${esc(read)}</div>${sub}
        </div>`;
      };
      // Under the appointments bar: the show rate the store is actually
      // getting against the one the plan assumes. Set, show, close is the
      // chain; this is the link the plan can't see from the count alone.
      const showLine = plan ? (() => {
        const h = ins.history || {}, past = h.past || 0, shown = h.shown || 0;
        const assumed = plan.appts.set ? Math.round((plan.appts.shows / plan.appts.set) * 100) : 0;
        const enough = past >= ASSUMED.minPast && h.showRate != null;
        const colour = !enough ? "color:var(--muted)" : h.showRate >= assumed ? "color:var(--success)" : h.showRate < assumed - 5 ? "color:var(--danger)" : "color:var(--muted)";
        const text = enough ? `Shown ${shown} of ${past} · ${h.showRate}% show rate, the plan assumes ${assumed}%` : `Shown ${shown} of ${past} · the plan assumes ${assumed}%${past ? ", too few yet to read the store's own" : ""}`;
        return `<div class="small mg-show" data-rate="${enough ? h.showRate : ""}" data-assumed="${assumed}" style="${colour}">${esc(text)}</div>`;
      })() : "";
      const left = plan ? Math.max(1, plan.days.left || 1) : 1;
      const need = plan ? { customers: Math.max(0, plan.customers.total - (t.loggedMonth || 0)), appts: Math.max(0, plan.appts.set - (ins.setThisMonth || 0)), units: Math.max(0, plan.targets.units - (t.units || 0)) } : null;
      const srcRows = plan ? plan.sources.map((sr) => { const have = upsBySrc[sr.key] || 0, want = Math.round(sr.upsNeeded * plan.pace.frac / 100), booked = setBySrc[sr.key] || 0; return { ...sr, have, want, booked }; }) : [];
      const mathCard = plan ? `<div class="card mg-math" style="margin-bottom:12px">
        <div class="mg-math-head"><div class="strong" style="font-size:1.1rem">${esc(monthName)} · ${plan.targets.units} units</div><div class="small muted">${plan.targets.new} new · ${plan.targets.used} used · selling day ${plan.days.gone} of ${plan.days.all} · the mark on each bar is where it should be today</div></div>
        <div class="mg-math-rows">${planRead.map((x, i) => paceRow(x, [plan.targets.units, plan.customers.total, plan.appts.set][i], i === 2 ? showLine : "")).join("")}</div>
        <div class="mg-math-need"><b>From here:</b> ${need.units} more units needs <b>${Math.ceil(need.customers / left)}</b> customers and <b>${Math.ceil(need.appts / left)}</b> appointments a day across the floor, ${left} selling day${left === 1 ? "" : "s"} left.</div>
        <details class="mg-math-src"><summary>Ups by source <span class="muted">· ${(t.logged || []).length} of ${Math.round(plan.upsNeeded * plan.pace.frac / 100)} by today, ${plan.upsNeeded} this month</span></summary>
          <div class="mg-src-list">${srcRows.map((sr) => `<div class="mg-src" data-src="${esc(sr.key)}">
            <span class="mg-src-name" title="${esc(sr.label)}">${esc(sr.label)}</span>
            <span class="mg-src-n" title="ups logged this month, against where the channel should be today" style="${sr.have >= sr.want ? "color:var(--success)" : "color:var(--danger)"}"><b>${sr.have}</b><span class="muted"> of ${sr.want}</span></span>
            <span class="small mg-src-set" title="appointments set this month from this channel, against its target${sr.apptsOwn ? " (yours)" : " (preset)"}" style="${sr.booked > 0 && sr.booked >= Math.round(sr.apptsTarget * plan.pace.frac / 100) ? "color:var(--success)" : "color:var(--muted)"}">${sr.booked} of ${sr.apptsTarget} booked${sr.apptsOwn ? "*" : ""}</span>
            <div class="progress mg-src-bar"><span style="width:${sr.upsNeeded ? Math.min(100, Math.round((sr.have / sr.upsNeeded) * 100)) : 0}%"></span><i class="mg-pace-tick" style="left:${sr.upsNeeded ? Math.min(100, Math.round((sr.want / sr.upsNeeded) * 100)) : 0}%"></i></div>
            <span class="small muted mg-src-close">closes ${sr.close}%</span>
          </div>`).join("")}</div>
          <div class="hint">Each bar is ups: the month's share at the year's mix, the tick where it should be today. Booked is appointments set this month from that channel against its target — the preset, or yours (*), under Admin → Store targets.</div>
        </details>
        <details class="mg-math-how"><summary>How it's worked out</summary>
          <div class="small muted" style="margin-top:6px">At ${plan.closing.store}% closing, ${plan.targets.units} units is ${plan.customers.total} customers spoken with (${plan.customers.perDay} a selling day). With ${plan.appts.unitsVia} units through an appointment at ${plan.closing.store ? "" : ""}${Math.round((plan.appts.unitsVia / Math.max(1, plan.appts.shows)) * 100)}% closing on a show and a ${Math.round((plan.appts.shows / Math.max(1, plan.appts.set)) * 100)}% show rate, that's ${plan.appts.set} appointments set (${plan.appts.perDay} a day) for ${plan.appts.shows} shows. ${plan.upsNeeded} ups at the year's mix.</div>
          ${plan.lever ? `<div class="small" style="margin-top:6px"><b>The lever:</b> an up that arrives as an appointment closes at ${plan.lever.apptClose}% against ${plan.lever.mixClose}% for the mix. Every internet up booked before it arrives is worth ${plan.lever.perUp} of a unit.</div>` : ""}
          <div class="hint">Targets, ratios and each rep's share are under Admin → Store targets.</div>
        </details>
      </div>` : "";
      // Today's plan: what each rep needs to set today, what they've set, and
      // the three things on their plate that produce appointments — fresh
      // leads, customers waiting, texts to send, appointments to confirm.
      const perRep = t ? rows.filter((r) => !r.error && r.insight).map((r) => {
        const n = r.insight.needs, set = setToday(r, today);
        const need = n.goal && !n.onTrack && n.apptsNeeded > 0 ? Math.max(1, Math.round(n.perDay)) : 0;
        const fresh = (r.leads ? r.leads.untouched.length : 0) + (r.raw ? r.raw.leads.filter((l) => l.stage === "new" && !l.importedAt && !l.firstContacted && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) <= 86400000 && now - new Date(l.createdAt) > 5 * 60000 && !(r.leads && r.leads.untouched.some((u) => u.id === l.id))).length : 0);
        const acts = [
          fresh ? [`${fresh} fresh lead${fresh === 1 ? "" : "s"}`, "/floor"] : null,
          r.waiting && r.waiting.length ? [`${r.waiting.length} waiting on a reply`, "/floor"] : null,
          r.textsDue && r.textsDue.length ? [`${r.textsDue.length} text${r.textsDue.length === 1 ? "" : "s"} to send`, "/floor"] : null,
          r.atRisk && r.atRisk.length ? [`${r.atRisk.length} to confirm`, "/floor"] : null,
        ].filter(Boolean);
        const pr = plan && plan.perRep.find((x) => x.member.user_id === r.member.user_id);
        return { r, set, need: pr && pr.day.appts ? Math.max(need, Math.ceil(pr.day.appts)) : need, acts, onTrack: !!(n.goal && n.onTrack), plan: pr };
      }) : [];
      const todayCard = t && ins ? `<div class="card mg-today mg-plan" style="margin-bottom:12px">
        <div class="row" style="align-items:baseline"><div class="row-main"><div class="strong" style="font-size:1.05rem">Today, by rep</div></div><span class="small muted">${ins.needs.goal ? (ins.needs.onTrack ? "on track" : `${ins.needs.apptsNeeded} more to set this month`) : plan ? "targets not written to phones yet" : "no targets set"}</span></div>
        ${!ins.needs.goal && plan ? `<div class="small muted" style="margin-top:2px">Each rep's share is set under Admin → Store targets; Write puts it on their phone.</div>` : ""}
        <div class="mg-today-reps" style="margin-top:8px">${perRep.map(({ r, set, need, acts, onTrack }) => `<div class="row mg-today-rep mg-rep" data-rep="${esc(r.member.user_id)}" style="padding:7px 0;border-top:1px solid var(--border);align-items:flex-start;cursor:pointer"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(memberName(r.member))} <span class="mg-need small" style="font-weight:600;${need ? (set >= need ? "color:var(--success)" : "color:var(--warning)") : "color:var(--muted)"}">${need ? `${set} of ${need} set today` : onTrack ? `on track · ${set} set today` : `${set} set today`}</span></div><div class="row-sub mg-today-acts">${acts.length ? acts.map(([txt]) => `<span class="mg-act">${esc(txt)}</span>`).join(" · ") : "nothing waiting on them"}</div>${plan ? `<div class="small muted mg-today-plan">${(() => { const pr = plan.perRep.find((x) => x.member.user_id === r.member.user_id); return pr ? `${pr.units} units this month · ${pr.day.customers} customers and ${pr.day.appts} appointments a day · ${r.loggedToday || 0} logged today` : ""; })()}</div>` : ""}</div><span class="muted">›</span></div>`).join("")}</div>
        <div class="hint" style="margin:8px 0 0">Tap a rep for their day. The work itself is on Floor.</div>
      </div>` : "";
      // What the manager's taps came to: appointments set within a day of a
      // nudge, a text, a hand-off, a welcome — the proof the board earns its place.
      const loop = t && t.loop;
      // The loop: a card once there's something to count, a line until then.
      const loopCard = loop ? (loop.all.tries ? `<div class="card mg-loop" style="margin-bottom:12px">
        <div class="row"><div class="row-main"><div class="strong">What your taps came to <span class="muted small" style="font-weight:500">· last ${LOOP_DAYS} days</span></div>
        <div class="small muted" style="margin-top:2px">${loop.all.set} of ${loop.all.tries} ${loop.all.tries === 1 ? "action" : "actions"} had an appointment set within a day${loop.all.rate != null ? ` (${loop.all.rate}%)` : ""}.</div></div></div>
        ${loop.byKind.length ? `<div class="small" style="margin-top:8px">${loop.byKind.map((k) => `<span class="mg-loop-kind"><b>${esc(k.label)}</b> ${k.set} of ${k.tries}</span>`).join(" · ")}</div>` : ""}
      </div>` : `<div class="small muted mg-loop mg-loop-empty" style="margin:0 2px 12px">Every nudge, text, hand-off and welcome you send from the board is counted here, with how many had an appointment set within a day.</div>`) : "";
      const notesLine = t ? (t.notes || []).filter((n) => n.rep.user_id !== (backend.currentUser() || {}).id).map((n) => `<div class="fab-note mg-note" style="text-align:left;color:var(--warning);margin:0 2px 10px"><b>${esc(memberName(n.rep))}:</b> ${esc(n.note)}</div>`).join("") : "";
      return `
      ${errLine(error)}
      ${!manager ? repNotice(team) : `
      ${asOf(c)}
      ${notesLine}
      ${mathCard}
      ${todayCard}
      ${loopCard}
      ${t ? `<div class="hint" style="margin:0 2px">The day as it happens is on Floor; each rep is under Reps; everything else is under the "+".</div>` : notRead(c)}`}`;
    },
  });
}

// ---- Floor: the day as it happens ----
export function renderFloor(view, { param } = {}) {
  let feedAll = false;
  // Opened from the agent's push ("Dana has waited 20 min — send this?"):
  // the sheet opens on the held draft, once.
  let deepLink = /^reply-(.+)$/.test(String(param || "")) ? String(param).slice(6) : "";
  const handed = new Set();
  const rankOpts = (lot) => { const s = store.getSettings(); return { defaultApr: s.defaultApr, dealMatchBand: s.dealMatchBand, match: lot && lot.rows.length ? makeMatcher(lot.rows, s) : null }; };
  const age = (iso, now) => { const m = Math.max(0, Math.round((now - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

  // Today on the floor: every customer logged, appointment set and car sold
  // across the store today, newest first, with who did it.
  function feedCard(t) {
    const feed = t.feed || [];
    const shown = feedAll ? feed : feed.slice(0, 8);
    const time = (iso) => { const s = String(iso || ""); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return ""; const d = new Date(s); return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
    const what = (e) => e.kind === "logged" ? `Logged <b>${esc(e.name || "a customer")}</b>`
      : e.kind === "appt" ? `Set an appointment with <b>${esc(e.name || "a customer")}</b>${e.when ? ` for ${esc(formatDateTime(e.when))}` : ""}`
      : `Sold <b>${esc(e.name || "a customer")}</b>${e.detail ? ` a ${esc(e.detail)}` : ""}`;
    const tag = { logged: "Logged", appt: "Appointment", sold: "Sold" };
    return `<div class="card mg-feed">${feed.length ? shown.map((e) => `<div class="row mg-event" data-kind="${e.kind}" ${e.leadId ? `data-fcust="${esc(e.leadId)}" data-frep="${esc(e.rep.user_id)}"` : ""} style="padding:7px 0;align-items:flex-start;${e.leadId ? "cursor:pointer" : ""}"><div class="row-main"><div class="row-title" style="font-size:0.93rem;font-weight:500">${what(e)}</div><div class="row-sub">${esc(memberName(e.rep))}${time(e.at) ? " · " + esc(time(e.at)) : ""}${e.kind === "logged" && e.detail ? " · " + esc(e.detail) : e.kind === "appt" && e.detail ? " · " + esc(e.detail) : ""}</div></div><span class="badge ${e.kind === "sold" ? "badge-sold" : e.kind === "appt" ? "badge-appt" : "badge-new"}" style="flex:none">${tag[e.kind]}</span></div>`).join("")
        + (feed.length > 8 ? `<button class="btn btn-ghost btn-sm btn-block" data-act="feed-all" style="margin-top:6px">${feedAll ? "Show less" : `Show all ${feed.length}`}</button>` : "")
        : `<div class="muted small">No customers logged, appointments set or cars sold yet today. It fills in as the reps' phones sync.</div>`}</div>`;
  }

  boardScreen(view, {
    needBook: true,
    paint: (c) => {
      const { team, now, manager, t, ins, rows, error, book, lot } = c;
      if (!manager) return repNotice(team);
      const me = store.getSettings().salesperson || memberName((team.members || []).find((m) => m.user_id === (backend.currentUser() || {}).id)) || "the sales manager";
      if (!t) return `${errLine(error)}${asOf(c)}${notRead(c)}`;
      const fx = findings(ins).filter((x) => x.kind !== "needs").slice(0, 3);
      const today = localDay(now);
      const tmrw = localDay(new Date(now.getTime() + 86400000));
      const first = (n) => String(n || "there").split(" ")[0];
      const firstName = (n) => String(n || "").trim().split(/\s+/)[0];
      const waitedFor = (iso) => { const m = Math.max(0, Math.round((now - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
      const whenWords = (w) => { const d = String(w).slice(0, 10), hm = String(w).slice(11, 16); return `${d === today ? "today" : d === tmrw ? "tomorrow" : esc(formatDateTime(w).split(",")[0])} ${esc(hm)}`; };
      const clock = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const myId = (backend.currentUser() || {}).id;
      const deal = (r) => r.read.deal ? `<div class="small" style="margin-top:2px">${esc(r.read.deal.name)} ≈ <b>$${Math.round(r.read.deal.monthly).toLocaleString("en-CA")}/mo</b>${r.read.deal.delta != null ? ` <span style="${r.read.deal.delta <= 0 ? "color:var(--success)" : ""}" class="${r.read.deal.delta <= 0 ? "" : "muted"}">(${r.read.deal.delta <= 0 ? "−" : "+"}$${Math.abs(Math.round(r.read.deal.delta)).toLocaleString("en-CA")}/mo)</span>` : ""}</div>` : "";

      // Act now: everything on the floor that costs business by the hour, in
      // one list, the costliest first, each row with its one action. A fresh
      // lead nobody has touched (the clock runs on screen), a customer
      // waiting on a reply, texts written on a rep's phone and not sent, an
      // appointment in the next day that isn't confirmed, a no-show nobody
      // has rebooked, a customer logged today with no welcome, a customer of
      // ours in the service drive, and on the review day the unsold ups gone
      // quiet. Texts in their hold ride at the end, so a customer just logged
      // is on the Floor the moment the rep's phone syncs.

      // 1. Fresh leads: every untouched new lead in the store with the clock
      //    on it, the ones that have waited longest first.
      const waiting = rows.flatMap((r) => (r.leads ? r.leads.untouched.map((l) => ({ l, r })) : [])).concat(
        rows.flatMap((r) => (r.raw ? r.raw.leads.filter((l) => l.stage === "new" && !l.importedAt && !l.firstContacted && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) <= 86400000 && now - new Date(l.createdAt) > 5 * 60000).map((l) => ({ l, r })) : []))
      ).filter((x, i, arr) => arr.findIndex((y) => y.l.id === x.l.id && y.r.member.user_id === x.r.member.user_id) === i)
       .sort((a, b) => String(a.l.createdAt).localeCompare(String(b.l.createdAt))).slice(0, 12);
      const freshRows = waiting.map(({ l, r }) => `<div class="row mg-fresh-row mg-k-fresh" style="padding:7px 0;align-items:center"><div class="row-main" data-cust="${esc(l.id)}" data-rep="${esc(r.member.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")} <span class="small mg-clock" data-at="${esc(l.createdAt)}" style="color:${now - new Date(l.createdAt) > 3600000 ? "var(--danger)" : "var(--warning)"};font-weight:600">${age(l.createdAt, now)}</span></div><div class="row-sub">fresh lead · ${esc(memberName(r.member))}${l.source ? " · " + esc(l.source) : ""}</div></div><button class="btn btn-ghost btn-sm" data-nudge="${esc(r.member.user_id)}" data-lead="${esc(l.id)}" data-name="${esc(l.name || "A lead")}" data-age="${age(l.createdAt, now)}">${icon("bell")} Nudge</button></div>`).join("");

      // 2. Customers waiting on a reply, longest first.
      const unanswered = t.waiting || [];
      const waitRows = unanswered.slice(0, 10).map((w) => `<div class="row mg-wait mg-k-wait" style="padding:8px 0;align-items:center;gap:8px"><div class="row-main" ${w.leadId ? `data-fcust="${esc(w.leadId)}" data-frep="${esc(w.rep.user_id)}" style="cursor:pointer"` : ""}><div class="row-title" style="font-size:0.95rem">${esc(w.name || "A customer")} <span class="small" style="color:var(--danger);font-weight:600">${waitedFor(w.at)}</span></div><div class="row-sub">${esc(memberName(w.rep))} · ${w.channel === "email" ? "emailed" : "texted"}: “${esc(w.preview)}”</div></div><button class="btn btn-ghost btn-sm" data-wnudge="${esc(w.rep.user_id)}" data-lead="${esc(w.leadId)}" data-name="${esc(w.name || "A customer")}" data-age="${waitedFor(w.at)}">${icon("bell")}</button>${w.channel === "text" && w.leadId ? `<button class="btn btn-primary btn-sm" data-mreply="${esc(w.leadId)}" data-rep="${esc(w.rep.user_id)}" data-name="${esc(w.name || "")}" ${heldDraft(w.leadId) ? `data-draft="${esc(heldDraft(w.leadId).body)}"` : ""}>${heldDraft(w.leadId) ? "Send draft" : "Reply"}</button>` : w.leadId ? `<button class="btn btn-primary btn-sm" data-fcust="${esc(w.leadId)}" data-frep="${esc(w.rep.user_id)}">Open</button>` : ""}</div>`).join("") + (unanswered.length > 10 ? `<div class="hint">and ${unanswered.length - 10} more waiting.</div>` : "");

      // 3. Texts drafted on a rep's phone and not sent — the welcome, a
      //    follow-up due — by rep; and texts still in their hold.
      const due = t.textsDue || [];
      const dueCount = due.reduce((a, d) => a + d.texts.length, 0);
      const dueRows = due.map((d) => `<div class="mg-due-rep mg-k-due" data-rep="${esc(d.rep.user_id)}" style="padding:7px 0"><div class="row" style="align-items:center;gap:8px"><div class="row-main mg-rep" data-rep="${esc(d.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(memberName(d.rep))} <span class="small" style="color:var(--warning);font-weight:600">${d.texts.length} text${d.texts.length === 1 ? "" : "s"} ready</span></div><div class="row-sub">oldest waiting ${waitedFor(d.oldest)} · ${d.texts.slice(0, 3).map((x) => `${esc(firstName(x.name) || "a customer")}${x.intent === "intro" ? " (welcome)" : ""}`).join(", ")}${d.texts.length > 3 ? ` and ${d.texts.length - 3} more` : ""}</div></div><button class="btn btn-ghost btn-sm" data-dnudge="${esc(d.rep.user_id)}" data-n="${d.texts.length}" data-age="${waitedFor(d.oldest)}">${icon("bell")} Nudge</button></div>${d.texts.filter((x) => !x.hasPhone).length ? `<div class="small muted" style="margin-top:2px">${d.texts.filter((x) => !x.hasPhone).length} can't send — no phone number on file.</div>` : ""}</div>`).join("");
      const held = t.textsHeld || [];
      const heldCount = held.reduce((a, d) => a + d.texts.length, 0);
      const heldRows = held.map((d) => `<div class="mg-held-rep mg-k-held" data-rep="${esc(d.rep.user_id)}" style="padding:7px 0"><div class="row" style="align-items:center;gap:8px"><div class="row-main mg-rep" data-rep="${esc(d.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(memberName(d.rep))} <span class="small muted" style="font-weight:600">${d.texts.length} text${d.texts.length === 1 ? "" : "s"} held</span></div><div class="row-sub">sends ${esc(clock(d.next))} · ${d.texts.slice(0, 3).map((x) => `${esc(firstName(x.name) || "a customer")}${x.intent === "intro" ? " (welcome)" : ""}`).join(", ")}${d.texts.length > 3 ? ` and ${d.texts.length - 3} more` : ""}</div></div></div></div>`).join("");
      // What the board read from each phone — so "the rep's phone shows a
      // text and the Floor doesn't" is answered on the page. Folded, and only
      // when no text is drafted or held. A phone that never synced, or a rep
      // in a store this account doesn't manage, reads as never synced.
      const found = (r) => {
        if (r.error) return `<span style="color:var(--danger)">${esc(r.error)}</span>`;
        const sy = syncedAgo(r.lastWrite, now.getTime()), p = r.planTexts || { onFile: 0, steps: 0, customers: 0, next: null, lapsed: 0 };
        const bits = [sy.text, `${p.customers || 0} customer${p.customers === 1 ? "" : "s"} on file`];
        if (!p.steps && !r.lastWrite) bits.push("nothing on file — their phone hasn't synced, or you don't manage their store");
        else if (!p.onFile) bits.push(p.steps ? "no texts planned" : "no plan steps on file — their phone hasn't pushed them");
        else bits.push(`${p.onFile} planned${p.next ? `, next ready ${clock(p.next)}` : ""}${p.lapsed ? `, ${p.lapsed} lapsed (ready more than a day ago)` : ""}`);
        return esc(bits.join(" · "));
      };
      const foundLines = rows.filter((r) => r.member.user_id !== myId || (r.planTexts && r.planTexts.onFile)).map((r) => `<div class="small mg-due-found" data-rep="${esc(r.member.user_id)}" style="padding:3px 0"><b>${esc(memberName(r.member))}</b> · ${found(r)}</div>`).join("");
      const foundFold = !dueCount && !heldCount && foundLines ? `<details class="mg-fold mg-found"><summary class="small muted">What the board read from each rep's phone</summary>${foundLines}</details>` : "";

      // 4. Appointments at risk: unconfirmed inside 24 hours, and no-shows nobody has rebooked.
      const risk = t.atRisk || [], noShows = t.noShows || [];
      const riskRows = risk.map((a) => `<div class="row mg-risk-row mg-k-risk" data-kind="unconfirmed" style="padding:8px 0;align-items:center;gap:8px"><div class="row-main" ${a.leadId ? `data-fcust="${esc(a.leadId)}" data-frep="${esc(a.rep.user_id)}" style="cursor:pointer"` : ""}><div class="row-title" style="font-size:0.95rem">${esc(a.customerName || "Appointment")} <span class="small muted">${whenWords(a.when)}</span></div><div class="row-sub">${esc(memberName(a.rep))}${a.type ? " · " + esc(a.type) : ""} · not confirmed</div></div><button class="btn btn-ghost btn-sm" data-anudge="${esc(a.rep.user_id)}" data-lead="${esc(a.leadId || "")}" data-title="${esc((a.customerName || "An appointment") + " at " + String(a.when).slice(11, 16) + " isn't confirmed")}" data-body="A confirmation now is the difference between a show and a no-show.">${icon("bell")}</button>${a.leadId ? `<button class="btn btn-primary btn-sm" data-mtext="${esc(a.leadId)}" data-rep="${esc(a.rep.user_id)}" data-name="${esc(a.customerName || "")}" data-draft="${esc(`Hi ${first(a.customerName)}, it's ${me} at ${team.name}. Just confirming your ${a.type || "appointment"} ${whenWords(a.when).replace(/<[^>]+>/g, "")} with ${first(memberName(a.rep))} — reply YES to confirm, or let me know if another time works better.`)}">Text</button>` : ""}</div>`).join("")
        + noShows.map((a) => `<div class="row mg-risk-row mg-k-risk" data-kind="noshow" style="padding:8px 0;align-items:center;gap:8px"><div class="row-main" ${a.leadId ? `data-fcust="${esc(a.leadId)}" data-frep="${esc(a.rep.user_id)}" style="cursor:pointer"` : ""}><div class="row-title" style="font-size:0.95rem">${esc(a.customerName || "Appointment")} <span class="small" style="color:var(--warning);font-weight:600">no-show</span></div><div class="row-sub">${esc(memberName(a.rep))} · ${esc(formatDateTime(a.when))} · not rebooked</div></div><button class="btn btn-ghost btn-sm" data-anudge="${esc(a.rep.user_id)}" data-lead="${esc(a.leadId || "")}" data-title="${esc("Rebook " + (a.customerName || "the no-show"))}" data-body="${esc("They no-showed " + formatDateTime(a.when) + " — a call today gets them back on the calendar.")}">${icon("bell")}</button>${a.leadId ? `<button class="btn btn-primary btn-sm" data-mtext="${esc(a.leadId)}" data-rep="${esc(a.rep.user_id)}" data-name="${esc(a.customerName || "")}" data-draft="${esc(`Hi ${first(a.customerName)}, it's ${me} at ${team.name}. Sorry we missed you — ${first(memberName(a.rep))} would love to get you in. What day works this week?`)}">Text</button>` : ""}</div>`).join("");

      // 5. Logged today with no text yet.
      const wl = t.welcomes || { logged: 0, welcomed: 0, pending: [] };
      const welcomeRows = wl.pending.map((l) => `<div class="row mg-welcome-row mg-k-welcome" style="padding:7px 0;align-items:center;gap:8px"><div class="row-main" data-fcust="${esc(l.id)}" data-frep="${esc(l.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")}</div><div class="row-sub">${esc(memberName(l.rep))}${l.vehicleInterest ? " · " + esc(l.vehicleInterest) : ""} · logged today, no text yet</div></div>${l.optOut ? `<span class="small muted">opted out</span>` : l.phone || l.email ? `<button class="btn btn-primary btn-sm" data-welcome="${esc(l.id)}" data-rep="${esc(l.rep.user_id)}" data-name="${esc(l.name || "")}">Welcome now</button>` : `<span class="small muted">no number</span>`}</div>`).join("");

      // 6. The service drive: customers on the books booked into service today or tomorrow, with the app's read.
      const svc = book ? rankBook(book.rows, rankOpts(lot)).rows.filter((r) => { const d = String(r.lead.serviceAppt || "").slice(0, 10); return d === today || d === tmrw; }).sort((a, b) => String(a.lead.serviceAppt).localeCompare(String(b.lead.serviceAppt)) || b.read.score - a.read.score) : null;
      const svcRows = svc ? svc.slice(0, 10).map((r) => `<div class="row mg-svc-row mg-k-svc" style="padding:8px 0;align-items:center"><div class="row-main" data-cust="${esc(r.lead.id)}" data-rep="${esc(r.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(r.lead.name || "Customer")}${r.tier ? ` <span class="badge ${r.tier.badge}" style="margin-left:4px">${r.tier.label}</span>` : ""} <span class="small muted">in service ${String(r.lead.serviceAppt).slice(0, 10) === today ? "today" : "tomorrow"}${/T\d\d:\d\d/.test(String(r.lead.serviceAppt)) ? " " + esc(String(r.lead.serviceAppt).slice(11, 16)) : ""}</span></div><div class="row-sub">${esc(r.lead.vehicleInterest || "")} · ${esc(memberName(r.rep))}</div><div class="row-reasons">${r.read.reasons.slice(0, 3).map(esc).join(" · ")}</div>${deal(r)}</div><button class="btn ${handed.has(r.lead.id) ? "btn-ghost" : "btn-primary"} btn-sm" data-hand="${esc(r.lead.id)}" data-hrep="${esc(r.rep.user_id)}" style="flex:0 0 auto;margin-left:8px" ${handed.has(r.lead.id) ? "disabled" : ""}>${handed.has(r.lead.id) ? "Sent" : "Send"}</button></div>`).join("") : "";

      // 7. The be-backs, on the review day: unsold ups still in play, nothing
      //    booked, quiet two days or more. Repeat customers close at 74%.
      const reviewDow = Number(((cachedConfig() || {}).plan || {}).reviewDow ?? 1);
      const bb = now.getDay() === reviewDow ? (t.bebacks || []) : [];
      const bbRows = bb.slice(0, 10).map((l) => `<div class="row mg-beback mg-k-beback" style="padding:7px 0;align-items:center;gap:8px"><div class="row-main" data-fcust="${esc(l.id)}" data-frep="${esc(l.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")} <span class="small" style="color:var(--warning);font-weight:600">quiet ${l.quiet} d</span></div><div class="row-sub">${esc(memberName(l.rep))} · ${esc(l.stage || "new")}${l.vehicleInterest ? " · " + esc(l.vehicleInterest) : ""} · in ${l.days} d ago${l.plan && l.plan.of ? ` · plan ${l.plan.done} of ${l.plan.of}` : " · no plan"}</div></div><button class="btn btn-ghost btn-sm" data-bnudge="${esc(l.rep.user_id)}" data-lead="${esc(l.id)}" data-name="${esc(l.name || "A customer")}" data-quiet="${l.quiet}">${icon("bell")}</button>${l.phone ? `<button class="btn btn-primary btn-sm" data-mtext="${esc(l.id)}" data-rep="${esc(l.rep.user_id)}" data-name="${esc(l.name || "")}" data-draft="${esc(`Hi ${first(l.name)}, it's ${me} at ${team.name}. ${first(memberName(l.rep))} mentioned you were in${l.vehicleInterest ? ` about the ${l.vehicleInterest}` : ""} — is it still on your mind? Happy to have it ready for a look this week, just say when.`)}">Text</button>` : ""}</div>`).join("") + (bb.length > 10 ? `<div class="hint">and ${bb.length - 10} more quiet.</div>` : "");

      const count = waiting.length + Math.min(unanswered.length, 10) + due.length + risk.length + noShows.length + wl.pending.length + (svc ? Math.min(svc.length, 10) : 0) + Math.min(bb.length, 10);
      const sub = [count ? `${count} · costliest first` : "nothing waiting on you", heldCount ? `${heldCount} held` : "", !book ? "reading…" : ""].filter(Boolean).join(" · ");
      const nowCard = `<div class="section-title" style="margin-top:0">Act now <span class="muted" style="font-weight:500;font-size:0.78rem">· ${sub}</span></div>
        <div class="card mg-now">${count ? freshRows + waitRows + dueRows + riskRows + welcomeRows + svcRows + bbRows : `<div class="muted small mg-now-empty">Every lead touched, every customer answered, every text sent, the next day confirmed. What you send from here is counted on Home.</div>`}${heldRows}${foundFold}</div>`;
      const notesLine = (t.notes || []).filter((n) => n.rep.user_id !== myId).map((n) => `<div class="fab-note mg-note" style="text-align:left;color:var(--warning);margin:0 2px 10px"><b>${esc(memberName(n.rep))}:</b> ${esc(n.note)}</div>`).join("");
      const feed = t.feed || [];
      return `
      ${errLine(error)}
      ${asOf(c)}
      ${notesLine}
      ${nowCard}

      <div class="section-title">Today's appointments <span class="muted" style="font-weight:500;font-size:0.78rem">· ${t.apptsToday.length}</span></div>
      <div class="card mg-appts">${t.apptsToday.length ? t.apptsToday.map((a) => `<div class="row" style="padding:6px 0"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(String(a.when).slice(11, 16))} · ${esc(a.customerName || a.title || "Appointment")}</div><div class="row-sub">${esc(memberName(a.rep))}${a.type ? " · " + esc(a.type) : ""}</div></div><span class="small muted">${apptState(a)}</span></div>`).join("") : `<div class="muted small">Nothing on the store's calendar today.</div>`}</div>

      <details class="mg-fold"><summary class="section-title">Today on the floor <span class="muted" style="font-weight:500;font-size:0.78rem">· ${feed.length ? `${feed.length} so far` : "nothing yet"}</span></summary>${feedCard(t)}</details>
      <details class="mg-fold"><summary class="section-title">Today's huddle <span class="muted" style="font-weight:500;font-size:0.78rem">· <a href="#" data-act="copy-huddle" style="color:var(--brand)">copy for the group chat</a></span></summary>
      <div class="card small" style="white-space:pre-wrap;line-height:1.5" id="mg-huddle">${esc(huddleText(team, t, ins, rows, fx, now))}</div></details>`;
    },
    wire: ({ el, book, lot, draw, refresh, t }) => {
      const on = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
      on('[data-act="feed-all"]', () => { feedAll = !feedAll; draw(); });
      // The fresh leads' clocks run while the screen is up.
      const tick = setInterval(() => {
        if (!el.isConnected) { clearInterval(tick); return; }
        const n = new Date();
        el.querySelectorAll(".mg-clock[data-at]").forEach((x) => { x.textContent = age(x.dataset.at, n); if (n - new Date(x.dataset.at) > 3600000) x.style.color = "var(--danger)"; });
      }, 30000);
      on('[data-act="copy-huddle"]', async (e) => { e.preventDefault(); const txt = el.querySelector("#mg-huddle")?.textContent || ""; try { await navigator.clipboard.writeText(txt); toast("Huddle copied", "success"); } catch { toast("Select the text to copy it", "warn"); } });
      const nudgeBtn = (b, payload) => async () => {
        b.disabled = true;
        try { await nudgeRep(b.dataset.wnudge || b.dataset.anudge, payload); toast("Nudged", "success"); }
        catch (err) { toast(err.message || "Couldn't nudge", "danger"); b.disabled = false; }
      };
      el.querySelectorAll("[data-dnudge]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        const n = Number(b.dataset.n) || 1;
        try { await nudgeRep(b.dataset.dnudge, { title: `${n} text${n === 1 ? " is" : "s are"} ready to send`, body: `The oldest has waited ${b.dataset.age}. They're written — read each one and tap Send.`, url: "./#/", tag: "due-" + Date.now() }); toast("Nudged", "success"); }
        catch (err) { toast(err.message || "Couldn't nudge", "danger"); b.disabled = false; }
      }));
      el.querySelectorAll("[data-wnudge]").forEach((b) => b.addEventListener("click", nudgeBtn(b, { title: `${b.dataset.name} is waiting on you`, body: `They wrote ${b.dataset.age} ago — answer them now.`, url: b.dataset.lead ? `./#/inbox/${b.dataset.lead}` : "./#/comms", tag: "wait-" + (b.dataset.lead || Date.now()), leadId: b.dataset.lead || "" })));
      el.querySelectorAll("[data-anudge]").forEach((b) => b.addEventListener("click", nudgeBtn(b, { title: b.dataset.title, body: b.dataset.body, url: b.dataset.lead ? `./#/inbox/${b.dataset.lead}` : "./#/appts", tag: "appt-" + (b.dataset.lead || Date.now()), leadId: b.dataset.lead || "" })));
      el.querySelectorAll("[data-mreply], [data-mtext]").forEach((b) => b.addEventListener("click", () => openManagerTextSheet({ rep: b.dataset.rep, leadId: b.dataset.mreply || b.dataset.mtext, name: b.dataset.name, draft: b.dataset.draft || "", onSent: () => refresh(true) })));
      if (deepLink) {
        const id = deepLink; deepLink = "";
        const d = heldDraft(id);
        const w = (t && t.waiting || []).find((x) => x.leadId === id);
        if (d || w) openManagerTextSheet({ rep: d ? d.rep : w.rep.user_id, leadId: id, name: d ? d.name : w.name, draft: d ? d.body : "", onSent: () => refresh(true) });
        else toast("They've been answered already", "success");
      }
      el.querySelectorAll("[data-welcome]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try { await sendWelcomeNow(b.dataset.rep, b.dataset.welcome); toast(`Welcomed ${b.dataset.name || "them"}`, "success"); refresh(true); }
        catch (err) { toast(err.message || "Couldn't send the welcome", "danger"); b.disabled = false; }
      }));
      el.querySelectorAll("[data-bnudge]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try { await nudgeRep(b.dataset.bnudge, { title: `${b.dataset.name} has gone quiet — ${b.dataset.quiet} days`, body: "An unsold up. A call today — be-backs close at three times the rate of a fresh up.", url: `./#/leads/${b.dataset.lead}`, tag: "beback-" + b.dataset.lead, leadId: b.dataset.lead }); toast("Nudged", "success"); }
        catch (err) { toast(err.message || "Couldn't nudge", "danger"); b.disabled = false; }
      }));
      el.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try { await nudgeRep(b.dataset.nudge, { title: `${b.dataset.name} has been waiting ${b.dataset.age}`, body: "A fresh lead — call or text them now. Leads set appointments in the first hour.", url: `./#/leads/${b.dataset.lead}`, tag: "lead-" + b.dataset.lead, leadId: b.dataset.lead }); toast("Nudged", "success"); }
        catch (err) { toast(err.message || "Couldn't nudge", "danger"); b.disabled = false; }
      }));
      el.querySelectorAll("[data-hand]").forEach((b) => b.addEventListener("click", async () => {
        const ranked = book ? rankBook(book.rows, rankOpts(lot)) : null;
        const r = ranked && ranked.rows.find((x) => x.lead.id === b.dataset.hand && x.rep.user_id === b.dataset.hrep);
        if (!r) return;
        if (r.pool) { try { sessionStorage.setItem("customers-query", JSON.stringify({ q: r.lead.name || "", rep: "all", mode: "pool" })); } catch { /* fine */ } navigate("/customers"); return; }
        b.disabled = true;
        try {
          await addRepTask(r.rep.user_id, taskFor(r, { by: store.getSettings().salesperson || "your manager" }));
          handed.add(r.lead.id);
          try { await nudgeRep(r.rep.user_id, { title: `Reach out to ${r.lead.name || "a customer"}`, body: r.read.reasons.slice(0, 3).join(" · "), url: `./#/leads/${r.lead.id}`, tag: "reach-" + r.lead.id }); } catch { /* the to-do is there */ }
          toast(`Sent to ${memberName(r.rep)}`, "success"); draw();
        } catch (e) { toast(e.message || "Couldn't send", "danger"); b.disabled = false; }
      }));
    },
  });
}

// ---- Reps: each rep, and everyone logged ----
const CHIP_KEY = "viniva:reps-chip";
export function renderReps(view) {
  let chip = "reps";
  try { chip = sessionStorage.getItem(CHIP_KEY) || "reps"; } catch { /* fine */ }

  // A customer's follow-up plan and where it stands, in one line.
  const planLine = (l, today) => {
    const p = l.plan;
    if (!p || !p.of) return `<span style="color:var(--warning)">No follow-up plan</span>`;
    if (!p.next) return `<span style="color:var(--success)">Follow-up plan done · ${p.done} of ${p.of}</span>`;
    const due = String(p.next.due || "");
    const when = !due ? "" : due < today ? `<span style="color:var(--danger)">overdue since ${esc(formatDateTime(due + "T00:00").split(",")[0])}</span>` : due === today ? "today" : esc(formatDateTime(due + "T00:00").split(",")[0]);
    return `Plan step ${p.next.step || p.done + 1} of ${p.of} · ${esc(p.next.channel || "step")} ${when}`;
  };
  const loggedWhen = (iso, now) => { const d = new Date(iso || ""); if (isNaN(d)) return ""; return d.toDateString() === now.toDateString() ? "today " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }); };
  const stageLabel = (s) => (store.stageMeta(s) || { label: s }).label;
  const stageBadge = (s) => (store.stageMeta(s) || { badge: "" }).badge;

  boardScreen(view, {
    paint: (c) => {
      const { team, now, manager, t, rows, error } = c;
      if (!manager) return repNotice(team);
      const today = localDay(now);
      const logged = t ? t.logged : [];
      const chips = `<div class="lead-seg" role="tablist">
        <button class="btn btn-sm lead-seg-btn ${chip === "reps" ? "btn-primary" : "btn-ghost"}" data-chip="reps" role="tab" aria-selected="${chip === "reps"}"><span class="seg-name">Reps</span> <span class="seg-count">${(team.members || []).length}</span></button>
        <button class="btn btn-sm lead-seg-btn ${chip === "logged" ? "btn-primary" : "btn-ghost"}" data-chip="logged" role="tab" aria-selected="${chip === "logged"}"><span class="seg-name">Logged</span> <span class="seg-count">${t ? logged.length : "—"}</span></button>
      </div>`;
      const head = `${errLine(error)}${asOf(c)}${chips}`;
      if (!t) return head + notRead(c);
      if (chip === "logged") {
        const noPlan = logged.filter((l) => !l.plan || !l.plan.of).length;
        return head + `
        <div class="section-title" style="margin-top:0">Logged this month <span class="muted" style="font-weight:500;font-size:0.78rem">· ${logged.length ? `newest first${noPlan ? ` · ${noPlan} with no plan` : ""}` : "nobody yet"}</span></div>
        <div class="card mg-logged" style="padding:6px 0">${logged.length ? logged.map((l) => `
          <div class="row mg-logged-row" data-fcust="${esc(l.id)}" data-frep="${esc(l.rep.user_id)}" style="padding:9px 16px;border-bottom:1px solid var(--border);cursor:pointer;align-items:flex-start">
            <div class="row-main">
              <div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")}</div>
              <div class="row-sub">${esc(memberName(l.rep))} · ${[l.vehicleInterest, l.shopping].filter(Boolean).map(esc).join(" · ") || "no vehicle noted"} · logged ${esc(loggedWhen(l.loggedAt, now))}</div>
              <div class="small mg-plan-line" style="margin-top:3px">${planLine(l, today)}${l.lastContacted ? ` <span class="muted">· last contact ${esc(formatDateTime(l.lastContacted).split(",")[0])}</span>` : ""}</div>
            </div>
            <span class="badge ${stageBadge(l.stage)}" style="flex:none">${esc(stageLabel(l.stage))}</span>
          </div>`).join("") : `<div class="muted small" style="padding:10px 16px">Nobody logged yet this month. Customers reps add, log a conversation with, book or sell land here.</div>`}</div>`;
      }
      return head + `
        <div class="section-title" style="margin-top:0">By appointments set <span class="muted" style="font-weight:500;font-size:0.78rem">· tap for their day</span></div>
        <div class="card" style="padding:6px 0">
          ${rows.map((r) => `
            <div class="team-row mg-rep" data-rep="${esc(r.member.user_id)}" style="padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer">
              <div class="row" style="align-items:center">
                <div class="row-main"><div class="row-title" style="font-size:0.98rem">${esc(memberName(r.member))}${r.member.role === "manager" ? ' <span class="badge badge-sold" style="margin-left:4px">Mgr</span>' : ""}</div>
                  ${r.error ? `<div class="row-sub" style="color:var(--danger)">${esc(r.error)}</div>` : `<div class="row-sub">${r.insight ? r.insight.setThisMonth : r.appts.set} set · ${setToday(r, today)} today · ${r.appts.shown} shown · ${r.touches.today} touch${r.touches.today === 1 ? "" : "es"} today · ${r.loggedToday || 0} logged today${r.textsDue && r.textsDue.length ? ` · <span style="color:var(--warning)">${r.textsDue.length} text${r.textsDue.length === 1 ? "" : "s"} to send</span>` : ""}</div><div class="small mg-synced" style="${syncedAgo(r.lastWrite).stale ? "color:var(--warning)" : "color:var(--muted)"}">${esc(syncedAgo(r.lastWrite).text)}</div>${r.note ? `<div class="small mg-row-note" style="color:var(--warning)">${esc(r.note)}</div>` : ""}${(() => { if (!r.rates || !t || !t.rates) return ""; const sr = t.rates, rr = r.rates; const gaps = [
                    rr.setRate != null && sr.setRate != null && rr.setRate < sr.setRate - 5 ? { k: "set rate", have: rr.setRate, store: sr.setRate, play: "ask for a time in the first reply — two options, not an open question" } : null,
                    rr.showRate != null && sr.showRate != null && rr.showRate < sr.showRate - 5 ? { k: "show rate", have: rr.showRate, store: sr.showRate, play: "confirm the night before with the car named, and text the morning of" } : null,
                    rr.closeOnShow != null && sr.closeOnShow != null && rr.closeOnShow < sr.closeOnShow - 5 ? { k: "closing on a show", have: rr.closeOnShow, store: sr.closeOnShow, play: "the deal read before the visit and a manager T.O. on every unsold show" } : null,
                    rr.closing != null && sr.closing != null && rr.closing < sr.closing - 5 ? { k: "closing", have: rr.closing, store: sr.closing, play: "fewer ups worked deeper: the follow-up plan on every customer logged, and the be-back list" } : null,
                  ].filter(Boolean).sort((a, b) => (a.have / a.store) - (b.have / b.store)); const g = gaps[0]; return g ? `<div class="small mg-coach" style="color:var(--warning)"><b>Coach:</b> ${esc(g.k)} ${g.have}% against the store's ${g.store}% — ${esc(g.play)}.</div>` : ""; })()}${r.calls ? `<div class="small muted mg-calls">${r.calls.days} days: ${r.calls.dials} call${r.calls.dials === 1 ? "" : "s"} · ${r.calls.connects} connected · <span style="${r.calls.booked ? "color:var(--success)" : ""}">${r.calls.booked} booked within a day</span>${(() => { const lp = t && t.loop && t.loop.byRep.find((x) => x.rep.user_id === r.member.user_id); return lp && lp.tries ? ` · your taps: ${lp.set} of ${lp.tries} booked` : ""; })()}</div>` : ""}`}</div>
                ${r.sales ? `<div class="row-meta"><div class="mono strong" style="${paceCls(r.sales.units, r.goal.units, r.goal.pace)}">${r.sales.units}<span class="muted" style="font-weight:500"> / ${r.goal.units || "—"}</span></div><div class="small muted">${r.insight && r.insight.needs.goal ? (r.insight.needs.onTrack ? "on track" : `needs ${r.insight.needs.apptsNeeded} · ${r.insight.needs.perDay}/day`) : "no goal set"}</div></div>` : ""}
              </div>
              ${r.leads ? `<div class="team-cells"><span style="${r.leads.untouched.length ? "color:var(--danger)" : ""}"><b>${r.leads.untouched.length}</b> untouched</span><span style="${r.leads.overdue.length ? "color:var(--warning)" : ""}"><b>${r.leads.overdue.length}</b> overdue</span><span><b>${r.leads.open}</b> open</span>${r.sheet ? `<span><b>${r.sheet.spoke}</b> logged this month</span>` : ""}</div>` : ""}
              <div class="row" style="margin-top:6px;gap:8px"><span class="small muted" style="flex:1">${r.goal ? (r.goal.fromStore ? `Target ${r.goal.units} units${r.goal.appts ? ` · ${r.goal.appts} appointments` : ""}, set by you` : r.goal.units ? `Their own target: ${r.goal.units} units` : "No target this month") : ""}</span><button class="btn btn-ghost btn-sm" data-target="${esc(r.member.user_id)}">${icon("target")} Targets</button></div>
            </div>`).join("")}
          ${!rows.length ? `<div class="muted small" style="padding:10px 16px">No reps on the board yet. Invite one from the "+".</div>` : ""}
        </div>`;
    },
    wire: ({ el, team, draw, refresh }) => {
      el.querySelectorAll("[data-chip]").forEach((b) => b.addEventListener("click", () => { chip = b.dataset.chip; try { sessionStorage.setItem(CHIP_KEY, chip); } catch { /* fine */ } draw(); }));
      el.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); openTargetSheet((team.members || []).find((m) => m.user_id === b.dataset.target), () => refresh(true)); }));
    },
  });
}

// The manager's text to a rep's customer: a reply the rep hasn't got to, a
// confirmation for tomorrow. Sent from the store's number, filed in the
// rep's thread. No figures — the sheet won't send one.
export function openManagerTextSheet({ rep, leadId, name = "", draft = "", onSent = null }) {
  openModal(`Text ${name || "the customer"}`, (close) => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="field"><textarea id="mt-body" rows="5" maxlength="600" placeholder="Hi ${esc(String(name || "there").split(" ")[0])}, it's the sales manager here…">${esc(draft)}</textarea></div>
      <div class="row small muted" style="margin:-4px 2px 10px"><span id="mt-count">${draft.length}/600</span><span>From the store's number · filed in the rep's thread</span></div>
      <button class="btn btn-primary btn-block" data-act="send">${icon("send")} Send</button>
      <div class="hint">Never a dollar amount, a payment or a rate — figures are for the sales desk. Their reply comes back to the rep's thread.</div>`;
    const ta = root.querySelector("#mt-body"), count = root.querySelector("#mt-count");
    ta.addEventListener("input", () => { count.textContent = `${ta.value.length}/600`; });
    root.querySelector('[data-act="send"]').addEventListener("click", async (e) => {
      const body = ta.value.trim();
      if (!body) { toast("Write the text first", "warn"); return; }
      if (looksLikeMoney(body)) { toast("No figures in a text to a customer — take the dollar amount or rate out", "warn"); return; }
      e.target.disabled = true;
      try { await sendManagerText(rep, leadId, body); toast(`Sent to ${name || "them"}`, "success"); close(); if (onSent) onSent(); }
      catch (err) { toast(err.message || "Couldn't send", "danger"); e.target.disabled = false; }
    });
    return root;
  });
}

function drawNoStore(el) {
  el.innerHTML = `
    <div class="hero"><div class="hero-title">No store yet</div></div>
    <div class="card">
      <div class="strong">${isAdmin() ? "Set up the store to start the board." : "You're not in a store yet."}</div>
      <div class="small muted" style="margin-top:4px">${isAdmin() ? "Name it, and you get an invite link for the reps. Then appoint managers by their sign-in email." : "Ask the admin to add you, or join with the invite link."}</div>
      <button class="btn btn-primary btn-block" data-act="team" style="margin-top:10px">${icon("store")} Open Admin</button>
    </div>
    <div class="qa-grid" style="margin-top:14px">
      <button class="qa-tile" data-act="settings"><span class="qa-ico">${icon("settings")}</span><span class="qa-label">Settings</span></button>
      <button class="qa-tile" data-act="sales"><span class="qa-ico">${icon("car")}</span><span class="qa-label">Sales view</span></button>
    </div>`;
  el.querySelector('[data-act="team"]').addEventListener("click", () => navigate("/team"));
  el.querySelector('[data-act="settings"]').addEventListener("click", () => navigate("/settings"));
  el.querySelector('[data-act="sales"]').addEventListener("click", () => { setViewMode("sales"); location.hash = "#/"; location.reload(); });
}

// The manager's "+": the things a manager does from anywhere, one sheet.
// Same tile grid as the rep's quick-add; different tiles.
export async function openManagerQuickAdd() {
  const tools = await import("./tools.js");
  const team = cachedStore();
  const { openModal } = await import("../components.js");
  openModal("Quick actions", (close) => {
    const wrap = document.createElement("div");
    const section = (label, items) => {
      const title = document.createElement("div");
      title.className = "section-title";
      title.style.marginTop = wrap.children.length ? "16px" : "0";
      title.textContent = label;
      wrap.appendChild(title);
      wrap.appendChild(tools.toolGrid(items, close));
    };
    const withTeam = (fn) => () => { if (!team || !isManager(team)) { toast("Set up the store under Admin first", "warn"); navigate("/team"); return; } fn(); };
    const customers = (mode) => () => { try { sessionStorage.setItem("customers-query", JSON.stringify({ q: "", rep: "all", mode })); } catch { /* fine */ } navigate("/customers"); };
    section("Do now", [
      { icon: "mail", label: "Email a customer", fn: withTeam(() => import("./mail.js").then((m) => m.openMailSheet(team))) },
      { icon: "message", label: "Welcome text", fn: withTeam(() => import("./welcome.js").then((m) => m.openWelcomeSheet(team))) },
      { icon: "bell", label: "Nudge a rep", fn: withTeam(() => openNudgeSheet(team)) },
      { icon: "send", label: "Hand out reach-outs", fn: withTeam(() => navigate("/customers")) },
      { icon: "file", label: "Load the owner book", fn: withTeam(() => import("./storebook.js").then((m) => m.openStoreBookUpload(team, () => navigate("/customers")))) },
      { icon: "target", label: "Set targets", fn: withTeam(() => navigate("/reps")) },
      { icon: "users", label: "Invite a rep", fn: withTeam(async () => { try { await navigator.clipboard.writeText(inviteLink(team.code)); toast("Invite link copied — send it to the rep", "success"); } catch { navigate("/team"); } }) },
    ]);
    section("Go to", [
      { icon: "calendar", label: "Appointments", fn: () => navigate("/appointments") },
      { icon: "users", label: "Customers", fn: customers("all") },
      { icon: "calendar", label: "Timing", fn: customers("timing") },
      { icon: "calendar", label: "Lease ends", fn: customers("leases") },
      { icon: "sparkles", label: "Insights", fn: () => navigate("/insights") },
      { icon: "store", label: "Admin", fn: () => navigate("/team") },
      { icon: "settings", label: "Settings", fn: () => navigate("/settings") },
      { icon: "car", label: "Sales view", fn: () => { setViewMode("sales"); location.hash = "#/"; location.reload(); } },
    ]);
    if (backend.isSignedIn()) section("Account", [{ icon: "logout", label: "Sign out", fn: async () => {
      const { confirmDialog: ask } = await import("../components.js");
      if (!(await ask("Sign out of viniva? Anything not yet synced goes up first.", { confirmLabel: "Sign out" }))) return;
      (await import("../signout.js")).signOutNow({ after: () => location.reload() });
    } }]);
    return wrap;
  });
}

// A notification to one rep's phone, in the manager's words.
export function openNudgeSheet(team) {
  const members = (team.members || []).filter((m) => m.role !== "manager").concat((team.members || []).filter((m) => m.role === "manager"));
  import("../components.js").then(({ openModal }) => openModal("Nudge a rep", (close) => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="field"><label>Who</label><select id="nd-rep">${members.map((m) => `<option value="${esc(m.user_id)}">${esc(memberName(m))}</option>`).join("")}</select></div>
      <div class="field"><label>Title</label><input id="nd-title" placeholder="Call your fresh lead" maxlength="80"></div>
      <div class="field"><label>Message</label><textarea id="nd-body" rows="3" placeholder="Ken Adams has been waiting since this morning — give him a call before lunch." maxlength="200"></textarea></div>
      <button class="btn btn-primary btn-block" data-act="send">${icon("bell")} Send to their phone</button>
      <div class="hint">A notification on the rep's phone that opens their app. They need notifications turned on.</div>`;
    root.querySelector('[data-act="send"]').addEventListener("click", async (e) => {
      const to = root.querySelector("#nd-rep").value, title = root.querySelector("#nd-title").value.trim(), body = root.querySelector("#nd-body").value.trim();
      if (!body) { toast("Say what you want them to do", "warn"); return; }
      e.target.disabled = true;
      try { await nudgeRep(to, { title: title || "From your manager", body, url: "./#/", tag: "nudge-" + Date.now() }); toast(`Nudged ${memberName(members.find((m) => m.user_id === to))}`, "success"); close(); }
      catch (err) { toast(err.message || "Couldn't nudge", "danger"); e.target.disabled = false; }
    });
    return root;
  }));
}

// The morning huddle, written from the numbers: where the store stands,
// what each rep needs today, and the one thing the data says to do.
export function huddleText(team, t, ins, rows, fx, now) {
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
