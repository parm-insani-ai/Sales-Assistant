// Settings: salesperson name, deal defaults, delivery checklist template,
// and data backup (export / import / reset).

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog } from "../components.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { loadSampleData, removeSampleData, hasSampleData } from "../demo.js";
import * as backend from "../backend.js";
import * as sync from "../sync.js";

export function renderSettings(view) {
  const s = store.getSettings();
  const sampleLoaded = hasSampleData();
  const el = document.createElement("div");
  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-act="back" style="margin-bottom:12px">← Home</button>

    <div class="section-title">Your info</div>
    <div class="card">
      <div class="field"><label>Your name</label><input id="s-name" value="${esc(s.salesperson || "")}" placeholder="Alex Rivera"></div>
      <div class="field"><label>Dealership</label><input id="s-dealer" value="${esc(s.dealership || "")}" placeholder="Metro Toyota"></div>
      <div class="field" style="margin-bottom:0"><label>Contact phone (for listings)</label><input id="s-phone" type="tel" inputmode="tel" value="${esc(s.contactPhone || "")}" placeholder="(555) 123-4567"></div>
      <div class="hint">Used to fill in {salesperson} / {dealership} in message templates and your contact info in Marketplace listings.</div>
    </div>

    <div class="section-title">Cloud sync &amp; account</div>
    <div class="card" id="cloud-slot"></div>

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

    <div class="section-title">Prospecting & follow-up</div>
    <div class="card">
      <div class="field-inline">
        <div class="field"><label>Daily touch goal</label><input id="s-touchgoal" type="number" inputmode="numeric" value="${esc(s.dailyTouchGoal)}"></div>
        <div class="field" style="display:flex;flex-direction:column;justify-content:flex-end">
          <label style="margin-bottom:8px">Auto follow-up plan</label>
          <label class="switch"><input id="s-autocad" type="checkbox" ${s.autoCadence ? "checked" : ""}><span>Start a plan on every new lead</span></label>
        </div>
      </div>
      <div class="small muted" style="margin:6px 0 8px">Your follow-up cadence — the touches auto-scheduled for each new lead:</div>
      <div class="cad-list"></div>
      <button class="btn btn-ghost btn-sm btn-block" data-act="add-cad" style="margin-top:10px">+ Add a touch</button>
    </div>

    <div class="section-title">Delivery checklist template</div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">Used every time you start a new delivery. Existing deliveries keep their own copy.</div>
      <div class="tmpl-list"></div>
      <button class="btn btn-ghost btn-sm btn-block" data-act="add-tmpl" style="margin-top:10px">+ Add item</button>
    </div>

    <div class="section-title">Dealer inventory sites</div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">Powers the “Find a car” search launcher. The network site is opened pre-filtered to used vehicles.</div>
      <div class="field"><label>My store — name</label><input id="d-store-name" value="${esc(s.storeSiteName || "")}" placeholder="My store"></div>
      <div class="field"><label>My store — inventory URL</label><input id="d-store-url" type="url" value="${esc(s.storeSiteUrl || "")}" placeholder="https://…/inventory/"></div>
      <div class="field"><label>Network — name</label><input id="d-net-name" value="${esc(s.networkSiteName || "")}" placeholder="Dealer network"></div>
      <div class="field"><label>Network — inventory URL</label><input id="d-net-url" type="url" value="${esc(s.networkSiteUrl || "")}" placeholder="https://…/inventory/"></div>
      <div class="field" style="margin-bottom:0"><label>Network “used only” filter</label><input id="d-net-suffix" value="${esc(s.networkUsedSuffix || "")}" placeholder="&search.vehicle-inventory-type-ids.0=2"></div>
      <div class="hint">Advanced: the query string appended to the network URL to show only used vehicles.</div>
    </div>

    <div class="section-title">Message templates</div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">Quick messages for follow-ups. Use <span class="mono">{firstName}</span>, <span class="mono">{name}</span>, <span class="mono">{vehicle}</span>, <span class="mono">{salesperson}</span>, <span class="mono">{dealership}</span> — they fill in automatically per customer.</div>
      <div class="tpl-list"></div>
      <button class="btn btn-ghost btn-sm btn-block" data-act="add-tpl" style="margin-top:10px">+ New template</button>
    </div>

    <div class="section-title">Data & backup</div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">Your data is stored only on this device. Export a backup regularly, or to move to a new phone.</div>
      <button class="btn btn-ghost btn-block" data-act="csv" style="margin-bottom:10px">${icon("file")} Import inventory / leads from spreadsheet (Excel or CSV)</button>
      <div class="btn-row">
        <button class="btn btn-ghost btn-block" data-act="export">${icon("download")} Export backup</button>
        <button class="btn btn-ghost btn-block" data-act="import">${icon("upload")} Restore backup</button>
      </div>
      <button class="btn ${sampleLoaded ? "btn-danger" : "btn-ghost"} btn-block" data-act="sample" style="margin-top:10px">${sampleLoaded ? "Remove sample data" : "Load sample data (try it out)"}</button>
      <button class="btn btn-danger btn-block" data-act="reset" style="margin-top:10px">Reset all data</button>
    </div>
    <div class="fab-note">entoa · data lives on your device</div>
  `;
  view.appendChild(el);

  el.querySelector('[data-act="back"]').addEventListener("click", () => (location.hash = "/"));
  el.querySelector('[data-act="csv"]').addEventListener("click", () => (location.hash = "/import"));

  el.querySelector('[data-act="sample"]').addEventListener("click", async () => {
    if (sampleLoaded) {
      removeSampleData();
      toast("Sample data removed");
    } else {
      loadSampleData();
      toast("Sample data loaded — check the Deal Radar", "success");
    }
    location.hash = "/";
  });

  // --- Cloud sync section ---
  const cloudSlot = el.querySelector("#cloud-slot");
  buildCloud(cloudSlot);
  const onSyncEvt = (e) => {
    const line = cloudSlot.querySelector(".cloud-status");
    if (!line) return;
    const d = e.detail || {};
    if (d.status === "syncing") line.textContent = "Syncing…";
    else if (d.status === "synced") line.textContent = `Synced ${timeAgo(d.at)}${d.applied ? ` · ${d.applied} update${d.applied === 1 ? "" : "s"} in` : ""}`;
    else if (d.status === "offline") line.textContent = "Offline — will sync when back online";
    else if (d.status === "error") line.textContent = `Sync error: ${d.error}`;
  };
  window.addEventListener("entoa-sync", onSyncEvt);

  el.querySelector("#s-name").addEventListener("change", (e) =>
    store.updateSettings({ salesperson: e.target.value.trim() }));
  el.querySelector("#s-dealer").addEventListener("change", (e) =>
    store.updateSettings({ dealership: e.target.value.trim() }));
  el.querySelector("#s-phone").addEventListener("change", (e) =>
    store.updateSettings({ contactPhone: e.target.value.trim() }));

  const dealerBind = { "d-store-name": "storeSiteName", "d-store-url": "storeSiteUrl", "d-net-name": "networkSiteName", "d-net-url": "networkSiteUrl", "d-net-suffix": "networkUsedSuffix" };
  Object.entries(dealerBind).forEach(([id, key]) =>
    el.querySelector("#" + id).addEventListener("change", (e) =>
      store.updateSettings({ [key]: e.target.value.trim() })));

  el.querySelector('[data-act="save-defaults"]').addEventListener("click", () => {
    store.updateSettings({
      taxRate: Number(el.querySelector("#s-tax").value) || 0,
      docFee: Number(el.querySelector("#s-doc").value) || 0,
      defaultApr: Number(el.querySelector("#s-apr").value) || 0,
      defaultTerm: Number(el.querySelector("#s-term").value) || 0,
    });
    toast("Defaults saved", "success");
  });

  // Prospecting settings
  el.querySelector("#s-touchgoal").addEventListener("change", (e) =>
    store.updateSettings({ dailyTouchGoal: Number(e.target.value) || 0 }));
  el.querySelector("#s-autocad").addEventListener("change", (e) =>
    store.updateSettings({ autoCadence: e.target.checked }));

  // Follow-up cadence editor
  const cadList = el.querySelector(".cad-list");
  function drawCad() {
    const steps = (store.getSettings().cadence || []).slice().sort((a, b) => a.day - b.day);
    cadList.innerHTML = "";
    steps.forEach((step, idx) => {
      const row = document.createElement("div");
      row.className = "check-item";
      const verb = step.channel === "text" ? "Text" : step.channel === "email" ? "Email" : "Call";
      row.innerHTML = `<label style="flex:1"><span class="strong">Day ${step.day}</span> · ${verb} — ${esc(step.label)}</label>
        <button class="modal-close" data-del="${idx}" aria-label="Remove" style="font-size:1.2rem">&times;</button>`;
      row.querySelector("[data-del]").addEventListener("click", () => {
        const next = steps.slice();
        next.splice(idx, 1);
        store.updateSettings({ cadence: next });
        drawCad();
      });
      cadList.appendChild(row);
    });
    if (!steps.length) cadList.innerHTML = `<div class="muted small">No touches — add one below.</div>`;
  }
  drawCad();
  el.querySelector('[data-act="add-cad"]').addEventListener("click", () => {
    openModal("Add a follow-up touch", (close) => {
      const { element } = buildForm(
        [
          { name: "day", label: "Day (from lead creation)", value: 1, type: "number", inputmode: "numeric", half: true, required: true },
          { name: "channel", label: "Channel", value: "call", type: "select", half: true, options: [{ value: "call", label: "Call" }, { value: "text", label: "Text" }, { value: "email", label: "Email" }] },
          { name: "label", label: "What to do", value: "", required: true, placeholder: "Check in, share options…" },
        ],
        { submitLabel: "Add touch", onSubmit: (data) => {
          const next = (store.getSettings().cadence || []).concat([{ day: Number(data.day) || 0, channel: data.channel, label: data.label }]);
          store.updateSettings({ cadence: next });
          close(); drawCad();
        } }
      );
      return element;
    });
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

  // Message templates editor
  const tplList = el.querySelector(".tpl-list");
  function drawTpl() {
    const list = store.getSettings().messageTemplates || [];
    tplList.innerHTML = "";
    if (!list.length) tplList.innerHTML = `<div class="muted small">No templates yet.</div>`;
    list.forEach((t) => {
      const row = document.createElement("div");
      row.className = "check-item";
      row.innerHTML = `
        <label style="flex:1" class="card-tap">
          <div class="strong">${icon(t.channel === "email" ? "mail" : "message")} ${esc(t.name)}</div>
          <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(String(t.body).replace(/\n/g, " "))}</div>
        </label>
        <button class="modal-close" data-del aria-label="Remove" style="font-size:1.2rem">&times;</button>`;
      row.querySelector("label").addEventListener("click", () => openTemplateEditor(t, drawTpl));
      row.querySelector("[data-del]").addEventListener("click", async () => {
        if (await confirmDialog(`Delete the "${t.name}" template?`)) {
          store.updateSettings({ messageTemplates: store.getSettings().messageTemplates.filter((x) => x.id !== t.id) });
          drawTpl();
        }
      });
      tplList.appendChild(row);
    });
  }
  drawTpl();
  el.querySelector('[data-act="add-tpl"]').addEventListener("click", () => openTemplateEditor(null, drawTpl));

  // Backup
  el.querySelector('[data-act="export"]').addEventListener("click", () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `entoa-backup-${stamp}.json`;
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

function timeAgo(iso) {
  if (!iso) return "just now";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// Renders the cloud-sync card based on current config + auth state. Calls
// itself to re-render after any state change.
function buildCloud(slot) {
  const s = store.getSettings();
  const configured = backend.isConfigured();
  const user = backend.currentUser();
  const rerender = () => buildCloud(slot);

  const setup = `
    <details class="cloud-setup" style="margin-bottom:12px">
      <summary class="strong small">${icon("help")} First-time setup (2 minutes)</summary>
      <ol class="small muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
        <li>Create a free project at <span class="mono">supabase.com</span>.</li>
        <li>In the project: <b>SQL Editor → New query</b>, paste the contents of <span class="mono">supabase/schema.sql</span> from your repo, and Run.</li>
        <li>Open <b>Project Settings → API</b> and copy the <b>Project URL</b> and the <b>anon public</b> key into the two boxes below.</li>
        <li>Create your account below and you're synced. (Optional: in Auth settings, turn off “Confirm email” for instant sign-up.)</li>
      </ol>
    </details>`;

  const configFields = `
    <div class="field"><label>Supabase Project URL</label><input id="c-url" type="url" value="${esc(s.supabaseUrl || "")}" placeholder="https://xxxx.supabase.co"></div>
    <div class="field"><label>Supabase anon key</label><input id="c-key" value="${esc(s.supabaseAnonKey || "")}" placeholder="eyJhbGciOi…"></div>`;

  if (!configured) {
    slot.innerHTML = `
      <div class="small muted" style="margin-bottom:10px">Back up and sync your data across devices. Until you set this up, everything stays on this device exactly as now.</div>
      ${setup}
      ${configFields}
      <div class="hint">The anon key is safe to store here — your data is protected by per-user security rules in the database.</div>`;
    bindConfig();
    return;
  }

  if (!user) {
    slot.innerHTML = `
      ${setup}
      ${configFields}
      <div class="section-title" style="margin-top:6px">Sign in</div>
      <div class="field"><label>Email</label><input id="c-email" type="email" inputmode="email" autocomplete="username" placeholder="you@email.com"></div>
      <div class="field"><label>Password</label><input id="c-pass" type="password" autocomplete="current-password" placeholder="••••••••"></div>
      <div class="btn-row">
        <button class="btn btn-primary btn-block" data-c="signin">Sign in</button>
        <button class="btn btn-ghost btn-block" data-c="signup">Create account</button>
      </div>
      <div class="cloud-status small muted" style="margin-top:10px;text-align:center"></div>`;
    bindConfig();
    bindAuth();
    return;
  }

  // Signed in.
  slot.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <div class="row-main">
        <div class="row-title">${icon("check")} Signed in</div>
        <div class="row-sub">${esc(user.email || "")}</div>
      </div>
      <button class="btn btn-ghost btn-sm" data-c="signout">Sign out</button>
    </div>
    <label class="switch" style="margin-bottom:12px"><input id="c-auto" type="checkbox" ${s.cloudAutoSync ? "checked" : ""}><span>Auto-sync in the background</span></label>
    <div class="btn-row">
      <button class="btn btn-primary btn-block" data-c="sync">${icon("download")} Sync now</button>
      <button class="btn btn-ghost btn-block" data-c="backup">${icon("upload")} Back up all</button>
    </div>
    <div class="cloud-status small muted" style="margin-top:10px;text-align:center">${sync.lastSyncAt() ? "Synced " + esc(timeAgo(sync.lastSyncAt())) : "Not synced yet — tap Sync now"}</div>`;
  bindConfig();

  slot.querySelector('[data-c="signout"]').addEventListener("click", async () => {
    await backend.signOut();
    sync.disable();
    toast("Signed out");
    rerender();
  });
  slot.querySelector("#c-auto").addEventListener("change", (e) =>
    store.updateSettings({ cloudAutoSync: e.target.checked }));
  slot.querySelector('[data-c="sync"]').addEventListener("click", () => sync.syncNow());
  slot.querySelector('[data-c="backup"]').addEventListener("click", async () => {
    try { await sync.backupNow(); toast("Backed up to cloud", "success"); }
    catch (e) { toast(e.message || "Backup failed", "danger"); }
  });

  function bindConfig() {
    const urlEl = slot.querySelector("#c-url");
    const keyEl = slot.querySelector("#c-key");
    if (urlEl) urlEl.addEventListener("change", (e) => { store.updateSettings({ supabaseUrl: e.target.value.trim() }); rerender(); });
    if (keyEl) keyEl.addEventListener("change", (e) => { store.updateSettings({ supabaseAnonKey: e.target.value.trim() }); rerender(); });
  }

  function bindAuth() {
    const status = slot.querySelector(".cloud-status");
    const creds = () => ({
      email: (slot.querySelector("#c-email").value || "").trim(),
      password: slot.querySelector("#c-pass").value || "",
    });
    const busy = (msg) => { if (status) status.textContent = msg; };
    slot.querySelector('[data-c="signin"]').addEventListener("click", async () => {
      const { email, password } = creds();
      if (!email || !password) return busy("Enter your email and password");
      busy("Signing in…");
      try {
        await backend.signIn(email, password);
        sync.enable(); sync.init(); sync.syncNow();
        toast("Signed in — syncing", "success");
        rerender();
      } catch (e) { busy(e.message || "Sign-in failed"); }
    });
    slot.querySelector('[data-c="signup"]').addEventListener("click", async () => {
      const { email, password } = creds();
      if (!email || password.length < 6) return busy("Use an email and a password of 6+ characters");
      busy("Creating account…");
      try {
        const r = await backend.signUp(email, password);
        if (r.needsConfirmation) { busy("Check your email to confirm, then sign in."); return; }
        sync.enable(); sync.init(); sync.backupNow();
        toast("Account created — backing up", "success");
        rerender();
      } catch (e) { busy(e.message || "Sign-up failed"); }
    });
  }
}

function openTemplateEditor(existing, onSaved) {
  const isEdit = !!existing;
  const t = existing || { channel: "sms" };
  openModal(isEdit ? "Edit template" : "New template", (close) => {
    const { element } = buildForm(
      [
        { name: "name", label: "Template name", value: t.name, required: true, placeholder: "First contact" },
        { name: "channel", label: "Channel", value: t.channel || "sms", type: "select",
          options: [{ value: "sms", label: "Text message" }, { value: "email", label: "Email" }] },
        { name: "subject", label: "Subject (email only)", value: t.subject, placeholder: "Your inquiry on the {vehicle}" },
        { name: "body", label: "Message", value: t.body, type: "textarea", required: true,
          hint: "Placeholders: {firstName} {name} {vehicle} {salesperson} {dealership}" },
      ],
      {
        submitLabel: isEdit ? "Save template" : "Add template",
        onSubmit: (data) => {
          const list = (store.getSettings().messageTemplates || []).slice();
          if (isEdit) {
            const idx = list.findIndex((x) => x.id === existing.id);
            if (idx >= 0) list[idx] = { ...existing, ...data };
          } else {
            list.push({ id: "tpl_" + Date.now().toString(36), ...data });
          }
          store.updateSettings({ messageTemplates: list });
          toast("Template saved", "success");
          close();
          if (onSaved) onSaved();
        },
      }
    );
    return element;
  });
}
