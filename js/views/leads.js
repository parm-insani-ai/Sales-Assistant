// Leads / follow-ups — the mini CRM.

import * as store from "../store.js";
import { LEAD_STAGES, stageMeta } from "../store.js";
import { openModal, buildForm, toast, undoToast, confirmDialog, emptyState, swipeable } from "../components.js";
import { navigate } from "../router.js";
import { openTemplatePicker } from "./messages.js";
import { openAppointmentForm } from "./calendar.js";
import { openSaleForm } from "./goals.js";
import { openDealerSearch } from "./dealer.js";
import { maybeStartCadence, startCadence, hasCadence, planSteps, planSummary } from "../cadence.js";
import { addContext, profileLines } from "../context.js";
import { assessAll, assessment, assessQuick, bookSummary, bookCheap, warmBook } from "../assess.js";
import { contractSummary } from "../contract.js";
import { dictate } from "../dictate.js";
import { nextMoves, undoMove } from "../moves.js";
import { openTaskForm } from "./tasks.js";
import { consentStatus, consentLine, recordConsent } from "../consent.js";
import { reviewProspect, reviewTouch } from "../touches.js";
import { snoozeProspect } from "../prospects.js";
import { openReferralCapture } from "./referrals.js";
import { openDealBuilder, openDealDetail, dealsForLead, offerText, equityDetail, dealInputs, estimateTradeDetail, paymentDelta, renderDeals, pitchList, vehicleKey } from "./dealbuilder.js";
import { icon } from "../icons.js";
import {
  currency, esc, initials, phoneDisplay, telHref, smsHref, mailtoHref,
  relativeDay, daysFromToday, formatDate, formatDateTime, todayISO, num,
} from "../utils.js";
import { emailsForLead, logEmail } from "../email.js";
import { afterSale, closeFollowUps } from "../connections.js";

// The words a customer can be found by, lowercased once per record rather
// than once per keystroke per customer.
const HAY = new WeakMap();
function haystack(l) {
  let h = HAY.get(l);
  if (h == null) { h = [l.name, l.phone, l.vehicleInterest, l.source, l.notes].join(" ").toLowerCase(); HAY.set(l, h); }
  return h;
}

export function renderLeads(view, { param }) {
  if (param) return renderLeadDetail(view, param);
  // The list is ordered by the radar's read of the book. When that read
  // isn't current, warm it a slice at a time and draw once it is, rather
  // than pricing three thousand customers inside the tap.
  if (!bookCheap()) {
    view.innerHTML = `<div class="card"><div class="muted small" style="text-align:center"><span class="radar-progress">Reading the book…</span></div></div>`;
    const prog = view.querySelector(".radar-progress");
    const again = () => { if (!view.isConnected) return; view.innerHTML = ""; renderLeads(view, { param }); };
    warmBook((done, total, phase) => { if (prog && prog.isConnected && total > 200) prog.textContent = `Reading the book… ${phase === "book" ? 50 + Math.round(done / total * 50) : Math.round(done / total * 50)}%`; }).then(again, again);
    return;
  }

  // A stat card or the voice agent can preset the filter and the search
  // (one-shot each) so the list you land on is the set that was just described
  // to you, rather than the default list with that set buried in it.
  // Where you left off. Tapping into a customer remembers how far down the
  // list you were (and how much of it was showing, since the list is windowed
  // — see renderList) so coming back lands you there, not at the top.
  const SPOT = "viniva:leads-spot";
  let spot = null;
  try { spot = JSON.parse(sessionStorage.getItem(SPOT) || "null"); sessionStorage.removeItem(SPOT); } catch { spot = null; }
  const rememberSpot = () => {
    try { sessionStorage.setItem(SPOT, JSON.stringify({ top: view.scrollTop, shown, filter, search, opp: opp && !selecting })); } catch {}
  };
  let search = sessionStorage.getItem("leads-search") || (spot && spot.search) || "";
  sessionStorage.removeItem("leads-search");
  // all | active | due | <stage>.
  //
  // The chip you tapped last is the one you're on next time — a preset from a
  // stat card or the voice agent is a one-off jump to a particular set and
  // doesn't change that. "All" is the default: the whole book, with Active
  // beside it for the people still in play.
  const REMEMBER = "viniva:leads-filter";
  const OPP_KEY = "viniva:leads-opp";
  const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const remember = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };
  // "By opportunity" is not a chip: it's a lens over the entire book — the
  // same customers ranked by how ready they are to trade, each with a deal —
  // so it sits beside Add customer and Select, and is remembered on its own.
  // (/deals and the voice agent still arrive by presetting "opportunity".)
  let preset = sessionStorage.getItem("leads-filter");
  sessionStorage.removeItem("leads-filter");
  let opp = preset === "opportunity" || (!preset && recall(OPP_KEY) === "1");
  if (preset === "opportunity") preset = null;
  const rem = recall(REMEMBER);
  let filter = preset || (rem && rem !== "opportunity" ? rem : null) || "all";
  // A jump from elsewhere (a preset) is a new list; the spot only applies to
  // the list it was saved on.
  if (spot && (preset || spot.filter !== filter || !!spot.opp !== !!opp)) spot = null;
  // Mass-delete selection mode (e.g. clearing a bad import to start fresh).
  let selecting = false;
  const selected = new Set();
  // Chunked list rendering — see renderList(). Declared up here because draw()
  // is invoked from handlers that can run before the later declaration line.
  let renderToken = 0;
  const FIRST = 40, CHUNK = 60;
  let shown = 0;       // cards currently in the document
  let watcher = null;  // the IntersectionObserver on the list's sentinel

  const wrap = document.createElement("div");
  view.appendChild(wrap);

  function draw() {
    const q = search.toLowerCase();
    let list = store.all("leads"); // read fresh so swipe-deletes/undos stay accurate
    if (filter === "active") list = list.filter((l) => !["delivered", "lost"].includes(l.stage));
    else if (filter === "due") list = list.filter((l) => !["delivered", "lost"].includes(l.stage) && l.followUp && daysFromToday(l.followUp) <= 0);
    else if (filter !== "all") list = list.filter((l) => l.stage === filter);
    if (q) list = list.filter((l) => haystack(l).includes(q));

    // Sort: overdue follow-ups first, then by follow-up date, then newest.
    list = list.slice().sort((a, b) => {
      const da = a.followUp ? daysFromToday(a.followUp) : Infinity;
      const db = b.followUp ? daysFromToday(b.followUp) : Infinity;
      if (da !== db) return da - db;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });

    // Every chip carries its count. The default is Active, which hides
    // delivered and lost — and an imported book of past customers is almost
    // entirely "delivered", so a fresh install opened on 61 of 2,923 and it read
    // as the other 2,862 having been lost. With "All 2,923" sitting beside
    // "Active 61" the hidden rows are a number on screen, not a mystery.
    const everyone = store.all("leads");
    const n = {
      active: everyone.filter((l) => !["delivered", "lost"].includes(l.stage)).length,
      due: everyone.filter((l) => !["delivered", "lost"].includes(l.stage) && l.followUp && daysFromToday(l.followUp) <= 0).length,
      all: everyone.length,
    };
    LEAD_STAGES.forEach((st) => { n[st.id] = everyone.filter((l) => l.stage === st.id).length; });
    const withCount = (label, id) => (n[id] == null ? label : `${label} ${n[id].toLocaleString()}`);
    const chips = [
      { id: "all", label: withCount("All", "all") },
      { id: "active", label: withCount("Active", "active") },
      { id: "due", label: withCount("Due follow-ups", "due") },
      ...LEAD_STAGES.map((s) => ({ id: s.id, label: withCount(s.label, s.id) })),
    ];

    // Selecting is a job on the plain list; the lens waits until Done.
    const ranked = opp && !selecting;
    // Top to bottom: search, the three actions on one line, then the chips
    // sitting directly on the list they filter. Under the lens, or while
    // selecting, the parts that don't apply aren't drawn at all.
    wrap.innerHTML = `
      ${ranked ? "" : `<div class="searchbar">
        <input type="search" placeholder="Search leads…" value="${esc(search)}" />
      </div>`}
      ${selecting ? `
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn btn-ghost btn-sm" data-act="sel-all" style="flex:0 0 auto">Select all shown</button>
        <button class="btn btn-danger btn-sm" data-act="sel-del" style="flex:1">${icon("trash")} Delete (<span id="sel-count">${selected.size}</span>)</button>
        <button class="btn btn-ghost btn-sm" data-act="sel-done" style="flex:0 0 auto">Done</button>
      </div>
      <div class="hint" style="margin-bottom:10px">Tap leads to select. The filter chips and search narrow what "Select all shown" grabs — search "AutoAlert" to target one import batch.</div>` : `
      <div class="btn-row lead-actions">
        <button class="btn btn-primary" data-act="add-lead">Add customer</button>
        <button class="btn btn-ghost" data-act="select">Select</button>
        <button class="btn ${ranked ? "btn-primary" : "btn-ghost"}" data-act="opp" aria-pressed="${ranked}">By opportunity</button>
      </div>`}
      ${ranked ? "" : `<div class="lead-chips">
        ${chips.map((c) => `<button class="btn btn-sm ${filter === c.id ? "btn-primary" : "btn-ghost"}" data-filter="${c.id}">${esc(c.label)}</button>`).join("")}
      </div>`}
      <div class="lead-list"></div>
    `;

    const on = (sel, fn) => { const n = wrap.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on('[data-act="opp"]', () => { opp = !opp; remember(OPP_KEY, opp ? "1" : null); draw(); });

    const listEl = wrap.querySelector(".lead-list");
    if (ranked) {
      renderDeals(listEl, { embedded: true });
      on('[data-act="add-lead"]', () => openLeadForm());
      on('[data-act="select"]', () => { selecting = true; selected.clear(); draw(); });
      return;
    }
    if (!list.length) {
      listEl.innerHTML = emptyState("users", "No leads here", search ? "Try a different search." : "Tap + to add your first customer.");
    } else if (spot) {
      // Back from a customer: put the same cards back, then the same scroll.
      const s = spot; spot = null;
      renderList({ restore: s.shown });
      requestAnimationFrame(() => { view.scrollTop = s.top; });
    } else {
      // The first render went through its own loop and built every card at
      // once, so the chunking in renderList() only ever applied to re-renders
      // — the one that mattered, opening "All", was the one it skipped.
      renderList();
    }

    const sb = wrap.querySelector('input[type="search"]');
    let searchTimer = null;
    if (sb) sb.addEventListener("input", (e) => {
      search = e.target.value;
      // A breath after the last keystroke, then one redraw of the list —
      // not a redraw per key over three thousand customers.
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { if (wrap.isConnected) renderList(); }, 90);
    });

    // Switching filters re-renders only the list and updates the active chip in
    // place — rebuilding the whole view would snap the scrollable filter row
    // (and the page) back to the top.
    function wireChips() {
      wrap.querySelectorAll("[data-filter]").forEach((b) =>
        b.addEventListener("click", () => {
          filter = b.dataset.filter;
          remember(REMEMBER, filter);
          wrap.querySelectorAll("[data-filter]").forEach((x) => {
            const active = x === b;
            x.classList.toggle("btn-primary", active);
            x.classList.toggle("btn-ghost", !active);
          });
          renderList();
        }));
    }

    wireChips();

    on('[data-act="add-lead"]', () => openLeadForm());
    on('[data-act="select"]', () => { selecting = true; selected.clear(); draw(); });
    on('[data-act="sel-done"]', () => { selecting = false; selected.clear(); draw(); });
    on('[data-act="sel-all"]', () => {
      applyFilter().forEach((l) => selected.add(l.id));
      renderList({ keep: true }); updateSelCount();
    });
    on('[data-act="sel-del"]', async () => {
      const ids = [...selected];
      if (!ids.length) { toast("Tap some leads first"); return; }
      const ok = await confirmDialog(
        `Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}? Their open follow-up tasks are removed too. This can't be undone (it deletes from the cloud as well).`);
      if (!ok) return;
      ids.forEach((id) => store.remove("leads", id));
      store.all("tasks")
        .filter((t) => t.leadId && selected.has(t.leadId) && !t.done)
        .forEach((t) => store.remove("tasks", t.id));
      selected.clear();
      selecting = false;
      toast(`Deleted ${ids.length} lead${ids.length === 1 ? "" : "s"}`, "success");
      draw();
    });
  }

  function updateSelCount() {
    const n = wrap.querySelector("#sel-count");
    if (n) n.textContent = selected.size;
  }

  // Selection-mode row: whole card toggles; no swipe/navigation in this mode.
  function selectCard(l) {
    const el = document.createElement("div");
    el.className = "card";
    const drawState = () => {
      const isSel = selected.has(l.id);
      el.style.outline = isSel ? "2px solid var(--brand)" : "none";
      el.innerHTML = `
        <div class="row" style="align-items:center;gap:12px">
          <span style="flex:none;display:inline-flex;width:24px;height:24px;border-radius:50%;border:2px solid ${isSel ? "var(--brand)" : "var(--border)"};background:${isSel ? "var(--brand)" : "transparent"};color:#fff;align-items:center;justify-content:center">${isSel ? "✓" : ""}</span>
          <div class="row-main" style="min-width:0">
            <div class="row-title">${esc(l.name || "Customer")}</div>
            <div class="row-sub">${esc([l.vehicleInterest, l.source].filter(Boolean).join(" · ") || stageMeta(l.stage).label)}</div>
          </div>
        </div>`;
    };
    drawState();
    el.addEventListener("click", () => {
      if (selected.has(l.id)) selected.delete(l.id); else selected.add(l.id);
      drawState(); updateSelCount();
    });
    return el;
  }

  // The list only ever holds what has been scrolled to. "All" on an imported
  // book is three thousand cards; streaming them in a frame at a time made the
  // first screenful quick, but left every card in the document afterwards —
  // 45,000 nodes and 15,000 pointer listeners for the browser to carry
  // through every scroll, every tap, and every screen change out of here.
  // That was the lag: not building the list, but living with it.
  //
  // So the first screenful goes in now, and a sentinel at the bottom of the
  // list asks for the next chunk as it comes into view. A newer render (a
  // keystroke, a filter tap) cancels an older one, and a re-render for a
  // store change keeps as many cards as were already showing so the page
  // doesn't jump back to the top under a scrolled reader.
  // restore: how many cards to put back at once (coming back from a customer).
  function renderList({ keep = false, restore = 0 } = {}) {
    const el = wrap.querySelector(".lead-list");
    if (!el) return;
    const filtered = applyFilter();
    const token = ++renderToken;
    if (watcher) { watcher.disconnect(); watcher = null; }
    el.innerHTML = "";
    if (!filtered.length) {
      shown = 0;
      el.innerHTML = emptyState("users", "No leads here", search ? "Try a different search." : "Nothing in this filter yet.");
      return;
    }
    const card = (x) => (selecting ? selectCard(x) : leadCard(x, rememberSpot));
    // How many to put back before handing over to the scroll: the previous
    // count on a redraw, the saved count on a return, else a screenful. On a
    // return they go in at once — a scroll position can't be restored onto
    // cards that don't exist yet.
    const first = restore ? Math.max(FIRST, Math.min(restore, filtered.length)) : FIRST;
    const target = keep ? Math.max(FIRST, Math.min(shown, filtered.length)) : first;
    const frag = document.createDocumentFragment();
    // What the read of the book found, in one line above it.
    if (!selecting && !search && filter === "all") {
      const b = bookSummary();
      const summary = document.createElement("div");
      summary.className = "lead-summary small muted";
      summary.innerHTML = `${b.total.toLocaleString()} customers · <span class="strong" style="color:var(--danger)">${b.hot} hot</span> · <span class="strong" style="color:var(--success)">${b.strong} strong</span> · ${b.worth} worth a call — best first, with the reason on each`;
      frag.appendChild(summary);
    }
    // The top of the screen this frame, the rest of the first screenful
    // next frame: half the work before the first paint, so the list is on
    // screen sooner and a tap on the first card lands sooner.
    const now = restore ? first : Math.min(first, 20);
    filtered.slice(0, now).forEach((x) => frag.appendChild(card(x)));
    el.appendChild(frag);
    let i = Math.min(now, filtered.length);
    shown = i;

    const sentinel = document.createElement("div");
    sentinel.className = "lead-more muted small";
    const label = () => {
      sentinel.textContent = i < filtered.length
        ? `Showing ${i.toLocaleString()} of ${filtered.length.toLocaleString()}`
        : (filtered.length > FIRST ? `All ${filtered.length.toLocaleString()} shown` : "");
    };
    const append = (n) => {
      const f = document.createDocumentFragment();
      filtered.slice(i, i + n).forEach((x) => f.appendChild(card(x)));
      i = Math.min(filtered.length, i + n);
      shown = i;
      el.insertBefore(f, sentinel);
      label();
      if (i >= filtered.length && watcher) { watcher.disconnect(); watcher = null; }
    };
    label();
    el.appendChild(sentinel);

    // Refill to where the reader was, a frame at a time.
    const refill = () => {
      if (token !== renderToken || !document.body.contains(el)) return;
      if (i < Math.max(first, target)) { append(Math.min(CHUNK, Math.max(first, target) - i)); requestAnimationFrame(refill); return; }
      watch();
    };
    // Then let the scroll position drive the rest.
    const watch = () => {
      if (i >= filtered.length || typeof IntersectionObserver !== "function") return;
      watcher = new IntersectionObserver((entries) => {
        if (token !== renderToken || !document.body.contains(el)) { if (watcher) watcher.disconnect(); return; }
        if (!entries.some((e) => e.isIntersecting)) return;
        append(CHUNK);
        // Re-arm: if the sentinel is still within reach after the append (a
        // tall screen, a fast flick), the observer reports it again.
        if (watcher) { watcher.unobserve(sentinel); watcher.observe(sentinel); }
      }, { root: view, rootMargin: "900px 0px" });
      watcher.observe(sentinel);
    };
    if (i < target) requestAnimationFrame(refill); else watch();
  }

  function applyFilter() {
    const q = search.toLowerCase();
    let list = store.all("leads"); // read fresh so swipe-deletes/undos stay accurate
    if (filter === "active") list = list.filter((l) => !["delivered", "lost"].includes(l.stage));
    else if (filter === "due") list = list.filter((l) => !["delivered", "lost"].includes(l.stage) && l.followUp && daysFromToday(l.followUp) <= 0);
    else if (filter !== "all") list = list.filter((l) => l.stage === filter);
    if (q) list = list.filter((l) => haystack(l).includes(q));
    // Best deals first. The list's job is to read the whole book and put the
    // people a car can be sold to at the top, with the reason on the card —
    // see assess.js. Ties go to the nearest follow-up, then the newest.
    const rank = assessAll().byId;
    const sc = (l) => { const a = rank.get(l.id); return a ? a.score : 0; };
    return list.slice().sort((a, b) => {
      const d = sc(b) - sc(a);
      if (d) return d;
      const da = a.followUp ? daysFromToday(a.followUp) : Infinity;
      const db = b.followUp ? daysFromToday(b.followUp) : Infinity;
      if (da !== db) return da - db;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }

  draw();
}

// What a customer's card says. Drawn once on the way in and again in place
// when something about them changes — a contact logged, a note added —
// without rebuilding the card or the swipe behind it.
function cardHTML(l, { quick = false } = {}) {
  const st = stageMeta(l.stage);
  const fuDays = l.followUp ? daysFromToday(l.followUp) : null;
  let fuBadge = "";
  if (l.followUp && !["delivered", "lost"].includes(l.stage)) {
    const cls = fuDays < 0 ? "badge-due" : fuDays === 0 ? "badge-due" : fuDays <= 2 ? "badge-soon" : "";
    fuBadge = `<span class="badge ${cls}" style="margin-left:6px">${esc(relativeDay(l.followUp))}</span>`;
  }
  // The read of this customer: how strong, and the reasons, right on the
  // card. A quick redraw re-reads this one customer rather than the book.
  const a = quick ? assessQuick(l.id) : assessment(l.id);
  const tier = a && a.tier ? `<span class="badge ${a.tier.badge}" style="margin-right:6px">${esc(a.tier.label)}</span>` : "";
  const reasons = a && a.reasons.length ? `<div class="row-reasons">${a.reasons.map(esc).join(" · ")}</div>` : "";
  // The last contact, on the card — so logging one is visibly registered.
  const contact = l.lastContacted
    ? `<div class="row-contact">${icon("checkline")} ${esc(VIA_LABEL[l.lastContactVia] || "Contacted")} ${esc(formatDateTime(l.lastContacted))}</div>` : "";
  // Their current contract in one line under the vehicle: what they pay,
  // how many payments are left, when it matures — or that it's paid off.
  return `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(l.name)}</div>
        <div class="row-sub">${l.vehicleInterest ? esc(l.vehicleInterest) : "No vehicle noted"}${l.phone ? " · " + esc(phoneDisplay(l.phone)) : ""}</div>
        ${reasons}${contact}
      </div>
      <div class="row-meta">
        ${tier}<span class="badge ${st.badge}">${esc(st.label)}</span>
      </div>
    </div>
    ${fuBadge ? `<div style="margin-top:8px">${fuBadge}</div>` : ""}
    ${contractBanner(l)}
  `;
}

// Their current contract, as a banner across the bottom of the card: the
// payment and the payments left, nothing else, big enough to read at a
// glance. Nothing when neither is on file.
function contractBanner(l, opts = {}) {
  const c = contractSummary(l);
  if (!c || (c.payment == null && c.left == null)) return "";
  const pay = c.payment != null ? currency(c.payment) + `<span class="cb-per">/mo</span>` : "—";
  const left = c.paidOff ? "Paid off" : c.left != null ? String(c.left) : "—";
  return `<div class="contract-banner${c.paidOff ? " contract-banner-done" : ""}"${opts.tap ? ' data-act="money" style="cursor:pointer"' : ""}>
      <div class="cb-cell"><span class="cb-label">Payment</span><span class="cb-value">${pay}</span></div>
      <div class="cb-cell"><span class="cb-label">Payments left</span><span class="cb-value">${esc(left)}</span></div>
    </div>`;
}

function leadCard(l, onOpen) {
  const el = document.createElement("div");
  el.className = "card card-tap";
  el.dataset.leadId = l.id;
  el.innerHTML = cardHTML(l);
  // While a note panel is up inside the card, the card is not a button.
  let busy = false;
  el.addEventListener("click", () => { if (busy) return; if (onOpen) onOpen(); navigate(`/leads/${l.id}`); });
  const redraw = () => {
    const fresh = store.get("leads", l.id);
    if (fresh) el.innerHTML = cardHTML(fresh, { quick: true });
  };
  return swipeable(el, {
    actions: [{
      label: "Contacted", icon: "checkline", kind: "ok",
      // Tapping it turns the tray into the question — Call, Text or Email —
      // right there behind the card. No sheet, no field to focus, nothing
      // that a phone could put in front of the buttons.
      onTap: (api) => api.expand(WAYS.map((w) => ({
        label: w.label, icon: w.icon, kind: "ok",
        onTap: () => {
          const rec = logContactFor(l, w.via, redraw);
          if (!rec) { api.close(); return; }
          // Logged. One more step in the same tray: say what happened, or
          // done. The card already shows the contact behind it.
          api.expand([
            { label: "Note", icon: "mic", kind: "note", onTap: () => {
              api.close();
              busy = true;
              el.innerHTML = "";
              el.appendChild(notePanel(l, rec, () => { busy = false; redraw(); }));
            } },
            { label: "Done", icon: "check", kind: "done", onTap: () => api.close() },
          ]);
        },
      }))),
    }],
    onDelete: (restoreRow) => {
      const snapshot = { ...l };
      store.remove("leads", l.id);
      undoToast(`Deleted ${l.name}`, () => { store.restore("leads", snapshot); restoreRow(); });
    },
  });
}

// The three ways to reach someone, and what a logged one is called.
const WAYS = [
  { via: "call", label: "Call", icon: "phone" },
  { via: "text", label: "Text", icon: "message" },
  { via: "email", label: "Email", icon: "mail" },
];
const VIA_LABEL = { call: "Called", text: "Texted", email: "Emailed" };

// Log that you reached them, now, this way. The date and time are the moment
// of the tap. Says so, offers Undo, and calls back so the view can redraw.
function logContactFor(l, via, onChange) {
  const prev = { lastContacted: l.lastContacted, lastContactVia: l.lastContactVia };
  let rec;
  try {
    rec = store.logContact(l.id, { via });
  } catch (err) {
    toast(`Couldn't log it — ${(err && err.message) || "try again"}`, "danger");
    return null;
  }
  if (onChange) onChange(rec);
  // On disk before anyone walks away. A failed write is said out loud.
  store.flush().then(() => { const err = store.saveError(); if (err) toast(`Not saved — this phone's storage refused the write (${err.message || err}).`, "danger"); });
  undoToast(`${VIA_LABEL[via]} ${l.name} · ${formatDateTime(rec.at)}`, () => {
    store.undoContact(rec.id, l.id, prev);
    if (onChange) onChange(null);
  });
  return rec;
}

// "What happened?" — said, or typed. Listening starts the moment the panel
// appears (the tap that opened it is the gesture the microphone needs), the
// words land in the box as they come, and Save puts them on the customer's
// profile as a dated note and on the contact itself, so the thread shows
// what the call was about. No engine, a blocked mic, a bad signal: the box
// is there to type into, and the keyboard's own mic key still dictates.
function notePanel(l, rec, onDone) {
  const panel = document.createElement("div");
  panel.className = "note-panel";
  panel.innerHTML = `
    <div class="row-title" style="margin-bottom:6px">${esc(l.name)}</div>
    <div class="note-status listening">${icon("mic")} <span>Listening… say what happened</span></div>
    <textarea data-f="note" placeholder="Left a voicemail · wants to come Saturday · asked about the SV"></textarea>
    <div class="btn-row">
      <button type="button" class="btn btn-primary" data-act="save" style="flex:1">Save note</button>
      <button type="button" class="btn btn-ghost" data-act="stop">Stop</button>
      <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
    </div>`;
  // The card behind this is a button and a swipe. Neither may hear these taps.
  ["pointerdown", "click"].forEach((t) => panel.addEventListener(t, (ev) => ev.stopPropagation()));
  const status = panel.querySelector(".note-status");
  const box = panel.querySelector('[data-f="note"]');
  const stopBtn = panel.querySelector('[data-act="stop"]');
  const say = (text, cls) => { status.className = `note-status${cls ? " " + cls : ""}`; status.innerHTML = `${icon(cls === "listening" ? "mic" : "edit")} <span>${esc(text)}</span>`; };
  let heard = "";
  const d = dictate({
    onInterim: (t) => { box.value = t; },
    onFinal: (t) => { heard = t; if (t) box.value = t; say(t ? "Heard. Fix anything, then Save." : "Didn't catch that — type it, or use your keyboard's mic."); stopBtn.hidden = true; if (!t) box.focus(); },
    onFallback: (why, partial) => { if (partial) box.value = partial; say(why); stopBtn.hidden = true; box.focus(); },
  });
  stopBtn.addEventListener("click", () => d.stop());
  const finish = (saved) => { try { d.stop(); } catch { } panel.remove(); if (onDone) onDone(saved); };
  panel.querySelector('[data-act="save"]').addEventListener("click", () => {
    const note = box.value.trim() || heard;
    if (!note) { say("Nothing to save yet — say it or type it."); box.focus(); return; }
    try {
      store.bulk(() => {
        addContext(l.id, { note });
        if (rec && store.get("calls", rec.id)) store.update("calls", rec.id, { notes: note });
      });
      // What the app does with it: booked, found, drafted, dated — taken
      // now and shown back where the panel was.
      const { moves } = nextMoves(l.id, note);
      panel.replaceWith(movesEl(l, moves, () => { if (onDone) onDone(true); }));
      try { d.stop(); } catch { }
      // The moves stay up long enough to read, then the view carries on.
      setTimeout(() => { if (onDone) onDone(true); }, 7000);
    } catch (err) {
      toast(`Couldn't save — ${(err && err.message) || "try again"}`, "danger");
    }
  });
  panel.querySelector('[data-act="cancel"]').addEventListener("click", () => finish(false));
  return panel;
}

// The customer's Next moves card: what's booked, what's drafted and waiting
// for an OK, what to call about, what to do — soonest first, each one a
// thing to tap. Empty, it offers the two moves that start everything.
function movesCard(l) {
  const box = document.createElement("div");
  box.className = "card nm-card";
  const draw = () => {
    const today = todayISO();
    const appts = store.all("appointments")
      .filter((a) => a.leadId === l.id && a.status !== "cancelled" && !a.outcome && String(a.when || "").slice(0, 10) >= today)
      .sort((a, b) => String(a.when).localeCompare(String(b.when)));
    const pr = { high: 0, normal: 1, low: 2 };
    const tasks = store.all("tasks").filter((t) => t.leadId === l.id && !t.done)
      .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")) || (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1))
      .slice(0, 8);
    if (!appts.length && !tasks.length) {
      const canPlan = !["sold", "delivered", "lost"].includes(l.stage) && !hasCadence(l.id);
      box.innerHTML = `
        <div class="muted small" style="margin-bottom:10px">Nothing set up yet. Add context above and the app works out the moves — or start with one of these.</div>
        <div class="btn-row">
          ${canPlan ? `<button type="button" class="btn btn-primary btn-sm" data-act="plan" style="flex:1">${icon("target")} Start the follow-up plan</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-act="book" style="flex:1">${icon("calendar")} Book a visit</button>
        </div>`;
      const plan = box.querySelector('[data-act="plan"]');
      if (plan) plan.addEventListener("click", () => { const n = startCadence(l.id); toast(n ? `${n}-step plan started — the first text is being drafted` : "Couldn't start a plan", n ? "success" : "danger"); draw(); });
      box.querySelector('[data-act="book"]').addEventListener("click", () => openAppointmentForm(null, { customerName: l.name, vehicle: l.vehicleInterest || "", leadId: l.id }));
      return;
    }
    const strip = (t) => t.title.replace(/^(Text|Call|Email) \S+ — /, "");
    const rows = [
      ...appts.map((a) => ({ key: "a:" + a.id, ico: "calendar", title: `${a.type === "testdrive" ? "Test drive" : a.title || "Appointment"} · ${formatDateTime(a.when)}`, sub: a.confirmed ? "Confirmed" : "Not confirmed yet", act: "appt", a })),
      ...tasks.map((t) => ({ key: "t:" + t.id, ico: t.channel === "text" ? "message" : t.channel === "call" ? "phone" : t.channel === "email" ? "mail" : t.source === "context" ? "sparkles" : "check",
        title: t.cadence ? strip(t) : t.title, sub: (t.at ? formatDateTime(t.at) : t.due ? relativeDay(t.due) : "") + (t.cadence ? " · from the plan" : t.source === "context" ? " · from your context" : ""), act: t.cadence && t.channel === "text" ? "review" : t.channel === "call" && l.phone ? "call" : "task", t })),
    ];
    box.innerHTML = rows.map((r, i) => `
      <div class="nm-row" data-i="${i}">
        <span class="nm-ico">${icon(r.ico)}</span>
        <div class="nm-main"><div class="nm-t">${esc(r.title)}</div>${r.sub ? `<div class="nm-s">${esc(r.sub)}</div>` : ""}</div>
        ${r.act === "review" ? `<button type="button" class="btn btn-primary btn-sm" data-act="review">Review</button>` : ""}
        ${r.act === "call" ? `<a class="btn btn-success btn-sm" data-act="call" href="${telHref(l.phone)}">${icon("phone")} Call</a>` : ""}
        ${r.act === "appt" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="appt">Open</button>` : `<button type="button" class="btn btn-ghost btn-sm" data-act="done" aria-label="Done">${icon("check")}</button>`}
      </div>`).join("");
    const complete = (t) => {
      store.bulk(() => {
        store.update("tasks", t.id, { done: true });
        if (t.cadence || t.channel) { store.logActivity("touch"); store.update("leads", l.id, { lastContacted: new Date().toISOString() }); }
      });
      toast("Done", "success");
      draw();
    };
    box.querySelectorAll(".nm-row").forEach((rowEl) => {
      const r = rows[Number(rowEl.dataset.i)];
      const on = (sel, fn) => { const n = rowEl.querySelector(sel); if (n) n.addEventListener("click", fn); };
      on('[data-act="review"]', async (ev) => { ev.currentTarget.disabled = true; try { await reviewTouch(r.t.id); } finally { ev.currentTarget.disabled = false; } });
      on('[data-act="call"]', () => { store.logCall(l.id, {}); });
      on('[data-act="done"]', () => complete(r.t));
      on('[data-act="appt"]', () => openAppointmentForm(r.a));
      const main = rowEl.querySelector(".nm-main");
      if (r.act === "task" || r.act === "call") main.addEventListener("click", () => openTaskForm(r.t));
      else if (r.act === "review") main.addEventListener("click", () => reviewTouch(r.t.id));
      else if (r.act === "appt") main.addEventListener("click", () => openAppointmentForm(r.a));
    });
  };
  draw();
  return box;
}

// "Here's what I did with that." Each move on its own line, with the
// detail under it; any that made something can be taken back on the spot.
const MOVE_ICON = { stage: "tag", appointment: "calendar", text: "message", stock: "car", budget: "dollar", people: "users", trade: "tag", objection: "compare", later: "clock", finance: "file", referral: "users", plan: "target", task: "check" };
function movesEl(l, moves, onDone) {
  const box = document.createElement("div");
  box.className = "moves";
  ["pointerdown", "click"].forEach((t) => box.addEventListener(t, (ev) => ev.stopPropagation()));
  box.innerHTML = `
    <div class="moves-title">${icon("sparkles")} Next moves for ${esc(first(l.name))}</div>
    ${moves.map((m, i) => `
      <div class="move" data-i="${i}">
        <span class="move-ico">${icon(MOVE_ICON[m.kind] || "check")}</span>
        <div class="move-main"><div class="move-t">${esc(m.title)}${m.updated ? ` <span class="badge badge-soon">moved</span>` : ""}</div>${m.when || m.detail ? `<div class="move-d">${m.when ? `<b>${esc(formatDateTime(m.when))}</b>${m.detail ? " · " : ""}` : ""}${m.detail ? esc(m.detail) : ""}</div>` : ""}</div>
        ${m.kind === "text" && m.taskId ? `<button type="button" class="btn btn-primary btn-sm" data-act="review">Review</button>` : ""}
        ${m.taskId || m.appointmentId ? `<button type="button" class="btn btn-ghost btn-sm" data-act="undo">Undo</button>` : ""}
      </div>`).join("")}
    <div class="btn-row" style="margin-top:8px">
      ${moves.some((m) => m.kind === "text") ? `<button type="button" class="btn btn-primary btn-sm" data-act="home" style="flex:1">${icon("message")} Review the texts</button>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-act="ok" style="flex:1">OK</button>
    </div>`;
  box.querySelectorAll('[data-act="undo"]').forEach((b) => b.addEventListener("click", () => {
    const row = b.closest(".move");
    const m = moves[Number(row.dataset.i)];
    undoMove(m);
    row.classList.add("move-undone");
    b.remove();
  }));
  box.querySelectorAll('[data-act="review"]').forEach((b) => b.addEventListener("click", async () => {
    const m = moves[Number(b.closest(".move").dataset.i)];
    b.disabled = true;
    try { await reviewTouch(m.taskId); } finally { b.disabled = false; }
  }));
  box.querySelector('[data-act="ok"]').addEventListener("click", () => { box.remove(); if (onDone) onDone(); });
  const home = box.querySelector('[data-act="home"]');
  if (home) home.addEventListener("click", () => { box.remove(); navigate("/"); });
  return box;
}
const first = (name) => String(name || "there").trim().split(/\s+/)[0];

// The same question, inline, for the customer's page: a row of buttons that
// appears under "Last contacted" when that row is tapped. After the tap, the
// row becomes the note panel, then the page redraws.
function contactWays(l, onDone) {
  const row = document.createElement("div");
  row.className = "contact-ways";
  row.innerHTML = WAYS.map((w) => `<button type="button" class="btn btn-ghost" data-via="${w.via}">${icon(w.icon)}<span>${w.label}</span></button>`).join("")
    + `<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>`;
  row.querySelectorAll("[data-via]").forEach((b) => b.addEventListener("click", () => {
    const rec = logContactFor(l, b.dataset.via, null);
    if (!rec) { row.remove(); return; }
    const panel = notePanel(l, rec, () => { if (onDone) onDone(rec); });
    row.replaceWith(panel);
  }));
  row.querySelector('[data-act="cancel"]').addEventListener("click", () => row.remove());
  return row;
}

// --- Add / edit form ---
// opts.focus: field name to focus once open (tap-to-edit from the detail page).
// The 60-second money form: everything the deal engine runs on, in one sheet.
// Fill it from a call ("what are you paying? what's the buyout?") and the
// pre-made deal recomputes on the spot.
export function openMoneyForm(l) {
  openModal("Their numbers", (close) => {
    const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
    const estD = l.currentValue == null ? estimateTradeDetail(l) : null;
    const { element } = buildForm(
      [
        { name: "currentPayment", label: "Current payment $/mo", value: l.currentPayment, type: "number", inputmode: "decimal", half: true, placeholder: "532" },
        { name: "payoff", label: "Payoff / buyout $", value: l.payoff, type: "number", inputmode: "decimal", half: true, placeholder: "19455", hint: "Blank = current payment × payments left to maturity." },
        { name: "currentValue", label: "Trade value $ (appraised)", value: l.currentValue, type: "number", inputmode: "decimal", half: true, placeholder: "21500", hint: estD ? `Blank = estimate ≈ ${currency(estD.value)} (${estD.lines.join(" · ")})` : "Leave blank to use a book estimate." },
        { name: "currentApr", label: "Their rate %", value: l.currentApr, type: "number", inputmode: "decimal", half: true, placeholder: "8.9", hint: "Blank = solved from payment, payoff & maturity when possible." },
        { name: "paymentsLeft", label: "Payments left (as of today)", value: l.paymentsLeft, type: "number", inputmode: "numeric", half: true, placeholder: "23", hint: "Counts down by itself from today." },
        { name: "dealType", label: "Deal type", value: /lease/i.test(String(l.dealType || "")) ? "Lease" : /retail|finance|loan/i.test(String(l.dealType || "")) ? "Finance" : "", type: "select", half: true, options: [{ value: "", label: "Not set" }, { value: "Finance", label: "Finance" }, { value: "Lease", label: "Lease" }] },
        { name: "leaseEnd", label: "Contract maturity date", value: l.leaseEnd || "", type: "date", half: true },
        { name: "currentTerm", label: "Original term (mo)", value: l.currentTerm, type: "number", inputmode: "numeric", half: true, placeholder: "72" },
        { name: "odometer", label: "Odometer (km)", value: l.odometer, type: "number", inputmode: "numeric", half: true, placeholder: "48000", hint: "Feeds the km adjustment on the estimate." },
        { name: "tradeCondition", label: "Trade condition", value: l.tradeCondition || "", type: "select", half: true, options: [
          { value: "", label: "Not graded" },
          { value: "clean", label: "Clean (+5%)" },
          { value: "average", label: "Average" },
          { value: "rough", label: "Rough (−15%)" },
        ] },
      ],
      {
        submitLabel: "Save & rebuild deal",
        onSubmit: (data) => {
          store.update("leads", l.id, {
            currentPayment: numOrNull(data.currentPayment),
            payoff: numOrNull(data.payoff),
            currentValue: numOrNull(data.currentValue),
            currentApr: numOrNull(data.currentApr),
            leaseEnd: data.leaseEnd || null,
            currentTerm: numOrNull(data.currentTerm),
            // A count entered today counts down from today; unchanged, it keeps its own date.
            paymentsLeft: numOrNull(data.paymentsLeft),
            paymentsLeftAsOf: numOrNull(data.paymentsLeft) == null ? null : (numOrNull(data.paymentsLeft) === (l.paymentsLeft == null || l.paymentsLeft === "" ? null : Number(l.paymentsLeft)) && l.paymentsLeftAsOf) ? l.paymentsLeftAsOf : new Date().toISOString().slice(0, 10),
            dealType: data.dealType || l.dealType || "",
            odometer: numOrNull(data.odometer),
            tradeCondition: data.tradeCondition || null,
          });
          toast("Deal inputs updated", "success");
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    return element;
  });
}

export function openLeadForm(existing, opts = {}) {
  const isEdit = !!existing;
  const l = existing || {};
  openModal(isEdit ? "Edit lead" : "New lead", (close) => {
    const { element } = buildForm(
      [
        { name: "name", label: "Customer name", value: l.name, required: true, placeholder: "Jane Doe" },
        { name: "phone", label: "Phone", value: l.phone, type: "tel", inputmode: "tel", half: true, placeholder: "(555) 123-4567" },
        { name: "email", label: "Email", value: l.email, type: "email", half: true, placeholder: "jane@email.com" },
        { name: "vehicleInterest", label: "Vehicle of interest", value: l.vehicleInterest, placeholder: "2024 RAV4 XLE" },
        { name: "source", label: "Lead source", value: l.source || "Walk-in", type: "select",
          options: ["Walk-in", "Internet", "Phone-in", "Referral", "Repeat", "Service", "Other"] },
        { name: "stage", label: "Stage", value: l.stage || "new", type: "select",
          options: LEAD_STAGES.map((s) => ({ value: s.id, label: s.label })), half: true },
        { name: "followUp", label: "Next follow-up", value: l.followUp || "", type: "date", half: true },
        { name: "dob", label: "Birthday (optional)", value: l.dob || "", type: "date", half: true },
        { name: "leaseEnd", label: "Lease end (optional)", value: l.leaseEnd || "", type: "date", half: true },
        { name: "notes", label: "Notes", value: l.notes, type: "textarea", placeholder: "Trade-in, budget, timeline, hot buttons…" },
      ],
      {
        submitLabel: isEdit ? "Save changes" : "Add lead",
        onSubmit: (data) => {
          if (isEdit) {
            store.update("leads", existing.id, data);
            toast("Lead updated", "success");
          } else {
            const lead = store.create("leads", data);
            const n = maybeStartCadence(lead.id);
            toast(n ? `Lead added — ${n}-step follow-up plan started` : "Lead added", "success");
          }
          close();
          // Refresh current view.
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    // Land on the field the user tapped (after the sheet's slide-up).
    if (opts.focus) setTimeout(() => element.querySelector(`[name="${opts.focus}"]`)?.focus(), 150);
    return element;
  });
}

// --- Detail page ---
function renderLeadDetail(view, id) {
  const l = store.get("leads", id);
  if (!l) {
    view.innerHTML = emptyState("help", "Lead not found", "It may have been deleted.");
    return;
  }
  const st = stageMeta(l.stage);
  const linkedVehicle = l.vehicleId ? store.get("vehicles", l.vehicleId) : null;

  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Leads</button>

    <div class="card">
      <div class="row">
        <div class="row-main" data-edit="name" style="cursor:pointer">
          <div class="row-title" style="font-size:1.35rem">${esc(l.name)}</div>
          <div class="row-sub">${l.vehicleInterest ? esc(l.vehicleInterest) : "No vehicle noted — tap to add"}</div>
        </div>
        <button class="info-btn" data-act="info" aria-label="Details, history and actions" title="Details">i</button>
      </div>

      ${(l.phone || l.email) ? `
      <div class="btn-row" style="margin-top:14px">
        ${l.phone ? `<a class="btn btn-success btn-sm" data-act="call" style="flex:1" href="${telHref(l.phone)}">${icon("phone")} Call</a>
        <a class="btn btn-primary btn-sm" data-act="text" style="flex:1" href="${smsHref(l.phone)}">${icon("message")} Text</a>` : ""}
        ${l.email ? `<a class="btn btn-primary btn-sm" data-act="email" style="flex:1" href="${mailtoHref(l.email)}">${icon("mail")} Email</a>` : ""}
      </div>` : ""}
      ${l.phone || l.email ? `<button class="btn btn-ghost btn-sm btn-block" data-act="templates" style="margin-top:8px">${icon("file")} Use a message template</button>` : ""}
      <div class="kv" data-act="contacted" style="cursor:pointer;margin-top:4px;padding:4px 0"><span class="k">Last contacted</span><span class="v">${l.lastContacted ? esc(formatDateTime(l.lastContacted)) + (l.lastContactVia ? ` <span class="muted small">· ${esc(l.lastContactVia)}</span>` : "") : "Tap to log"}</span></div>
      ${contractBanner(l, { tap: true })}
    </div>

    ${(() => {
      // What we know about them — first, under the name, before anything has
      // to be scrolled past: the structured facts, then the notes as spoken.
      // Every text in the plan is written from this card.
      const lines = profileLines(l);
      return `
    <div class="section-title">Context <span class="muted" style="font-weight:500;font-size:0.78rem">· every follow-up is written from this</span></div>
    <div class="card">
      ${lines.map((x) => `<div class="kv"><span class="k">${esc(x.label)}</span><span class="v">${esc(x.value)}</span></div>`).join("")}
      ${l.notes
        ? `<div data-edit="notes" style="white-space:pre-wrap;cursor:pointer;${lines.length ? "margin-top:10px;padding-top:10px;border-top:1px solid var(--border)" : ""}">${esc(l.notes)}</div>`
        : `<div class="muted small">Nothing yet. Tell the voice agent about them, or add it here — what they want, what they love, budget, timeline, who else decides.</div>`}
      <button class="btn btn-ghost btn-sm btn-block" data-act="add-context" style="margin-top:12px">${icon("mic")} Add context</button>
    </div>`;
    })()}

    ${(() => {
      // Their current contract in full — the summary line sits under the vehicle
      // in the name box; this is the payment, the
      // payments left and when it matures, read plainly from what's on file.
      const c = contractSummary(l);
      const e = equityDetail(l);
      const equityRow = e.v != null
        ? `<div class="kv"><span class="k">${e.v < 0 ? "Negative equity" : "Equity"}</span><span class="v mono" style="color:${e.v >= 0 ? "var(--success)" : "var(--danger)"}">${e.v < 0 ? "− " + currency(-e.v) : currency(e.v)}${e.src === "est" ? ` <span class="muted small">est.</span>` : ""}</span></div>`
        : "";
      if (!c) return `
    <div class="section-title">Current contract</div>
    <div class="card card-tap" data-act="money">
      <div class="muted small">Nothing on file yet — tap to add their payment, payments left and payoff.</div>
    </div>`;
      const pct = c.term && c.paid != null ? Math.round(c.paid / c.term * 100) : null;
      return `
    <div class="section-title">Current contract <span class="muted" style="font-weight:500;font-size:0.78rem">· tap to edit</span></div>
    <div class="card card-tap contract-card${c.paidOff ? " contract-done" : ""}" data-act="money">
      <div class="contract-head">
        <div class="contract-pay">${c.paidOff ? "Paid off" : c.payment != null ? currency(c.payment) + "<span class=\"contract-per\">/mo</span>" : "Payment unknown"}</div>
        <div class="contract-left">${c.paidOff ? (c.matures ? "matured " + esc(c.matures.toLocaleDateString("en-CA", { month: "short", year: "numeric" })) : "") : c.left != null ? `<b>${c.left}</b> payment${c.left === 1 ? "" : "s"} left` : "payments left unknown"}</div>
      </div>
      ${pct != null && !c.paidOff ? `<div class="contract-bar"><div class="contract-bar-fill" style="width:${pct}%"></div></div><div class="small muted" style="margin-top:4px">${c.paid} of ${c.term} paid${c.matures ? " · matures " + esc(c.matures.toLocaleDateString("en-CA", { month: "long", year: "numeric" })) : ""}</div>` : ""}
      <div style="margin-top:${pct != null ? 8 : 4}px">
        ${c.rows.filter((r) => r[0] !== "Payment" && !(pct != null && (r[0] === "Payments left" || r[0] === "Matures"))).map((r) => `<div class="kv"><span class="k">${esc(r[0])}</span><span class="v mono">${esc(r[1])}</span></div>`).join("")}
        ${equityRow}
      </div>
    </div>`;
    })()}

    <div class="section-title">Next moves <span class="muted" style="font-weight:500;font-size:0.78rem">· what the app set up from the context</span></div>
    <div id="moves-slot"></div>

    ${(() => {
      // Why now: the read of this customer in full, and the next move.
      const a = assessment(l.id);
      if (!a) return "";
      const tier = a.tier ? `<span class="badge ${a.tier.badge}">${esc(a.tier.label)}</span>` : `<span class="badge badge-delivered">No reason yet</span>`;
      return `
    <div class="section-title">Why now <span class="muted" style="font-weight:500;font-size:0.78rem">· score ${a.score}</span></div>
    <div class="card why-card">
      <div class="row" style="margin-bottom:${a.why.length ? 10 : 0}px"><div class="row-main"><div class="strong">${tier} ${a.next ? esc(a.next.label) : ""}</div></div></div>
      ${a.why.length ? `<ul class="why-list">${a.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<div class="muted small">Nothing on file points to a deal yet — add their payment, payoff and vehicle (Their numbers) and this fills in.</div>`}
      ${a.next && a.next.kind === "opener" && l.phone ? `
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-primary" data-act="opener" style="flex:1">${icon("message")} Review the opener</button>
        <button class="btn btn-ghost" data-act="snooze" style="flex:0 0 auto">Not now</button>
      </div>` : ""}
    </div>`;
    })()}

    <div id="deal-slot"></div>


    ${(() => {
      const steps = planSteps(l.id);
      const short = (t) => t.title.replace(/^\w+ \S+ — /, "");
      return `
    <div class="section-title">Follow-up plan</div>
    <div class="card">
      ${steps.length ? `
        <div class="small muted" style="margin-bottom:8px">${esc(planSummary(l.id))}</div>
        ${steps.slice(0, 5).map((t) => `<div class="kv" style="align-items:flex-start"><span class="k" style="flex:none">${esc(relativeDay(t.due))}</span><span class="v" style="text-align:left;flex:1">${icon(t.channel === "call" ? "phone" : t.channel === "email" ? "mail" : "message")} ${esc(short(t))}</span></div>`).join("")}
        ${steps.length > 5 ? `<div class="small muted" style="margin-top:6px">+ ${steps.length - 5} more, out to 90 days. Texts are drafted from the context above and wait for your OK on Home.</div>` : ""}`
      : `<div class="muted small">${["sold", "delivered", "lost"].includes(l.stage) ? "No plan running." : "No plan running — start one below and every text in it is drafted for you."}</div>`}
    </div>`;
    })()}

  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => navigate("/leads"));
  el.querySelectorAll('[data-act="money"]').forEach((n) => n.addEventListener("click", () => openMoneyForm(l)));
  // Tap-to-edit: the name box opens the form focused on that field.
  el.querySelectorAll("[data-edit]").forEach((n) =>
    n.addEventListener("click", () => openLeadForm(l, { focus: n.dataset.edit })));
  el.querySelector('[data-act="info"]').addEventListener("click", () => openInfoSheet());
  // The last contact, on the name box, with a tap to log another.
  el.querySelector('#view [data-act="contacted"], [data-act="contacted"]').addEventListener("click", (ev) => {
    const kv = ev.currentTarget;
    const existing = kv.nextElementSibling;
    if (existing && existing.classList.contains("contact-ways")) { existing.remove(); return; }
    kv.after(contactWays(l, () => window.dispatchEvent(new HashChangeEvent("hashchange"))));
  });
  // The customer's own to-do list: the moves made from their context, and
  // the plan's next steps, soonest first — each one something to act on.
  el.querySelector("#moves-slot").appendChild(movesCard(l));

  // A sync that changes this customer — their record, a contact, a step —
  // redraws the page in place, keeping the scroll. A fresh install opening
  // straight onto a customer sees them fill in rather than stay blank.
  const drawnAt = [l.updatedAt, store.generation("calls"), store.generation("tasks"), store.generation("appointments")].join("|");
  const onSynced = (e) => {
    if (!el.isConnected) { window.removeEventListener("viniva-sync", onSynced); return; }
    const d = e.detail || {};
    if (d.status !== "synced" || !d.applied) return;
    const now = store.get("leads", id);
    const key = [now && now.updatedAt, store.generation("calls"), store.generation("tasks"), store.generation("appointments")].join("|");
    if (key === drawnAt) return;
    window.removeEventListener("viniva-sync", onSynced);
    const y = view.scrollTop;
    view.replaceChildren();
    renderLeadDetail(view, id);
    view.scrollTop = y;
  };
  window.addEventListener("viniva-sync", onSynced);

  const tmplBtn = el.querySelector('[data-act="templates"]');
  if (tmplBtn) tmplBtn.addEventListener("click", () => openTemplatePicker(l));

  const openerBtn = el.querySelector('[data-act="opener"]');
  if (openerBtn) openerBtn.addEventListener("click", async () => {
    openerBtn.disabled = true; openerBtn.textContent = "Drafting…";
    try { await reviewProspect(l.id); }
    finally { openerBtn.disabled = false; openerBtn.innerHTML = `${icon("message")} Review the opener`; }
  });
  const snoozeBtn = el.querySelector('[data-act="snooze"]');
  if (snoozeBtn) snoozeBtn.addEventListener("click", () => {
    const until = snoozeProspect(l.id);
    toast(`Parked until ${until}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

  // Typed context goes the same way as spoken context: onto the record whole,
  // and if nobody has started working this person yet, that starts now.
  el.querySelector('[data-act="add-context"]').addEventListener("click", (ev) => {
    // Say it. The panel that follows a logged contact, here without one;
    // Save adds the note and starts the follow-up plan if there isn't one.
    const btn = ev.currentTarget;
    if (btn.nextElementSibling && btn.nextElementSibling.classList.contains("note-panel")) return;
    btn.hidden = true;
    btn.after(notePanel(l, null, (saved) => {
      btn.hidden = false;
      if (saved) window.dispatchEvent(new HashChangeEvent("hashchange"));
    }));
  });

  // Log outreach as a "touch" and stamp last-contacted when calling/texting.
  const logTouch = () => {
    store.logActivity("touch");
    store.update("leads", l.id, { lastContacted: new Date().toISOString() });
  };
  const callBtn = el.querySelector('[data-act="call"]');
  if (callBtn) callBtn.addEventListener("click", logTouch);
  const textBtn = el.querySelector('[data-act="text"]');
  if (textBtn) textBtn.addEventListener("click", logTouch);
  const emailBtn = el.querySelector('[data-act="email"]');
  if (emailBtn) emailBtn.addEventListener("click", () => {
    logTouch();
    logEmail(l.id, { direction: "out", subject: "", body: "", via: "mail-app" });
  });

  // The deal is pre-made: best payment-matched option front and center, two
  // alternates under it, the offer text one tap away. No button hunting.
  //
  // Replacement options: the vehicles this customer would move into, each
  // with its payment. The app suggests the closest fits to what they drive;
  // the salesperson adds any unit from the lot or the lineup with one tap
  // in the picker, and the shortlist is kept on the customer.
  function buildDealSection() {
    const slot = el.querySelector("#deal-slot");
    if (!slot || l.stage === "lost") return;
    const fresh = store.get("leads", l.id) || l;
    const vname = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
    const all = pitchList(fresh, 0);
    if (!all.length) { slot.innerHTML = ""; return; }
    const byKey = new Map(all.map((m) => [vehicleKey(m.vehicle), m]));
    const picked = (fresh.shortlist || []).map((k) => byKey.get(k)).filter(Boolean);
    const pickedKeys = new Set(picked.map((m) => vehicleKey(m.vehicle)));
    const suggested = all.filter((m) => !pickedKeys.has(vehicleKey(m.vehicle))).slice(0, Math.max(1, 3 - picked.length));
    const rows = [...picked.map((m) => ({ m, picked: true })), ...suggested.map((m) => ({ m, picked: false }))];
    const deltaLine = (m) => (paymentDelta(m.delta) || { text: "" }).text;
    const deltaColor = (m) => (paymentDelta(m.delta) || { color: "var(--muted)" }).color;
    const first = rows[0].m;
    const rowHTML = ({ m, picked }, i) => `
      <div class="row ro-row" data-deal-open="${i}" style="cursor:pointer">
        <div class="row-main" style="min-width:0">
          <div class="row-title">${esc(vname(m.vehicle))}${picked ? ` <span class="badge badge-working" style="margin-left:4px">picked</span>` : i === 0 ? ` <span class="badge badge-sold" style="margin-left:4px">best fit</span>` : ""}</div>
          <div class="row-sub">${m.vehicle.price != null ? currency(m.vehicle.price) : ""}${m.vehicle.lineup ? " · new — order/allocate" : m.vehicle.stock ? " · #" + esc(m.vehicle.stock) : ""} · ${m.method === "lease" ? "lease" : "finance"}${m.special ? " · 🏷 " + esc(m.special) : ""}</div>
        </div>
        <div class="row-meta" style="flex:none;text-align:right">
          <div class="strong mono" style="font-size:1.15rem">${currency(Math.round(m.monthly))}<span class="muted" style="font-size:0.75rem">/mo</span></div>
          <div class="small strong" style="color:${deltaColor(m)}">${deltaLine(m)}</div>
        </div>
        ${picked ? `<button class="modal-close ro-remove" data-unpick="${esc(vehicleKey(m.vehicle))}" aria-label="Remove" title="Remove from the list">&times;</button>` : ""}
      </div>`;
    slot.innerHTML = `
      <div class="section-title">Replacement options <span class="muted" style="font-weight:500;font-size:0.78rem">· tap one for the full breakdown</span></div>
      <div class="card">
        ${fresh.currentPayment != null ? `<div class="small muted" style="margin-bottom:6px">They pay ${currency(fresh.currentPayment)}/mo now${fresh.vehicleInterest ? " on the " + esc(fresh.vehicleInterest) : ""}.</div>` : `<div class="small muted" style="margin-bottom:6px">No current payment on file — payments shown, not compared.</div>`}
        <div class="ro-list">${rows.map(rowHTML).join("")}</div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-primary btn-sm" data-act="pick-vehicle" style="flex:1.2">${icon("car")} Pick a vehicle</button>
          ${fresh.phone ? `<a class="btn btn-ghost btn-sm" data-act="deal-offer" style="flex:1" href="${smsHref(fresh.phone, offerText(fresh, first))}">${icon("message")} Text the top one</a>` : ""}
        </div>
        <button class="btn btn-ghost btn-sm btn-block" data-act="deal-more" style="margin-top:8px">Every option, with cash down</button>
        ${(() => {
          // What this deal stands on — every input with its provenance, and a
          // one-tap way to replace an estimate with the real number.
          const inp = dealInputs(fresh);
          const chip = (label, x, fmt) => {
            const cls = x.src === "known" ? "di-known" : (x.src === "missing" || x.src === "default") ? "di-miss" : "di-est";
            const mark = x.src === "known" ? "✓" : x.src === "missing" ? "+" : "≈";
            const tag = x.src === "book" ? " est" : x.src === "calc" ? " calc" : x.src === "wash" ? " assumed" : x.src === "default" ? " assumed" : "";
            return `<span class="di-chip ${cls}">${mark} ${label} ${x.v != null ? fmt(x.v) : "add"}${tag}</span>`;
          };
          const strip = [
            chip("pmt", inp.payment, (v) => currency(Math.round(v))),
            chip("payoff", inp.payoff, (v) => currency(Math.round(v))),
            chip("trade", inp.value, (v) => currency(Math.round(v))),
            chip("rate", inp.apr, (v) => v + "%"),
            inp.maturity.v != null ? chip("mat.", inp.maturity, (v) => v + " mo") : "",
          ].join("");
          return `<div class="di-strip" data-act="deal-numbers" title="Update their numbers" style="margin-top:10px">${strip}<span class="di-chip di-edit">edit</span></div>`;
        })()}
      </div>`;

    const offer = slot.querySelector('[data-act="deal-offer"]');
    if (offer) offer.addEventListener("click", (ev) => {
      ev.stopPropagation();
      store.logActivity("touch");
      store.update("leads", l.id, { lastContacted: new Date().toISOString() });
    });
    slot.querySelectorAll("[data-deal-open]").forEach((n) =>
      n.addEventListener("click", (ev) => { if (ev.target.closest("[data-unpick]")) return; openDealDetail(fresh, rows[Number(n.dataset.dealOpen)].m); }));
    slot.querySelectorAll("[data-unpick]").forEach((n) => n.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const cur = store.get("leads", l.id);
      store.update("leads", l.id, { shortlist: (cur.shortlist || []).filter((k) => k !== n.dataset.unpick) });
      buildDealSection();
    }));
    slot.querySelector('[data-act="pick-vehicle"]').addEventListener("click", () => openVehiclePicker(fresh, all, (m) => {
      const cur = store.get("leads", l.id);
      const k = vehicleKey(m.vehicle);
      const list = (cur.shortlist || []).filter((x) => x !== k);
      store.update("leads", l.id, { shortlist: [k, ...list].slice(0, 8) });
      toast(`${vname(m.vehicle)} added — ${currency(Math.round(m.monthly))}/mo`, "success");
      buildDealSection();
    }));
    slot.querySelector('[data-act="deal-more"]').addEventListener("click", () => openDealBuilder(fresh));
    const nums = slot.querySelector('[data-act="deal-numbers"]');
    if (nums) nums.addEventListener("click", (ev) => { ev.stopPropagation(); openMoneyForm(fresh); });
  }
  buildDealSection();

  // Everything that isn't the read of the customer — their details, stage,
  // texting consent, follow-up, contact history and the actions — lives
  // behind the "i" on the name box, so the page itself is the customer.
  function historyHTML() {
    const items = [];
    store.all("calls").filter((c) => c.leadId === l.id).forEach((c) => items.push({ at: c.at || c.createdAt, kind: c.via === "text" ? "text" : c.via === "email" ? "email" : "call", dir: c.dir || "out", line: `${c.logged ? "Logged " : ""}${c.via === "text" ? "text" : c.via === "email" ? "email" : "call"}${c.outcome && c.outcome !== "reached" ? " · " + c.outcome : ""}${c.notes ? " — " + c.notes : ""}` }));
    store.all("texts").filter((t) => t.leadId === l.id).forEach((t) => items.push({ at: t.at || t.createdAt, kind: "text", dir: t.dir, line: String(t.body || "").slice(0, 110) }));
    emailsForLead(l.id).forEach((e) => items.push({ at: e.receivedAt || e.createdAt, kind: "email", dir: e.direction, line: (e.subject || "(no subject)") + (e.via === "auto" ? " · sent automatically" : e.via === "outlook" ? " · from Outlook" : "") }));
    items.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    if (!items.length) return `<div class="muted small">No calls, texts or emails logged yet.</div>`;
    return items.slice(0, 40).map((x) => `
      <div class="kv hist-row" style="align-items:flex-start">
        <span class="k" style="flex:none">${icon(x.kind === "call" ? "phone" : x.kind === "email" ? "mail" : "message")} ${x.dir === "in" ? "↓" : "↑"}</span>
        <span class="v" style="text-align:left;flex:1;font-weight:500">${esc(x.line)}<div class="small muted" style="font-weight:450">${esc(formatDateTime(x.at))}</div></span>
      </div>`).join("");
  }
  function openInfoSheet() {
    openModal(l.name, (close) => {
      const cur = store.get("leads", l.id) || l;
      const c = consentStatus(cur);
      const cBadge = c.basis === "express" ? "badge-sold" : c.basis === "implied" ? "badge-soon" : c.basis === "withdrawn" ? "badge-lost" : "badge-due";
      const cLabel = c.basis === "express" ? "Express" : c.basis === "implied" ? "Implied" : c.basis === "withdrawn" ? "Withdrawn" : "None";
      const root = document.createElement("div");
      root.innerHTML = `
        <div class="section-title" style="margin-top:0">Details <span class="muted" style="font-weight:500;font-size:0.78rem">· tap a row to edit</span></div>
        <div class="card">
          <div class="kv" data-edit="phone" style="cursor:pointer"><span class="k">Phone</span><span class="v">${cur.phone ? esc(phoneDisplay(cur.phone)) : "Tap to add"}</span></div>
          <div class="kv" data-edit="email" style="cursor:pointer"><span class="k">Email</span><span class="v">${cur.email ? esc(cur.email) : "Tap to add"}</span></div>
          <div class="kv" data-edit="source" style="cursor:pointer"><span class="k">Source</span><span class="v">${esc(cur.source || "—")}</span></div>
          <div class="kv" data-edit="followUp" style="cursor:pointer"><span class="k">Follow-up</span><span class="v">${cur.followUp ? esc(relativeDay(cur.followUp)) + " (" + esc(formatDate(cur.followUp)) + ")" : "Tap to set"}</span></div>
          <div class="kv" data-act="contacted" style="cursor:pointer"><span class="k">Last contacted</span><span class="v">${cur.lastContacted ? esc(formatDateTime(cur.lastContacted)) + (cur.lastContactVia ? ` <span class="muted small">· ${esc(cur.lastContactVia)}</span>` : "") : "Tap to log"}</span></div>
          ${linkedVehicle ? `<div class="kv"><span class="k">Matched vehicle</span><span class="v">${esc(vehicleName(linkedVehicle))}</span></div>` : ""}
          <div class="kv"><span class="k">Added</span><span class="v">${esc(formatDate(cur.createdAt))}</span></div>
          <div class="kv" style="align-items:flex-start"><span class="k">Texting</span><span class="v" style="text-align:right"><span class="badge ${cBadge}">${cLabel}</span><div class="small muted" style="margin-top:3px">${esc(consentLine(c))}</div></span></div>
          <div class="btn-row" style="margin-top:8px">
            ${c.basis !== "express" ? `<button class="btn btn-ghost btn-sm" data-act="consent-express" style="flex:1">${icon("check")} Record express consent</button>` : ""}
            ${c.basis !== "withdrawn" ? `<button class="btn btn-ghost btn-sm" data-act="consent-withdraw" style="flex:0 0 auto">They said stop</button>` : `<button class="btn btn-ghost btn-sm" data-act="consent-express" style="flex:1">They've said yes again</button>`}
          </div>
        </div>

        <div class="section-title">Stage</div>
        <div class="card"><div class="btn-row">
          ${LEAD_STAGES.map((st) => `<button class="btn btn-sm ${st.id === cur.stage ? "btn-primary" : "btn-ghost"}" data-stage="${st.id}">${esc(st.label)}</button>`).join("")}
        </div></div>

        <div class="section-title">Contact history</div>
        <div class="card">
          <div class="hist-list">${historyHTML()}</div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn btn-ghost btn-sm" data-act="log-contact" style="flex:1">${icon("checkline")} Log a contact</button>
            <button class="btn btn-ghost btn-sm" data-act="log-email" style="flex:1">${icon("mail")} Log an email</button>
          </div>
        </div>

        <div class="section-title">Actions</div>
        <div class="card">
          <button class="btn btn-primary btn-block" data-act="find-car" style="margin-bottom:10px">${icon("search")} Find a car on O'Regan's</button>
          <button class="btn btn-ghost btn-block" data-act="cadence" style="margin-bottom:10px">${icon("bell")} ${hasCadence(l.id) ? "Follow-up plan is active" : "Start follow-up plan"}</button>
          <button class="btn btn-ghost btn-block" data-act="referral" style="margin-bottom:14px">${icon("users")} Ask for a referral</button>
          <div class="field">
            <label>Set / change follow-up</label>
            <input type="date" data-act="followup" value="${esc(cur.followUp || "")}" />
          </div>
          <div class="btn-row" style="margin-top:4px">
            <button class="btn btn-ghost btn-sm" data-act="followup-tomorrow">Tomorrow</button>
            <button class="btn btn-ghost btn-sm" data-act="followup-3">In 3 days</button>
            <button class="btn btn-ghost btn-sm" data-act="followup-week">In a week</button>
          </div>
          <hr class="divider" />
          <div class="btn-row">
            <button class="btn btn-ghost btn-block" data-act="appointment">${icon("calendar")} Schedule</button>
            <button class="btn btn-ghost btn-block" data-act="logsale">${icon("dollar")} Log sale</button>
          </div>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn btn-primary btn-block" data-act="edit">${icon("edit")} Edit</button>
            <button class="btn btn-success btn-block" data-act="deliver">${icon("check")} Start delivery</button>
          </div>
          <button class="btn btn-danger btn-block" data-act="delete" style="margin-top:10px">Delete lead</button>
        </div>`;

      const on = (sel, fn) => root.querySelectorAll(sel).forEach((n) => n.addEventListener("click", fn));
      // Something that changes the customer closes the sheet and redraws the page under it.
      const done = () => { close(); renderRefresh(view, id); };
      on("[data-edit]", (ev) => { close(); openLeadForm(cur, { focus: ev.currentTarget.dataset.edit }); });
      on('[data-act="edit"]', () => { close(); openLeadForm(cur); });
      on('[data-act="contacted"], [data-act="log-contact"]', (ev) => {
        const anchor = ev.currentTarget.closest(".card");
        const existing = anchor.querySelector(".contact-ways");
        if (existing) { existing.remove(); return; }
        anchor.appendChild(contactWays(cur, () => done()));
      });
      on('[data-act="consent-express"]', () => {
        close();
        openModal("Express consent", (close2) => {
          const { element } = buildForm(
            [{ name: "note", label: "How they gave it", value: "", placeholder: "Asked on the phone 14 Sep · ticked the box on the credit app · replied YES", required: true }],
            { submitLabel: "Record", onSubmit: (data) => { recordConsent(l.id, { basis: "express", note: data.note }); toast("Consent recorded", "success"); close2(); renderRefresh(view, id); } });
          return element;
        });
      });
      on('[data-act="consent-withdraw"]', async () => {
        if (!(await confirmDialog(`Stop texting ${l.name}? They'll be left out of every campaign and opener until they say yes again.`))) return;
        recordConsent(l.id, { basis: "withdrawn", note: "recorded by hand" });
        toast("Texting stopped");
        done();
      });
      on("[data-stage]", (ev) => {
        const stage = ev.currentTarget.dataset.stage;
        store.update("leads", l.id, { stage });
        toast(`Moved to ${stageMeta(stage).label}`, "success");
        close();
        if (stage === "sold") {
          const hasSale = store.all("sales").some((x) => x.leadId === l.id);
          if (!hasSale) { openSaleForm(null, { customerName: l.name, vehicle: l.vehicleInterest, leadId: l.id }, () => renderRefresh(view, id)); return; }
          afterSale(l.id, { vehicle: l.vehicleInterest || "" });
        } else if (stage === "lost") {
          closeFollowUps(l.id);
        }
        renderRefresh(view, id);
      });
      on('[data-act="log-email"]', () => {
        close();
        openModal("Log an email", (close2) => {
          const { element } = buildForm(
            [
              { name: "direction", label: "Direction", value: "in", type: "select", options: [{ value: "in", label: "Received from customer" }, { value: "out", label: "Sent to customer" }] },
              { name: "subject", label: "Subject", value: "", placeholder: "Re: the Rogue" },
              { name: "body", label: "Email text (optional)", value: "", type: "textarea", placeholder: "Paste the email here…" },
            ],
            { submitLabel: "Log it", onSubmit: (data) => {
              logEmail(l.id, { direction: data.direction, subject: data.subject, body: data.body, via: "manual" });
              if (data.direction === "out") logTouch();
              toast("Email logged", "success"); close2(); renderRefresh(view, id);
            } });
          return element;
        });
      });
      on('[data-act="cadence"]', () => {
        if (hasCadence(l.id)) { toast("Follow-up plan already running", ""); return; }
        const n = startCadence(l.id);
        toast(`${n}-step follow-up plan started`, "success");
        done();
      });
      on('[data-act="referral"]', () => { close(); openReferralCapture(l.name, l.id); });
      on('[data-act="find-car"]', () => { close(); openDealerSearch({ vehicleInterest: l.vehicleInterest, name: l.name }); });
      on('[data-act="appointment"]', () => { close(); openAppointmentForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest, type: "appointment" }); });
      on('[data-act="logsale"]', () => { close(); openSaleForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest }); });
      const fuInput = root.querySelector('[data-act="followup"]');
      fuInput.addEventListener("change", () => { store.update("leads", l.id, { followUp: fuInput.value || null }); toast("Follow-up set", "success"); done(); });
      const setFu = (days) => { const d = new Date(); d.setDate(d.getDate() + days); store.update("leads", l.id, { followUp: d.toISOString().slice(0, 10) }); toast("Follow-up set", "success"); done(); };
      on('[data-act="followup-tomorrow"]', () => setFu(1));
      on('[data-act="followup-3"]', () => setFu(3));
      on('[data-act="followup-week"]', () => setFu(7));
      on('[data-act="deliver"]', () => {
        const settings = store.getSettings();
        const checklist = settings.deliveryChecklist.map((label) => ({ label, done: false }));
        const d = store.create("deliveries", { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest || (linkedVehicle ? vehicleName(linkedVehicle) : ""), deliveryDate: "", status: "prep", checklist, notes: "" });
        store.update("leads", l.id, { stage: l.stage === "delivered" ? l.stage : "sold" });
        toast("Delivery started", "success");
        close();
        navigate(`/deliveries/${d.id}`);
      });
      on('[data-act="delete"]', async () => {
        if (await confirmDialog(`Delete ${l.name}? This can't be undone.`)) { store.remove("leads", l.id); toast("Lead deleted"); close(); navigate("/leads"); }
      });
      return root;
    }, { focus: false });
  }
}

function renderRefresh(view, id) {
  view.innerHTML = "";
  renderLeadDetail(view, id);
}

function vehicleName(v) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
}


// A sheet to pick any vehicle for a customer: the lot and the new lineup,
// searchable by model, trim, stock or year, each with the payment it would
// be for THIS customer. "Like theirs" puts the closest fits to what they
// drive first. One tap adds it to their replacement options.
function openVehiclePicker(lead, all, onPick) {
  const vname = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  let q = "", mode = "fit"; // fit | stock | lineup
  openModal("Pick a vehicle", (close) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="searchbar" style="margin-bottom:8px"><input type="search" placeholder="Model, trim, stock #, year…" autocomplete="off" /></div>
      <div class="seg" role="group" aria-label="Show" style="margin-bottom:10px">
        <button class="seg-btn active" data-mode="fit">Like theirs</button>
        <button class="seg-btn" data-mode="stock">On the lot</button>
        <button class="seg-btn" data-mode="lineup">New lineup</button>
      </div>
      <div class="vp-list"></div>`;
    const list = wrap.querySelector(".vp-list");
    const input = wrap.querySelector("input");
    const draw = () => {
      const ql = q.trim().toLowerCase();
      let rows = all.slice();
      if (mode === "stock") rows = rows.filter((m) => !m.vehicle.lineup).sort((a, b) => (a.vehicle.price ?? 1e12) - (b.vehicle.price ?? 1e12));
      else if (mode === "lineup") rows = rows.filter((m) => m.vehicle.lineup).sort((a, b) => (a.vehicle.price ?? 1e12) - (b.vehicle.price ?? 1e12));
      if (ql) rows = rows.filter((m) => `${vname(m.vehicle)} ${m.vehicle.stock || ""} ${m.vehicle.color || ""} ${m.vehicle.condition || ""}`.toLowerCase().includes(ql));
      list.innerHTML = "";
      if (!rows.length) { list.innerHTML = `<div class="muted small" style="padding:10px 0">Nothing matches.</div>`; return; }
      const FIRST = 30;
      let i = 0;
      const append = (n) => {
        const frag = document.createDocumentFragment();
        rows.slice(i, i + n).forEach((m) => {
          const v = m.vehicle;
          const dl = paymentDelta(m.delta);
          const row = document.createElement("div");
          row.className = "row vp-row";
          row.innerHTML = `
            <div class="row-main" style="min-width:0">
              <div class="row-title" style="font-size:0.95rem">${esc(vname(v))}</div>
              <div class="row-sub">${v.price != null ? currency(v.price) : "no price"}${v.lineup ? " · new lineup" : v.stock ? " · #" + esc(v.stock) : ""}${v.color ? " · " + esc(String(v.color).split("/")[0]) : ""}${v.mileage != null && !/new/i.test(String(v.condition || "")) ? " · " + num(v.mileage) + " km" : ""}</div>
            </div>
            <div class="row-meta" style="flex:none;text-align:right">
              <div class="strong mono">${currency(Math.round(m.monthly))}<span class="muted" style="font-size:0.72rem">/mo</span></div>
              ${dl ? `<div class="small" style="color:${dl.color}">${dl.text}</div>` : `<div class="small muted">${m.method}</div>`}
            </div>`;
          row.addEventListener("click", () => { onPick(m); close(); });
          frag.appendChild(row);
        });
        i = Math.min(rows.length, i + n);
        list.appendChild(frag);
      };
      append(FIRST);
      if (i < rows.length) {
        const more = document.createElement("button");
        more.className = "btn btn-ghost btn-sm btn-block";
        more.style.marginTop = "8px";
        const label = () => { more.textContent = `Show more (${i} of ${rows.length})`; };
        label();
        more.addEventListener("click", () => { list.removeChild(more); append(40); if (i < rows.length) { label(); list.appendChild(more); } });
        list.appendChild(more);
      }
    };
    let t = null;
    input.addEventListener("input", () => { q = input.value; clearTimeout(t); t = setTimeout(draw, 80); });
    wrap.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.mode;
      wrap.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
      draw();
    }));
    draw();
    return wrap;
  }, { focus: false });
}
