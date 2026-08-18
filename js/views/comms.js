// Communication hub: today's outreach queue, one-tap sends, the email stream,
// and the automated-email status — everything about talking to customers.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { esc, initials, formatDate, relativeDay, daysFromToday, telHref, smsHref, mailtoHref } from "../utils.js";
import { openTemplatePicker } from "./messages.js";
import { emailSendConfigured } from "../email.js";

const chMeta = (c) =>
  c === "text" ? { icon: "message", label: "Text" } :
  c === "email" ? { icon: "mail", label: "Email" } :
  { icon: "phone", label: "Call" };

export function renderComms(view) {
  const leads = store.all("leads");
  const leadById = (id) => leads.find((l) => l.id === id) || null;
  const s = store.getSettings();
  const today = new Date().toISOString().slice(0, 10);

  const due = store.all("tasks")
    .filter((t) => !t.done && t.leadId && t.channel && t.due && t.due <= today)
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""));

  const emails = store.all("emails")
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 10);

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="section-title">Outreach due</div>
    <div class="card" id="c-due">${due.length ? "" : `<div class="muted small">Nothing due — every follow-up is on schedule. 🎉</div>`}</div>

    <div class="section-title">Send a message</div>
    <div class="card">
      <div class="searchbar" style="margin-bottom:10px"><input type="search" id="c-search" placeholder="Find a customer…"></div>
      <div id="c-people"></div>
    </div>

    <div class="section-title">Recent emails</div>
    <div class="card" id="c-emails">${emails.length ? "" : `<div class="muted small">No emails logged yet. Send one with a template, or log a reply from a customer's page.</div>`}</div>

    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="row-title">${icon("mail")} Automated emails</div>
          <div class="row-sub">${
            s.emailAutoSend
              ? (emailSendConfigured() ? "On — due follow-up emails send when you open the app." : "On, but the sending function isn't set up yet.")
              : "Off — turn on to send due follow-up emails automatically."
          }</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="c-settings">Set up</button>
      </div>
    </div>
  `;
  view.appendChild(el);

  // --- Outreach due: one-tap act (marks the step done + logs the touch). ---
  const dueBox = el.querySelector("#c-due");
  due.slice(0, 12).forEach((t) => {
    const l = leadById(t.leadId);
    const m = chMeta(t.channel);
    const overdue = daysFromToday(t.due) < 0;
    const href = !l ? "#" :
      t.channel === "text" ? smsHref(l.phone) :
      t.channel === "email" ? mailtoHref(l.email) : telHref(l.phone);
    const usable = l && (t.channel === "email" ? !!l.email : !!l.phone);
    const row = document.createElement("div");
    row.className = "kv";
    row.style.alignItems = "center";
    row.innerHTML = `
      <span class="v" style="text-align:left;flex:1;font-weight:550;cursor:pointer">${esc(t.title)}
        <div class="small ${overdue ? "" : "muted"}" style="font-weight:450;${overdue ? "color:var(--danger)" : ""}">${esc(relativeDay(t.due))}</div>
      </span>
      ${usable
        ? `<a class="btn btn-primary btn-sm" href="${href}" style="flex:none">${icon(m.icon)} ${m.label}</a>`
        : `<button class="btn btn-ghost btn-sm" data-open style="flex:none">Open</button>`}
    `;
    row.querySelector("span").addEventListener("click", () => l && navigate(`/leads/${l.id}`));
    const openBtn = row.querySelector("[data-open]");
    if (openBtn) openBtn.addEventListener("click", () => l && navigate(`/leads/${l.id}`));
    const act = row.querySelector("a");
    if (act) act.addEventListener("click", () => {
      store.update("tasks", t.id, { done: true });
      store.update("leads", l.id, { lastContacted: new Date().toISOString() });
      store.logActivity("touch");
      row.style.opacity = "0.45";
    });
    dueBox.appendChild(row);
  });

  // --- Send a message: pick a customer, then a template. ---
  const people = el.querySelector("#c-people");
  const contactable = leads
    .filter((l) => !["delivered", "lost"].includes(l.stage) && (l.phone || l.email))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const drawPeople = (q = "") => {
    const query = q.trim().toLowerCase();
    const list = (query
      ? contactable.filter((l) => [l.name, l.vehicleInterest, l.phone, l.email].join(" ").toLowerCase().includes(query))
      : contactable
    ).slice(0, 8);
    people.innerHTML = list.length ? "" : `<div class="muted small">No customers with a phone or email${query ? " match that" : " yet"}.</div>`;
    list.forEach((l) => {
      const row = document.createElement("div");
      row.className = "kv";
      row.style.cssText = "align-items:center;cursor:pointer";
      row.innerHTML = `
        <span class="v" style="text-align:left;flex:1;font-weight:550">${esc(l.name)}
          <div class="small muted" style="font-weight:450">${esc(l.vehicleInterest || "No vehicle noted")}</div>
        </span>
        <span class="muted" style="flex:none">${l.phone ? icon("message") : ""} ${l.email ? icon("mail") : ""}</span>
      `;
      row.addEventListener("click", () => openTemplatePicker(l));
      people.appendChild(row);
    });
  };
  drawPeople();
  el.querySelector("#c-search").addEventListener("input", (e) => drawPeople(e.target.value));

  // --- Recent emails across every customer. ---
  const emailBox = el.querySelector("#c-emails");
  emails.forEach((e) => {
    const l = leadById(e.leadId);
    const row = document.createElement("div");
    row.className = "kv";
    row.style.cssText = "align-items:flex-start;cursor:pointer";
    row.innerHTML = `
      <span class="k" style="flex:none">${e.direction === "in" ? "↓ In" : "↑ Out"}</span>
      <span class="v" style="text-align:left;flex:1;font-weight:550">${esc(e.subject || "(no subject)")}
        <div class="small muted" style="font-weight:450">${esc(l ? l.name : "Customer")} · ${esc(formatDate(e.createdAt))}${e.via === "auto" ? " · automatic" : ""}</div>
      </span>
    `;
    row.addEventListener("click", () => l && navigate(`/leads/${l.id}`));
    emailBox.appendChild(row);
  });

  el.querySelector("#c-settings").addEventListener("click", () => navigate("/settings"));
}
