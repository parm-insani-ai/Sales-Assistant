// The audience filter, by hand.
//
// The same criteria the assistant reads out of a sentence ("everyone who
// owns a Sentra that's paid off"), as a sheet of fields: pick a model, a
// make, a body style, a year range, a situation, a stage — and the same
// matching rules decide who's in. Used on Leads to narrow the book, and on
// Mass outreach to adjust who a blast goes to.

import { LEAD_STAGES } from "../store.js";
import { openModal } from "../components.js";
import { esc } from "../utils.js";
import { emptyAudience, isEveryone, describeAudience } from "../outreach.js";

const BODIES = [["", "Any"], ["suv", "SUV / crossover"], ["car", "Sedan / hatchback"], ["truck", "Truck"], ["van", "Van"], ["sports", "Sports car"]];
const list = (s) => String(s || "").toLowerCase().split(/[,/]+/).map((x) => x.trim()).filter(Boolean);

// Open the sheet on `current` (an audience object or null) and hand the
// chosen audience to `onApply` — null when cleared.
export function openAudienceFilter(current, onApply, { title = "Filter customers" } = {}) {
  const a = { ...emptyAudience(), ...(current || {}), unknown: [] };
  const num = (v) => (v === "" || v == null || !isFinite(Number(v)) ? null : Number(v));
  openModal(title, (close) => {
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="field"><label>Model</label><input id="af-models" placeholder="Sentra, Rogue…" value="${esc(a.models.join(", "))}" autocomplete="off"><div class="hint">Any of these, by name. Leave blank for any model.</div></div>
      <div class="field"><label>Make</label><input id="af-makes" placeholder="Nissan, Honda…" value="${esc(a.makes.join(", "))}" autocomplete="off"></div>
      <div class="field"><label>Body style</label><select id="af-body">${BODIES.map(([v, t]) => `<option value="${v}" ${a.body === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label>Model year</label>
        <div class="row" style="gap:8px"><input id="af-ymin" type="number" inputmode="numeric" placeholder="from" value="${a.yearMin ?? ""}" style="flex:1"><span class="muted">to</span><input id="af-ymax" type="number" inputmode="numeric" placeholder="to" value="${a.yearMax ?? ""}" style="flex:1"></div>
      </div>
      <div class="field" style="margin-bottom:6px"><label>Where they stand</label></div>
      <label class="switch" style="margin:0 0 12px"><input type="checkbox" id="af-paid" ${a.paidOff ? "checked" : ""}><span>Paid off</span></label>
      <label class="switch" style="margin:0 0 12px"><input type="checkbox" id="af-equity" ${a.equity ? "checked" : ""}><span>With equity</span></label>
      <label class="switch" style="margin:0 0 18px"><input type="checkbox" id="af-lease" ${a.lease ? "checked" : ""}><span>Lease ending (next 4 months)</span></label>
      <div class="field"><label>Owned at least</label><div class="row" style="gap:8px"><input id="af-owned" type="number" inputmode="numeric" placeholder="any" value="${a.ownedYears ?? ""}" style="flex:1"><span class="muted">years</span></div></div>
      <div class="field"><label>Not contacted in</label><div class="row" style="gap:8px"><input id="af-quiet" type="number" inputmode="numeric" placeholder="any" value="${a.quietDays ?? ""}" style="flex:1"><span class="muted">days</span></div></div>
      <div class="field"><label>Stage</label>
        <div class="lead-chips" style="flex-wrap:wrap;overflow:visible">${LEAD_STAGES.map((s) => `<button type="button" class="btn btn-sm ${a.stages.includes(s.id) ? "btn-primary" : "btn-ghost"}" data-stage="${s.id}">${esc(s.label)}</button>`).join("")}</div>
        <div class="hint">None picked means any stage. Lost customers are never texted or emailed.</div>
      </div>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn btn-ghost btn-block" data-act="clear">Clear</button>
        <button class="btn btn-primary btn-block" data-act="apply">Apply</button>
      </div>
    `;
    const picked = new Set(a.stages);
    el.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.stage;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      b.classList.toggle("btn-primary", picked.has(id)); b.classList.toggle("btn-ghost", !picked.has(id));
    }));
    el.querySelector('[data-act="clear"]').addEventListener("click", () => { close(); onApply(null); });
    el.querySelector('[data-act="apply"]').addEventListener("click", () => {
      const v = (id) => el.querySelector("#" + id).value;
      const on = (id) => el.querySelector("#" + id).checked;
      const makes = list(v("af-makes")).map((m) => (m === "vw" ? "volkswagen" : m === "chevy" ? "chevrolet" : m === "mercedes-benz" ? "mercedes" : m));
      let yMin = num(v("af-ymin")), yMax = num(v("af-ymax"));
      if (yMin != null && yMax != null && yMin > yMax) [yMin, yMax] = [yMax, yMin];
      const out = {
        ...emptyAudience(),
        models: list(v("af-models")), makes, nissan: makes.length === 1 && makes[0] === "nissan",
        body: v("af-body"), yearMin: yMin, yearMax: yMax,
        paidOff: on("af-paid"), equity: on("af-equity"), lease: on("af-lease"),
        ownedYears: num(v("af-owned")), quietDays: num(v("af-quiet")), stages: [...picked],
      };
      out.everyone = isEveryone(out);
      out.text = describeAudience(out);
      close();
      onApply(out.everyone ? null : out);
    });
    return el;
  });
}

// A short label for the active filter, for a chip.
export function audienceLabel(a) {
  return a && !isEveryone(a) ? describeAudience(a) : "";
}
