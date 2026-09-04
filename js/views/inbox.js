// Inbox — the conversations. One list of threads, one thread at a time.
//
// This is the half of the loop that didn't exist before: the app could send but
// never hear, so a customer who replied got silence until someone happened to
// look at their phone. Speed of reply is the single biggest lever on whether a
// text becomes an appointment, so unanswered threads sort to the top and stay
// there until they're answered.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { toast } from "../components.js";
import { icon } from "../icons.js";
import { esc, formatDate, telHref } from "../utils.js";
import { sendText, retryText, inboxThreads, smsReady, smsBlocker, takePrefill } from "../sms.js";
import { draftReply, draftingAvailable } from "../replies.js";

function when(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const today = new Date().toISOString().slice(0, 10);
  const day = t.toISOString().slice(0, 10);
  const clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return day === today ? clock : `${formatDate(iso)} · ${clock}`;
}

// --- Thread list ---
export function renderInbox(view, { param } = {}) {
  if (param) return renderThread(view, param);

  const threads = inboxThreads();
  const el = document.createElement("div");

  if (!smsReady()) {
    el.innerHTML += `<div class="card" style="margin-bottom:12px">
      <div class="row"><div class="row-main">
        <div class="row-title">${icon("message")} Replies aren't switched on</div>
        <div class="row-sub">${esc(smsBlocker())}</div>
      </div><button class="btn btn-sm btn-ghost" data-act="setup">Set up</button></div>
    </div>`;
  }

  if (!threads.length) {
    el.innerHTML += `<div class="card"><div class="muted small">
      No conversations yet. Texts you send from the app — and every reply that comes back — show up here.
    </div></div>`;
    view.appendChild(el);
    el.querySelector('[data-act="setup"]')?.addEventListener("click", () => navigate("/settings"));
    return;
  }

  threads.forEach((t) => {
    const card = document.createElement("div");
    card.className = "card card-tap";
    const preview = String(t.last.body || "").replace(/\s+/g, " ").slice(0, 72);
    card.innerHTML = `
      <div class="row">
        <div class="row-main" style="min-width:0">
          <div class="row-title">${esc(t.lead.name || "Customer")}${
            t.lead.smsOptOut ? ' <span class="badge badge-lost">opted out</span>' : ""
          }${t.unread ? ` <span class="badge badge-due">${t.unread} new</span>` : ""}</div>
          <div class="row-sub">${t.last.dir === "out" ? "You: " : ""}${esc(preview)}${preview.length >= 72 ? "…" : ""}</div>
        </div>
        <div class="row-meta small muted">${esc(when(t.at))}</div>
      </div>`;
    card.addEventListener("click", () => navigate(`/inbox/${t.leadId}`));
    el.appendChild(card);
  });
  view.appendChild(el);
  el.querySelector('[data-act="setup"]')?.addEventListener("click", () => navigate("/settings"));
}

// --- One conversation ---
function renderThread(view, leadId) {
  const lead = store.get("leads", leadId);
  if (!lead) {
    view.innerHTML = `<div class="card"><div class="muted small">That conversation is gone.</div></div>`;
    return;
  }
  store.markThreadRead(leadId);

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row">
        <div class="row-main" style="min-width:0">
          <div class="row-title">${esc(lead.name || "Customer")}</div>
          <div class="row-sub">${esc(lead.vehicleInterest || lead.phone || "")}</div>
        </div>
        <div class="btn-row">
          ${lead.phone ? `<a class="btn btn-sm btn-ghost" href="${telHref(lead.phone)}">${icon("phone")}</a>` : ""}
          <button class="btn btn-sm btn-ghost" data-act="open">Profile</button>
        </div>
      </div>
    </div>
    ${lead.smsOptOut ? `<div class="card" style="margin-bottom:12px"><div class="row"><div class="row-main">
      <div class="row-title">${icon("alert")} They've opted out</div>
      <div class="row-sub">${esc((lead.name || "They").split(" ")[0])} texted STOP, so the app won't message them and campaigns skip them. They can text START to come back.</div>
    </div></div></div>` : ""}
    <div id="ib-thread"></div>
    <div class="card ib-compose" id="ib-compose"></div>`;
  view.appendChild(el);
  el.querySelector('[data-act="open"]').addEventListener("click", () => navigate(`/leads/${lead.id}`));

  const threadBox = el.querySelector("#ib-thread");
  const compose = el.querySelector("#ib-compose");

  function paintThread() {
    const msgs = store.textsFor(leadId);
    threadBox.innerHTML = "";
    if (!msgs.length) {
      threadBox.innerHTML = `<div class="card"><div class="muted small">Nothing here yet — send the first message below.</div></div>`;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "chat";
    msgs.forEach((m) => {
      const b = document.createElement("div");
      b.className = `bubble ${m.dir === "in" ? "bubble-in" : "bubble-out"}${m.status === "failed" ? " bubble-failed" : ""}`;
      b.innerHTML = `<div class="bubble-body">${esc(m.body)}</div>
        <div class="bubble-meta">${esc(when(m.at || m.createdAt))}${
          m.status === "sending" ? " · sending…" : m.status === "failed" ? ` · ${esc(m.error || "failed")}` : ""
        }</div>`;
      if (m.status === "failed") {
        const again = document.createElement("button");
        again.className = "btn btn-sm btn-ghost";
        again.textContent = "Try again";
        again.addEventListener("click", async () => {
          again.disabled = true;
          const r = await retryText(m.id);
          if (!r.ok) toast(r.error, "warn");
          paintThread();
        });
        b.appendChild(again);
      }
      wrap.appendChild(b);
    });
    threadBox.appendChild(wrap);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function paintCompose() {
    const blocked = lead.smsOptOut ? "They've opted out — you can't text them from here." : smsBlocker();
    compose.innerHTML = `
      <div class="field" style="margin:0">
        <textarea id="ib-text" rows="2" placeholder="${blocked ? "Texting unavailable" : "Write a reply…"}"
          ${blocked ? "disabled" : ""}></textarea>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-primary btn-sm" data-act="send" ${blocked ? "disabled" : ""}>${icon("message")} Send</button>
        ${draftingAvailable() && !blocked ? `<button class="btn btn-ghost btn-sm" data-act="draft">${icon("sparkles")} Draft a reply</button>` : ""}
      </div>
      ${blocked ? `<div class="small muted" style="margin-top:8px">${esc(blocked)}</div>` : ""}`;

    const box = compose.querySelector("#ib-text");
    // Arrived here from a "Text" button elsewhere in the app: it carries the
    // message it would have handed to iMessage. Read it, don't send it — the
    // last look before a customer gets something stays with the person.
    const prefill = takePrefill(leadId);
    if (prefill && box && !box.disabled) {
      box.value = prefill;
      requestAnimationFrame(() => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); });
    }
    compose.querySelector('[data-act="send"]')?.addEventListener("click", async () => {
      const body = box.value.trim();
      if (!body) return;
      const btn = compose.querySelector('[data-act="send"]');
      btn.disabled = true;
      box.value = "";
      paintThread();
      const r = await sendText(lead, body);
      if (!r.ok) toast(r.error, "warn");
      btn.disabled = false;
      paintThread();
    });

    // The agent writes it; you send it. Nothing reaches a customer unread.
    compose.querySelector('[data-act="draft"]')?.addEventListener("click", async () => {
      const btn = compose.querySelector('[data-act="draft"]');
      btn.disabled = true;
      btn.textContent = "Thinking…";
      const r = await draftReply(lead);
      btn.disabled = false;
      btn.innerHTML = `${icon("sparkles")} Draft a reply`;
      if (!r.ok) return toast(r.error, "warn");
      box.value = r.text;
      box.focus();
      toast("Draft ready — read it before you send", "");
    });
  }

  paintThread();
  paintCompose();
  const off = store.subscribe(() => { if (document.body.contains(threadBox)) paintThread(); });
  window.addEventListener("hashchange", () => off && off(), { once: true });
}
