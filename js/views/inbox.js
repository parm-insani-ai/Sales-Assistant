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
import { sendText, retryText, smsBlocker, takePrefill, timelineFor, linkIsHot } from "../sms.js";
import { bookingLinkForLead } from "./settings.js";
import { draftReply, draftingAvailable } from "../replies.js";

function when(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const today = new Date().toISOString().slice(0, 10);
  const day = t.toISOString().slice(0, 10);
  const clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return day === today ? clock : `${formatDate(iso)} · ${clock}`;
}

// The conversation list is the Comms tab now — one inbox, not two. This route
// stays for the per-customer thread, and for old notifications and links that
// point at /inbox.
export function renderInbox(view, { param } = {}) {
  if (param) return renderThread(view, param);
  navigate("/comms");
}

// --- One conversation ---
function renderThread(view, leadId) {
  // The customer record and the messages sync as separate rows, so the thread
  // can exist before its lead does. Stand in with the number rather than
  // showing "gone" over a conversation that is plainly right there.
  let lead = store.get("leads", leadId);
  if (!lead) {
    const first = store.textsFor(leadId).find((t) => t.phone);
    if (!first) {
      view.innerHTML = `<div class="card"><div class="muted small">That conversation is gone.</div></div>`;
      return;
    }
    lead = { id: leadId, name: first.phone, phone: first.phone, orphan: true };
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
          ${lead.phone ? `<a class="btn btn-sm btn-ghost" data-act="call" href="${telHref(lead.phone)}">${icon("phone")}</a>` : ""}
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
  // Placing the call logs it, so the thread shows the whole conversation
  // instead of only the half that was typed.
  el.querySelector('[data-act="call"]')?.addEventListener("click", () => {
    store.logCall(lead.id);
    setTimeout(paintThread, 0);
  });

  const threadBox = el.querySelector("#ib-thread");
  const compose = el.querySelector("#ib-compose");

  function paintThread() {
    const items = timelineFor(leadId);
    threadBox.innerHTML = "";
    if (!items.length) {
      threadBox.innerHTML = `<div class="card"><div class="muted small">Nothing here yet — send the first message below.</div></div>`;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "chat";
    items.forEach((item) => {
      // A call and a link open aren't things anybody said, so they read as
      // quiet centred notes rather than speech bubbles — the thread stays a
      // conversation and these sit in it as context.
      if (item.type === "call") {
        const c = document.createElement("div");
        c.className = "chat-event";
        c.innerHTML = `${icon("phone")} ${item.rec.dir === "in" ? "They called you" : "You called"}${
          item.rec.outcome ? ` · ${esc(item.rec.outcome)}` : ""} · ${esc(when(item.at))}`;
        wrap.appendChild(c);
        return;
      }
      if (item.type === "open") {
        const lk = item.rec;
        const n = Number(lk.opens) || 1;
        const what = /book/i.test(lk.kind || "") ? "your booking page" : "the vehicle page";
        const hot = linkIsHot(lk);
        const c = document.createElement("div");
        c.className = `chat-event${hot ? " chat-event-hot" : ""}`;
        c.innerHTML = `${icon("target")} Opened ${esc(what)}${n > 1 ? ` <b>${n}×</b>` : ""} · ${esc(when(item.at))}${
          hot ? " · they're looking now" : ""}`;
        wrap.appendChild(c);
        return;
      }
      const m = item.rec;
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
        ${blocked ? "" : `<button class="btn btn-ghost btn-sm" data-act="booklink">${icon("calendar")} Booking link</button>`}
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

    // Drops this customer's own booking link into the message. Theirs, not the
    // shared one — that's what lets the thread tell you they opened it.
    compose.querySelector('[data-act="booklink"]')?.addEventListener("click", async () => {
      const btn = compose.querySelector('[data-act="booklink"]');
      btn.disabled = true;
      const link = await bookingLinkForLead(lead);
      btn.disabled = false;
      if (!link) return toast("Set up your booking page in Settings first", "warn");
      const sep = box.value.trim() ? "\n\n" : "";
      box.value = `${box.value.trim()}${sep}Pick a time that suits you: ${link}`;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
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
