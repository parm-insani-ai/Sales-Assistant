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
import { esc, formatDateTime, currency } from "../utils.js";
import { cachedStore, myStore, isAdmin, isManager, memberName, cachedBoard, loadBoard, storeTotals, inviteLink, setViewMode, nudgeRep, syncedAgo, sendManagerText, sendWelcomeNow, heldDraft } from "../team.js";
import { looksLikeMoney } from "../replies.js";
import { openRepSheet, openCustomerSheet, apptState, openTargetSheet } from "./team.js";
import { findings } from "../insight.js";
import { cachedBook, loadBook, addRepTask, cachedInventory, loadInventory } from "../team.js";
import { makeMatcher } from "../match.js";
import { rankBook, reachOuts, taskFor } from "../reach.js";
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
      if (st.team && isManager(st.team)) st.board = await loadBoard(st.team, { force });
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

  draw();
  refresh(false);
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
      const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthName = now.toLocaleDateString("en-CA", { month: "long" });
      const pace = t && t.goal ? Math.round((t.goal * now.getDate()) / daysIn) : 0;
      const today = now.toISOString().slice(0, 10);
      return `
      ${errLine(error)}
      ${!manager ? repNotice(team) : `
      ${asOf(c)}
      ${t ? `
      <div class="stat-grid" style="margin-bottom:12px">
        <div class="stat"><div class="stat-value" style="${paceCls(t.units, t.goal, pace)}">${t.units}<span class="muted" style="font-size:0.9rem;font-weight:500"> / ${t.goal || "—"}</span></div><div class="stat-label">Units · ${currency(t.gross)} gross${t.goal ? ` · pace ${pace}` : ""}</div></div>
        <div class="stat"><div class="stat-value" style="color:var(--brand)">${ins.setThisMonth}</div><div class="stat-label">Appointments set in ${esc(monthName)} · ${rows.reduce((a, r) => a + setToday(r, today), 0)} today</div></div>
        <div class="stat"><div class="stat-value" style="${ins.needs.goal ? (ins.needs.onTrack ? "color:var(--success)" : "color:var(--danger)") : ""}">${ins.needs.goal ? ins.needs.apptsNeeded : "—"}</div><div class="stat-label">${ins.needs.goal ? `more to set for ${ins.needs.goal} units · ${ins.needs.perDay} a day` : "No unit goals set"}</div></div>
        <div class="stat"><div class="stat-value">${ins.funnel.shown}<span class="muted" style="font-size:0.9rem;font-weight:500"> · ${ins.history.showRate != null ? ins.history.showRate + "%" : "—"}</span></div><div class="stat-label">Shown · show rate over 8 weeks</div></div>
        <div class="stat"><div class="stat-value">${t.loggedMonth}</div><div class="stat-label">Customers logged in ${esc(monthName)} · ${t.loggedToday} today</div></div>
        <div class="stat"><div class="stat-value">${t.closing != null ? t.closing + "%" : "—"}</div><div class="stat-label">Closing · sold of customers logged</div></div>
        <div class="stat"><div class="stat-value">${t.touchesToday}</div><div class="stat-label">Touches today${ins.touchesPerAppt ? ` · ${ins.touchesPerAppt} per appointment` : ""}</div></div>
        <div class="stat"><div class="stat-value" style="${t.untouched ? "color:var(--danger)" : ""}">${t.untouched}</div><div class="stat-label">Untouched new leads · ${t.overdue} overdue</div></div>
      </div>
      ${ins.needs.goal ? `<div class="card mg-plan" style="margin-bottom:14px">
        <div class="strong">${ins.needs.onTrack ? `On track: the calendar covers the rest of ${esc(monthName)}.` : `To hit ${ins.needs.goal} units: ${ins.needs.apptsNeeded} more appointments set by month end.`}</div>
        <div class="small muted" style="margin-top:4px">${ins.needs.sold} sold · ${ins.needs.futureSet} on the calendar (~${ins.needs.pipeline} units) · ${ins.needs.perAppt} units per appointment set (${ins.needs.showRate}% show × ${ins.needs.closeRate}% close${ins.needs.assumed ? ", typical rates until there's history" : ""})${ins.touchesPerDay && !ins.needs.onTrack ? ` · about ${ins.touchesPerDay} touches a day across the floor` : ""}</div>
        ${!ins.needs.onTrack ? `<div class="small" style="margin-top:8px">${rows.filter((r) => r.insight && r.insight.needs.goal).map((r) => `<span class="mg-need"><b>${esc(memberName(r.member))}</b> ${r.insight.needs.onTrack ? "on track" : r.insight.needs.perDay + "/day"}</span>`).join(" ")}</div>` : ""}
      </div>` : ""}
      <div class="hint" style="margin:0 2px">The day as it happens is on Floor; each rep is under Reps; everything else is under the "+".</div>` : notRead(c)}`}`;
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
    return `<div class="section-title" style="margin-top:0">Today on the floor <span class="muted" style="font-weight:500;font-size:0.78rem">· ${feed.length ? `${feed.length} so far` : "nothing yet"}</span></div>
      <div class="card mg-feed">${feed.length ? shown.map((e) => `<div class="row mg-event" data-kind="${e.kind}" ${e.leadId ? `data-fcust="${esc(e.leadId)}" data-frep="${esc(e.rep.user_id)}"` : ""} style="padding:7px 0;align-items:flex-start;${e.leadId ? "cursor:pointer" : ""}"><div class="row-main"><div class="row-title" style="font-size:0.93rem;font-weight:500">${what(e)}</div><div class="row-sub">${esc(memberName(e.rep))}${time(e.at) ? " · " + esc(time(e.at)) : ""}${e.kind === "logged" && e.detail ? " · " + esc(e.detail) : e.kind === "appt" && e.detail ? " · " + esc(e.detail) : ""}</div></div><span class="badge ${e.kind === "sold" ? "badge-sold" : e.kind === "appt" ? "badge-appt" : "badge-new"}" style="flex:none">${tag[e.kind]}</span></div>`).join("")
        + (feed.length > 8 ? `<button class="btn btn-ghost btn-sm btn-block" data-act="feed-all" style="margin-top:6px">${feedAll ? "Show less" : `Show all ${feed.length}`}</button>` : "")
        : `<div class="muted small">No customers logged, appointments set or cars sold yet today. It fills in as the reps' phones sync.</div>`}</div>`;
  }

  function reachCard(book, lot) {
    if (!book) return `<div class="section-title">Who to reach out to <span class="muted" style="font-weight:500;font-size:0.78rem">· the assistant</span></div><div class="card muted small">Reading every rep's book…</div>`;
    const ranked = rankBook(book.rows, rankOpts(lot));
    const top = reachOuts(ranked, { limit: 5 });
    const all = reachOuts(ranked, { limit: 100000 }).length;
    return `<div class="section-title">Who to reach out to <span class="muted" style="font-weight:500;font-size:0.78rem">· ${all.toLocaleString()} worth a call · <a href="#/customers" style="color:var(--brand)">see them all</a></span></div>
      <div class="card" style="padding:6px 0">${top.length ? top.map((r) => `<div class="row" style="padding:8px 16px;border-bottom:1px solid var(--border);align-items:center"><div class="row-main" data-cust="${esc(r.lead.id)}" data-rep="${esc(r.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(r.lead.name || "Customer")}${r.tier ? ` <span class="badge ${r.tier.badge}" style="margin-left:4px">${r.tier.label}</span>` : ""}</div><div class="row-sub">${esc(r.lead.vehicleInterest || "")} · ${esc(memberName(r.rep))}</div><div class="row-reasons">${r.read.reasons.map(esc).join(" · ")}</div>${r.read.deal ? `<div class="small" style="margin-top:2px">${esc(r.read.deal.name)} ≈ <b>$${Math.round(r.read.deal.monthly).toLocaleString("en-CA")}/mo</b>${r.read.deal.delta != null ? ` <span style="${r.read.deal.delta <= 0 ? "color:var(--success)" : ""}" class="${r.read.deal.delta <= 0 ? "" : "muted"}">(${r.read.deal.delta <= 0 ? "−" : "+"}$${Math.abs(Math.round(r.read.deal.delta)).toLocaleString("en-CA")}/mo)</span>` : ""}</div>` : ""}</div><button class="btn ${handed.has(r.lead.id) ? "btn-ghost" : "btn-primary"} btn-sm" data-hand="${esc(r.lead.id)}" data-hrep="${esc(r.rep.user_id)}" style="flex:0 0 auto;margin-left:8px" ${handed.has(r.lead.id) ? "disabled" : ""}>${handed.has(r.lead.id) ? "Sent" : "Send"}</button></div>`).join("") : `<div class="muted small" style="padding:10px 16px">Nobody on the book is worth a call right now — or the reps' books haven't synced.</div>`}</div>`;
  }

  boardScreen(view, {
    needBook: true,
    paint: (c) => {
      const { team, now, manager, t, ins, rows, error, book, lot } = c;
      if (!manager) return repNotice(team);
      const me = store.getSettings().salesperson || memberName((team.members || []).find((m) => m.user_id === (backend.currentUser() || {}).id)) || "the sales manager";
      if (!t) return `${errLine(error)}${asOf(c)}${notRead(c)}`;
      const fx = findings(ins).filter((x) => x.kind !== "needs").slice(0, 3);
      const today = now.toISOString().slice(0, 10);
      const attention = rows.filter((r) => !r.error && r.touches && r.insight).flatMap((r) => {
        // A manager with no book and no goal has nothing to be behind on.
        if (!r.leads.open && !r.goal.units && !r.sales.units) return [];
        const why = [];
        const i = r.insight;
        if (r.leads.untouched.length) why.push(`${r.leads.untouched.length} untouched lead${r.leads.untouched.length === 1 ? "" : "s"}`);
        if (i.needs.goal && !i.needs.onTrack && i.needs.perDay >= 1 && !setToday(r, today) && now.getHours() >= 12) why.push(`needs ${i.needs.perDay} appointment${i.needs.perDay === 1 ? "" : "s"} a day, none set today`);
        const thisWeek = i.weekly[i.weekly.length - 1];
        if (thisWeek && !thisWeek.set && now.getDay() >= 3) why.push("nothing set this week");
        if (r.leads.overdue.length >= 3) why.push(`${r.leads.overdue.length} overdue follow-ups`);
        if (!r.touches.today && now.getHours() >= 12) why.push("no touches yet today");
        return why.length ? [{ r, why }] : [];
      });
      // Fresh leads waiting: every untouched new lead in the store with the
      // clock on it, newest arrivals that have waited longest first.
      const waiting = rows.flatMap((r) => (r.leads ? r.leads.untouched.map((l) => ({ l, r })) : [])).concat(
        rows.flatMap((r) => (r.raw ? r.raw.leads.filter((l) => l.stage === "new" && !l.firstContacted && !l.lastContacted && l.createdAt && now - new Date(l.createdAt) <= 86400000 && now - new Date(l.createdAt) > 30 * 60000).map((l) => ({ l, r })) : []))
      ).filter((x, i, arr) => arr.findIndex((y) => y.l.id === x.l.id && y.r.member.user_id === x.r.member.user_id) === i)
       .sort((a, b) => String(a.l.createdAt).localeCompare(String(b.l.createdAt))).slice(0, 12);
      const first = (n) => String(n || "there").split(" ")[0];
      const firstName = (n) => String(n || "").trim().split(/\s+/)[0];
      const waitedFor = (iso) => { const m = Math.max(0, Math.round((now - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
      const whenWords = (w) => { const d = String(w).slice(0, 10), hm = String(w).slice(11, 16); return `${d === today ? "today" : d === tmrw ? "tomorrow" : esc(formatDateTime(w).split(",")[0])} ${esc(hm)}`; };
      const tmrw = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
      // 1. Customers waiting on a reply, longest first.
      const unanswered = t.waiting || [];
      const waitingCard = `<div class="section-title" style="margin-top:0">Waiting on a reply <span class="muted" style="font-weight:500;font-size:0.78rem">· ${unanswered.length ? `${unanswered.length} · longest first` : "nobody"}</span></div>
        <div class="card mg-waiting">${unanswered.length ? unanswered.slice(0, 10).map((w) => `<div class="row mg-wait" style="padding:8px 0;align-items:center;gap:8px"><div class="row-main" ${w.leadId ? `data-fcust="${esc(w.leadId)}" data-frep="${esc(w.rep.user_id)}" style="cursor:pointer"` : ""}><div class="row-title" style="font-size:0.95rem">${esc(w.name || "A customer")} <span class="small" style="color:var(--danger);font-weight:600">${waitedFor(w.at)}</span></div><div class="row-sub">${esc(memberName(w.rep))} · ${w.channel === "email" ? "emailed" : "texted"}: “${esc(w.preview)}”</div></div><button class="btn btn-ghost btn-sm" data-wnudge="${esc(w.rep.user_id)}" data-lead="${esc(w.leadId)}" data-name="${esc(w.name || "A customer")}" data-age="${waitedFor(w.at)}">${icon("bell")}</button>${w.channel === "text" && w.leadId ? `<button class="btn btn-primary btn-sm" data-mreply="${esc(w.leadId)}" data-rep="${esc(w.rep.user_id)}" data-name="${esc(w.name || "")}" ${heldDraft(w.leadId) ? `data-draft="${esc(heldDraft(w.leadId).body)}"` : ""}>${heldDraft(w.leadId) ? "Send draft" : "Reply"}</button>` : w.leadId ? `<button class="btn btn-primary btn-sm" data-fcust="${esc(w.leadId)}" data-frep="${esc(w.rep.user_id)}">Open</button>` : ""}</div>`).join("") + (unanswered.length > 10 ? `<div class="hint">and ${unanswered.length - 10} more.</div>` : "") : `<div class="muted small">Every customer who wrote has been answered. A reply inside five minutes books far better than one inside an hour.</div>`}</div>`;
      // 1b. Texts drafted on a rep's phone and not sent — the welcome, a
      // follow-up due — sitting on their Right now. The store's side of
      // "waiting": the customer hasn't heard from us yet.
      const due = t.textsDue || [];
      const dueCount = due.reduce((a, d) => a + d.texts.length, 0);
      const dueCard = `<div class="section-title">Texts waiting to go <span class="muted" style="font-weight:500;font-size:0.78rem">· ${dueCount ? `${dueCount} drafted, not sent` : "none"}</span></div>
        <div class="card mg-due">${due.length ? due.map((d) => `<div class="mg-due-rep" data-rep="${esc(d.rep.user_id)}" style="padding:7px 0;border-bottom:1px solid var(--border)"><div class="row" style="align-items:center;gap:8px"><div class="row-main mg-rep" data-rep="${esc(d.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(memberName(d.rep))} <span class="small" style="color:var(--warning);font-weight:600">${d.texts.length} text${d.texts.length === 1 ? "" : "s"} ready</span></div><div class="row-sub">oldest waiting ${waitedFor(d.oldest)} · ${d.texts.slice(0, 3).map((x) => `${esc(firstName(x.name) || "a customer")}${x.intent === "intro" ? " (welcome)" : ""}`).join(", ")}${d.texts.length > 3 ? ` and ${d.texts.length - 3} more` : ""}</div></div><button class="btn btn-ghost btn-sm" data-dnudge="${esc(d.rep.user_id)}" data-n="${d.texts.length}" data-age="${waitedFor(d.oldest)}">${icon("bell")} Nudge</button></div>${d.texts.filter((x) => !x.hasPhone).length ? `<div class="small muted" style="margin-top:2px">${d.texts.filter((x) => !x.hasPhone).length} can't send — no phone number on file.</div>` : ""}</div>`).join("") : `<div class="muted small">Every text the reps' phones have drafted has gone out.</div>`}</div>`;
      // 2. Appointments at risk: unconfirmed inside 24 hours, and no-shows nobody has rebooked.
      const risk = t.atRisk || [], noShows = t.noShows || [];
      const riskCard = `<div class="section-title">Appointments at risk <span class="muted" style="font-weight:500;font-size:0.78rem">· ${risk.length || noShows.length ? [risk.length ? `${risk.length} unconfirmed` : "", noShows.length ? `${noShows.length} to rebook` : ""].filter(Boolean).join(" · ") : "none"}</span></div>
        <div class="card mg-risk">${risk.map((a) => `<div class="row mg-risk-row" data-kind="unconfirmed" style="padding:8px 0;align-items:center;gap:8px"><div class="row-main" ${a.leadId ? `data-fcust="${esc(a.leadId)}" data-frep="${esc(a.rep.user_id)}" style="cursor:pointer"` : ""}><div class="row-title" style="font-size:0.95rem">${esc(a.customerName || "Appointment")} <span class="small muted">${whenWords(a.when)}</span></div><div class="row-sub">${esc(memberName(a.rep))}${a.type ? " · " + esc(a.type) : ""} · not confirmed</div></div><button class="btn btn-ghost btn-sm" data-anudge="${esc(a.rep.user_id)}" data-lead="${esc(a.leadId || "")}" data-title="${esc((a.customerName || "An appointment") + " at " + String(a.when).slice(11, 16) + " isn't confirmed")}" data-body="A confirmation now is the difference between a show and a no-show.">${icon("bell")}</button>${a.leadId ? `<button class="btn btn-primary btn-sm" data-mtext="${esc(a.leadId)}" data-rep="${esc(a.rep.user_id)}" data-name="${esc(a.customerName || "")}" data-draft="${esc(`Hi ${first(a.customerName)}, it's ${me} at ${team.name}. Just confirming your ${a.type || "appointment"} ${whenWords(a.when).replace(/<[^>]+>/g, "")} with ${first(memberName(a.rep))} — reply YES to confirm, or let me know if another time works better.`)}">Text</button>` : ""}</div>`).join("")
        + noShows.map((a) => `<div class="row mg-risk-row" data-kind="noshow" style="padding:8px 0;align-items:center;gap:8px"><div class="row-main" ${a.leadId ? `data-fcust="${esc(a.leadId)}" data-frep="${esc(a.rep.user_id)}" style="cursor:pointer"` : ""}><div class="row-title" style="font-size:0.95rem">${esc(a.customerName || "Appointment")} <span class="small" style="color:var(--warning);font-weight:600">no-show</span></div><div class="row-sub">${esc(memberName(a.rep))} · ${esc(formatDateTime(a.when))} · not rebooked</div></div><button class="btn btn-ghost btn-sm" data-anudge="${esc(a.rep.user_id)}" data-lead="${esc(a.leadId || "")}" data-title="${esc("Rebook " + (a.customerName || "the no-show"))}" data-body="${esc("They no-showed " + formatDateTime(a.when) + " — a call today gets them back on the calendar.")}">${icon("bell")}</button>${a.leadId ? `<button class="btn btn-primary btn-sm" data-mtext="${esc(a.leadId)}" data-rep="${esc(a.rep.user_id)}" data-name="${esc(a.customerName || "")}" data-draft="${esc(`Hi ${first(a.customerName)}, it's ${me} at ${team.name}. Sorry we missed you — ${first(memberName(a.rep))} would love to get you in. What day works this week?`)}">Text</button>` : ""}</div>`).join("")
        + (!risk.length && !noShows.length ? `<div class="muted small">Everything in the next 24 hours is confirmed, and no recent no-show is waiting to be rebooked.</div>` : "")}</div>`;
      // 3. The service drive: customers on the books booked into service today or tomorrow, with the app's read.
      const svc = book ? rankBook(book.rows, rankOpts(lot)).rows.filter((r) => { const d = String(r.lead.serviceAppt || "").slice(0, 10); return d === today || d === tmrw; }).sort((a, b) => String(a.lead.serviceAppt).localeCompare(String(b.lead.serviceAppt)) || b.read.score - a.read.score) : null;
      const svcCard = `<div class="section-title">In the service drive <span class="muted" style="font-weight:500;font-size:0.78rem">· ${!svc ? "reading…" : svc.length ? `${svc.length} today and tomorrow` : "nobody booked"}</span></div>
        <div class="card mg-service" style="padding:6px 0">${!svc ? `<div class="muted small" style="padding:10px 16px">Reading every rep's book…</div>` : svc.length ? svc.slice(0, 10).map((r) => `<div class="row" style="padding:8px 16px;border-bottom:1px solid var(--border);align-items:center"><div class="row-main" data-cust="${esc(r.lead.id)}" data-rep="${esc(r.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(r.lead.name || "Customer")}${r.tier ? ` <span class="badge ${r.tier.badge}" style="margin-left:4px">${r.tier.label}</span>` : ""} <span class="small muted">${String(r.lead.serviceAppt).slice(0, 10) === today ? "today" : "tomorrow"}${/T\d\d:\d\d/.test(String(r.lead.serviceAppt)) ? " " + esc(String(r.lead.serviceAppt).slice(11, 16)) : ""}</span></div><div class="row-sub">${esc(r.lead.vehicleInterest || "")} · ${esc(memberName(r.rep))}</div><div class="row-reasons">${r.read.reasons.slice(0, 3).map(esc).join(" · ")}</div>${r.read.deal ? `<div class="small" style="margin-top:2px">${esc(r.read.deal.name)} ≈ <b>$${Math.round(r.read.deal.monthly).toLocaleString("en-CA")}/mo</b>${r.read.deal.delta != null ? ` <span style="${r.read.deal.delta <= 0 ? "color:var(--success)" : ""}" class="${r.read.deal.delta <= 0 ? "" : "muted"}">(${r.read.deal.delta <= 0 ? "−" : "+"}$${Math.abs(Math.round(r.read.deal.delta)).toLocaleString("en-CA")}/mo)</span>` : ""}</div>` : ""}</div><button class="btn ${handed.has(r.lead.id) ? "btn-ghost" : "btn-primary"} btn-sm" data-hand="${esc(r.lead.id)}" data-hrep="${esc(r.rep.user_id)}" style="flex:0 0 auto;margin-left:8px" ${handed.has(r.lead.id) ? "disabled" : ""}>${handed.has(r.lead.id) ? "Sent" : "Send"}</button></div>`).join("") : `<div class="muted small" style="padding:10px 16px">Nobody on the books is booked into service today or tomorrow. Service dates come in with the owner book import (the "service appointment" column).</div>`}</div>`;
      // 4. Today's plays, by rep: what the night read set each rep, and how many they've reached.
      const plays = t.playsByRep || [];
      const playsCard = `<div class="section-title">Today's plays <span class="muted" style="font-weight:500;font-size:0.78rem">· ${plays.length ? `${plays.reduce((a, p) => a + p.reached, 0)} of ${plays.reduce((a, p) => a + p.items.length, 0)} reached` : "no night read yet"}</span></div>
        <div class="card mg-plays" style="padding:6px 0">${plays.length ? plays.map((p) => `<div class="mg-plays-rep" data-rep="${esc(p.rep.user_id)}" style="padding:8px 16px;border-bottom:1px solid var(--border)"><div class="row mg-rep" data-rep="${esc(p.rep.user_id)}" style="cursor:pointer"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(memberName(p.rep))} <span class="small" style="${p.reached === p.items.length ? "color:var(--success)" : "color:var(--muted)"};font-weight:600">${p.reached} of ${p.items.length} reached</span></div>${p.summary ? `<div class="row-sub">${esc(p.summary)}</div>` : ""}</div></div>${p.items.filter((x) => !x.reached).slice(0, 4).map((x) => `<div class="small mg-play" ${x.leadId ? `data-fcust="${esc(x.leadId)}" data-frep="${esc(p.rep.user_id)}" style="cursor:pointer;padding:3px 0 3px 8px;border-left:2px solid var(--border)"` : `style="padding:3px 0 3px 8px;border-left:2px solid var(--border)"`}><b>${esc(x.customer || "")}</b>${x.customer ? ": " : ""}${esc(x.title)}</div>`).join("")}</div>`).join("") : `<div class="muted small" style="padding:10px 16px">The night read writes each rep a few plays for the day; they show here with how many each rep has reached. It runs at 2am once the viniva-night job in supabase/cron.sql is set up.</div>`}</div>`;
      // 5. Welcomed today: everyone logged today, and who hasn't had a text yet.
      const wl = t.welcomes || { logged: 0, welcomed: 0, pending: [] };
      const welcomeCard = `<div class="section-title">Welcomed today <span class="muted" style="font-weight:500;font-size:0.78rem">· ${wl.logged} logged · ${wl.welcomed} welcomed</span></div>
        <div class="card mg-welcome">${wl.pending.length ? wl.pending.map((l) => `<div class="row mg-welcome-row" style="padding:7px 0;align-items:center;gap:8px"><div class="row-main" data-fcust="${esc(l.id)}" data-frep="${esc(l.rep.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")}</div><div class="row-sub">${esc(memberName(l.rep))}${l.vehicleInterest ? " · " + esc(l.vehicleInterest) : ""} · no text yet</div></div>${l.optOut ? `<span class="small muted">opted out</span>` : l.phone || l.email ? `<button class="btn btn-primary btn-sm" data-welcome="${esc(l.id)}" data-rep="${esc(l.rep.user_id)}" data-name="${esc(l.name || "")}">Welcome now</button>` : `<span class="small muted">no number</span>`}</div>`).join("") : `<div class="muted small">${wl.logged ? "Everyone logged today has had a text." : "Nobody logged yet today."}</div>`}</div>`;
      return `
      ${errLine(error)}
      ${asOf(c)}
      ${waitingCard}
      ${dueCard}
      ${riskCard}
      ${feedCard(t)}
      ${svcCard}
      ${playsCard}
      ${welcomeCard}

      ${fx.length ? `<div class="section-title">What the numbers say <span class="muted" style="font-weight:500;font-size:0.78rem">· <a href="#/insights" style="color:var(--brand)">all insights</a></span></div>
      <div class="card">${fx.map((x) => `<div class="row" style="padding:6px 0;align-items:flex-start;gap:10px"><span style="flex:none;color:var(--brand)">${icon("sparkles")}</span><div class="small">${esc(x.text)}</div></div>`).join("")}</div>` : ""}

      <div class="section-title">Fresh leads waiting <span class="muted" style="font-weight:500;font-size:0.78rem">· ${waiting.length ? "untouched · oldest first" : "none"}</span></div>
      <div class="card">${waiting.length ? waiting.map(({ l, r }) => `<div class="row" style="padding:7px 0;align-items:center"><div class="row-main" data-cust="${esc(l.id)}" data-rep="${esc(r.member.user_id)}" style="cursor:pointer"><div class="row-title" style="font-size:0.95rem">${esc(l.name || "Customer")} <span class="small" style="color:var(--danger);font-weight:600">${age(l.createdAt, now)}</span></div><div class="row-sub">${esc(memberName(r.member))}${l.source ? " · " + esc(l.source) : ""}</div></div><button class="btn btn-ghost btn-sm" data-nudge="${esc(r.member.user_id)}" data-lead="${esc(l.id)}" data-name="${esc(l.name || "A lead")}" data-age="${age(l.createdAt, now)}">${icon("bell")} Nudge</button></div>`).join("") : `<div class="muted small">Every lead has been touched. Leads set appointments in the first hour and rarely after the first day.</div>`}</div>

      ${reachCard(book, lot)}

      <div class="section-title">Today's huddle <span class="muted" style="font-weight:500;font-size:0.78rem">· <a href="#" data-act="copy-huddle" style="color:var(--brand)">copy for the group chat</a></span></div>
      <div class="card small" style="white-space:pre-wrap;line-height:1.5" id="mg-huddle">${esc(huddleText(team, t, ins, rows, fx, now))}</div>

      <div class="section-title">Needs a word <span class="muted" style="font-weight:500;font-size:0.78rem">· ${attention.length ? attention.length : "nobody"}</span></div>
      <div class="card">${attention.length ? attention.map(({ r, why }) => `<div class="row mg-rep" data-rep="${esc(r.member.user_id)}" style="padding:7px 0;cursor:pointer"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(memberName(r.member))}</div><div class="row-sub">${esc(why.join(" · "))}</div></div><span class="muted">›</span></div>`).join("") : `<div class="muted small">Every rep is on pace, touching leads, and current on follow-ups.</div>`}</div>

      <div class="section-title">Today's appointments <span class="muted" style="font-weight:500;font-size:0.78rem">· ${t.apptsToday.length}</span></div>
      <div class="card">${t.apptsToday.length ? t.apptsToday.map((a) => `<div class="row" style="padding:6px 0"><div class="row-main"><div class="row-title" style="font-size:0.95rem">${esc(String(a.when).slice(11, 16))} · ${esc(a.customerName || a.title || "Appointment")}</div><div class="row-sub">${esc(memberName(a.rep))}${a.type ? " · " + esc(a.type) : ""}</div></div><span class="small muted">${apptState(a)}</span></div>`).join("") : `<div class="muted small">Nothing on the store's calendar today.</div>`}</div>`;
    },
    wire: ({ el, book, lot, draw, refresh, t }) => {
      const on = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
      on('[data-act="feed-all"]', () => { feedAll = !feedAll; draw(); });
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
      el.querySelectorAll("[data-wnudge]").forEach((b) => b.addEventListener("click", nudgeBtn(b, { title: `${b.dataset.name} is waiting on you`, body: `They wrote ${b.dataset.age} ago — answer them now.`, url: b.dataset.lead ? `./#/inbox/${b.dataset.lead}` : "./#/comms", tag: "wait-" + (b.dataset.lead || Date.now()) })));
      el.querySelectorAll("[data-anudge]").forEach((b) => b.addEventListener("click", nudgeBtn(b, { title: b.dataset.title, body: b.dataset.body, url: b.dataset.lead ? `./#/inbox/${b.dataset.lead}` : "./#/appts", tag: "appt-" + (b.dataset.lead || Date.now()) })));
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
      el.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try { await nudgeRep(b.dataset.nudge, { title: `${b.dataset.name} has been waiting ${b.dataset.age}`, body: "A fresh lead — call or text them now. Leads set appointments in the first hour.", url: `./#/leads/${b.dataset.lead}`, tag: "lead-" + b.dataset.lead }); toast("Nudged", "success"); }
        catch (err) { toast(err.message || "Couldn't nudge", "danger"); b.disabled = false; }
      }));
      el.querySelectorAll("[data-hand]").forEach((b) => b.addEventListener("click", async () => {
        const ranked = book ? rankBook(book.rows, rankOpts(lot)) : null;
        const r = ranked && ranked.rows.find((x) => x.lead.id === b.dataset.hand && x.rep.user_id === b.dataset.hrep);
        if (!r) return;
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
      const today = now.toISOString().slice(0, 10);
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
                  ${r.error ? `<div class="row-sub" style="color:var(--danger)">${esc(r.error)}</div>` : `<div class="row-sub">${r.insight ? r.insight.setThisMonth : r.appts.set} set · ${setToday(r, today)} today · ${r.appts.shown} shown · ${r.touches.today} touch${r.touches.today === 1 ? "" : "es"} today · ${r.loggedToday || 0} logged today${r.textsDue && r.textsDue.length ? ` · <span style="color:var(--warning)">${r.textsDue.length} text${r.textsDue.length === 1 ? "" : "s"} to send</span>` : ""}</div><div class="small mg-synced" style="${syncedAgo(r.lastWrite).stale ? "color:var(--warning)" : "color:var(--muted)"}">${esc(syncedAgo(r.lastWrite).text)}</div>`}</div>
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
