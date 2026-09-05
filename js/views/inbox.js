// Inbox — the conversations. One list of threads, one thread at a time.
//
// This is the half of the loop that didn't exist before: the app could send but
// never hear, so a customer who replied got silence until someone happened to
// look at their phone. Speed of reply is the single biggest lever on whether a
// text becomes an appointment, so unanswered threads sort to the top and stay
// there until they're answered.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { toast, openModal } from "../components.js";
import { icon } from "../icons.js";
import { esc, formatDate, telHref, initials } from "../utils.js";
import { sendText, retryText, smsBlocker, takePrefill, timelineFor, linkIsHot } from "../sms.js";
import { bookingLinkForLead } from "./settings.js";
import { draftReply, draftingAvailable } from "../replies.js";

// The conversation list is the Comms tab now — one inbox, not two. This route
// stays for the per-customer thread, and for old notifications and links that
// point at /inbox.
export function renderInbox(view, { param } = {}) {
  if (param) return renderThread(view, param);
  navigate("/comms");
}

function clock(iso) {
  const t = new Date(iso);
  return isNaN(t) ? "" : t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// The separator between days. "Today" and "Yesterday" by name, because that's
// what people actually say, and a date for anything older.
function dayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const day = (x) => new Date(x).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (day(iso) === today) return "Today";
  if (day(iso) === yest) return "Yesterday";
  return formatDate(iso);
}

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

  const name = lead.name || "Customer";
  const el = document.createElement("div");
  el.className = "conv-screen";
  el.innerHTML = `
    <div class="conv-head">
      <div class="conv-av">${esc(initials(name))}</div>
      <div class="conv-head-main">
        <div class="conv-head-name">${esc(name)}</div>
        <div class="conv-head-sub">${esc(lead.vehicleInterest || lead.phone || "")}</div>
      </div>
      ${lead.phone ? `<a class="conv-head-btn" data-act="call" aria-label="Call" href="${telHref(lead.phone)}">${icon("phone")}</a>` : ""}
      <button class="conv-head-btn" data-act="open" aria-label="Profile">${icon("users")}</button>
    </div>
    ${lead.smsOptOut ? `<div class="card" style="margin-bottom:8px"><div class="row"><div class="row-main">
      <div class="row-title">${icon("alert")} They've opted out</div>
      <div class="row-sub">${esc(String(name).split(" ")[0])} texted STOP, so the app won't message them and campaigns skip them. They can text START to come back.</div>
    </div></div></div>` : ""}
    <div id="ib-thread"></div>
    <div class="ib-compose" id="ib-compose"></div>`;
  view.appendChild(el);
  // A thread supplies its own bottom edge — the reply bar — so it doesn't want
  // the scroll buffer the list screens carry underneath them.
  view.classList.add("view-thread");
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

    // Group consecutive messages from the same side into a run. Within a run
    // the bubbles sit tight and only the last one carries a time — a timestamp
    // under every line is noise, and the shape of the run is what tells you
    // who said what.
    const sameSide = (a, b) =>
      a && b && a.type === "text" && b.type === "text" && a.rec.dir === b.rec.dir &&
      a.rec.status !== "failed" && b.rec.status !== "failed";

    let lastDay = "";
    items.forEach((item, i) => {
      const day = String(item.at || "").slice(0, 10);
      if (day && day !== lastDay) {
        lastDay = day;
        const sep = document.createElement("div");
        sep.className = "chat-day";
        sep.textContent = dayLabel(item.at);
        wrap.appendChild(sep);
      }

      // A call and a link open aren't things anybody said, so they read as
      // quiet centred notes rather than speech bubbles.
      if (item.type === "call") {
        const c = document.createElement("div");
        c.className = "chat-event";
        c.innerHTML = `${item.rec.dir === "in" ? "They called you" : "You called"}${
          item.rec.outcome ? ` · ${esc(item.rec.outcome)}` : ""} · ${esc(clock(item.at))}`;
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
        c.innerHTML = `Opened ${esc(what)}${n > 1 ? ` <b>${n}×</b>` : ""} · ${esc(clock(item.at))}${
          hot ? " · they're looking now" : ""}`;
        wrap.appendChild(c);
        return;
      }

      const m = item.rec;
      const runStart = !sameSide(items[i - 1], item);
      const runEnd = !sameSide(item, items[i + 1]);
      const b = document.createElement("div");
      b.className = `bubble ${m.dir === "in" ? "bubble-in" : "bubble-out"}${
        m.status === "failed" ? " bubble-failed" : ""}${runStart ? " bubble-runstart" : ""}${
        runEnd ? " bubble-runend" : ""}`;
      const body = document.createElement("div");
      body.className = "bubble-body";
      body.textContent = m.body;
      b.appendChild(body);
      wrap.appendChild(b);

      // The time sits under the run, outside the bubble — the way it does in
      // every messaging app, and it keeps the bubble to just the words.
      if (runEnd || m.status !== "sent") {
        const meta = document.createElement("div");
        meta.className = `bubble-meta${m.dir === "in" ? " bubble-meta-in" : ""}${
          m.status === "failed" ? " bubble-meta-failed" : ""}`;
        meta.textContent = m.status === "sending" ? "Sending…"
          : m.status === "failed" ? (m.error || "Not delivered")
          : clock(m.at || m.createdAt);
        if (m.status === "failed") {
          const again = document.createElement("button");
          again.className = "bubble-retry";
          again.textContent = "Try again";
          again.addEventListener("click", async () => {
            again.disabled = true;
            const r = await retryText(m.id);
            if (!r.ok) toast(r.error, "warn");
            paintThread();
          });
          meta.appendChild(again);
        }
        wrap.appendChild(meta);
      }
    });
    threadBox.appendChild(wrap);
    // Open on the newest message, the way a conversation should. The scroller
    // is the view container now — .chat scrolls with the page rather than
    // inside itself, so setting scrollTop on it did nothing and threads opened
    // partway up.
    scrollToLatest();
  }

  // Called after a repaint, so wait a frame for layout before measuring.
  function scrollToLatest() {
    const scroller = view.closest(".view") || document.getElementById("view");
    if (!scroller) return;
    requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  }

  function paintCompose() {
    const blocked = lead.smsOptOut ? "They've opted out — you can't text them from here." : smsBlocker();
    if (blocked) {
      compose.innerHTML = `<div class="ib-blocked">${esc(blocked)}</div>`;
      return;
    }
    // One row: extras, the box, send. Everything that isn't "type a reply and
    // send it" moved behind the +, because on a phone the reply is the screen.
    compose.innerHTML = `
      <button class="ib-round ib-more" data-act="more" aria-label="More">${icon("plus")}</button>
      <textarea id="ib-text" rows="1" placeholder="Message"></textarea>
      <button class="ib-round ib-send" data-act="send" aria-label="Send" disabled>${icon("send")}</button>`;

    const box = compose.querySelector("#ib-text");
    const sendBtn = compose.querySelector('[data-act="send"]');
    // Grow with the message, up to the cap in CSS.
    const grow = () => { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 120) + "px"; };
    const sync = () => { sendBtn.disabled = !box.value.trim(); grow(); };
    box.addEventListener("input", sync);

    // Arrived here from a "Text" button elsewhere in the app: it carries the
    // message it would have handed to iMessage. Read it, don't send it — the
    // last look before a customer gets something stays with the person.
    const prefill = takePrefill(leadId);
    if (prefill) {
      box.value = prefill;
      requestAnimationFrame(() => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); });
    }
    sync();

    const send = async () => {
      const body = box.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      box.value = "";
      sync();
      paintThread();
      const r = await sendText(lead, body);
      if (!r.ok) toast(r.error, "warn");
      paintThread();
    };
    sendBtn.addEventListener("click", send);

    compose.querySelector('[data-act="more"]').addEventListener("click", () => openExtras(box));
  }

  // The two things worth doing to a reply that aren't typing it. A sheet keeps
  // them one tap away without spending a row of the screen on them.
  function openExtras(box) {
    openModal("Add to this reply", (close) => {
      const wrap = document.createElement("div");
      const insert = (text) => {
        const sep = box.value.trim() ? "\n\n" : "";
        box.value = `${box.value.trim()}${sep}${text}`;
        box.dispatchEvent(new Event("input"));
        close();
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      };

      const bookBtn = document.createElement("button");
      bookBtn.className = "btn btn-ghost btn-block";
      bookBtn.innerHTML = `${icon("calendar")} Booking link`;
      bookBtn.addEventListener("click", async () => {
        bookBtn.disabled = true;
        const link = await bookingLinkForLead(lead);
        bookBtn.disabled = false;
        if (!link) { close(); return toast("Set up your booking page in Settings first", "warn"); }
        insert(`Pick a time that suits you: ${link}`);
      });
      wrap.appendChild(bookBtn);

      if (draftingAvailable()) {
        const draftBtn = document.createElement("button");
        draftBtn.className = "btn btn-ghost btn-block";
        draftBtn.style.marginTop = "8px";
        draftBtn.innerHTML = `${icon("sparkles")} Draft a reply`;
        // The agent writes it; you send it. Nothing reaches a customer unread.
        draftBtn.addEventListener("click", async () => {
          draftBtn.disabled = true;
          draftBtn.textContent = "Thinking…";
          const r = await draftReply(lead);
          if (!r.ok) { close(); return toast(r.error, "warn"); }
          box.value = r.text;
          box.dispatchEvent(new Event("input"));
          close();
          box.focus();
          toast("Draft ready — read it before you send", "");
        });
        wrap.appendChild(draftBtn);
      }
      return wrap;
    });
  }

  paintThread();
  paintCompose();
  const off = store.subscribe(() => { if (document.body.contains(threadBox)) paintThread(); });
  window.addEventListener("hashchange", () => off && off(), { once: true });
}
