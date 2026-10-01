// The assistant's work on a to-do, all on one page: what it did and said,
// the results themselves — the payment-matched options, the units on the
// lot, a text drafted with its own Send button, a comparison, a booking —
// and the next things it can do for you from here. Nothing opens
// elsewhere: the assistant runs with navigation held, and every result
// is drawn here and kept on the to-do. Reached from Done — check it out
// on the to-do's card (Log → To-dos).

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc, relativeDay, formatDateTime, currency, smsHref } from "../utils.js";
import { icon } from "../icons.js";
import { toast } from "../components.js";
import { isReminder, reminderWhen } from "../reminders.js";
import { smsReady, sendText } from "../sms.js";
import { looksLikeMoney } from "../replies.js";
import { doItFor, compactResult, pendingRun, clearPendingRun } from "./tasks.js";

const first = (name) => String(name || "").trim().split(/\s+/)[0] || "them";
const TURNS_MAX = 12; // exchanges kept on the to-do

// The next things the assistant can do from here, by the kind of move it
// just made. Every text is drafted onto this page for you to send —
// nothing goes to the customer until you tap Send. Booking and reminders
// ask you when.
export function nextActions(t, lead) {
  if (!lead) return [];
  const name = lead.name, f = first(name);
  const text = (what) => `Draft a text to ${name} for me to send: ${what}. Warm, short, no figures or payments.`;
  const book = { icon: "calendar", label: `Book ${f} a time to come in`, ask: `Book ${name} an appointment to come in — ask me which day and time.` };
  const remind = { icon: "bell", label: "Remind me to follow up", ask: `Set me a reminder to follow up with ${name} — ask me when.` };
  switch (t.kind) {
    case "budget": case "stock": case "objection": return [
      { icon: "message", label: `Text ${f} the options`, ask: text(`that I've found a couple of options worth a look, name the best fit from what you found, and ask when they could come see it`) },
      { icon: "compare", label: "Compare the two best", ask: `Compare the two best fits you found for ${name}, side by side.` },
      book, remind,
    ];
    case "people": return [
      { icon: "calendar", label: "Book a visit for both of them", ask: `Book ${name} an appointment for both of them to come in together — ask me which day and time.` },
      remind,
    ];
    case "referral": return [
      { icon: "bell", label: "Remind me to ask in person", ask: `Set me a reminder to ask ${name} for the referral in person — ask me when.` },
      remind,
    ];
    default: return [book, remind];
  }
}

// The exchanges on the to-do, oldest first. A to-do run before the page
// kept results has its one reply and no results.
function turnsOf(t) {
  const a = t.assist;
  if (!a || !a.at) return [];
  if (Array.isArray(a.turns) && a.turns.length) return a.turns;
  return [{ ask: "Do it", say: a.say || "Done.", at: a.at, steps: a.steps || [], results: [] }];
}

const money = (n) => (n == null ? "—" : currency(Math.round(n)));
const delta = (d) => (d == null ? "" : d === 0 ? "same" : d > 0 ? `+${money(d)}` : `−${money(-d)}`);
const initials = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

// The reply as prose. The assistant is told plain words, but a model
// under pressure still reaches for markdown — so bold becomes bold, a
// bulleted run becomes a list, headings and backticks go, and nothing
// shows up as asterisks.
export function sayHtml(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "$1").replace(/(^|\s)\*([^*\s][^*]*?)\*(?=[\s.,!?;:]|$)/g, "$1<em>$2</em>");
  let html = "", list = [];
  const flush = () => { if (list.length) { html += `<ul class="td-list">${list.map((x) => `<li>${x}</li>`).join("")}</ul>`; list = []; } };
  String(text || "").replace(/\r/g, "").split("\n").forEach((raw) => {
    const l = raw.trim();
    if (!l) { flush(); return; }
    const m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (m) { list.push(inline(m[1])); return; }
    flush();
    html += `<p>${inline(l.replace(/^#+\s*/, ""))}</p>`;
  });
  flush();
  return html || "<p>Done.</p>";
}

// The steps as a timeline: each one ticked, the one underway pulsing.
function stepsHtml(steps, { live = false } = {}) {
  const list = (steps || []).filter(Boolean).slice(0, 8);
  return list.map((s, i) => {
    const now = live && i === list.length - 1;
    return `<div class="td-tl ${now ? "td-tl-now" : "td-tl-done"}"><span class="td-tl-dot">${now ? "" : icon("checkline")}</span><span class="td-tl-text">${esc(s)}</span></div>`;
  }).join("");
}

export function renderTodo(view, { param } = {}) {
  const t = param ? store.get("tasks", param) : null;
  if (!t) {
    view.innerHTML = `<div class="hero"><div class="hero-title">That to-do's gone</div></div><div class="card muted small">It was ticked off or deleted. The rest are on Log under To-dos.</div>`;
    return;
  }
  const lead = t.leadId ? store.get("leads", t.leadId) : null;
  const ask = doItFor(t, lead);
  const el = document.createElement("div");
  el.className = "td-page";
  // The page fills the scroller so the ask box sits at the bottom of the
  // screen whether the work is short or long (same as the inbox's reply bar).
  view.classList.add("view-thread");
  view.appendChild(el);

  // One conversation for the page, so each next action knows what the
  // assistant already found. The first ask carries that work in.
  let session = null, seeded = false, busy = false;
  const getSession = async () => {
    const a = await import("../agent.js");
    if (!a.agentConfigured()) throw new Error("Set up the voice agent under Settings first");
    if (!session) session = a.createAgentSession({ stay: true, onTool: (n, i, o) => { if (hearTool) hearTool(n, i, o); } });
    return session;
  };
  let hearTool = null;
  const seed = (text) => {
    if (seeded) return text;
    seeded = true;
    const a = t.assist;
    return a && a.say ? `Earlier, for my to-do "${t.title}"${lead ? ` about ${lead.name}` : ""}, you did this and said: "${a.say}". Now: ${text}` : text;
  };
  const save = () => store.update("tasks", t.id, { assist: t.assist });
  const remember = (turn, { fresh = false } = {}) => {
    const a = fresh || !t.assist ? { at: turn.at, say: turn.say, steps: turn.steps, turns: [] } : { ...t.assist, turns: turnsOf(t) };
    a.turns = [...a.turns, turn].slice(-TURNS_MAX);
    t.assist = a;
    save();
  };

  // ---- Drawing a result. Each returns an element; the draft's Send is
  // wired here so it works the same live and redrawn.
  function resultEl(r) {
    const d = document.createElement("div");
    d.className = `td-result td-result-${r.kind} td-in`;
    if (r.kind === "options") {
      d.innerHTML = `<div class="td-rhead">${icon("dollar")} Payment-matched options${r.now != null ? `<span class="muted td-rsub">pays ${esc(money(r.now))}/mo now</span>` : ""}</div>
        <table class="td-table"><thead><tr><th>Vehicle</th><th class="num">Monthly</th><th class="num">vs now</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr><td>${esc(x.vehicle)}${x.inStock ? "" : ` <span class="td-tag">to order</span>`}<div class="small muted">${esc(x.method || "")}</div></td><td class="num">${esc(money(x.monthly))}<span class="muted">/mo</span></td><td class="num ${x.delta != null && x.delta <= 0 ? "td-good" : ""}">${esc(delta(x.delta))}</td></tr>`).join("")}
        </tbody></table>`;
    } else if (r.kind === "lot") {
      d.innerHTML = `<div class="td-rhead">${icon("car")} ${r.count ? `${r.count} on the lot` : "On the lot"}</div>
        ${r.answer ? `<div class="small" style="margin-bottom:6px">${esc(r.answer)}</div>` : ""}
        ${r.units.map((u) => `<div class="td-unit"><div><div class="strong">${esc(u.vehicle)}</div><div class="small muted">${[u.condition, u.color, u.km != null ? `${Number(u.km).toLocaleString()} km` : "", u.stock ? `#${u.stock}` : ""].filter(Boolean).map(esc).join(" · ")}</div></div><div class="num strong">${esc(money(u.price))}</div></div>`).join("")}
        ${r.more ? `<div class="small muted" style="margin-top:6px">+${r.more} more on the lot</div>` : ""}`;
    } else if (r.kind === "draft") {
      const to = lead || store.all("leads").find((l) => l.name === r.to) || null;
      d.innerHTML = `<div class="td-rhead">${icon("message")} Text to ${esc(r.to || (to && to.name) || "them")}</div>
        <textarea class="td-draft-body" rows="4" ${r.sent ? "readonly" : ""}>${esc(r.message)}</textarea>
        <div class="row" style="margin-top:8px"><span class="small ${r.sent ? "td-good strong" : "muted"}" data-status>${r.sent ? `${icon("checkline")} Sent ${esc(formatDateTime(r.sent))}` : "Not sent — read it, then send"}</span>${r.sent ? "" : `<button type="button" class="btn btn-primary btn-sm" data-send>${icon("send")} Send</button>`}</div>`;
      const btn = d.querySelector("[data-send]");
      if (btn) btn.addEventListener("click", async () => {
        const body = d.querySelector(".td-draft-body").value.trim();
        if (!body) { toast("Nothing to send", "warn"); return; }
        if (looksLikeMoney(body)) { toast("Take the figure out first — numbers stay for the desk", "warn"); return; }
        if (!to || !to.phone) { toast("No phone number on file", "warn"); return; }
        r.message = body;
        btn.disabled = true; btn.textContent = "Sending…";
        if (smsReady()) {
          const res = await sendText(to, body);
          if (!res.ok) { toast(res.error || "Couldn't send", "danger"); btn.disabled = false; btn.innerHTML = `${icon("send")} Send`; return; }
        } else {
          // No texting number set up: the phone's own Messages app, with the
          // text in it.
          location.href = smsHref(to.phone, body);
        }
        r.sent = new Date().toISOString();
        save();
        d.replaceWith(resultEl(r));
        toast(`Sent to ${first(to.name)}`, "success");
      });
    } else if (r.kind === "compare") {
      const rows = [["Price / MSRP", (v) => money(v.price)], ["Engine", (v) => v.engine || "—"], ["Horsepower", (v) => (v.hp ? `${v.hp} hp` : "—")], ["Fuel (combined)", (v) => (v.fuel ? `${v.fuel} L/100 km` : "—")], ["Drivetrain", (v) => v.drive || "—"], ["Seats", (v) => v.seats || "—"]];
      d.innerHTML = `<div class="td-rhead">${icon("compare")} Side by side</div>
        <table class="td-table"><thead><tr><th></th>${r.rows.map((v) => `<th>${esc(v.label)}</th>`).join("")}</tr></thead><tbody>
        ${rows.map(([lbl, get]) => `<tr><td class="muted">${esc(lbl)}</td>${r.rows.map((v) => `<td>${esc(String(get(v)))}</td>`).join("")}</tr>`).join("")}
        </tbody></table>`;
    } else if (r.kind === "did") {
      d.innerHTML = `<div class="td-did">${icon("checkline")} <span>${esc(r.text)}</span></div>`;
    } else {
      d.innerHTML = `<div class="small muted">${esc(r.text || "")}</div>`;
    }
    return d;
  }

  // One exchange as a card: what was asked, the steps, the results, the reply.
  function turnEl(turn, { live = false } = {}) {
    const c = document.createElement("div");
    c.className = "card td-turn td-in" + (live ? " td-turn-live" : "");
    const steps = (turn.steps || []).filter(Boolean);
    c.innerHTML = `<div class="td-turn-head">
        <span class="td-ask">${esc(turn.ask)}</span>
        <span class="td-when">${live ? `<span class="td-pill td-pill-live">Working</span>` : turn.at ? esc(formatDateTime(turn.at)) : ""}</span>
      </div>
      <div class="td-steps" ${steps.length ? "" : "hidden"}>${stepsHtml(steps, { live })}</div>
      <div class="td-results"></div>
      <div class="td-reply-row">
        <span class="td-mark">${icon("sparkles")}</span>
        <div class="td-reply ${live ? "td-working" : ""}" ${live ? "data-step" : ""}>${live ? "Working…" : sayHtml(turn.say)}</div>
      </div>`;
    const box = c.querySelector(".td-results");
    (turn.results || []).forEach((r) => box.appendChild(resultEl(r)));
    return c;
  }

  const when = isReminder(t) ? reminderWhen(t) : t.due ? relativeDay(t.due) : "";

  function draw() {
    const turns = turnsOf(t);
    const actions = nextActions(t, lead);
    const pend = pendingRun(t.id);
    const last = turns[turns.length - 1];
    const status = pend ? `<span class="td-pill td-pill-ask">${icon("help")} Waiting on you</span>`
      : last ? `<span class="td-pill td-pill-done">${icon("checkline")} Done · ${esc(formatDateTime(last.at))}</span>`
      : `<span class="td-pill">Not run yet</span>`;
    el.innerHTML = `
      <div class="td-hero">
        ${lead ? `<a href="#/leads/${esc(lead.id)}" class="td-person"><span class="td-avatar">${esc(initials(lead.name))}</span><span class="td-person-name">${esc(lead.name)}</span>${when ? `<span class="td-person-when">· ${esc(when)}</span>` : ""}</a>` : when ? `<div class="hero-greeting">${esc(when)}</div>` : ""}
        <div class="hero-title td-title">${esc(t.title)}</div>
        <div class="td-status">${status}</div>
      </div>
      <div class="section-title">What it did</div>
      <div class="td-thread"></div>
      ${!turns.length && !pend ? `<div class="card td-work td-in"><div class="td-reply-row"><span class="td-mark">${icon("sparkles")}</span><div class="td-reply muted">Nothing yet. Tap Do it and the work lands here.</div></div>${ask ? `<button type="button" class="btn btn-primary btn-block" data-act="run" style="margin-top:14px">${icon("sparkles")} Do it</button>` : ""}</div>` : ""}
      <div class="td-live"></div>
      ${actions.length ? `
      <div class="section-title">It can also</div>
      <div class="card td-actions">
        ${actions.map((x, i) => `<button type="button" class="td-action" data-action="${i}"><span class="td-action-ico">${icon(x.icon)}</span><span class="td-action-label">${esc(x.label)}</span><span class="td-arrow">›</span></button>`).join("")}
      </div>` : ""}
      <div class="td-foot">
        <button type="button" class="btn btn-primary btn-block td-tick" data-act="done">${icon("check")} Tick it off</button>
        ${ask && turns.length ? `<button type="button" class="btn btn-ghost btn-sm btn-block" data-act="again">Run it again</button>` : ""}
      </div>
      <form class="td-ask-form">
        <input type="text" class="td-input" placeholder="${esc(lead ? `Or tell it what else to do for ${first(lead.name)}…` : "Or tell it what else to do…")}" autocomplete="off" />
        <button type="submit" class="btn btn-primary btn-sm" aria-label="Go">${icon("send")}</button>
      </form>
    `;
    const thread = el.querySelector(".td-thread");
    turns.forEach((turn) => thread.appendChild(turnEl(turn)));
    // A run from the card that's waiting on an answer: its work so far,
    // its question, and the field — the answer finishes that run here.
    // (pend was read above, before the markup)
    if (pend) {
      clearPendingRun(t.id);
      session = pend.session; seeded = true;
      const turn = pend.turn;
      const card = turnEl(turn, { live: true });
      const reply = card.querySelector(".td-reply");
      reply.classList.remove("td-working"); reply.removeAttribute("data-step"); reply.textContent = pend.question;
      const w = card.querySelector(".td-when"); if (w) w.innerHTML = `<span class="td-pill td-pill-ask">${icon("help")} Needs you</span>`;
      el.querySelector(".td-live").appendChild(card);
      const notRun = el.querySelector(".td-work");
      if (notRun) notRun.remove();
      askBox(card, pend.question, pend.options, (answer) => run(answer, answer, { fresh: true, turn, card }));
    }
    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener("click", fn); };
    on('[data-act="run"]', () => run(ask, "Do it", { fresh: true }));
    on('[data-act="again"]', () => run(ask, "Run it again", { fresh: true }));
    on('[data-act="done"]', () => { store.update("tasks", t.id, { done: true }); toast("Nice — task done", "success"); try { sessionStorage.setItem("viniva:log:open", "todos"); } catch { /* fine */ } navigate("/log"); });
    el.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => {
      const x = actions[Number(b.dataset.action)];
      if (x) run(x.ask, x.label);
    }));
    holdScroll(el.querySelector(".td-ask-form .td-input"));
    el.querySelector(".td-ask-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = el.querySelector(".td-input");
      const text = inp.value.trim();
      if (!text) return;
      inp.value = "";
      run(text, text);
    });
  }

  // One exchange, live on the page: what was asked, the step it's on, the
  // results as they land, then the reply — with answers to tap when it
  // asks something back. "Run it again" starts over from the to-do;
  // everything else builds on what's been found.
  // The assistant asked something back — a number, a day — under its
  // question: the answers it offered as chips, and a field to type one
  // (a phone field when it's a number it wants). The answer carries the
  // same turn on.
  function askBox(card, question, options, onAnswer) {
    const box = document.createElement("div");
    box.className = "td-answer";
    const phone = /\b(number|phone|cell|mobile)\b/i.test(question);
    box.innerHTML = `${options.length ? `<div class="vt-choices">${options.map((o) => `<button type="button" class="vt-choice">${esc(o)}</button>`).join("")}</div>` : ""}
      <form class="td-answer-form"><input type="${phone ? "tel" : "text"}" class="td-input" placeholder="${phone ? "Their number" : "Your answer"}" autocomplete="off" ${phone ? 'inputmode="tel"' : ""} /><button type="submit" class="btn btn-primary btn-sm">Send</button></form>`;
    const done = (answer) => { box.querySelectorAll("button, input").forEach((x) => { x.disabled = true; }); box.classList.add("answered"); onAnswer(answer); };
    box.querySelectorAll(".vt-choice").forEach((b) => b.addEventListener("click", () => { b.classList.add("picked"); done(b.textContent); }));
    box.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); const v = box.querySelector("input").value.trim(); if (v) done(v); });
    card.appendChild(box);
    setTimeout(() => { try { box.querySelector("input").focus(); } catch { /* fine */ } }, 50);
  }

  // opts.turn + opts.card: carry on an exchange already on the page (an
  // answer to its question) rather than starting a new card.
  async function run(text, label, { fresh = false, turn = null, card = null } = {}) {
    if (busy) { toast("Still working on the last one", "warn"); return; }
    busy = true;
    const cont = !!(turn && card);
    if (!cont) {
      turn = { ask: label, say: "", at: "", steps: [], results: [] };
      card = turnEl(turn, { live: true });
      el.querySelector(".td-live").appendChild(card);
    } else {
      const reply = card.querySelector(".td-reply");
      reply.classList.add("td-working"); reply.setAttribute("data-step", ""); reply.textContent = "Working…";
    }
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.querySelectorAll(".td-action, .td-ask-form button").forEach((b) => { b.disabled = true; });
    hearTool = (name, input, out) => {
      const r = compactResult(name, input, out);
      if (!r) return;
      turn.results.push(r);
      card.querySelector(".td-results").appendChild(resultEl(r));
    };
    try {
      const s = await getSession();
      const res = await s.send(fresh || cont ? text : seed(text), (step) => {
        if (!step || /^⚠/.test(step)) return;
        if (turn.steps[turn.steps.length - 1] !== step) { turn.steps.push(step); const box = card.querySelector(".td-steps"); box.hidden = false; box.innerHTML = stepsHtml(turn.steps, { live: true }); }
      });
      const reply = card.querySelector(".td-reply");
      reply.classList.remove("td-working");
      reply.innerHTML = sayHtml(res.say || "Done.");
      reply.classList.add("td-in");
      turn.say = res.say || "Done.";
      turn.steps = turn.steps.slice(0, 8);
      // The timeline settles: every step ticked, the pill becomes the time.
      const stepsBox = card.querySelector(".td-steps");
      if (stepsBox && turn.steps.length) stepsBox.innerHTML = stepsHtml(turn.steps);
      if (res.done !== false) { const w = card.querySelector(".td-when"); if (w) w.innerHTML = `<span class="td-pill td-pill-done td-in">${icon("checkline")} Done</span>`; }
      if (res.done === false) {
        // A question back: answered right here, and the same turn carries on.
        const opts = Array.isArray(res.options) ? res.options : [];
        askBox(card, res.say || "", opts, (answer) => run(answer, answer, { fresh: fresh || turn.ask === "Do it", turn, card }));
      } else {
        turn.at = new Date().toISOString();
        remember(turn, { fresh });
        // Starting over draws the page afresh from the to-do; a next move
        // stays where it landed, under the work it built on.
        if (fresh) draw();
        else card.classList.remove("td-turn-live");
      }
    } catch (err) {
      const reply = card.querySelector(".td-reply");
      reply.classList.remove("td-working");
      reply.textContent = `Couldn't do it: ${err && err.message ? err.message : err}`;
      reply.style.color = "var(--danger)";
    } finally {
      hearTool = null;
      busy = false;
      el.querySelectorAll(".td-action, .td-ask-form button").forEach((b) => { b.disabled = false; });
    }
  }

  // Tapping the ask box raises the keyboard, and the page and the box move
  // up together: the keyboard takes the space where the bottom of the page
  // was, and what you were reading just above the box is still just above
  // it. Done by anchoring the BOTTOM edge of the content — the point of the
  // page that sits at the scroller's bottom — and holding it there as the
  // scroller changes height, through the keyboard's animation in and out.
  // (The browser's own "scroll the field into view" and iOS's slide of the
  // page are overridden the same way.)
  function holdScroll(input) {
    if (!input) return;
    let anchor = null, until = 0;
    const settle = () => {
      if (anchor == null || Date.now() > until) return;
      const want = Math.max(0, anchor - view.clientHeight);
      if (Math.abs(view.scrollTop - want) > 1) view.scrollTop = want;
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
    };
    const hold = (ms) => { anchor = view.scrollTop + view.clientHeight; until = Date.now() + ms; [0, 60, 150, 300, 500, 800].forEach((t) => setTimeout(settle, t)); };
    input.addEventListener("pointerdown", () => { if (document.activeElement !== input) hold(1200); });
    input.addEventListener("focus", () => { if (anchor == null || Date.now() > until) hold(1200); });
    input.addEventListener("blur", () => hold(1200));
    const vv = window.visualViewport;
    if (!vv) return;
    const onShape = () => { if (!view.isConnected) { vv.removeEventListener("resize", onShape); vv.removeEventListener("scroll", onShape); return; } settle(); };
    vv.addEventListener("resize", onShape);
    vv.addEventListener("scroll", onShape);
  }

  draw();
}
