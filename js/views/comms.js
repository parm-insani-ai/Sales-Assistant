// Comms — the inbox.
//
// One list of conversations, one row per customer, newest and unanswered
// first. Two tabs, because texts and email are answered in different postures:
// a text is a two-minute reply, an email is a sit-down.
//
// What used to be here — outreach due, appointment confirmations, occasions —
// is the Home queue's job. Those are things to go and do; this is things people
// have said to you. Keeping both on one screen was what made Comms, Leads and
// the old Deal Radar blur into each other.
//
// Link opens live in the conversation rather than in a feed of their own. "Ann
// opened the booking page twice this afternoon" is a fact about the
// conversation with Ann; anywhere else and you're reading two lists and
// joining them by hand.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { openModal, buildForm, toast } from "../components.js";
import { icon } from "../icons.js";
import { esc, formatDate, mailtoHref, initials } from "../utils.js";
import { openTemplatePicker } from "./messages.js";
import { emailSendConfigured } from "../email.js";
import { inboxThreads, smsReady, smsBlocker, linkIsHot } from "../sms.js";

const TAB_KEY = "comms-tab"; // survives navigating into a thread and back

// A customer without a phone or email: collect it on the spot, then go
// straight into picking a message — no detour through the lead page.
function addContactThenMessage(lead) {
  openModal(`Reach ${String(lead.name || "them").split(" ")[0]}`, (close) => {
    const { element } = buildForm(
      [
        { name: "phone", label: "Phone", value: lead.phone || "", type: "tel", inputmode: "tel", placeholder: "(902) 555-1234" },
        { name: "email", label: "Email", value: lead.email || "", type: "email", placeholder: "name@email.com" },
      ],
      {
        submitLabel: "Save & choose message",
        onSubmit: (data) => {
          store.update("leads", lead.id, { phone: (data.phone || "").trim(), email: (data.email || "").trim() });
          close();
          const updated = store.get("leads", lead.id);
          if (updated.phone || updated.email) openTemplatePicker(updated);
          else toast("Add a phone or email to message them", "");
        },
      }
    );
    return element;
  });
}

function when(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const today = new Date().toISOString().slice(0, 10);
  const clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return t.toISOString().slice(0, 10) === today ? clock : formatDate(iso);
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  if (min < 1440) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

// The one-line summary of where a conversation stands.
function preview(t) {
  const last = t.last;
  if (!last) return "";
  if (last.type === "text") {
    const body = String(last.rec.body || "").replace(/\s+/g, " ").slice(0, 68);
    return `${last.rec.dir === "out" ? "You: " : ""}${body}`;
  }
  if (last.type === "call") return `${last.rec.dir === "in" ? "Called you" : "You called"}${last.rec.outcome ? ` · ${last.rec.outcome}` : ""}`;
  if (last.type === "open") {
    const n = Number(last.rec.opens) || 1;
    const what = /book/i.test(last.rec.kind || "") ? "your booking page" : "the vehicle page";
    return `Opened ${what}${n > 1 ? ` ${n}×` : ""}`;
  }
  return "";
}

export function renderComms(view) {
  let tab = sessionStorage.getItem(TAB_KEY) || "messages";

  const el = document.createElement("div");
  view.appendChild(el);

  function draw() {
    sessionStorage.setItem(TAB_KEY, tab);
    // Tabs, then a compose button the size a compose button should be. A
    // full-width primary bar for "New message" took more of the screen than
    // the conversations did, and starting a fresh thread is the rarer action —
    // most of the time you're answering someone who already wrote to you.
    el.innerHTML = `
      <div class="btn-row" style="margin-bottom:6px; flex-wrap:nowrap; align-items:center">
        <button class="btn btn-sm ${tab === "messages" ? "btn-primary" : "btn-ghost"}" data-tab="messages" style="flex:1">${icon("message")} Messages</button>
        <button class="btn btn-sm ${tab === "email" ? "btn-primary" : "btn-ghost"}" data-tab="email" style="flex:1">${icon("mail")} Email</button>
        <button class="ib-round ib-more" data-act="compose"
          aria-label="${tab === "email" ? "New email" : "New message"}">${icon("plus")}</button>
      </div>
      <div id="c-body"></div>`;
    el.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => { tab = b.dataset.tab; draw(); }));
    el.querySelector('[data-act="compose"]').addEventListener("click", () =>
      openPeoplePicker(tab === "email" ? "email" : "text"));
    (tab === "messages" ? drawMessages : drawEmail)(el.querySelector("#c-body"));
  }

  // ---- Messages & calls ----
  function drawMessages(box) {
    const threads = inboxThreads();

    if (!smsReady()) {
      const warn = document.createElement("div");
      warn.className = "card";
      warn.style.marginBottom = "12px";
      warn.innerHTML = `<div class="row"><div class="row-main">
        <div class="row-title">${icon("message")} Replies aren't switched on</div>
        <div class="row-sub">${esc(smsBlocker())}</div>
      </div><button class="btn btn-sm btn-ghost" data-act="setup">Set up</button></div>`;
      warn.querySelector('[data-act="setup"]').addEventListener("click", () => navigate("/settings"));
      box.appendChild(warn);
    }

    if (!threads.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `<div class="muted small">No conversations yet. Every text you send — and every reply — lands here.</div>`;
      box.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "conv-list";
    threads.forEach((t) => list.appendChild(convRow(t)));
    box.appendChild(list);
  }

  // One conversation, the way a messages list has always drawn one: who,
  // what they last said, when. The ordering still puts unanswered replies and
  // live link opens on top — that judgement is the point of the screen — but
  // it's expressed by position and weight rather than by a row of chips.
  function convRow(t) {
    const row = document.createElement("div");
    row.className = `conv-row${t.unread ? " conv-unread" : ""}${t.lead.smsOptOut ? " conv-row-muted" : ""}`;
    const name = t.lead.name || "Customer";
    row.innerHTML = `
      <div class="conv-av${t.hot ? " conv-av-dot" : ""}">${esc(initials(name))}</div>
      <div class="conv-main">
        <div class="conv-top">
          <span class="conv-name">${esc(name)}</span>
          <span class="conv-time">${esc(when(t.at))}</span>
        </div>
        <div class="conv-bottom">
          <span class="conv-preview">${esc(preview(t))}</span>
          ${t.lead.smsOptOut ? `<span class="conv-tag">opted out</span>` : ""}
          ${t.unread ? `<span class="conv-badge">${t.unread}</span>` : ""}
        </div>
      </div>`;
    // The dot says someone is reading a link right now, which is the one thing
    // on this screen you'd want explained. Say it, quietly, in place of the
    // preview — it IS the newest thing that happened.
    if (t.hot) {
      const p2 = row.querySelector(".conv-preview");
      p2.textContent = `Opened your link · ${timeAgo(t.lastOpenAtHot || t.at)}`;
      p2.style.color = "var(--brand-strong)";
    }
    row.addEventListener("click", () => navigate(`/inbox/${t.leadId}`));
    return row;
  }

  // ---- Email ----
  function drawEmail(box) {
    const s = store.getSettings();
    // One row per customer, carrying their most recent email either way.
    const byLead = new Map();
    store.all("emails").forEach((e) => {
      if (!e.leadId) return;
      const at = String(e.createdAt || e.receivedAt || "");
      const cur = byLead.get(e.leadId);
      if (!cur || at > cur.at) byLead.set(e.leadId, { at, last: e, count: (cur?.count || 0) + 1 });
      else cur.count += 1;
    });
    const rows = [...byLead.entries()]
      .map(([leadId, e]) => ({ leadId, lead: store.get("leads", leadId), ...e }))
      .filter((r) => r.lead)
      .sort((a, b) => b.at.localeCompare(a.at));

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.style.marginBottom = "12px";
      empty.innerHTML = `<div class="muted small">No emails yet. Send one with a template, or connect Outlook so customer replies land here.</div>`;
      box.appendChild(empty);
    }

    const list = document.createElement("div");
    list.className = "conv-list";
    rows.forEach((r) => {
      const name = r.lead.name || "Customer";
      const row = document.createElement("div");
      row.className = `conv-row${r.last.direction === "in" ? " conv-unread" : ""}`;
      const tag = r.last.direction === "in" ? "reply" : (r.last.via === "auto" ? "automatic" : "");
      row.innerHTML = `
        <div class="conv-av">${esc(initials(name))}</div>
        <div class="conv-main">
          <div class="conv-top">
            <span class="conv-name">${esc(name)}</span>
            <span class="conv-time">${esc(when(r.at))}</span>
          </div>
          <div class="conv-bottom">
            <span class="conv-preview">${esc(String(r.last.subject || r.last.body || "").replace(/\s+/g, " ").slice(0, 80))}</span>
            ${tag ? `<span class="conv-tag">${esc(tag)}</span>` : ""}
            ${r.count > 1 ? `<span class="conv-tag">${r.count}</span>` : ""}
          </div>
        </div>`;
      row.addEventListener("click", () => navigate(`/leads/${r.leadId}`));
      list.appendChild(row);
    });
    box.appendChild(list);

    const auto = document.createElement("div");
    auto.className = "card";
    auto.style.marginTop = "14px";
    auto.innerHTML = `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${icon("mail")} Automated emails</div>
          <div class="row-sub">${
            s.emailAutoSend
              ? (emailSendConfigured() ? "On — due follow-up emails send when you open the app, and show here marked automatic." : "On, but the sending function isn't set up yet.")
              : "Off — turn on to send due follow-up emails automatically."
          }</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-act="email-settings">Set up</button>
      </div>`;
    auto.querySelector('[data-act="email-settings"]').addEventListener("click", () => navigate("/settings"));
    box.appendChild(auto);
  }

  // Starting a new conversation: pick the person first, the same way a
  // messages app does.
  function openPeoplePicker(channel) {
    openModal(channel === "email" ? "New email" : "New message", (close) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="searchbar"><input type="search" id="cp-q" placeholder="Find a customer…"></div><div id="cp-list"></div>`;
      const list = wrap.querySelector("#cp-list");
      const paint = (q = "") => {
        const needle = q.toLowerCase();
        const people = store.all("leads")
          .filter((l) => !needle || [l.name, l.phone, l.email, l.vehicleInterest].join(" ").toLowerCase().includes(needle))
          .filter((l) => (channel === "email" ? true : !l.smsOptOut))
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
          .slice(0, 40);
        list.innerHTML = people.length ? "" : `<div class="muted small" style="padding:8px 2px">Nobody matches that.</div>`;
        people.forEach((l) => {
          const row = document.createElement("div");
          row.className = "row";
          row.style.cursor = "pointer";
          const reachable = channel === "email" ? !!l.email : !!l.phone;
          row.innerHTML = `<div class="row-main" style="min-width:0">
              <div class="row-title">${esc(l.name || "Customer")}</div>
              <div class="row-sub">${esc(l.vehicleInterest || (channel === "email" ? l.email : l.phone) || "no contact details")}</div>
            </div>${reachable ? "" : `<div class="row-meta small muted">add ${channel === "email" ? "email" : "phone"}</div>`}`;
          row.addEventListener("click", () => {
            close();
            if (!reachable) return addContactThenMessage(l);
            if (channel === "email") return openTemplatePicker(l);
            // Texting goes to the thread, where the conversation already lives.
            navigate(`/inbox/${l.id}`);
          });
          list.appendChild(row);
        });
      };
      paint();
      wrap.querySelector("#cp-q").addEventListener("input", (e) => paint(e.target.value));
      return wrap;
    });
  }

  draw();
  const off = store.subscribe(() => { if (document.body.contains(el)) draw(); });
  window.addEventListener("hashchange", () => off && off(), { once: true });
}
