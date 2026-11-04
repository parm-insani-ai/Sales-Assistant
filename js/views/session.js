// The calling session, on the screen: one customer at a time.
//
// Top: how far through the day's batch, and the batch itself as a strip of
// names — tap any of them to go there; Back and Next step through. Then the
// customer — name, what they drive, the read's verdict and reasons, and
// the script: the opener in the salesperson's voice, the ask, and what to
// say back to the objections this reason tends to draw. A big Call button
// dials. Under it, the outcomes, each doing its own paperwork (session.js),
// and the next customer without an answer is up. An answer already given
// shows lit; tapping another changes it (the first one's paperwork is taken
// back), and Undo clears it. Spoke opens the note panel so what was said is
// kept, by voice. With everyone answered, the summary: dials, reached,
// appointments, minutes — with the way back through the people to change
// anything before the session is ended.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc, telHref, phoneDisplay } from "../utils.js";
import { icon } from "../icons.js";
import { toast, emptyState } from "../components.js";
import { assessment } from "../assess.js";
import { contractSummary } from "../contract.js";
import { consentStatus } from "../consent.js";
import { openAppointmentForm } from "./calendar.js";
import { notePanel } from "./leads.js";
import { reachLine } from "../reachtime.js";
import { currentSession, currentCustomer, recordOutcome, revertOutcome, endSession, summarize, callScript, OUTCOMES, startSession, sessionQueue, extendSession, roster, goTo, goNext, goPrev, nextOpen } from "../session.js";

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "?";
// Booking an appointment re-draws the whole screen from the router (the
// form announces the change the way every form does), which replaces this
// view with a fresh one. The fresh one reads this flag to carry on where
// the old one would have: to the summary when everyone's answered.
const AFTER_FLAG = "viniva:session:after";
const flag = (on) => { try { if (on) sessionStorage.setItem(AFTER_FLAG, "1"); else sessionStorage.removeItem(AFTER_FLAG); } catch { /* fine */ } };
const flagged = () => { try { return sessionStorage.getItem(AFTER_FLAG) === "1"; } catch { return false; } };

export function renderSession(view) {
  const page = document.createElement("div");
  page.className = "cs-page";
  view.appendChild(page);
  // The numbers over a session still open, so the salesperson can go back
  // through the people and change an answer before ending it.
  let showSummary = false;
  if (flagged()) { flag(false); if (nextOpen() < 0) showSummary = true; }
  draw();

  function draw() {
    let s = currentSession();
    if (!s) { page.replaceChildren(startCard()); return; }
    // Anyone the batch brought up since the session started joins it.
    if (extendSession()) s = currentSession();
    const cur = currentCustomer();
    if (!cur) { page.replaceChildren(summaryCard(endSession(), { over: true })); return; }
    if (showSummary) { page.replaceChildren(summaryCard(summarize(s), { over: false })); return; }
    page.replaceChildren(customerCard(cur, s));
    const now = page.querySelector(".cs-chip-now");
    if (now) { try { now.scrollIntoView({ inline: "center", block: "nearest" }); } catch { /* fine */ } }
  }

  // No session under way: offer today's batch.
  function startCard() {
    const q = sessionQueue();
    const el = document.createElement("div");
    if (!q.length) { el.innerHTML = emptyState("phone", "Nobody to call right now", "Today's batch is worked through, or nobody on it has a number. Outreach brings up the next handful tomorrow."); const b = document.createElement("button"); b.className = "btn btn-ghost"; b.textContent = "Back to Outreach"; b.addEventListener("click", () => navigate("/leads")); el.appendChild(b); return el; }
    el.className = "card cs-start";
    el.innerHTML = `
      <div class="cs-start-n">${q.length}</div>
      <div class="strong">to call today</div>
      <div class="small muted" style="margin:6px 0 14px">Best first. One at a time: who, why, what to say, the number — and what came of it.</div>
      <button type="button" class="btn btn-success btn-lg" data-act="start" style="width:100%">${icon("phone")} Start calling</button>`;
    el.querySelector('[data-act="start"]').addEventListener("click", () => { startSession(); draw(); });
    return el;
  }

  // The batch as a strip of names, each coloured by what came of it.
  function stripHTML() {
    const kindOf = (o) => (OUTCOMES.find((x) => x.key === o) || {}).kind || "";
    return `<div class="cs-strip" role="tablist" aria-label="Today's batch">${roster().map((r) => `<button type="button" class="cs-chip${r.current ? " cs-chip-now" : ""}${r.outcome ? ` cs-chip-${kindOf(r.outcome)}` : ""}" data-go="${r.i}" role="tab" aria-selected="${r.current}" title="${esc(r.name)}">${r.outcome ? icon((OUTCOMES.find((x) => x.key === r.outcome) || {}).icon || "check") : ""}<span>${esc(firstName(r.name))}</span></button>`).join("")}</div>`;
  }

  function customerCard(cur, s) {
    const l = cur.lead;
    const a = assessment(l.id) || { reasons: [], why: [], whySafe: [], tier: null, best: null };
    const script = callScript({ lead: l, reasons: a.reasons, whySafe: a.whySafe, why: a.why, best: a.best });
    const c = contractSummary(l);
    const consent = consentStatus(l);
    const called = s.done.length;
    const reached = s.done.filter((d) => ["reached", "appointment", "not_interested"].includes(d.outcome)).length;
    const was = cur.done ? OUTCOMES.find((o) => o.key === cur.done.outcome) : null;
    const el = document.createElement("div");
    el.className = "cs-wrap";
    el.innerHTML = `
      <div class="cs-head">
        <div class="cs-progress"><span class="strong">${cur.i + 1} of ${cur.of}</span><span class="muted"> · ${called} called · ${reached} reached</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="end">${called >= cur.of ? "Finish" : "End"}</button>
        <div class="cs-bar"><span style="width:${Math.round((called / Math.max(1, cur.of)) * 100)}%"></span></div>
      </div>
      ${stripHTML()}
      <div class="card cs-card">
        <div class="cs-who">
          <div>
            <div class="cs-name">${esc(l.name)}</div>
            <div class="cs-sub">${esc(l.vehicleInterest || "No vehicle noted")}${c && c.line ? ` · ${esc(c.line)}` : ""}</div>
            ${reachLine(l.id) ? `<div class="cs-when">${icon("clock")} ${esc(reachLine(l.id))}</div>` : ""}
          </div>
          ${a.tier ? `<span class="badge ${a.tier.badge}">${esc(a.tier.label)}</span>` : ""}
        </div>
        ${a.reasons.length ? `<div class="cs-reasons">${a.reasons.map((r) => `<span class="cs-reason">${esc(r)}</span>`).join("")}</div>` : ""}
        <div class="cs-script">
          <div class="cs-label">Say</div>
          <p class="cs-line">${esc(script.opener)}</p>
          <p class="cs-line cs-ask">${esc(script.bridge)}</p>
        </div>
        <details class="cs-obj">
          <summary>If they say…</summary>
          ${script.objections.map((o) => `<div class="cs-obj-row"><div class="cs-obj-say">“${esc(o.say)}”</div><div class="cs-obj-back">${esc(o.back)}</div></div>`).join("")}
        </details>
        ${!consent.ok ? `<div class="cs-note small">${icon("alert")} No texting consent on file — this one's a call. ${esc(consent.note || "")}</div>` : ""}
        ${l.phone && !l.badPhone ? `<a class="btn btn-success btn-lg cs-dial" data-act="dial" href="${telHref(l.phone)}">${icon("phone")} Call ${esc(phoneDisplay(l.phone))}</a>`
          : `<div class="cs-dial cs-dial-off">${icon("alert")} ${l.badPhone ? "Wrong number on file" : "No number on file"}</div>`}
        <div class="cs-label" style="margin-top:14px">What came of it</div>
        <div class="cs-outcomes">
          ${OUTCOMES.map((o) => `<button type="button" class="btn cs-out cs-out-${o.kind}${was && was.key === o.key ? " cs-out-picked" : ""}" data-outcome="${o.key}" title="${esc(o.hint)}">${icon(o.icon)}<span>${esc(o.label)}</span></button>`).join("")}
        </div>
        ${was ? `<div class="cs-recorded small">${icon("check")} <span>Recorded: <b>${esc(was.label)}</b> · tap another to change it</span><button type="button" class="btn btn-ghost btn-sm" data-act="undo">Undo</button></div>` : ""}
        <div class="cs-slot"></div>
      </div>
      <div class="cs-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-act="prev" aria-label="Back one">‹ Back</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="open">Open their page</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="next" aria-label="Next one">Next ›</button>
      </div>`;
    el.querySelector('[data-act="end"]').addEventListener("click", () => { showSummary = true; draw(); });
    el.querySelector('[data-act="prev"]').addEventListener("click", () => { goPrev(); draw(); });
    el.querySelector('[data-act="next"]').addEventListener("click", () => { goNext(); draw(); });
    el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { goTo(Number(b.dataset.go)); draw(); }));
    el.querySelector('[data-act="open"]').addEventListener("click", () => navigate(`/leads/${l.id}`));
    const dial = el.querySelector('[data-act="dial"]');
    if (dial) dial.addEventListener("click", () => { store.logActivity("touch"); el.classList.add("cs-dialed"); });
    const undo = el.querySelector('[data-act="undo"]');
    if (undo) undo.addEventListener("click", () => { revertOutcome(l.id); toast(`${firstName(l.name)}'s answer cleared`, ""); draw(); });
    const slot = el.querySelector(".cs-slot");
    const outcomes = el.querySelector(".cs-outcomes");
    // After an answer: the next person without one — or, with everyone
    // answered, the summary.
    const after = (line, kind = "success") => {
      if (line) toast(line, kind);
      if (nextOpen() < 0) showSummary = true;
      draw();
    };
    el.querySelectorAll("[data-outcome]").forEach((b) => b.addEventListener("click", () => {
      const key = b.dataset.outcome;
      if (was && was.key === key) { toast(`Already recorded as ${was.label.toLowerCase()} — tap another to change it`, ""); return; }
      outcomes.querySelectorAll("button").forEach((x) => { x.disabled = true; x.classList.remove("cs-out-picked"); });
      b.classList.add("cs-out-picked");
      if (key === "appointment") {
        const r = recordOutcome(l.id, key);
        // The form books them; the session carries on when it closes —
        // in this view when the form was dismissed, in the fresh one the
        // router draws when it was saved (see AFTER_FLAG).
        flag(true);
        openAppointmentForm(null, { leadId: l.id, customerName: l.name, vehicle: l.vehicleInterest || "", type: "appointment" });
        const wait = setInterval(() => {
          if (!page.isConnected) { clearInterval(wait); return; }
          if (!document.querySelector(".modal-backdrop")) { clearInterval(wait); flag(false); after(r ? r.line : ""); }
        }, 300);
        return;
      }
      if (key === "reached") {
        const r = recordOutcome(l.id, key);
        if (!r) { after("Couldn't log that — try again", "danger"); return; }
        // What was said, by voice; the moves it implies are offered there.
        slot.appendChild(notePanel(l, r.rec, () => after(r.line)));
        slot.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const r = recordOutcome(l.id, key);
      after(r ? r.line : "Couldn't log that — try again", r ? (key === "wrong_number" || key === "not_interested" ? "" : "success") : "danger");
    }));
    return el;
  }

  // The numbers. Over a session still open, the way back through the
  // people is offered before it's ended.
  function summaryCard(sum, { over }) {
    const el = document.createElement("div");
    el.className = "card cs-summary";
    if (!sum) { el.innerHTML = `<div class="muted">No session to sum up.</div>`; return el; }
    const stat = (n, label) => `<div class="cs-stat"><div class="cs-stat-n">${n}</div><div class="cs-stat-l">${esc(label)}</div></div>`;
    const rate = sum.dials ? Math.round((sum.reached / sum.dials) * 100) : 0;
    el.innerHTML = `
      <div class="strong" style="font-size:1.1rem">${over ? "Session done" : sum.left ? `${sum.left} still to call` : "Everyone's answered"}</div>
      <div class="small muted" style="margin-top:2px">${sum.minutes} minute${sum.minutes === 1 ? "" : "s"} on the phone${sum.left && over ? ` · ${sum.left} left for later` : ""}</div>
      <div class="cs-stats">
        ${stat(sum.dials, "dials")}${stat(sum.reached, "reached")}${stat(sum.appointments, sum.appointments === 1 ? "appointment" : "appointments")}${stat(`${rate}%`, "reach rate")}
      </div>
      <div class="small muted">${[sum.voicemail ? `${sum.voicemail} message${sum.voicemail === 1 ? "" : "s"} left` : "", sum.noAnswer ? `${sum.noAnswer} no answer` : "", sum.notInterested ? `${sum.notInterested} not interested` : "", sum.wrongNumber ? `${sum.wrongNumber} wrong number${sum.wrongNumber === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || (sum.dials ? "Every call reached someone." : "Nothing recorded yet.")}</div>
      <div class="small" style="margin-top:10px">${sum.voicemail || sum.noAnswer ? "The follow-ups are on your Log — a text or a call for each one tomorrow." : "Nothing left to follow up from this round."}</div>
      ${over ? `<div class="btn-row" style="margin-top:14px">
        <button type="button" class="btn btn-primary" data-act="back" style="flex:1">Back to Outreach</button>
      </div>` : `<div class="btn-row" style="margin-top:14px">
        <button type="button" class="btn btn-ghost" data-act="review" style="flex:1">${sum.left ? "Keep calling" : "Go back through them"}</button>
        <button type="button" class="btn btn-primary" data-act="finish" style="flex:1">End session</button>
      </div>
      <div class="small muted" style="margin-top:8px;text-align:center">Go back to change any answer; ending the session keeps them as they are.</div>`}`;
    const back = el.querySelector('[data-act="back"]');
    if (back) back.addEventListener("click", () => navigate("/leads"));
    const review = el.querySelector('[data-act="review"]');
    if (review) review.addEventListener("click", () => { showSummary = false; const i = nextOpen(-1); if (i >= 0) goTo(i); else goTo(0); draw(); });
    const finish = el.querySelector('[data-act="finish"]');
    if (finish) finish.addEventListener("click", () => { showSummary = false; page.replaceChildren(summaryCard(endSession(), { over: true })); });
    return el;
  }
}
