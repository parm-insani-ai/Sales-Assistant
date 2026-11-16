// Putting a customer on one of the salesperson's own lists (lists.js), from
// wherever they're being worked: a row of toggles for the session's "How did
// it go?", and a picker with a tick per list for a card, a page, or a whole
// cut at once. Both make a new list on the spot.

import * as store from "../store.js";
import { openModal, buildForm, toast } from "../components.js";
import { icon } from "../icons.js";
import { esc } from "../utils.js";
import { memberLists, createList, addToList, removeFromList, toggleMember, listsOf } from "../lists.js";

// "Callbacks · Interested" — the lists one customer is on, by name.
export function listNames(leadId) { return listsOf(leadId).map((x) => x.name); }

// A name for a new list, then `then(list)`.
export function askNewList(then) {
  openModal("New list", (close) => {
    const { element } = buildForm([{ name: "name", label: "Name", required: true, placeholder: "Callbacks · Interested, no appointment · Spring event" }], {
      submitLabel: "Create",
      onSubmit: (d) => { const x = createList(d.name); close(); if (x) then(x); },
    });
    return element;
  });
}

// The lists as toggles, lit where this customer is on them, with New list
// at the end. A tap puts them on or takes them off at once.
export function listTogglesRow(leadId, { onChange } = {}) {
  const row = document.createElement("div");
  row.className = "list-toggles";
  const draw = () => {
    const lists = memberLists();
    row.innerHTML = lists.map((x) => {
      const on = x.ids.includes(leadId);
      return `<button type="button" class="btn btn-sm ${on ? "btn-primary" : "btn-ghost"} list-toggle" data-list="${esc(x.id)}" aria-pressed="${on}">${icon("users")} ${esc(x.name)}</button>`;
    }).join("") + `<button type="button" class="btn btn-ghost btn-sm list-new" data-act="new-list">${icon("plus")} New list</button>`;
  };
  draw();
  ["pointerdown", "click"].forEach((t) => row.addEventListener(t, (ev) => ev.stopPropagation()));
  row.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-list]");
    if (b) {
      const on = toggleMember(b.dataset.list, leadId);
      const x = store.get("lists", b.dataset.list);
      toast(on ? `On "${x ? x.name : "the list"}"` : `Off "${x ? x.name : "the list"}"`, on ? "success" : "");
      draw(); if (onChange) onChange();
      return;
    }
    if (ev.target.closest('[data-act="new-list"]')) {
      askNewList((x) => { addToList(x.id, leadId); toast(`On "${x.name}"`, "success"); draw(); if (onChange) onChange(); });
    }
  });
  return row;
}

// The picker: every list with a tick, a line to make a new one. For one
// customer a tick is their membership; for many, ticked means all of them
// are on it, and ticking puts them all on. Resolves when it closes.
export function openListPicker(leadIds, { title } = {}) {
  const ids = [].concat(leadIds).filter(Boolean);
  const one = ids.length === 1 ? ids[0] : null;
  return new Promise((resolve) => {
    openModal(title || (one ? "Lists" : `Put ${ids.length.toLocaleString()} on a list`), () => {
      const box = document.createElement("div");
      box.className = "list-pick";
      const draw = () => {
        const lists = memberLists();
        box.innerHTML = `
          ${lists.length
            ? lists.map((x) => { const on = one ? x.ids.includes(one) : ids.every((id) => x.ids.includes(id)); return `<label class="switch list-pick-row"><input type="checkbox" data-list="${esc(x.id)}" ${on ? "checked" : ""}><span><b>${esc(x.name)}</b> <span class="muted small">${x.ids.length.toLocaleString()}</span></span></label>`; }).join("")
            : `<div class="muted small" style="margin-bottom:8px">No lists yet — make one below: a callback list, the people who were interested but didn't book, anyone you want to come back to.</div>`}
          <form class="list-pick-new row" style="margin-top:10px;gap:6px;align-items:center"><input name="name" placeholder="New list…" style="flex:1" autocomplete="off"><button class="btn btn-primary btn-sm" type="submit" style="flex:none">${icon("plus")} Add</button></form>`;
      };
      draw();
      box.addEventListener("change", (ev) => {
        const i = ev.target.closest("input[data-list]"); if (!i) return;
        const x = store.get("lists", i.dataset.list);
        if (i.checked) addToList(i.dataset.list, ids); else removeFromList(i.dataset.list, ids);
        toast(i.checked ? `${one ? "On" : `${ids.length.toLocaleString()} on`} "${x ? x.name : "the list"}"` : `Off "${x ? x.name : "the list"}"`, i.checked ? "success" : "");
        draw();
      });
      box.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const input = box.querySelector('input[name="name"]');
        const x = createList(input.value);
        if (!x) return;
        addToList(x.id, ids);
        toast(`${one ? "On" : `${ids.length.toLocaleString()} on`} "${x.name}"`, "success");
        draw();
      });
      return box;
    }, { onClose: () => resolve(true) });
  });
}
