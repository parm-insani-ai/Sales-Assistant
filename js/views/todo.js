// The assistant's work on a to-do, on its own page: what it did and said,
// where it put the result, and the next things it can do for you from
// here — each one a tap, run in the same conversation so "text him the
// options" knows which options. Reached from Done — check it out on the
// to-do's card (Log → To-dos).

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc, relativeDay, formatDateTime } from "../utils.js";
import { icon } from "../icons.js";
import { toast } from "../components.js";
import { isReminder, reminderWhen } from "../reminders.js";
import { doItFor } from "./tasks.js";

const first = (name) => String(name || "").trim().split(/\s+/)[0] || "them";
const LOG_MAX = 12; // exchanges kept on the to-do

// The next things the assistant can do from here, by the kind of move it
// just made. Every text is drafted into the box for you to send — nothing
// goes to the customer from this page. Booking and reminders ask you when.
export function nextActions(t, lead, assist) {
  if (!lead) return [];
  const name = lead.name, f = first(name);
  const text = (what) => `Draft a text to ${name} for me to send: ${what}. Warm, short, no figures or payments. Put it in the box; I'll send it.`;
  const book = { icon: "calendar", label: `Book ${f} a time to come in`, ask: `Book ${name} an appointment to come in — ask me which day and time.` };
  const remind = { icon: "bell", label: "Remind me to follow up", ask: `Set me a reminder to follow up with ${name} — ask me when.` };
  const open = assist && assist.to ? [{ icon: "message", label: "Open the text to send", to: assist.to }] : [];
  switch (t.kind) {
    case "budget": case "stock": case "objection": return [
      { icon: "message", label: `Text ${f} the options`, ask: text(`that I've found a couple of options worth a look, name the best fit from what you found, and ask when they could come see it`) },
      { icon: "compare", label: "Compare the two best", ask: `Put the two best fits you found for ${name} side by side on the Compare screen.` },
      book, remind,
    ];
    case "people": return [
      ...open,
      { icon: "calendar", label: "Book a visit for both of them", ask: `Book ${name} an appointment for both of them to come in together — ask me which day and time.` },
      remind,
    ];
    case "referral": return [
      ...open,
      { icon: "bell", label: "Remind me to ask in person", ask: `Set me a reminder to ask ${name} for the referral in person — ask me when.` },
    ];
    default: return [book, remind];
  }
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
  view.appendChild(el);

  // One conversation for the page, so each next action knows what the
  // assistant already found. The first ask carries that work in.
  let session = null, seeded = false, busy = false;
  const getSession = async () => {
    const a = await import("../agent.js");
    if (!a.agentConfigured()) throw new Error("Set up the voice agent under Settings first");
    if (!session) session = a.createAgentSession();
    return session;
  };
  const seed = (text) => {
    if (seeded) return text;
    seeded = true;
    const a = t.assist;
    return a && a.say ? `Earlier, for my to-do "${t.title}"${lead ? ` about ${lead.name}` : ""}, you did this and said: "${a.say}". Now: ${text}` : text;
  };
  const remember = (ask1, say, extra = {}) => {
    const a = { ...(t.assist || {}), ...extra };
    a.log = [...(a.log || []), { ask: ask1, say, at: new Date().toISOString() }].slice(-LOG_MAX);
    t.assist = a;
    store.update("tasks", t.id, { assist: a });
  };

  const when = isReminder(t) ? reminderWhen(t) : t.due ? relativeDay(t.due) : "";
  const sub = [lead ? `<a href="#/leads/${esc(lead.id)}" class="td-who">${esc(lead.name)}</a>` : "", esc(when)].filter(Boolean).join(" · ");

  function draw() {
    const a = t.assist;
    const actions = nextActions(t, lead, a);
    const steps = a && Array.isArray(a.steps) ? a.steps.filter(Boolean) : [];
    el.innerHTML = `
      <div class="hero">
        ${sub ? `<div class="hero-greeting">${sub}</div>` : ""}
        <div class="hero-title" style="font-size:1.3rem">${esc(t.title)}</div>
      </div>
      <div class="section-title">What it did</div>
      ${a && a.at ? `
      <div class="card td-work">
        ${steps.length ? `<div class="td-steps">${steps.map((s) => `<span class="td-step">${esc(s)}</span>`).join(`<span class="td-sep">›</span>`)}</div>` : ""}
        <div class="td-say">${esc(a.say || "Done.")}</div>
        <div class="small muted" style="margin-top:8px">${esc(formatDateTime(a.at))}</div>
        ${a.to ? `<button type="button" class="btn btn-primary btn-block" data-act="open" style="margin-top:12px">Open what it put on screen <span class="td-arrow">›</span></button>` : ""}
      </div>
      ${(a.log || []).length ? `<div class="td-thread">${a.log.map((x) => `<div class="card td-turn"><div class="td-ask">${esc(x.ask)}</div><div class="td-reply">${esc(x.say)}</div></div>`).join("")}</div>` : ""}`
      : `<div class="card td-work"><div class="td-say muted">Not run yet.</div>${ask ? `<button type="button" class="btn btn-primary btn-block" data-act="run" style="margin-top:12px">Do it</button>` : ""}</div>`}
      <div class="td-live"></div>
      ${actions.length ? `
      <div class="section-title">It can also</div>
      <div class="card td-actions">
        ${actions.map((x, i) => `<button type="button" class="td-action" data-action="${i}">${icon(x.icon)}<span>${esc(x.label)}</span><span class="td-arrow">›</span></button>`).join("")}
      </div>` : ""}
      <div class="card">
        <form class="td-ask-form" style="display:flex;gap:8px;align-items:center">
          <input type="text" class="td-input" placeholder="${esc(lead ? `Or tell it what else to do for ${first(lead.name)}…` : "Or tell it what else to do…")}" autocomplete="off" style="flex:1;min-width:0" />
          <button type="submit" class="btn btn-primary btn-sm" style="flex:none">Go</button>
        </form>
      </div>
      <div class="btn-row" style="margin-top:4px">
        ${ask ? `<button type="button" class="btn btn-ghost btn-sm" data-act="again" style="flex:1">Run it again</button>` : ""}
        <button type="button" class="btn btn-ghost btn-sm" data-act="done" style="flex:1">${icon("check")} Tick it off</button>
      </div>
      <div class="fab-note">Texts it drafts land in the box for you to send. Figures stay off them.</div>
    `;
    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener("click", fn); };
    on('[data-act="open"]', () => { location.hash = a.to; });
    on('[data-act="run"]', () => run(ask, "Do it", { fresh: true }));
    on('[data-act="again"]', () => run(ask, "Run it again", { fresh: true }));
    on('[data-act="done"]', () => { store.update("tasks", t.id, { done: true }); toast("Nice — task done", "success"); navigate("/log"); });
    el.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => {
      const x = actions[Number(b.dataset.action)];
      if (!x) return;
      if (x.to) { location.hash = x.to; return; }
      run(x.ask, x.label);
    }));
    el.querySelector(".td-ask-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = el.querySelector(".td-input");
      const text = inp.value.trim();
      if (!text) return;
      inp.value = "";
      run(text, text);
    });
  }

  // One exchange, live on the page: what was asked, the step it's on,
  // then the reply — with answers to tap when it asks something back.
  async function run(text, label, { fresh = false } = {}) {
    if (busy) { toast("Still working on the last one", "warn"); return; }
    busy = true;
    const live = el.querySelector(".td-live");
    const card = document.createElement("div");
    card.className = "card td-turn td-turn-live";
    card.innerHTML = `<div class="td-ask">${esc(label)}</div><div class="td-reply td-working" data-step>Working…</div>`;
    live.appendChild(card);
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.querySelectorAll(".td-action, .td-ask-form button").forEach((b) => { b.disabled = true; });
    const from = location.hash;
    try {
      const s = await getSession();
      // "Run it again" starts over from the to-do; everything else builds on
      // what's been found.
      const res = await s.send(fresh ? text : seed(text), (step) => { const d = card.querySelector("[data-step]"); if (d && step && !/^⚠/.test(step)) d.textContent = step; });
      const reply = card.querySelector(".td-reply");
      reply.classList.remove("td-working");
      reply.textContent = res.say || "Done.";
      const to = location.hash !== from ? location.hash : "";
      if (res.done === false) {
        // A question back: the answers it offered as chips, or the box below.
        const opts = Array.isArray(res.options) ? res.options : [];
        if (opts.length) {
          const box = document.createElement("div");
          box.className = "vt-choices";
          opts.forEach((o) => { const b = document.createElement("button"); b.type = "button"; b.className = "vt-choice"; b.textContent = o; b.addEventListener("click", () => { box.querySelectorAll("button").forEach((x) => { x.disabled = true; }); b.classList.add("picked"); box.classList.add("answered"); run(o, o); }); box.appendChild(b); });
          card.appendChild(box);
        } else {
          const hint = document.createElement("div"); hint.className = "small muted"; hint.style.marginTop = "6px"; hint.textContent = "Answer in the box below."; card.appendChild(hint);
        }
      } else if (fresh) {
        remember(label, res.say || "Done.", { at: new Date().toISOString(), say: res.say || "Done.", to, log: [] });
        if (!to) draw();
      } else {
        remember(label, res.say || "Done.", to ? { to } : {});
      }
    } catch (err) {
      const reply = card.querySelector(".td-reply");
      reply.classList.remove("td-working");
      reply.textContent = `Couldn't do it: ${err && err.message ? err.message : err}`;
      reply.style.color = "var(--danger)";
    } finally {
      busy = false;
      el.querySelectorAll(".td-action, .td-ask-form button").forEach((b) => { b.disabled = false; });
    }
  }

  draw();
}
