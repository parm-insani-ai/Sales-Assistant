// Lists, each on its own page.
//
// Two kinds. Your own lists (lists.js): people put on by hand — a callback
// list, "interested, no appointment", an event. Saved filters (cutlists.js):
// a cut saved under a name on Outreach, which fills itself from the book
// each time. The index names them all with their counts; a list's page is
// its people as cards, with the list's own actions across the top — call
// them as a session, text or email them, add people (your own lists) or
// work it on Outreach with the cuts (saved filters), rename, delete.

import * as store from "../store.js";
import { navigate } from "../router.js";
import { esc, relativeDay } from "../utils.js";
import { icon } from "../icons.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { emptyAudience } from "../outreach.js";
import { startSession } from "../session.js";
import { memberLists, listById, renameList, deleteList, addToList, removeFromList } from "../lists.js";
import { savedLists, savedList, savedLabel, savedMembers, removeSavedList } from "../cutlists.js";
import { askNewList } from "./listpick.js";
import { leadCard } from "./leads.js";

export function renderLists(view, { param } = {}) {
  if (param) return renderListPage(view, param);
  const el = document.createElement("div");
  view.appendChild(el);
  const draw = () => {
    const mine = memberLists();
    const saved = savedLists().map((x) => ({ ...x, n: savedMembers(x).length }));
    const row = (href, name, sub, n, k) => `<a class="card card-tap ls-row" href="#${href}" data-kind="${k}"><div class="row" style="align-items:center"><div class="row-main" style="min-width:0"><div class="row-title">${esc(name)}</div>${sub ? `<div class="row-sub">${esc(sub)}</div>` : ""}</div><div class="row-meta"><span class="strong">${n.toLocaleString()}</span><span class="muted small"> ${n === 1 ? "person" : "people"}</span></div></div></a>`;
    el.innerHTML = `
      <div class="section-title" style="margin-top:0">Your lists <span class="muted">· ${mine.length}</span></div>
      ${mine.length ? mine.map((x) => row(`/lists/${x.id}`, x.name, x.at ? `updated ${relativeDay(x.at)}` : "", x.ids.length, "mine")).join("") : `<div class="card muted small">None yet. A list of your own is people you put on it by hand — a callback list, the ones who were interested but didn't book, an event. Put someone on from their page, from a session's "How did it go?", or a whole cut from Outreach.</div>`}
      <button type="button" class="btn btn-ghost btn-block" data-act="new-list" style="margin:4px 0 14px">${icon("plus")} New list</button>
      <div class="section-title">Saved filters <span class="muted">· ${saved.length}</span></div>
      ${saved.length ? saved.map((x) => row(`/lists/${x.id}`, x.name, savedLabel(x), x.n, "saved")).join("") : `<div class="card muted small">None yet. On Outreach, turn on any cuts or build a filter on any field, then tap Save in the bar — the filter is kept under a name and fills itself from the book each time.</div>`}
      <div class="hint" style="margin:6px 2px 0">A saved filter is a rule and finds everyone who fits it today; a list of your own is exactly the people you put on it.</div>`;
    el.querySelector('[data-act="new-list"]').addEventListener("click", () => askNewList((x) => navigate(`/lists/${x.id}`)));
  };
  draw();
}

function renderListPage(view, id) {
  const el = document.createElement("div");
  view.appendChild(el);
  const kindOf = () => (listById(id) ? "mine" : savedList(id) ? "saved" : null);
  if (!kindOf()) { view.innerHTML = emptyState("users", "List not found", "It may have been deleted."); return; }
  const people = () => {
    const mine = listById(id);
    if (mine) return mine.ids.map((x) => store.get("leads", x)).filter(Boolean);
    return savedMembers(savedList(id));
  };
  const nameOf = () => (listById(id) || savedList(id) || {}).name || "List";
  const draw = () => {
    const kind = kindOf();
    if (!kind) { el.innerHTML = emptyState("users", "List not found", "It was deleted."); return; }
    const rows = people();
    const withPhone = rows.filter((l) => l.phone && !l.badPhone);
    const x = kind === "mine" ? listById(id) : savedList(id);
    el.innerHTML = `
      <div class="card lead-audience ls-head" style="margin-bottom:12px">
        <div class="row" style="align-items:flex-start">
          <div class="row-main" style="min-width:0">
            <div class="row-title" style="font-size:1.2rem;${kind === "mine" ? "cursor:pointer" : ""}" ${kind === "mine" ? 'data-act="rename" title="Rename"' : ""}>${esc(nameOf())}</div>
            <div class="row-sub">${rows.length.toLocaleString()} ${rows.length === 1 ? "person" : "people"} · ${kind === "mine" ? "your own list" : `saved filter · ${esc(savedLabel(x))}`}</div>
          </div>
        </div>
        <div class="btn-row cut-actions" style="margin-top:10px">
          <button type="button" class="btn btn-success btn-sm" data-act="call" style="flex:1" ${withPhone.length ? "" : "disabled"}>${icon("phone")} Call</button>
          <button type="button" class="btn btn-primary btn-sm" data-act="text" style="flex:1">${icon("message")} Text</button>
          <button type="button" class="btn btn-primary btn-sm" data-act="email" style="flex:1">${icon("mail")} Email</button>
        </div>
        <div class="btn-row" style="margin-top:8px;flex-wrap:nowrap">
          ${kind === "mine" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="add" style="flex:1">${icon("plus")} Add people</button>` : `<button type="button" class="btn btn-ghost btn-sm" data-act="work" style="flex:1">${icon("sliders")} Work it on Outreach</button>`}
          <button type="button" class="btn btn-ghost btn-sm" data-act="delete" style="flex:0 0 auto" title="${kind === "mine" ? "Delete the list (the customers stay on file)" : "Forget this saved filter"}">${icon("trash")}</button>
        </div>
      </div>
      <div class="ls-people"></div>
      ${!rows.length ? `<div class="card muted small">${kind === "mine" ? "Nobody on it yet — Add people, or put someone on from their page." : "Nobody fits this filter today."}</div>` : ""}`;
    const list = el.querySelector(".ls-people");
    rows.forEach((l) => {
      const card = leadCard(l, null, { onListChange: draw });
      if (kind === "mine") {
        const holder = document.createElement("div");
        holder.className = "ls-member";
        holder.appendChild(card);
        const off = document.createElement("button");
        off.type = "button"; off.className = "btn btn-ghost btn-sm ls-off"; off.dataset.off = l.id; off.title = "Take off this list";
        off.innerHTML = `&times; Off the list`;
        off.addEventListener("click", () => { removeFromList(id, l.id); toast(`${l.name} off "${nameOf()}"`, ""); draw(); });
        holder.appendChild(off);
        list.appendChild(holder);
      } else list.appendChild(card);
    });
    const on = (sel, fn) => { const n = el.querySelector(sel); if (n) n.addEventListener("click", fn); };
    on('[data-act="call"]', () => { const ids = withPhone.map((l) => l.id); if (!ids.length) { toast("Nobody here has a number to call", "warn"); return; } startSession(ids, { name: nameOf() }); navigate("/session"); });
    const blast = (channel) => { try { sessionStorage.setItem("outreach-audience", JSON.stringify({ channel, audience: emptyAudience(), ids: rows.map((l) => l.id), label: nameOf() })); } catch { /* fine */ } navigate("/outreach"); };
    on('[data-act="text"]', () => blast("text"));
    on('[data-act="email"]', () => blast("email"));
    on('[data-act="work"]', () => { try { sessionStorage.setItem("viniva:leads-saved", id); } catch { /* fine */ } navigate("/leads"); });
    on('[data-act="rename"]', () => openModal("Rename the list", (close) => {
      const { element } = buildForm([{ name: "name", label: "Name", value: nameOf(), required: true }], { submitLabel: "Save", onSubmit: (d) => { renameList(id, d.name); close(); draw(); } });
      return element;
    }));
    on('[data-act="delete"]', async () => {
      const kindNow = kindOf();
      const ok = await confirmDialog(kindNow === "mine" ? `Delete the list "${nameOf()}"? The ${rows.length.toLocaleString()} ${rows.length === 1 ? "customer stays" : "customers stay"} on file.` : `Forget the saved filter "${nameOf()}"?`, { confirmLabel: kindNow === "mine" ? "Delete" : "Forget" });
      if (!ok) return;
      if (kindNow === "mine") deleteList(id); else removeSavedList(id);
      toast(kindNow === "mine" ? "List deleted" : "Filter forgotten", "");
      navigate("/lists");
    });
    on('[data-act="add"]', () => openAddPeople(id, draw));
  };
  draw();
}

// Pick people for one of your own lists: a search over the book, a tap
// per person. Those already on it are shown as on.
function openAddPeople(listId, after) {
  openModal("Add people", (close) => {
    const box = document.createElement("div");
    box.innerHTML = `<input type="search" class="ls-search" placeholder="Name, number or vehicle…" autocomplete="off" style="width:100%;margin-bottom:8px"><div class="ls-results"></div>`;
    const input = box.querySelector(".ls-search"), out = box.querySelector(".ls-results");
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      const on = new Set((listById(listId) || { ids: [] }).ids);
      const hits = store.all("leads").filter((l) => !q || `${l.name || ""} ${l.phone || ""} ${l.vehicleInterest || ""}`.toLowerCase().includes(q)).slice(0, 30);
      out.innerHTML = hits.length ? hits.map((l) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--border);align-items:center"><div class="row-main" style="min-width:0"><div class="row-title" style="font-size:0.96rem">${esc(l.name || "Customer")}</div><div class="row-sub">${esc(l.vehicleInterest || "")}</div></div><button type="button" class="btn btn-sm ${on.has(l.id) ? "btn-primary" : "btn-ghost"}" data-add="${esc(l.id)}" aria-pressed="${on.has(l.id)}">${on.has(l.id) ? "On" : "Add"}</button></div>`).join("") : `<div class="muted small">Nobody matches.</div>`;
      out.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { const lid = b.dataset.add; if ((listById(listId) || { ids: [] }).ids.includes(lid)) removeFromList(listId, lid); else addToList(listId, lid); paint(); after(); }));
    };
    input.addEventListener("input", paint);
    paint();
    setTimeout(() => input.focus(), 50);
    return box;
  }, { onClose: after });
}
