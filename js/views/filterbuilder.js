// A filter on any field, built by hand.
//
// The assistant builds these from a sentence (bookquery.js); this is the
// same thing as a sheet: pick a field from everything on file — who they
// are, what they drive, their deal, service, contact, conversations, the
// app's read, the calendar — an operator that fits the field's type, a
// value, and as many of those as the list needs, all of them or any. The
// count updates as it's built. Apply puts it on Outreach as the lit
// question chip, the same as a list the assistant built, so it can be
// saved under a name, called, texted or emailed.

import { openModal } from "../components.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { FIELDS, fieldFor, describeQuery } from "../bookquery.js";

// The fields in groups a salesperson thinks in.
export const GROUPS = [
  { label: "Who they are", keys: ["name", "phone", "email", "stage", "source", "rep", "notes", "dob", "birthMonth", "createdAt", "importedAt"] },
  { label: "What they drive", keys: ["vehicle", "make", "model", "year", "body", "trim", "vin", "odometer"] },
  { label: "What they want", keys: ["newUsed", "budget", "timeline", "tradeIn", "features", "hotButtons"] },
  { label: "Their deal", keys: ["dealType", "purchaseDate", "ownedYears", "leaseEnd", "contractEnd", "paymentsLeft", "currentPayment", "payoff", "currentValue", "equity", "currentApr", "currentTerm", "sales"] },
  { label: "Service", keys: ["serviceAppt", "lastService", "alertType", "priority"] },
  { label: "Contact", keys: ["contacted", "lastContacted", "daysSinceContact", "lastContactVia", "lastContactOutcome", "followUp", "lastCampaignAt", "canText", "doNotContact", "badPhone"] },
  { label: "Conversations", keys: ["spokenWith", "lastConversation", "conversationOutcome", "attempts", "reachState"] },
  { label: "The app's read", keys: ["score", "tier", "reasons", "reasonKinds"] },
  { label: "Calendar and to-dos", keys: ["nextAppointment", "openTasks"] },
];
// Anything the catalogue has that the groups above don't name rides at the end.
const grouped = new Set(GROUPS.flatMap((g) => g.keys));
const EXTRA = FIELDS.map((f) => f.key).filter((k) => !grouped.has(k));

// The operators that fit each type, in the salesperson's words. A choice
// may carry a fixed value (yes / no on a true-false field).
const OPS_BY_TYPE = {
  number: [["gt", "over"], ["gte", "at least"], ["lt", "under"], ["lte", "at most"], ["between", "between"], ["is", "exactly"], ["isnt", "not"], ["exists", "on file"], ["missing", "not on file"]],
  date: [["withinDays", "in the next … days"], ["pastDays", "in the last … days"], ["olderThanDays", "more than … days ago"], ["before", "before"], ["after", "after"], ["between", "between"], ["inMonth", "in the month of"], ["inYear", "in the year"], ["exists", "on file"], ["missing", "not on file"]],
  text: [["contains", "contains"], ["is", "is"], ["isnt", "is not"], ["startsWith", "starts with"], ["exists", "on file"], ["missing", "not on file"]],
  enum: [["is", "is"], ["isnt", "is not"], ["exists", "on file"], ["missing", "not on file"]],
  list: [["contains", "includes"], ["isnt", "doesn't include"], ["exists", "has any"], ["missing", "has none"]],
  bool: [["yes", "yes"], ["no", "no"]],
};
const NO_VALUE = new Set(["exists", "missing", "yes", "no"]);
const MONTHS = Array.from({ length: 12 }, (_, i) => [i + 1, new Date(2000, i, 1).toLocaleDateString("en-CA", { month: "long" })]);

// A spec condition ↔ a row in the sheet.
const toRow = (c) => {
  const f = fieldFor(c.field); if (!f) return null;
  if (f.type === "bool") return { field: f.key, op: c.value === false || /^(false|no|0)$/i.test(String(c.value)) ? "no" : "yes", value: "" };
  const v = c.value;
  return { field: f.key, op: c.op || "is", value: Array.isArray(v) ? (v[0] ?? "") : (v ?? ""), value2: Array.isArray(v) ? (v[1] ?? "") : "" };
};
const toCond = (r) => {
  const f = fieldFor(r.field); if (!f) return null;
  if (f.type === "bool") return { field: f.key, op: "is", value: r.op !== "no" };
  if (NO_VALUE.has(r.op)) return { field: f.key, op: r.op };
  if (r.op === "between") { if (r.value === "" || r.value2 === "") return null; return { field: f.key, op: "between", value: [coerce(f, r.op, r.value), coerce(f, r.op, r.value2)] }; }
  if (r.value === "" || r.value == null) return null;
  return { field: f.key, op: r.op, value: coerce(f, r.op, r.value) };
};
function coerce(f, op, v) {
  if (f.type === "number" || ["withinDays", "pastDays", "olderThanDays", "inMonth", "inYear"].includes(op)) { const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : v; }
  return String(v).trim();
}

/**
 * Open the sheet. `current` is a spec (or null); `count(spec)` says how
 * many pass right now; `values(fieldKey)` lists a text field's values on
 * the book for the input's suggestions (optional). `onApply(spec|null)`.
 */
export function openFilterBuilder(current, onApply, { count = null, values = null, title = "Filter on any field" } = {}) {
  let rows = ((current && current.where) || []).map(toRow).filter(Boolean);
  if (!rows.length) rows = [{ field: "currentPayment", op: "gt", value: "", value2: "" }];
  let any = !!(current && current.any);
  let sort = current && current.sort && fieldFor(current.sort.field) ? { field: fieldFor(current.sort.field).key, dir: /^desc/i.test(String(current.sort.dir || "")) ? "desc" : "asc" } : { field: "", dir: "desc" };
  const spec = () => { const where = rows.map(toCond).filter(Boolean); const s = { where, any }; if (sort.field) s.sort = { field: sort.field, dir: sort.dir }; return s; };

  openModal(title, (close) => {
    const el = document.createElement("div");
    el.className = "fb";
    const fieldOptions = (sel) => GROUPS.map((g) => `<optgroup label="${esc(g.label)}">${g.keys.map((k) => fieldFor(k)).filter(Boolean).map((f) => `<option value="${f.key}"${f.key === sel ? " selected" : ""}>${esc(f.label)}</option>`).join("")}</optgroup>`).join("") + (EXTRA.length ? `<optgroup label="More">${EXTRA.map((k) => fieldFor(k)).map((f) => `<option value="${f.key}"${f.key === sel ? " selected" : ""}>${esc(f.label)}</option>`).join("")}</optgroup>` : "");
    const opOptions = (f, sel) => (OPS_BY_TYPE[f.type] || OPS_BY_TYPE.text).map(([op, label]) => `<option value="${op}"${op === sel ? " selected" : ""}>${esc(label)}</option>`).join("");
    const valueInput = (f, r, i) => {
      if (NO_VALUE.has(r.op)) return "";
      const unit = f.fmt && f.fmt.money ? "$" : f.fmt && f.fmt.pct ? "%" : "";
      const num = (name, v, ph) => `<input class="fb-val" data-i="${i}" data-k="${name}" type="number" inputmode="decimal" step="any" value="${esc(v)}" placeholder="${esc(ph || unit || "")}">`;
      if (f.type === "date") {
        if (["withinDays", "pastDays", "olderThanDays"].includes(r.op)) return `<div class="fb-vals">${num("value", r.value, "days")}<span class="muted small">days</span></div>`;
        if (r.op === "inMonth") return `<select class="fb-val" data-i="${i}" data-k="value">${MONTHS.map(([n, m]) => `<option value="${n}"${String(r.value) === String(n) ? " selected" : ""}>${m}</option>`).join("")}</select>`;
        if (r.op === "inYear") return num("value", r.value, String(new Date().getFullYear()));
        const d = (name, v) => `<input class="fb-val" data-i="${i}" data-k="${name}" type="date" value="${esc(String(v || "").slice(0, 10))}">`;
        return r.op === "between" ? `<div class="fb-vals">${d("value", r.value)}<span class="muted small">to</span>${d("value2", r.value2)}</div>` : d("value", r.value);
      }
      if (f.type === "number") return r.op === "between" ? `<div class="fb-vals">${num("value", r.value)}<span class="muted small">to</span>${num("value2", r.value2)}</div>` : num("value", r.value);
      if (f.type === "enum" && f.fmt && f.fmt.values) return `<select class="fb-val" data-i="${i}" data-k="value">${f.fmt.values.map((v) => `<option value="${esc(v)}"${String(r.value) === v ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
      // text / list: free text, with what the book holds as suggestions.
      const sugg = values ? (values(f.key) || []) : [];
      const listId = sugg.length ? `fb-dl-${i}` : "";
      return `<input class="fb-val" data-i="${i}" data-k="value" type="text" value="${esc(r.value)}" placeholder="${esc(f.type === "list" ? "a word" : f.label)}" autocomplete="off"${listId ? ` list="${listId}"` : ""}>${listId ? `<datalist id="${listId}">${sugg.slice(0, 60).map((v) => `<option value="${esc(v)}">`).join("")}</datalist>` : ""}`;
    };
    const draw = () => {
      const s = spec();
      const n = count ? count(s) : null;
      el.innerHTML = `
        <div class="fb-rows">${rows.map((r, i) => { const f = fieldFor(r.field) || fieldFor("currentPayment"); return `
          <div class="fb-row card" data-i="${i}">
            <div class="fb-line"><select class="fb-field" data-i="${i}">${fieldOptions(f.key)}</select><button type="button" class="modal-close fb-del" data-i="${i}" aria-label="Remove">&times;</button></div>
            <div class="fb-line"><select class="fb-op" data-i="${i}">${opOptions(f, r.op)}</select>${valueInput(f, r, i)}</div>
            <div class="fb-hint small muted">${esc(f.says)}</div>
          </div>`; }).join("")}</div>
        <div class="fb-line" style="margin:8px 0 10px"><button type="button" class="btn btn-ghost btn-sm" data-act="add">${icon("plus")} Add a condition</button>
          ${rows.length > 1 ? `<div class="seg fb-any" role="group"><button type="button" class="seg-btn${!any ? " active" : ""}" data-any="0">All of these</button><button type="button" class="seg-btn${any ? " active" : ""}" data-any="1">Any of these</button></div>` : ""}</div>
        <div class="fb-line" style="margin-bottom:10px"><label class="small muted" style="flex:none">Order by</label><select class="fb-sort"><option value="">best first</option>${fieldOptions(sort.field).replace(`value="${sort.field}" selected`, `value="${sort.field}" selected`)}</select><select class="fb-dir"><option value="desc"${sort.dir === "desc" ? " selected" : ""}>highest first</option><option value="asc"${sort.dir === "asc" ? " selected" : ""}>lowest first</option></select></div>
        <div class="fb-count small"><b>${n == null ? "" : n.toLocaleString()}</b> ${n == null ? "" : n === 1 ? "customer matches" : "customers match"} <span class="muted">· ${esc(describeQuery(s))}</span></div>
        <div class="btn-row" style="margin-top:10px">
          <button type="button" class="btn btn-ghost btn-block" data-act="clear">Clear</button>
          <button type="button" class="btn btn-primary btn-block" data-act="apply" ${s.where.length ? "" : "disabled"}>Show them</button>
        </div>`;
      // The sort select: fieldOptions marks the chosen one; "best first" is the blank.
      const sortSel = el.querySelector(".fb-sort"); if (sortSel) sortSel.value = sort.field || "";
      el.querySelectorAll(".fb-field").forEach((sel) => sel.addEventListener("change", () => { const i = Number(sel.dataset.i); const f = fieldFor(sel.value); rows[i] = { field: f.key, op: (OPS_BY_TYPE[f.type] || OPS_BY_TYPE.text)[0][0], value: "", value2: "" }; draw(); }));
      el.querySelectorAll(".fb-op").forEach((sel) => sel.addEventListener("change", () => { const i = Number(sel.dataset.i); rows[i].op = sel.value; if (NO_VALUE.has(sel.value)) { rows[i].value = ""; rows[i].value2 = ""; } draw(); }));
      // A focused input removed by a redraw fires one last change event on
      // its way out; it belongs to a row that may be gone, so it's ignored.
      el.querySelectorAll(".fb-val").forEach((inp) => { const h = () => { const i = Number(inp.dataset.i); if (!inp.isConnected || !rows[i]) return; rows[i][inp.dataset.k] = inp.value; refreshCount(); }; inp.addEventListener("input", h); inp.addEventListener("change", h); });
      el.querySelectorAll(".fb-del").forEach((b) => b.addEventListener("click", () => { rows.splice(Number(b.dataset.i), 1); if (!rows.length) rows = [{ field: "currentPayment", op: "gt", value: "", value2: "" }]; draw(); }));
      el.querySelector('[data-act="add"]').addEventListener("click", () => { rows.push({ field: "equity", op: "gt", value: "", value2: "" }); draw(); el.querySelector(".fb-rows").lastElementChild.scrollIntoView({ block: "nearest" }); });
      el.querySelectorAll("[data-any]").forEach((b) => b.addEventListener("click", () => { any = b.dataset.any === "1"; draw(); }));
      if (sortSel) sortSel.addEventListener("change", () => { sort.field = sortSel.value; refreshCount(); });
      const dirSel = el.querySelector(".fb-dir"); if (dirSel) dirSel.addEventListener("change", () => { sort.dir = dirSel.value; refreshCount(); });
      el.querySelector('[data-act="clear"]').addEventListener("click", () => { close(); onApply(null); });
      el.querySelector('[data-act="apply"]').addEventListener("click", () => { const out = spec(); if (!out.where.length) return; close(); onApply(out); });
    };
    // The count and the sentence follow every keystroke; the rest stands.
    let t = null;
    const refreshCount = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = spec(); const n = count ? count(s) : null;
        const c = el.querySelector(".fb-count"); if (c) c.innerHTML = `<b>${n == null ? "" : n.toLocaleString()}</b> ${n == null ? "" : n === 1 ? "customer matches" : "customers match"} <span class="muted">· ${esc(describeQuery(s))}</span>`;
        const a = el.querySelector('[data-act="apply"]'); if (a) a.disabled = !s.where.length;
      }, 120);
    };
    draw();
    return el;
  });
}
