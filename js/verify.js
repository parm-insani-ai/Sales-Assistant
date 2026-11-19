// A verified outcome for every interaction.
//
// The rule: nobody is contacted without the app finding out what came of it.
// A call placed from any screen — the customer's page, a card, the inbox, a
// Next move — opens an interaction: a call record with no outcome yet. The
// moment the salesperson is back in the app, the question is on screen: how
// did it go? Spoke (and then what — booked, call back, interested, not now,
// not interested, bought elsewhere), left a message, no answer, wrong
// number, or didn't call. A text or email opened in the phone's own app asks
// the one thing the app can't see: sent, or not. The answer runs the same
// paperwork a calling session's does (session.js recordOutcome), stamped at
// the time of the call.
//
// An interaction left open — the phone put down, the question dismissed —
// doesn't go away: it's on Home under Right now and at the top of the Log's
// To-dos until it has its outcome. The calling session has its own outcome
// step, so its dial button is left alone (data-noverify).

import * as store from "./store.js";
import { openModal, toast } from "./components.js";
import { icon } from "./icons.js";
import { esc, formatDateTime } from "./utils.js";
import { recordOutcome, CONVERSATION_OUTCOMES, CALLBACK_WHEN } from "./session.js";
import { slotOn } from "./schedule.js";
import { addDaysISO } from "./cadence.js";

const DAY = 86400000;
const PENDING = "viniva:verify-pending";
// Back inside eight seconds: a mis-tap, not a call. Older than six hours:
// the question waits on the list rather than popping up at breakfast.
export const MIN_AWAY_MS = 8000, MAX_AGE_MS = 6 * 3600000;
// A record under ninety seconds old is a call in progress, not an open one.
export const GRACE_MS = 90000, WINDOW_DAYS = 14;
export const VIAS = { call: "Call", text: "Text", email: "Email" };
const first = (name) => String(name || "there").trim().split(/\s+/)[0];
const at = (c) => new Date(c.at || c.createdAt || 0).getTime();

/** An outbound record with no outcome yet — a tap-to-call the app never heard back about. */
export const isOpen = (c) => !!c && c.dir !== "in" && !c.outcome && !c.logged;

/** Start an interaction: the record, and the question armed for the return. */
export function openInteraction(leadId, via = "call") {
  const lead = store.get("leads", leadId);
  if (!lead) return null;
  if (!VIAS[via]) via = "call";
  // Two taps on the same button are one call.
  const recent = store.all("calls").find((c) => c.leadId === leadId && isOpen(c) && (c.via || "call") === via && Date.now() - at(c) < 120000);
  const rec = recent || store.logCall(leadId, { via });
  try { localStorage.setItem(PENDING, JSON.stringify({ recId: rec.id, leadId, via, at: Date.now() })); } catch { /* the list still has it */ }
  return rec;
}

/** Every interaction still without an outcome, newest first. */
export function openInteractions({ now = Date.now(), days = WINDOW_DAYS, grace = GRACE_MS } = {}) {
  return store.all("calls")
    .filter((c) => isOpen(c) && now - at(c) >= grace && now - at(c) <= days * DAY && store.get("leads", c.leadId))
    .sort((a, b) => at(b) - at(a));
}

// The customer's last contact was this very tap: put it back to the one before.
function rollBackLastContact(lead, rec) {
  if (!lead || lead.lastContacted !== rec.at) return;
  const others = store.all("calls").filter((c) => c.leadId === lead.id && c.id !== rec.id && c.dir !== "in").sort((a, b) => at(b) - at(a));
  store.update("leads", lead.id, { lastContacted: others[0] ? others[0].at : null, lastContactVia: others[0] ? others[0].via || "call" : null, lastContactOutcome: others[0] ? others[0].outcome || null : null });
}

/**
 * The answer. `key` is one of the session's outcomes (reached, appointment,
 * callback, interested, not_now, not_interested, bought_elsewhere,
 * voicemail, no_answer, wrong_number) for a call; "sent" for a text or
 * email; "none" for "didn't call / didn't send", which takes the record off.
 * Returns { rec, line } or null.
 */
export function verifyOutcome(recId, key, { notes = "", when = null } = {}) {
  const rec = store.get("calls", recId);
  if (!rec) return null;
  const lead = store.get("leads", rec.leadId);
  if (!lead) { store.remove("calls", recId); return null; }
  const via = rec.via || "call";
  const fn = first(lead.name);
  if (key === "none") {
    store.bulk(() => { store.remove("calls", recId); rollBackLastContact(lead, rec); });
    return { rec: null, line: via === "call" ? `No call to ${fn} — taken off.` : `Nothing sent to ${fn} — taken off.` };
  }
  if (via !== "call") {
    let made = null;
    store.bulk(() => {
      store.remove("calls", recId);
      made = store.logContact(lead.id, { via, outcome: "reached", at: rec.at, notes });
      store.update("calls", made.id, { verifiedAt: new Date().toISOString() });
    });
    return { rec: made, line: `${VIAS[via]} to ${fn} on their file · ${formatDateTime(rec.at)}.` };
  }
  // A call: the session's paperwork, as of the call's own time, with no
  // session to revert.
  store.remove("calls", recId);
  const r = recordOutcome(lead.id, key, { notes, now: new Date(rec.at), when, session: false });
  if (r && r.rec && store.get("calls", r.rec.id)) store.update("calls", r.rec.id, { verifiedAt: new Date().toISOString() });
  return r;
}

// ---- The question ----

/** "How did it go with Dana?" — the sheet. `onDone(result)` after an answer; `onDone(null)` on dismiss. */
export function verifySheet(rec, { onDone } = {}) {
  const live = store.get("calls", rec.id) || rec;
  const lead = store.get("leads", live.leadId);
  if (!lead) { if (onDone) onDone(null); return; }
  const via = live.via || "call";
  const fn = first(lead.name);
  let answered = false;
  openModal(`How did it go with ${fn}?`, (close) => {
    const box = document.createElement("div");
    box.className = "vf-sheet";
    box.dataset.noverify = "1";
    const btn = (key, label, ico, cls = "btn-ghost") => `<button type="button" class="btn ${cls} vf-btn" data-key="${key}">${ico ? icon(ico) : ""}<span>${esc(label)}</span></button>`;
    const callStep = () => `
      <div class="vf-grid">
        ${btn("spoke", "Spoke", "check", "btn-success")}
        ${btn("voicemail", "Left a message", "message")}
        ${btn("no_answer", "No answer", "phone")}
        ${btn("wrong_number", "Wrong number", "alert")}
      </div>
      <button type="button" class="btn btn-ghost btn-sm vf-none" data-key="none">Didn't call</button>`;
    const spokeStep = () => `
      <div class="vf-label">Spoke — how did it go?</div>
      <div class="vf-grid">
        ${CONVERSATION_OUTCOMES.map((o) => btn(o.key, o.label, o.icon)).join("")}
        ${btn("reached", "Just talked", "check")}
      </div>
      <div class="vf-when" hidden>
        <div class="vf-label">Call back when?</div>
        <div class="vf-grid vf-grid-4">${CALLBACK_WHEN.map((w) => `<button type="button" class="btn btn-primary btn-sm" data-when="${w.key}">${esc(w.label)}</button>`).join("")}</div>
        <input type="date" data-f="when" style="margin-top:6px">
      </div>
      <button type="button" class="btn btn-ghost btn-sm vf-none" data-key="back">‹ Back</button>`;
    const sentStep = () => `
      <div class="vf-grid">
        ${btn("sent", "Sent", "check", "btn-success")}
        ${btn("none", "Didn't send", "logout")}
      </div>`;
    box.innerHTML = `
      <div class="vf-sub">${esc(VIAS[via])} · ${esc(formatDateTime(live.at))}${lead.vehicleInterest ? ` · ${esc(lead.vehicleInterest)}` : ""}</div>
      <div class="vf-steps"></div>
      <textarea class="vf-note" data-f="note" rows="2" placeholder="What happened (optional)"></textarea>`;
    const steps = box.querySelector(".vf-steps");
    const note = () => box.querySelector('[data-f="note"]').value.trim();
    const finish = (r) => {
      if (!r) { toast("Couldn't log that — try again", "danger"); return; }
      answered = true;
      toast(r.line, "success");
      close();
      if (onDone) onDone(r);
    };
    const draw = (step) => {
      steps.innerHTML = step === "spoke" ? spokeStep() : via === "call" ? callStep() : sentStep();
      steps.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("click", () => {
        const key = b.dataset.key;
        if (key === "spoke") { draw("spoke"); return; }
        if (key === "back") { draw("call"); return; }
        if (key === "callback") { const w = steps.querySelector(".vf-when"); w.hidden = false; w.scrollIntoView({ block: "nearest" }); return; }
        if (key === "appointment") {
          // Book them in; the outcome goes on once the form has closed.
          const r = verifyOutcome(live.id, "appointment", { notes: note() });
          if (!r) { finish(null); return; }
          answered = true; close();
          import("./views/calendar.js").then((m) => m.openAppointmentForm(null, { leadId: lead.id, customerName: lead.name, vehicle: lead.vehicleInterest || "", type: "appointment" })).catch(() => {});
          toast(r.line, "success");
          if (onDone) onDone(r);
          return;
        }
        finish(verifyOutcome(live.id, key, { notes: note() }));
      }));
      steps.querySelectorAll("[data-when]").forEach((b) => b.addEventListener("click", () => {
        const w = CALLBACK_WHEN.find((x) => x.key === b.dataset.when);
        const h = new Date().getHours();
        finish(verifyOutcome(live.id, "callback", { notes: note(), when: slotOn(addDaysISO(w.days), h >= 8 && h < 20 ? h : 10, 0) }));
      }));
      const dateIn = steps.querySelector('[data-f="when"]');
      if (dateIn) dateIn.addEventListener("change", () => { if (dateIn.value) finish(verifyOutcome(live.id, "callback", { notes: note(), when: slotOn(dateIn.value, 10, 0) })); });
    };
    draw("first");
    return box;
  }, { onClose: () => { if (!answered && onDone) onDone(null); }, className: "modal-verify" });
}

// ---- Where the open ones show ----

/**
 * The open interactions as a card: each with who, how, when, and the quick
 * answers; the row opens the sheet. Empty: nothing drawn (hidden).
 */
export function openOutcomesCard({ limit = 6, onChange, title = "Say how these went" } = {}) {
  const card = document.createElement("div");
  card.className = "card vf-card";
  const draw = () => {
    const list = openInteractions();
    card.hidden = !list.length;
    if (!list.length) { card.innerHTML = ""; return; }
    const shown = list.slice(0, limit);
    card.innerHTML = `
      <div class="strong" style="margin-bottom:6px">${icon("alert")} ${esc(title)} <span class="muted">· ${list.length}</span></div>
      ${shown.map((c) => { const l = store.get("leads", c.leadId); const via = c.via || "call"; return `
        <div class="vf-row" data-rec="${esc(c.id)}">
          <div class="vf-main">
            <div class="row-title">${esc(l.name)}</div>
            <div class="row-sub">${esc(VIAS[via])} · ${esc(formatDateTime(c.at))}${l.vehicleInterest ? ` · ${esc(l.vehicleInterest)}` : ""}</div>
          </div>
          <div class="vf-quick">${via === "call"
            ? `<button type="button" class="btn btn-sm btn-success" data-q="spoke">Spoke</button><button type="button" class="btn btn-sm btn-ghost" data-q="voicemail">Message</button><button type="button" class="btn btn-sm btn-ghost" data-q="no_answer">No answer</button>`
            : `<button type="button" class="btn btn-sm btn-success" data-q="sent">Sent</button><button type="button" class="btn btn-sm btn-ghost" data-q="none">Didn't</button>`}</div>
        </div>`; }).join("")}
      ${list.length > shown.length ? `<div class="small muted" style="margin-top:4px">and ${list.length - shown.length} more — each opens with a tap</div>` : ""}`;
    const after = (r) => { draw(); if (onChange) onChange(r); };
    card.querySelectorAll(".vf-row").forEach((row) => {
      const rec = store.get("calls", row.dataset.rec);
      if (!rec) return;
      row.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (b.dataset.q === "spoke") { verifySheet(rec, { onDone: (r) => { if (r) after(r); } }); return; }
        const r = verifyOutcome(rec.id, b.dataset.q);
        if (r) toast(r.line, "success");
        after(r);
      }));
      row.addEventListener("click", () => verifySheet(rec, { onDone: (r) => { if (r) after(r); } }));
    });
  };
  draw();
  card.redraw = draw;
  return card;
}

// ---- Arming ----

// The customer behind a tel:/sms:/mailto: link: the link's own lead id, the
// page's customer when the number is theirs, else the one customer on file
// with that number or address.
function leadForLink(a, href) {
  const direct = a.dataset.lead || (a.closest("[data-lead-id]") || {}).dataset?.leadId;
  if (direct && store.get("leads", direct)) return store.get("leads", direct);
  const h = String(href || "");
  if (/^mailto:/i.test(h)) {
    const em = decodeURIComponent(h.slice(7).split("?")[0]).trim().toLowerCase();
    if (!em) return null;
    const hits = store.all("leads").filter((l) => String(l.email || "").trim().toLowerCase() === em);
    return hits.length === 1 ? hits[0] : null;
  }
  const num = decodeURIComponent(h.replace(/^(tel|sms):/i, "").split(/[?;&]/)[0]);
  if (!num.replace(/\D/g, "")) return null;
  const m = /^#\/leads\/([^/?]+)/.exec(location.hash || "");
  if (m) { const l = store.get("leads", m[1]); if (l && l.phone && store.phoneKey(l.phone) === store.phoneKey(num)) return l; }
  try { return store.leadByPhone(num) || null; } catch { return null; }
}

let showing = false;
/** The armed question, if its moment has come: back after a call, with the record still open. */
export function checkPending({ minAway = MIN_AWAY_MS, maxAge = MAX_AGE_MS, onDone } = {}) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING) || "null"); } catch { p = null; }
  if (!p || !p.recId) return false;
  const age = Date.now() - Number(p.at || 0);
  if (age < minAway) return false;
  const clear = () => { try { localStorage.removeItem(PENDING); } catch { /* fine */ } };
  if (age > maxAge) { clear(); return false; }
  const rec = store.get("calls", p.recId);
  if (!isOpen(rec)) { clear(); return false; }
  if (showing || document.querySelector(".modal-backdrop")) return false;
  clear();
  showing = true;
  verifySheet(rec, { onDone: (r) => { showing = false; if (onDone) onDone(r); } });
  return true;
}

/** Once, at start: every dial, text and mail link opens an interaction; the return asks the question. */
export function armVerify() {
  document.addEventListener("click", (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]');
    if (!a || a.closest("[data-noverify]")) return;
    const href = a.getAttribute("href") || "";
    const via = /^tel:/i.test(href) ? "call" : /^sms:/i.test(href) ? "text" : "email";
    const lead = leadForLink(a, href);
    if (!lead) return;
    // A handler that kept the tap in the app (the in-app texter, sms.js)
    // owns the record; only a link that really left the app opens one.
    setTimeout(() => { if (!ev.keptInApp) openInteraction(lead.id, via); }, 0);
  }, true);
  const back = () => { if (document.visibilityState === "hidden") return; setTimeout(() => checkPending(), 400); };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("focus", back);
  window.addEventListener("pageshow", back);
  setTimeout(() => checkPending(), 1500);
}
