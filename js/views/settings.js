// Settings: salesperson name, deal defaults, delivery checklist template,
// and data backup (export / import / reset).

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog } from "../components.js";
import { esc } from "../utils.js";

export function renderSettings(view) {
  const s = store.getSettings();
  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Home</button>

    <div class="section-title">Your info</div>
    <div class="card">
      <div class="field"><label>Your name</label><input id="s-name" value="${esc(s.salesperson || "")}" placeholder="Alex Rivera"></div>
    </div>

    <div class="section-title">Deal defaults</div>
    <div class="card">
      <div class="field-inline">
        <div class="field"><label>Sales tax %</label><input id="s-tax" type="number" step="0.01" inputmode="decimal" value="${esc(s.taxRate)}"></div>
        <div class="field"><label>Doc fee</label><input id="s-doc" type="number" inputmode="decimal" value="${esc(s.docFee)}"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>Default APR %</label><input id="s-apr" type="number" step="0.01" inputmode="decimal" value="${esc(s.defaultApr)}"></div>
        <div class="field"><label>Default term</label><input id="s-term" type="number" inputmode="numeric" value="${esc(s.defaultTerm)}"></div>
      </div>
      <button class="btn btn-primary btn-block" data-act="save-defaults">Save defaults</button>
    </div>

    <div class="section-title">Delivery checklist template</div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">Used every time you start a new delivery. Existing deliveries keep their own copy.</div>
      <div class="tmpl-list"></div>
      <button class="btn btn-ghost btn-sm btn-block" data-act="add-tmpl" style="margin-top:10px">+ Add item</button>
    </div>

    <div class="section-title">Data & backup</div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">Your data is stored only on this device. Export a backup regularly, or to move to a new phone.</div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-block" data-act="export">⬇️ Export backup</button>
        <button class="btn btn-ghost btn-block" data-act="import">⬆️ Import</button>
      </div>
      <button class="btn btn-danger btn-block" data-act="reset" style="margin-top:10px">Reset all data</button>
    </div>
    <div class="fab-note">Sales Assistant · data lives on your device</div>
  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => (location.hash = "/"));

  el.querySelector("#s-name").addEventListener("change", (e) =>
    store.updateSettings({ salesperson: e.target.value.trim() }));

  el.querySelector('[data-act="save-defaults"]').addEventListener("click", () => {
    store.updateSettings({
      taxRate: Number(el.querySelector("#s-tax").value) || 0,
      docFee: Number(el.querySelector("#s-doc").value) || 0,
      defaultApr: Number(el.querySelector("#s-apr").value) || 0,
      defaultTerm: Number(el.querySelector("#s-term").value) || 0,
    });
    toast("Defaults saved", "success");
  });

  // Checklist template editor
  const tmplList = el.querySelector(".tmpl-list");
  function drawTmpl() {
    const list = store.getSettings().deliveryChecklist;
    tmplList.innerHTML = "";
    list.forEach((label, idx) => {
      const row = document.createElement("div");
      row.className = "check-item";
      row.innerHTML = `<label style="flex:1">${esc(label)}</label>
        <button class="modal-close" data-del="${idx}" aria-label="Remove" style="font-size:1.2rem">&times;</button>`;
      row.querySelector("[data-del]").addEventListener("click", () => {
        const next = store.getSettings().deliveryChecklist.slice();
        next.splice(idx, 1);
        store.updateSettings({ deliveryChecklist: next });
        drawTmpl();
      });
      tmplList.appendChild(row);
    });
  }
  drawTmpl();
  el.querySelector('[data-act="add-tmpl"]').addEventListener("click", () => {
    openModal("Add checklist item", (close) => {
      const { element } = buildForm(
        [{ name: "label", label: "Item", required: true, placeholder: "e.g. Verify insurance" }],
        { submitLabel: "Add", onSubmit: ({ label }) => {
          store.updateSettings({ deliveryChecklist: [...store.getSettings().deliveryChecklist, label] });
          close(); drawTmpl();
        } });
      return element;
    });
  });

  // Backup
  el.querySelector('[data-act="export"]').addEventListener("click", () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `sales-assistant-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded", "success");
  });

  el.querySelector('[data-act="import"]').addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      if (!(await confirmDialog("Importing will replace all current data. Continue?", { danger: false, confirmLabel: "Import" }))) return;
      try {
        store.importJSON(await file.text());
        toast("Data imported", "success");
        location.hash = "/";
      } catch (e) {
        toast("Import failed — invalid file", "danger");
      }
    });
    input.click();
  });

  el.querySelector('[data-act="reset"]').addEventListener("click", async () => {
    if (await confirmDialog("Erase ALL leads, tasks, inventory and deliveries? This cannot be undone.", { confirmLabel: "Erase everything" })) {
      store.resetAll();
      toast("All data reset");
      location.hash = "/";
    }
  });
}
