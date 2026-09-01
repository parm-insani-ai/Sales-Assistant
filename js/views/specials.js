// Monthly manufacturer specials board. Keep the current APR / lease / cash
// offers by model in one place so you can quote them instantly and drop them
// into a deal. Editable in seconds each month; ships with a one-tap seeder for
// the current Nissan Canada national offers.

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog, emptyState } from "../components.js";
import { currency, esc, formatDate, todayISO } from "../utils.js";
import { icon } from "../icons.js";

// Nissan Canada national representative offers (captured Aug 2026). These are a
// starting point — always confirm live numbers; regional/Atlantic offers vary.
const NISSAN_SEED = {
  label: "Nissan Canada · September 2026 (SB2609-ATL, Atlantic)",
  expiry: "2026-09-30",
  items: [
    { model: "Rogue",
      aprByTerm: { 24: 0, 36: 0, 48: 0, 60: 0, 72: 2.9, 84: 2.9 },
      leasePayment: 429, leaseTerm: 36, leaseDown: 0, leaseTrim: "S",
      trimOffers: [
        { trim: "S", offer: "Advertised lease $99/wk @ 0% · 36 mo · $0 down, incl. $1,200 Clear-out bonus (lease only)" },
        { trim: "SV & up", offer: "$5,000 non-stackable cash alt on std-rate/cash deals" },
      ],
      notes: "0.5% loyalty rate reduction (1.0% for returning Qashqai)." },
    { model: "Rogue Plug-in Hybrid", cash: 10000,
      notes: "$10,000 on std-rate/cash-buyer deals only. Std rates apply (7.24%+). Not EVAP-eligible." },
    { model: "Kicks", cash: 500,
      aprByTerm: { 24: 0, 36: 0, 48: 3.4, 60: 3.4, 72: 4.4, 84: 4.4 },
      trimOffers: [
        { trim: "SV / SR", offer: "$2,000–$3,000 non-stackable cash alt" },
      ],
      notes: "$1,000 Welcome/Conquest bonus. Lease 2.9% (36–60 mo) w/ $1,000 lease cash. 0.5% loyalty (1.0% returning Kicks/Qashqai)." },
    { model: "Sentra", cash: 750,
      aprByTerm: { 24: 0, 36: 0, 48: 3.9, 60: 4.9, 72: 4.9, 84: 4.9 },
      leasePayment: 320, leaseTerm: 36, leaseDown: 699, leaseTrim: "SV",
      trimOffers: [
        { trim: "SR", offer: "Up to $2,750 bonus cash (non-stackable with finance cash)" },
      ],
      notes: "Advertised SV lease includes loyalty reduction. 0.5–1.0% loyalty for returning Sentra." },
    { model: "Pathfinder",
      aprByTerm: { 24: 5.4, 36: 5.4, 48: 5.9, 60: 5.9, 72: 6.4, 84: 6.4 },
      trimOffers: [
        { trim: "SL / PRO-4X / Platinum", offer: "Lease 4.9% w/ $5,000 lease cash" },
      ] },
    { model: "Murano",
      aprByTerm: { 24: 4.9, 36: 4.9, 48: 5.4, 60: 5.4, 72: 5.9, 84: 5.9 },
      notes: "MY26 rates. $2,000 non-stackable cash alt. MY27: 1.0% loyalty for returning Murano owners." },
    { model: "Frontier",
      aprByTerm: { 24: 5.4, 36: 5.4, 48: 6.4, 60: 6.4, 72: 6.9, 84: 6.9 } },
    { model: "Armada", cash: 5000,
      aprByTerm: { 24: 4.9, 36: 4.9, 48: 4.9, 60: 4.9, 72: 4.9, 84: 4.9 },
      notes: "4.9% + $5,000 on special finance, OR $7,500 non-stackable / cash-purchase bonus instead." },
    { model: "Leaf", cash: 1000,
      aprByTerm: { 24: 0, 36: 0, 48: 0, 60: 0, 72: 1.4, 84: 1.9 },
      trimOffers: [
        { trim: "S+, SV+", offer: "$1,000 + 0% up to 60 mo (rate table above) · lease 0%" },
        { trim: "Platinum+", offer: "$5,000 @ 3.9% flat" },
      ],
      notes: "EVAP-eligible (all 2026 trims)." },
    { model: "Ariya", cash: 6000,
      aprByTerm: { 24: 6.4, 36: 6.4, 48: 6.4, 60: 6.4, 72: 6.9, 84: 6.9 },
      trimOffers: [
        { trim: "SV FWD, SL e-4ORCE", offer: "$6,000 @ 6.4% (rate table above)" },
        { trim: "SL+ FWD", offer: "$7,000 @ 7.4%" },
        { trim: "SL+ / Platinum+ e-4ORCE", offer: "$5,000 @ 3.4%" },
      ],
      notes: "EVAP: SV FWD, SL e-4ORCE, SL+ FWD. Verify trim at desk." },
  ],
};

// Collapse a {term: apr} table into ranges of equal APR — {24:0,36:0,48:0,
// 60:0,72:2.9,84:2.9} reads as "0% for 24–60 mo · 2.9% for 72–84 mo".
function rateSegments(sp) {
  const t = sp.aprByTerm;
  if (t && Object.keys(t).length) {
    const segs = [];
    Object.keys(t).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b).forEach((term) => {
      const apr = Number(t[term]);
      const last = segs[segs.length - 1];
      if (last && last.apr === apr) last.to = term;
      else segs.push({ apr, from: term, to: term });
    });
    return segs;
  }
  if (sp.financeApr != null && sp.financeApr !== "") {
    const term = Number(sp.financeTerm) || null;
    return [{ apr: Number(sp.financeApr), from: term, to: term }];
  }
  return [];
}

function segLabel(seg) {
  if (!seg.from) return "any term";
  return seg.from === seg.to ? `${seg.to} mo` : `${seg.from}–${seg.to} mo`;
}

export function renderSpecials(view) {
  const specials = store.all("specials")
    .sort((a, b) => String(a.model || "").localeCompare(String(b.model || "")));

  const el = document.createElement("div");
  el.innerHTML = `
    <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
      <span>Current specials</span>
      <button class="btn btn-sm btn-primary" data-act="add">${icon("plus")} Add</button>
    </div>
    <div class="special-list"></div>
    <div class="fab-note">Confirm live numbers before quoting — offers change monthly and by region. Tap a card to edit.</div>
  `;
  view.appendChild(el);

  const list = el.querySelector(".special-list");
  if (!specials.length) {
    list.innerHTML = `
      ${emptyState("tag", "No specials loaded", "Add your own, or load this month's Nissan Canada offers to start.")}
      <button class="btn btn-primary btn-block" data-act="seed" style="margin-top:12px">${icon("download")} Load ${esc(NISSAN_SEED.label)}</button>`;
    list.querySelector('[data-act="seed"]').addEventListener("click", seedNissan);
  } else {
    specials.forEach((sp) => list.appendChild(specialCard(sp)));
    const seedRow = document.createElement("button");
    seedRow.className = "btn btn-ghost btn-sm btn-block";
    seedRow.style.marginTop = "8px";
    seedRow.innerHTML = `${icon("download")} Re-load ${esc(NISSAN_SEED.label)}`;
    seedRow.addEventListener("click", seedNissan);
    list.appendChild(seedRow);
  }

  el.querySelector('[data-act="add"]').addEventListener("click", () => openSpecialForm());
}

function specialCard(sp) {
  const expired = sp.expiry && sp.expiry < todayISO();
  const segs = rateSegments(sp);
  const aprs = segs.map((s) => s.apr);
  const best = aprs.length ? Math.min(...aprs) : null;
  // Highlight the cheapest money only when it stands out — an all-4.9% table
  // lit up end to end reads as noise, a 0% opener reads as the hook it is.
  const highlight = segs.length > 1 || best === 0;

  const finSegs = segs.map((s) => `
    <div class="sp-seg${highlight && s.apr === best ? " sp-seg-hot" : ""}">
      <b>${esc(String(s.apr))}%</b><span>${esc(segLabel(s))}</span>
    </div>`).join("");
  const cashSeg = sp.cash ? `
    <div class="sp-seg sp-seg-cash">
      <b>+${esc(currency(sp.cash))}</b><span>${segs.length ? "finance cash" : "cash / bonus"}</span>
    </div>` : "";

  const leaseBits = [];
  if (sp.leasePayment != null && sp.leasePayment !== "") {
    leaseBits.push(`<b>${esc(currency(sp.leasePayment))}/mo</b>`);
    if (sp.leaseTerm) leaseBits.push(`${esc(String(sp.leaseTerm))} mo`);
    leaseBits.push(Number(sp.leaseDown) ? `${esc(currency(sp.leaseDown))} down` : "$0 down");
  }

  const trimRows = (Array.isArray(sp.trimOffers) ? sp.trimOffers : [])
    .filter((t) => t && (t.trim || t.offer))
    .map((t) => `<div class="sp-trim-row"><b>${esc(t.trim || "All trims")}</b><span>${esc(t.offer || "")}</span></div>`)
    .join("");

  const el = document.createElement("div");
  el.className = "card card-tap";
  el.innerHTML = `
    <div class="row">
      <div class="row-main"><div class="row-title">${icon("tag")} ${esc(sp.model || "Model")}</div></div>
      ${sp.expiry ? `<div class="row-meta"><div class="small ${expired ? "" : "muted"}" style="${expired ? "color:var(--danger)" : ""}">${expired ? "Expired" : "ends " + esc(formatDate(sp.expiry))}</div></div>` : ""}
    </div>
    ${finSegs || cashSeg ? `
      <div class="sp-block">
        <div class="sp-lab">${segs.length ? "Finance" : "Cash"}</div>
        <div class="sp-segs">${finSegs}${cashSeg}</div>
      </div>` : `<div class="small muted" style="margin-top:6px">No offer details — tap to edit</div>`}
    ${leaseBits.length ? `
      <div class="sp-block">
        <div class="sp-lab">Lease</div>
        <div class="sp-leaseline">${leaseBits.join(" · ")}${sp.leaseTrim ? ` <span class="badge badge-working">${esc(sp.leaseTrim)} trim only</span>` : ""}</div>
      </div>` : ""}
    ${trimRows ? `<div class="sp-trims">${trimRows}</div>` : ""}
    ${sp.notes ? `
      <details class="sp-fine" data-stop>
        <summary>Fine print</summary>
        <div class="small muted">${esc(sp.notes)}</div>
      </details>` : ""}
  `;
  // The fine-print toggle shouldn't fling the card into edit mode.
  const fine = el.querySelector(".sp-fine");
  if (fine) fine.addEventListener("click", (e) => e.stopPropagation());
  el.addEventListener("click", () => openSpecialForm(sp));
  return el;
}

function seedNissan() {
  const existing = store.all("specials");
  let added = 0, updated = 0;
  NISSAN_SEED.items.forEach((it) => {
    const dupes = existing.filter((s) => String(s.model).toLowerCase() === it.model.toLowerCase());
    // Hand-entered specials (no seed source) are the desk's own numbers — never
    // clobber those. Stale seed-loaded ones get replaced with this month's data.
    if (dupes.some((s) => !s.source)) return;
    dupes.forEach((s) => store.remove("specials", s.id));
    store.create("specials", { ...it, expiry: it.expiry || NISSAN_SEED.expiry, source: NISSAN_SEED.label });
    if (dupes.length) updated++; else added++;
  });
  const bits = [];
  if (added) bits.push(`${added} new`);
  if (updated) bits.push(`${updated} updated`);
  toast(bits.length ? `Nissan offers loaded (${bits.join(", ")})` : "Nothing to load — your hand-entered specials were kept", bits.length ? "success" : "");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// "24:0, 36:0, 48:3.4" → {24:0, 36:0, 48:3.4}; blank/garbage → null.
function parseAprTable(text) {
  const out = {};
  String(text || "").split(/[,;\s]+/).forEach((pair) => {
    const m = pair.match(/^(\d{2,3})\s*[:=@]\s*(\d+(?:\.\d+)?)%?$/);
    if (m) out[Number(m[1])] = Number(m[2]);
  });
  return Object.keys(out).length ? out : null;
}

function aprTableText(t) {
  if (!t || !Object.keys(t).length) return "";
  return Object.keys(t).map(Number).sort((a, b) => a - b).map((k) => `${k}:${t[k]}`).join(", ");
}

// One per line, "trim | offer". A line with no pipe is an all-trims note.
function parseTrimOffers(text) {
  const rows = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    if (i < 0) return { trim: "", offer: l };
    return { trim: l.slice(0, i).trim(), offer: l.slice(i + 1).trim() };
  }).filter((r) => r.trim || r.offer);
  return rows.length ? rows : null;
}

function trimOffersText(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return rows.map((r) => (r.trim ? `${r.trim} | ${r.offer || ""}` : r.offer || "")).join("\n");
}

export function openSpecialForm(existing) {
  const isEdit = !!existing;
  const sp = existing || {};
  openModal(isEdit ? "Edit special" : "New special", (close) => {
    const { element } = buildForm(
      [
        { name: "model", label: "Model", value: sp.model, required: true, placeholder: "Rogue" },
        { name: "aprTable", label: "Finance rate table (term:APR)", value: aprTableText(sp.aprByTerm), placeholder: "24:0, 36:0, 48:3.4, 60:3.4, 72:4.4, 84:4.4", hint: "Term:APR pairs from the program bulletin. The deal engine tries every term and picks the payment closest to the customer's. Leave blank to use the single APR below." },
        { name: "financeApr", label: "Single APR %", value: sp.financeApr, type: "number", inputmode: "decimal", half: true, placeholder: "0" },
        { name: "financeTerm", label: "Finance term (mo)", value: sp.financeTerm, type: "number", inputmode: "numeric", half: true, placeholder: "60" },
        { name: "leasePayment", label: "Lease $/mo", value: sp.leasePayment, type: "number", inputmode: "decimal", half: true, placeholder: "319" },
        { name: "leaseTerm", label: "Lease term (mo)", value: sp.leaseTerm, type: "number", inputmode: "numeric", half: true, placeholder: "36" },
        { name: "leaseDown", label: "Lease down $", value: sp.leaseDown, type: "number", inputmode: "decimal", half: true, placeholder: "4019" },
        { name: "leaseTrim", label: "Lease trim (advertised)", value: sp.leaseTrim, half: true, placeholder: "SV", hint: "The advertised lease applies only to this trim; other trims get a computed lease." },
        { name: "cash", label: "Cash / bonus $", value: sp.cash, type: "number", inputmode: "decimal", half: true, placeholder: "0" },
        { name: "expiry", label: "Expires", value: sp.expiry || "", type: "date" },
        { name: "trimOffersText", label: "Trim-specific offers", value: trimOffersText(sp.trimOffers), type: "textarea", placeholder: "SR | Up to $2,750 bonus cash\nSL / Platinum | Lease 4.9% w/ $5,000 lease cash", hint: "One per line: trim | offer. Shown as rows on the card." },
        { name: "notes", label: "Fine print", value: sp.notes, type: "textarea", placeholder: "Stackable, loyalty, conditions…" },
      ],
      {
        submitLabel: isEdit ? "Save" : "Add special",
        onSubmit: (data) => {
          data.aprByTerm = parseAprTable(data.aprTable);
          delete data.aprTable;
          data.trimOffers = parseTrimOffers(data.trimOffersText);
          delete data.trimOffersText;
          if (isEdit) { store.update("specials", existing.id, data); toast("Special updated", "success"); }
          else { store.create("specials", data); toast("Special added", "success"); }
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
      del.textContent = "Delete special";
      del.addEventListener("click", async () => {
        if (await confirmDialog("Delete this special?")) {
          store.remove("specials", existing.id); toast("Deleted"); close();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      });
      element.appendChild(del);
    }
    return element;
  });
}
