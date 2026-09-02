// Shared UI primitives: modal sheet, toast, confirm, and small form helpers.

import { icon } from "./icons.js";

const modalRoot = () => document.getElementById("modal-root");
const toastRoot = () => document.getElementById("toast-root");

// Open a bottom-sheet modal. `render(close)` returns an HTMLElement or HTML string.
// Returns a close() function.
// Every open sheet's close fn, so a view can dismiss the whole stack before
// navigating. Leaving a sheet up over the new page makes the tap look dead.
const openSheets = new Set();
export function closeAllModals() {
  [...openSheets].forEach((fn) => fn());
  openSheets.clear();
}

export function openModal(title, render, { onClose } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    openSheets.delete(close);
    if (onClose) onClose();
  };
  openSheets.add(close);
  const onKey = (e) => { if (e.key === "Escape") close(); };

  modal.innerHTML = `
    <div class="modal-handle"></div>
    <div class="modal-header">
      <h2></h2>
      <button class="modal-close" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body"></div>
  `;
  modal.querySelector("h2").textContent = title;
  modal.querySelector(".modal-close").addEventListener("click", close);

  const body = modal.querySelector(".modal-body");
  const content = render(close);
  if (typeof content === "string") body.innerHTML = content;
  else if (content) body.appendChild(content);

  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", onKey);
  modalRoot().appendChild(backdrop);

  // Focus first input for quick entry.
  const first = modal.querySelector("input, select, textarea");
  if (first) setTimeout(() => first.focus(), 60);

  return close;
}

export function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind ? `toast-${kind}` : ""}`;
  el.textContent = message;
  toastRoot().appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

// Toast with an Undo action — the safety net after a swipe-delete. Stays up
// longer than a normal toast; tapping Undo restores and dismisses.
export function undoToast(message, onUndo) {
  const el = document.createElement("div");
  el.className = "toast toast-undo";
  const span = document.createElement("span");
  span.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Undo";
  el.appendChild(span);
  el.appendChild(btn);
  toastRoot().appendChild(el);
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  };
  btn.addEventListener("click", () => { if (!gone) { dismiss(); if (onUndo) onUndo(); } });
  setTimeout(dismiss, 6000);
}

export function confirmDialog(message, { danger = true, confirmLabel = "Delete" } = {}) {
  return new Promise((resolve) => {
    // Resolve exactly once. close() triggers onClose, so settle BEFORE closing —
    // otherwise onClose's resolve(false) would beat the button's real answer.
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal("Confirm", (close) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <p style="margin-top:0">${escapeText(message)}</p>
        <div class="btn-row" style="margin-top:18px">
          <button class="btn btn-ghost btn-block" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-block" data-act="ok">${escapeText(confirmLabel)}</button>
        </div>`;
      wrap.querySelector('[data-act="cancel"]').addEventListener("click", () => { done(false); close(); });
      wrap.querySelector('[data-act="ok"]').addEventListener("click", () => { done(true); close(); });
      return wrap;
    }, { onClose: () => done(false) });
  });
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// --- Form builder ---
// fields: [{ name, label, type, value, options, placeholder, required, hint, half, step, min }]
// Returns { element, getValues, form }.
export function buildForm(fields, { submitLabel = "Save", onSubmit } = {}) {
  const form = document.createElement("form");
  form.noValidate = true;

  let inlineBuffer = [];
  const flushInline = () => {
    if (inlineBuffer.length) {
      const wrap = document.createElement("div");
      wrap.className = "field-inline";
      inlineBuffer.forEach((f) => wrap.appendChild(f));
      form.appendChild(wrap);
      inlineBuffer = [];
    }
  };

  fields.forEach((f) => {
    const field = document.createElement("div");
    field.className = "field";
    const id = `f_${f.name}`;

    const label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = f.label + (f.required ? " *" : "");
    field.appendChild(label);

    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      (f.options || []).forEach((o) => {
        const opt = document.createElement("option");
        opt.value = typeof o === "string" ? o : o.value;
        opt.textContent = typeof o === "string" ? o : o.label;
        input.appendChild(opt);
      });
    } else if (f.type === "textarea") {
      input = document.createElement("textarea");
    } else {
      input = document.createElement("input");
      input.type = f.type || "text";
      if (f.step != null) input.step = f.step;
      if (f.min != null) input.min = f.min;
      if (f.inputmode) input.inputMode = f.inputmode;
    }
    input.id = id;
    input.name = f.name;
    if (f.placeholder) input.placeholder = f.placeholder;
    if (f.value != null) input.value = f.value;
    if (f.required) input.required = true;
    field.appendChild(input);

    if (f.hint) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = f.hint;
      field.appendChild(hint);
    }

    if (f.half) {
      inlineBuffer.push(field);
      if (inlineBuffer.length === 2) flushInline();
    } else {
      flushInline();
      form.appendChild(field);
    }
  });
  flushInline();

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn-primary btn-block";
  submit.textContent = submitLabel;
  submit.style.marginTop = "6px";
  form.appendChild(submit);

  const getValues = () => {
    const data = {};
    fields.forEach((f) => {
      const el = form.elements[f.name];
      let v = el.value.trim();
      if (f.type === "number") v = v === "" ? null : Number(v);
      data[f.name] = v;
    });
    return data;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const missing = fields.find((f) => f.required && !String(form.elements[f.name].value).trim());
    if (missing) {
      form.elements[missing.name].focus();
      toast(`${missing.label} is required`, "danger");
      return;
    }
    onSubmit(getValues());
  });

  return { element: form, getValues, form };
}

export function emptyState(iconName, title, sub) {
  return `<div class="empty"><div class="empty-icon">${icon(iconName, "ico-xl")}</div>
    <div class="strong">${escapeText(title)}</div>
    ${sub ? `<div class="small">${escapeText(sub)}</div>` : ""}</div>`;
}

// --- Swipe to delete ---
// iOS-style: wrap a list card/row so sliding it left reveals a red Delete
// button; tapping that button is the confirmation. Returns the wrapper to
// append in place of the element. Vertical scrolling is untouched (we only
// claim the gesture once the movement is clearly horizontal).
let closeOpenSwipe = null;
export function swipeable(el, { onDelete, label = "Delete" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "swipe-wrap" + (el.classList.contains("card") ? " swipe-wrap-card" : "");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "swipe-del";
  btn.innerHTML = `${icon("trash")}<span>${escapeText(label)}</span>`;
  el.classList.add("swipe-card");
  wrap.appendChild(btn);
  wrap.appendChild(el);

  const W = 92; // revealed width
  let startX = 0, startY = 0, dx = 0, horiz = null, tracking = false, open = false, moved = false;

  const setX = (x) => { el.style.transform = x ? `translate3d(${x}px,0,0)` : ""; };
  const closeRow = () => { open = false; dx = 0; setX(0); if (closeOpenSwipe === closeRow) closeOpenSwipe = null; };

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tracking = true; horiz = null; moved = false;
    startX = e.clientX; startY = e.clientY;
  });
  el.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (horiz === null) {
      if (Math.abs(mx) < 7 && Math.abs(my) < 7) return;
      horiz = Math.abs(mx) > Math.abs(my);
      if (horiz) {
        try { el.setPointerCapture(e.pointerId); } catch {}
        el.classList.add("dragging");
        if (closeOpenSwipe && closeOpenSwipe !== closeRow) closeOpenSwipe();
      }
    }
    if (!horiz) { tracking = false; return; }
    moved = true;
    dx = Math.max(-W - 24, Math.min(0, (open ? -W : 0) + mx));
    setX(dx);
  });
  const finish = () => {
    if (!tracking) return;
    tracking = false;
    el.classList.remove("dragging");
    if (!horiz) return;
    open = dx < -W / 2;
    setX(open ? -W : 0);
    closeOpenSwipe = open ? closeRow : (closeOpenSwipe === closeRow ? null : closeOpenSwipe);
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);

  // A drag (or a tap while open) must not trigger the row's own tap action.
  el.addEventListener("click", (e) => {
    if (moved || open) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (open && !moved) closeRow();
      moved = false;
    }
  }, true);

  btn.addEventListener("click", () => {
    closeRow();
    // Remember where the row sat so an Undo can slot it right back.
    const parent = wrap.parentNode, next = wrap.nextSibling;
    wrap.remove();
    const restoreRow = () => {
      if (!parent) return;
      parent.insertBefore(wrap, next && next.parentNode === parent ? next : null);
    };
    if (onDelete) onDelete(restoreRow);
  });
  return wrap;
}
