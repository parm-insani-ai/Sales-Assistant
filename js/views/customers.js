// Customers — the store's whole book, and the assistant that reads it.
//
// Every rep's customers in one list: search it, narrow it with the same
// filter a blast is built from, see it by rep. "Reach-outs" is the
// assistant's view: everyone worth a call, best first, each with the
// reasons and the move, and a button that hands the customer to their rep
// as a to-do (and a tap on the rep's phone). Nothing here writes to a rep's
// book beyond that one task.

import { icon } from "../icons.js";
import { toast, confirmDialog } from "../components.js";
import { esc, formatDateTime, formatDate } from "../utils.js";
import { cachedStore, myStore, isManager, memberName, cachedBook, loadBook, addRepTask, nudgeRep, cachedInventory, loadInventory } from "../team.js";
import { makeMatcher } from "../match.js";
import { rankBook, reachOuts, taskFor } from "../reach.js";
import { horizonBook, contractsEnding, horizonTaskFor, monthLabel, ymd } from "../horizon.js";
import { inAudience } from "../outreach.js";
import { openAudienceFilter, audienceLabel } from "./audience.js";
import { openCustomerSheet } from "./team.js";
import * as store from "../store.js";
import { onPull } from "../pulltorefresh.js";

const stageLabel = (s) => (store.stageMeta(s) || { label: s }).label;
const stageBadge = (s) => (store.stageMeta(s) || { badge: "" }).badge;

export function renderCustomers(view) {
  const el = document.createElement("div");
  view.appendChild(el);
  let team = cachedStore();
  let book = cachedBook();
  let lot = cachedInventory();
  let mode = "reach"; // reach | all | timing | leases
  let rep = "all";
  let search = "";
  // The assistant hands over a search: "find the Rogue owners" opens this
  // screen already narrowed to them.
  try {
    const handed = JSON.parse(sessionStorage.getItem("customers-query") || "null");
    sessionStorage.removeItem("customers-query");
    if (handed) { search = handed.q || ""; rep = handed.rep || "all"; mode = handed.mode || (search ? "all" : "reach"); }
  } catch { /* fresh screen */ }
  let aud = null;
  let loading = false, error = "";
  let ranked = null;
  const sent = new Set();

  async function refresh(force = false) {
    if (loading) return;
    loading = true; draw();
    try { team = await myStore(); if (team && isManager(team)) { [book, lot] = await Promise.all([loadBook(team, { force }), loadInventory(team, { force }).catch(() => lot)]); } ranked = null; error = ""; }
    catch (e) { error = e && e.message ? e.message : "couldn't read the book"; }
    loading = false; draw();
  }

  function rankedRows() {
    if (!book) return null;
    const s = store.getSettings();
    const lotAt = lot ? lot.at : 0;
    if (!ranked || ranked.at !== book.at || ranked.lotAt !== lotAt) ranked = { at: book.at, lotAt, ...rankBook(book.rows, { defaultApr: s.defaultApr, dealMatchBand: s.dealMatchBand, match: lot && lot.rows.length ? makeMatcher(lot.rows, s) : null }) };
    return ranked;
  }

  function draw() {
    const bar = document.getElementById("page-title"); if (bar) bar.textContent = "Customers";
    if (!team || !isManager(team)) {
      el.innerHTML = `<div class="hero"><div class="hero-title">${team ? "For managers" : "No store yet"}</div></div><div class="card muted small">${team ? "The store's book is the manager's. Your own customers are under Leads in the sales view." : "Set up the store under Team first."}</div>`;
      return;
    }
    const R = rankedRows();
    const q = search.trim().toLowerCase();
    const now = new Date();
    // Timing and lease ends read the same rows a different way: the month
    // each window opens, or every lease in order of ending.
    if (R && mode === "timing" && !R.timing) { const s = store.getSettings(); R.timing = horizonBook(R.rows, { now, defaultApr: s.defaultApr, dealMatchBand: s.dealMatchBand, match: lot && lot.rows.length ? makeMatcher(lot.rows, s) : null }); }
    if (R && mode === "leases" && !R.leases) R.leases = contractsEnding(R.rows, { now, type: "lease" });
    let rows = R ? (mode === "reach" ? reachOuts(R, { limit: 500 }) : mode === "timing" ? R.timing.filter((r) => r.hz.m != null) : mode === "leases" ? R.leases : R.rows) : [];
    if (rep !== "all") rows = rows.filter((r) => r.rep.user_id === rep);
    if (aud) rows = rows.filter((r) => inAudience(aud, r.lead));
    if (q) rows = rows.filter((r) => [r.lead.name, r.lead.phone, r.lead.vehicleInterest, r.lead.source].join(" ").toLowerCase().includes(q));
    const shown = rows.slice(0, 150);
    const counts = R ? { all: R.rows.length, reach: reachOuts(R, { limit: 100000 }).length, hot: R.rows.filter((r) => r.tier && r.tier.key === "hot").length } : null;
    el.innerHTML = `
      ${error ? `<div class="fab-note" style="text-align:left;color:var(--danger);margin:0 2px 12px">${esc(error)}</div>` : ""}
      <div class="row" style="margin:4px 2px 8px"><span class="small muted">${book ? `${counts.all.toLocaleString()} customers · ${counts.reach.toLocaleString()} worth a call · ${counts.hot} hot · ${lot && lot.rows.length ? `priced against ${lot.rows.filter((v) => (v.status || "available") === "available").length} units` : "no shared lot yet"} · as of ${esc(formatDateTime(new Date(book.at).toISOString()))}${loading ? " · reading…" : " · pull down to refresh"}` : loading ? "Reading every rep's book…" : "Not read yet"}</span></div>
      <div class="searchbar"><input type="search" placeholder="Search the store's customers…" value="${esc(search)}"></div>
      <div class="lead-chips">
        <button class="btn btn-sm ${mode === "reach" ? "btn-primary" : "btn-ghost"}" data-mode="reach">${icon("sparkles")} Reach-outs${counts ? " " + counts.reach : ""}</button>
        <button class="btn btn-sm ${mode === "all" ? "btn-primary" : "btn-ghost"}" data-mode="all">All${counts ? " " + counts.all.toLocaleString() : ""}</button>
        <button class="btn btn-sm ${mode === "timing" ? "btn-primary" : "btn-ghost"}" data-mode="timing">${icon("calendar")} Timing</button>
        <button class="btn btn-sm ${mode === "leases" ? "btn-primary" : "btn-ghost"}" data-mode="leases">Lease ends</button>
        <button class="btn btn-sm ${aud ? "btn-primary" : "btn-ghost"}" data-act="filter">${icon("search")} ${aud ? "Filter on" : "Filter"}</button>
        <button class="btn btn-sm ${rep === "all" ? "btn-ghost" : "btn-primary"}" data-act="rep">${rep === "all" ? "Every rep" : esc(memberName((team.members || []).find((m) => m.user_id === rep)))}</button>
      </div>
      ${aud ? `<div class="card lead-audience" style="padding:10px 12px;margin-bottom:10px"><div class="row" style="align-items:center"><span class="small"><span class="strong">${rows.length.toLocaleString()}</span> match · ${esc(audienceLabel(aud))}</span><button class="modal-close" data-act="aud-clear" aria-label="Clear filter">&times;</button></div></div>` : ""}
      ${mode === "reach" && rows.length ? `<div class="card mg-plan" style="margin-bottom:12px"><div class="strong">${rows.length.toLocaleString()} customer${rows.length === 1 ? "" : "s"} a rep should reach out to${rep !== "all" || aud || q ? " in this view" : ""}.</div><div class="small muted" style="margin-top:4px">Best first, each with the reasons. Send one to its rep as a to-do, or the top ten at once.</div><div class="btn-row" style="margin-top:8px"><button class="btn btn-primary btn-sm btn-block" data-act="send-top">${icon("send")} Send the top ${Math.min(10, rows.length)} to their reps</button></div></div>` : ""}
      ${mode === "timing" && R ? `<div class="card mg-plan" style="margin-bottom:12px"><div class="strong">${rows.filter((r) => r.hz.m === 0).length} ready now · ${rows.filter((r) => r.hz.m > 0 && r.hz.m <= 6).length} open up in the next six months${rep !== "all" || aud || q ? " in this view" : ""}.</div><div class="small muted" style="margin-top:4px">Every owner across the store in the month it starts to make sense — equity clears the line, a like-for-like lands at their payment, the contract runs out, or a lease is six months from its end. Send one to its rep as a to-do due in that month.</div></div>` : ""}
      ${mode === "leases" && R ? `<div class="card mg-plan" style="margin-bottom:12px"><div class="strong">${rows.length} lease${rows.length === 1 ? "" : "s"} out${rep !== "all" || aud || q ? " in this view" : ""} · ${rows.filter((r) => r.end && !r.past && r.end - now < 365 * 86400000).length} end in the next year${rows.filter((r) => r.past).length ? ` · ${rows.filter((r) => r.past).length} past the end` : ""}.</div><div class="small muted" style="margin-top:4px">Every lease the store has out, in order of ending. Send one to its rep as a to-do six months before the end.</div></div>` : ""}
      <div class="card" style="padding:6px 0">
        ${mode === "timing" || mode === "leases" ? shown.map((r) => {
          const l = r.lead, hz = r.hz, end = r.end;
          const days = end ? Math.round((end.getTime() - now.getTime()) / 86400000) : null;
          const badge = hz ? (hz.m === 0 ? '<span class="badge badge-due" style="margin-left:4px">Now</span>' : `<span class="badge badge-soon" style="margin-left:4px">${esc(monthLabel(hz.at))}</span>`) : r.past ? '<span class="badge badge-due" style="margin-left:4px">Past end</span>' : days != null && days <= 90 ? '<span class="badge badge-soon" style="margin-left:4px">Soon</span>' : "";
          const line = hz ? hz.why : !end ? "no end date on file" : r.past ? `ended ${formatDate(ymd(end))}` : `ends ${formatDate(ymd(end))}${days <= 45 ? " · " + days + " days" : ""}`;
          return `<div class="row cu-row" data-lead="${esc(l.id)}" data-rep="${esc(r.rep.user_id)}" style="padding:9px 16px;border-bottom:1px solid var(--border);align-items:center">
            <div class="row-main" style="cursor:pointer"><div class="row-title" style="font-size:0.96rem">${esc(l.name || "Customer")} ${badge}</div><div class="row-sub">${esc(l.vehicleInterest || "No vehicle noted")} · ${esc(memberName(r.rep))}${r.payment != null ? ` · $${Math.round(r.payment).toLocaleString("en-CA")}/mo` : ""}</div><div class="row-reasons">${esc(line)}</div></div>
            ${!(hz && hz.m == null) ? `<button class="btn ${sent.has(r.rep.user_id + "|" + l.id) ? "btn-ghost" : "btn-primary"} btn-sm" data-send="${esc(l.id)}" data-srep="${esc(r.rep.user_id)}" style="flex:0 0 auto;margin-left:8px" ${sent.has(r.rep.user_id + "|" + l.id) ? "disabled" : ""}>${sent.has(r.rep.user_id + "|" + l.id) ? "Sent" : "Send to " + esc(memberName(r.rep).split(" ")[0])}</button>` : ""}
          </div>`;
        }).join("") || `<div class="muted small" style="padding:10px 16px">${mode === "timing" ? "No owners with enough on file to time." : "No leases on the book."}</div>` : ""}
        ${mode === "timing" || mode === "leases" ? "" : shown.length ? shown.map((r) => `
          <div class="row cu-row" data-lead="${esc(r.lead.id)}" data-rep="${esc(r.rep.user_id)}" style="padding:9px 16px;border-bottom:1px solid var(--border);align-items:center">
            <div class="row-main" style="cursor:pointer">
              <div class="row-title" style="font-size:0.96rem">${esc(r.lead.name || "Customer")}${r.tier ? ` <span class="badge ${r.tier.badge}" style="margin-left:4px">${r.tier.label}</span>` : ""}</div>
              <div class="row-sub">${esc(r.lead.vehicleInterest || "No vehicle noted")} · ${esc(memberName(r.rep))}${mode === "all" ? ` · <span class="badge ${stageBadge(r.lead.stage)}" style="font-size:0.66rem">${esc(stageLabel(r.lead.stage))}</span>` : ""}</div>
              ${r.read.reasons.length ? `<div class="row-reasons">${r.read.reasons.map(esc).join(" · ")}</div>` : ""}
              ${r.read.deal ? `<div class="small cu-deal" style="margin-top:3px">${esc(r.read.deal.name)} ≈ <b>$${Math.round(r.read.deal.monthly).toLocaleString("en-CA")}/mo</b>${r.read.deal.delta != null ? ` <span class="${r.read.deal.delta <= 0 ? "" : "muted"}" style="${r.read.deal.delta <= 0 ? "color:var(--success)" : ""}">(${r.read.deal.delta <= 0 ? "−" : "+"}$${Math.abs(Math.round(r.read.deal.delta)).toLocaleString("en-CA")}/mo)</span>` : ` <span class="muted">with their trade</span>`}</div>` : ""}
              ${mode === "reach" && r.read.next ? `<div class="small" style="margin-top:3px;color:var(--brand)">${esc(r.read.next.label)}</div>` : ""}
            </div>
            ${!r.read.excluded && !r.read.inPlay && r.read.contactable ? `<button class="btn ${sent.has(r.rep.user_id + "|" + r.lead.id) ? "btn-ghost" : "btn-primary"} btn-sm" data-send="${esc(r.lead.id)}" data-srep="${esc(r.rep.user_id)}" style="flex:0 0 auto;margin-left:8px" ${sent.has(r.rep.user_id + "|" + r.lead.id) ? "disabled" : ""}>${sent.has(r.rep.user_id + "|" + r.lead.id) ? "Sent" : "Send to " + esc(memberName(r.rep).split(" ")[0])}</button>` : ""}
          </div>`).join("") : `<div class="muted small" style="padding:10px 16px">${book ? (mode === "reach" ? "Nobody worth a call in this view." : "No customers match.") : loading ? "Reading…" : "Pull down to read the book."}</div>`}
        ${(mode === "timing" || mode === "leases") && !book ? `<div class="muted small" style="padding:10px 16px">${loading ? "Reading…" : "Pull down to read the book."}</div>` : ""}
        ${rows.length > shown.length ? `<div class="muted small" style="padding:10px 16px">Showing ${shown.length} of ${rows.length.toLocaleString()} — search or filter to narrow it.</div>` : ""}
      </div>
      <div class="hint" style="margin:0 2px">Read from what's on each customer's file — equity, years in, when the contract ends, the warranty, the rate, kilometres, AutoAlert flags, service visits, whether anyone has spoken to them lately — and priced against the store's shared lot: what they could drive for the money they pay now. ${lot && lot.rows.length ? "" : "Import the lot under Settings → Dealer inventory sites, or have any rep in the store import it, and payment matches appear."}</div>
    `;
    const on = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on('[data-act="aud-clear"]', () => { aud = null; draw(); });
    on('[data-act="filter"]', () => openAudienceFilter(aud, (a) => { aud = a; draw(); }, { title: "Filter the store's customers" }));
    on('[data-act="rep"]', () => {
      const members = team.members || [];
      const i = rep === "all" ? -1 : members.findIndex((m) => m.user_id === rep);
      rep = i + 1 >= members.length ? "all" : members[i + 1].user_id;
      draw();
    });
    el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; draw(); }));
    const sb = el.querySelector('input[type="search"]');
    let t = null;
    sb.addEventListener("input", (e) => { search = e.target.value; clearTimeout(t); t = setTimeout(() => { const y = view.scrollTop; draw(); view.scrollTop = y; const s2 = el.querySelector('input[type="search"]'); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }, 120); });
    el.querySelectorAll(".cu-row .row-main").forEach((n) => n.addEventListener("click", () => { const r = n.closest(".cu-row"); openCustomerSheet(r.dataset.rep, r.dataset.lead); }));
    el.querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", async () => {
      const r = rows.find((x) => x.lead.id === b.dataset.send && x.rep.user_id === b.dataset.srep);
      if (!r) return;
      b.disabled = true;
      try { await sendOne(r); b.textContent = "Sent"; b.classList.remove("btn-primary"); b.classList.add("btn-ghost"); toast(`Sent to ${memberName(r.rep)}`, "success"); }
      catch (e) { toast(e.message || "Couldn't send", "danger"); b.disabled = false; }
    }));
    on('[data-act="send-top"]', async () => {
      const top = rows.filter((r) => !sent.has(r.rep.user_id + "|" + r.lead.id)).slice(0, 10);
      if (!top.length) return;
      if (!(await confirmDialog(`Send ${top.length} reach-out${top.length === 1 ? "" : "s"} to ${new Set(top.map((r) => r.rep.user_id)).size} rep${new Set(top.map((r) => r.rep.user_id)).size === 1 ? "" : "s"} as today's to-dos?`, { confirmLabel: "Send", danger: false }))) return;
      let ok = 0; const fails = [];
      for (const r of top) { try { await sendOne(r, { quiet: true }); ok++; } catch (e) { fails.push(`${r.lead.name}: ${e.message}`); } }
      // One nudge per rep with the count, rather than ten buzzes.
      const byRep = new Map(); top.forEach((r) => { if (sent.has(r.rep.user_id + "|" + r.lead.id)) byRep.set(r.rep.user_id, (byRep.get(r.rep.user_id) || 0) + 1); });
      for (const [uid, n] of byRep) { try { await nudgeRep(uid, { title: `${n} customer${n === 1 ? "" : "s"} to reach out to today`, body: "Your manager picked them from the book — reasons are on each to-do.", url: "./#/", tag: "reach" }); } catch { /* the to-dos are there regardless */ } }
      toast(`${ok} sent${fails.length ? " · " + fails.join(" · ") : ""}`, fails.length ? "warn" : "success");
      draw();
    });
  }

  // Hand one customer to their rep: a to-do in the rep's book, and a tap on
  // their phone naming the customer and the reason.
  async function sendOne(r, { quiet = false } = {}) {
    const by = store.getSettings().salesperson || memberName((team.members || []).find((m) => m.role === "manager")) || "your manager";
    // A timing row's to-do is due in its month; a lease's six months before
    // the end; a reach-out's today.
    const task = r.hz ? horizonTaskFor(r, { by })
      : r.end ? horizonTaskFor({ lead: r.lead, hz: { m: Math.max(0, (r.left || 0) - 6), at: new Date(Math.max(Date.now(), r.end.getTime() - 182 * 86400000)), why: r.past ? `Lease ended ${monthLabel(r.end)}` : `Lease ends ${monthLabel(r.end)}`, trigger: "lease" } }, { by })
      : taskFor(r, { by });
    await addRepTask(r.rep.user_id, task);
    sent.add(r.rep.user_id + "|" + r.lead.id);
    if (!quiet) { try { await nudgeRep(r.rep.user_id, { title: `Reach out to ${r.lead.name || "a customer"}${task.due > new Date().toISOString().slice(0, 10) ? " in " + monthLabel(task.due + "T12:00:00") : ""}`, body: (r.read && r.read.reasons.slice(0, 3).join(" · ")) || (r.hz && r.hz.why) || task.note, url: `./#/leads/${r.lead.id}`, tag: "reach-" + r.lead.id }); } catch { /* the to-do is there regardless */ } }
  }

  draw();
  refresh(false);
  onPull(() => refresh(true));
}
