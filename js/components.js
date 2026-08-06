// Shared UI primitives: modal sheet, toast, confirm, and small form helpers.

import { icon } from "./icons.js";

const modalRoot = () => document.getElementById("modal-root");
const toastRoot = () => document.getElementById("toast-root");

// Open a bottom-sheet modal. `render(close)` returns an HTMLElement or HTML string.
// Returns a close() function.
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
    if (onClose) onClose();
  };
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

export function confirmDialog(message, { danger = true, confirmLabel = "Delete" } = {}) {
  return new Promise((resolve) => {
    openModal("Confirm", (close) => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <p style="margin-top:0">${escapeText(message)}</p>
        <div class="btn-row" style="margin-top:18px">
          <button class="btn btn-ghost btn-block" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-block" data-act="ok">${escapeText(confirmLabel)}</button>
        </div>`;
      wrap.querySelector('[data-act="cancel"]').addEventListener("click", () => { close(); resolve(false); });
      wrap.querySelector('[data-act="ok"]').addEventListener("click", () => { close(); resolve(true); });
      return wrap;
    }, { onClose: () => resolve(false) });
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
