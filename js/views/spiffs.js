// SPIF organizer — track this month's sales incentives (manufacturer or house
// bonuses) and auto-count which of your logged sales qualify, so you always
// know exactly how much bonus money you've earned and what's still on the table.

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { currency, esc, formatDate, todayISO } from "../utils.js";
import { icon } from "../icons.js";

function thisMonthKey() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}
function monthKey(iso) {
  return (iso || "").slice(0, 7);
}
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// A spif qualifies a sale when the sale is in the spif's month and the sale's
// vehicle text contains the spif's match keyword (empty keyword = every sale).
function qualifyingSales(spif) {
  const kw = String(spif.match || "").trim().toLowerCase();
  return store.all("sales").filter((s) => {
    if (monthKey(s.saleDate) !== (spif.month || thisMonthKey())) return false;
    if (!kw) return true;
    return String(s.vehicle || "").toLowerCase().includes(kw);
  });
}

function spifEarned(spif) {
  return qualifyingSales(spif).length * (Number(spif.amount) || 0);
}

export function renderSpiffs(view) {
  const mKey = thisMonthKey();
  const spifs = store.all("spifs")
    .filter((s) => (s.month || mKey) === mKey)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const totalEarned = spifs.reduce((a, s) => a + spifEarned(s), 0);
  const totalPotential = spifs.reduce((a, s) => a + (Number(s.amount) || 0) * Math.max(1, Number(s.target) || 0), 0);

  const el = document.createElement("div");
  el.innerHTML = `
    <div style="margin:2px 4px 12px"><div class="muted small">SPIFs for</div><div class="strong" style="font-size:1.15rem">${esc(monthLabel(mKey))}</div></div>

    <div class="stat-grid" style="margin-bottom:6px">
      <div class="stat"><div class="stat-value" style="color:var(--success)">${currency(totalEarned)}</div><div class="stat-label">Earned so far</div></div>
      <div class="stat"><div class="stat-value">${spifs.length}</div><div class="stat-label">Active spifs</div></div>
    </div>

    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>This month's spifs</span>
      <button class="btn btn-sm btn-primary" data-act="add">${icon("plus")} Add spif</button>
    </div>
    <div class="spif-list"></div>
    <div class="fab-note">A spif counts a sale when the sale's vehicle text contains the keyword you set (leave blank to count every sale). Log deals under Goals → Log sale and they tally here automatically.</div>
  `;
  view.appendChild(el);

  const list = el.querySelector(".spif-list");
  if (!spifs.length) {
    list.innerHTML = emptyState("award", "No spifs yet", "Add this month's incentives — e.g. “$500 on every Rogue” — and watch them tally as you log sales.");
  } else {
    spifs.forEach((s) => list.appendChild(spifCard(s)));
  }

  el.querySelector('[data-act="add"]').addEventListener("click", () => openSpifForm());
}

function spifCard(spif) {
  const sales = qualifyingSales(spif);
  const earned = sales.length * (Number(spif.amount) || 0);
  const target = Number(spif.target) || 0;
  const pct = target > 0 ? Math.min(100, Math.round((sales.length / target) * 100)) : 0;
  const expired = spif.expiry && spif.expiry < todayISO();

  const el = document.createElement("div");
  el.className = "card card-tap";
  el.innerHTML = `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${icon("award")} ${esc(spif.title || "Spif")}</div>
        <div class="row-sub">${currency(spif.amount)} each${spif.match ? ` · matches “${esc(spif.match)}”` : " · every sale"}${spif.expiry ? ` · <span style="${expired ? "color:var(--danger)" : ""}">ends ${esc(formatDate(spif.expiry))}</span>` : ""}</div>
      </div>
      <div class="row-meta">
        <div class="strong mono" style="color:var(--success)">${currency(earned)}</div>
        <div class="small muted mono">${sales.length}${target ? ` / ${target}` : ""} sold</div>
      </div>
    </div>
    ${target ? `<div class="progress" style="margin-top:10px"><span style="width:${pct}%;background:${sales.length >= target ? "var(--success)" : "var(--accent)"}"></span></div>` : ""}
  `;
  el.addEventListener("click", () => openSpifForm(spif));
  return el;
}

export function openSpifForm(existing) {
  const isEdit = !!existing;
  const s = existing || {};
  openModal(isEdit ? "Edit spif" : "New spif", (close) => {
    const { element } = buildForm(
      [
        { name: "title", label: "What's the spif?", value: s.title, required: true, placeholder: "$500 on every Rogue" },
        { name: "amount", label: "$ per qualifying sale", value: s.amount, type: "number", inputmode: "decimal", half: true, placeholder: "500" },
        { name: "target", label: "Target units (optional)", value: s.target, type: "number", inputmode: "numeric", half: true, placeholder: "e.g. 5" },
        { name: "match", label: "Match keyword (optional)", value: s.match, placeholder: "Rogue", hint: "Counts a sale when its vehicle contains this word. Leave blank to count every sale." },
        { name: "expiry", label: "Ends (optional)", value: s.expiry || "", type: "date" },
        { name: "notes", label: "Notes", value: s.notes, type: "textarea", placeholder: "Stackable? Add-on required? Payout timing…" },
      ],
      {
        submitLabel: isEdit ? "Save spif" : "Add spif",
        onSubmit: (data) => {
          const payload = { ...data, month: s.month || new Date().toISOString().slice(0, 7) };
          if (isEdit) { store.update("spifs", existing.id, payload); toast("Spif updated", "success"); }
          else { store.create("spifs", payload); toast("Spif added", "success"); }
          close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        },
      }
    );
    if (isEdit) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-danger btn-block";
      del.style.marginTop = "10px";
      del.textContent = "Delete spif";
      del.addEventListener("click", async () => {
        if (await confirmDialog("Delete this spif?")) {
          store.remove("spifs", existing.id); toast("Deleted"); close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      });
      element.appendChild(del);
    }
    return element;
  });
}
