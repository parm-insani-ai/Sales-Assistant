// Settings: salesperson name, deal defaults, delivery checklist template,
// and data backup (export / import / reset).

import * as store from "../store.js";
import { openModal, buildForm, toast, confirmDialog } from "../components.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";
import { loadSampleData, removeSampleData, hasSampleData } from "../demo.js";
import * as backend from "../backend.js";
import * as sync from "../sync.js";
import * as calfeeds from "../calfeeds.js";
import { checkForUpdate, getVersion } from "../updater.js";
import { testAgent, findAgentFunction } from "../agent.js";
import { sendEmail, emailSendConfigured } from "../email.js";
import { connectOutlook, outlookConnected, outlookAccount, disconnectOutlook, pullOutlookMail, lastMailPull } from "../msmail.js";

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
      <div class="field"><label>Contact phone (for listings)</label><input id="s-phone" type="tel" inputmode="tel" value="${esc(s.contactPhone || "")}" placeholder="(555) 123-4567"></div>
      <div class="field" style="margin-bottom:0"><label>Your email</label><input id="s-email" type="email" value="${esc(s.contactEmail || "")}" placeholder="you@email.com"></div>
      <div class="hint">Used to fill in {salesperson} / {dealership} in message templates, your contact info in Marketplace listings, and as the default address for email tests.</div>
    </div>

    <div class="section-title">Cloud sync &amp; account</div>
    <div class="card" id="cloud-slot"></div>

    <div class="section-title">Calendar feeds</div>
    <div class="card" id="feeds-slot"></div>

    <div class="section-title">Voice agent</div>
    <div class="card" id="agent-slot"></div>

    <div class="section-title">Email</div>
    <div class="card" id="email-slot"></div>

    <div class="section-title">Booking page</div>
    <div class="card" id="booking-slot"></div>

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

    <div class="section-title">App</div>
    <div class="card">
      <button class="btn btn-ghost btn-block" data-act="update">${icon("download")} Check for updates</button>
      <div class="small muted" id="app-version" style="text-align:center;margin-top:10px">entoa</div>
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
  buildFeeds(el.querySelector("#feeds-slot"));
  buildAgent(el.querySelector("#agent-slot"));
  buildEmail(el.querySelector("#email-slot"));
  buildBooking(el.querySelector("#booking-slot"));
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
  el.querySelector("#s-email").addEventListener("change", (e) =>
    store.updateSettings({ contactEmail: e.target.value.trim() }));

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

  // App version + manual update check.
  const verEl = el.querySelector("#app-version");
  getVersion().then((v) => { if (verEl) verEl.textContent = v ? `Version ${v.version} · ${new Date(v.built).toLocaleDateString()}` : "entoa"; });
  el.querySelector('[data-act="update"]').addEventListener("click", async () => {
    toast("Checking for updates…");
    const updating = await checkForUpdate();
    if (updating) toast("Update found — refreshing…", "success");
    else setTimeout(() => toast("You're on the latest version", "success"), 500);
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

// Voice agent (Claude-backed) endpoint config.
function buildAgent(slot) {
  const s = store.getSettings();
  slot.innerHTML = `
    <div class="small muted" style="margin-bottom:10px">Turn the Voice button into a real assistant that understands plain language and runs tasks — "book Ken a test drive Thursday at 4", "mark Sara's appointment sold", "log a sale for Moe, commission 800". Powered by Claude through a function on your Supabase.</div>
    <details class="cloud-setup" style="margin-bottom:12px">
      <summary class="strong small">${icon("help")} How to set this up</summary>
      <ol class="small muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
        <li>Get an API key at <span class="mono">console.anthropic.com</span>.</li>
        <li>Set it as a secret: <span class="mono">supabase secrets set ANTHROPIC_API_KEY=sk-ant-…</span></li>
        <li>Deploy: <span class="mono">supabase functions deploy voice-agent --no-verify-jwt</span></li>
        <li>Paste the function URL below.</li>
      </ol>
    </details>
    <div class="field"><label>Voice agent URL</label><input id="ag-url" type="url" value="${esc(s.agentUrl || "")}" placeholder="https://xxxx.supabase.co/functions/v1/voice-agent"></div>
    <div class="hint">Leave blank to use the built-in on-device commands. When set, the mic understands natural language and carries out tasks.</div>
    <button class="btn btn-sm" id="ag-test" type="button" style="margin-top:10px">Test connection</button>
    <div class="hint" id="ag-test-out"></div>
  `;
  slot.querySelector("#ag-url").addEventListener("change", (e) => store.updateSettings({ agentUrl: e.target.value.trim() }));
  const testBtn = slot.querySelector("#ag-test");
  const testOut = slot.querySelector("#ag-test-out");
  testBtn.addEventListener("click", async () => {
    // Pick up an un-blurred edit before testing.
    const typed = slot.querySelector("#ag-url").value.trim();
    if (typed !== (store.getSettings().agentUrl || "")) store.updateSettings({ agentUrl: typed });
    testBtn.disabled = true;
    testOut.textContent = "Testing…";
    try {
      await testAgent();
      testOut.textContent = "✓ Connected — the voice assistant is ready.";
      toast("Voice agent connected", "success");
    } catch (e) {
      const msg = e.message || "Test failed";
      // On a 404 the function exists under another name — find it and fix the
      // URL automatically instead of making the user hunt through Supabase.
      if (msg.includes("404")) {
        testOut.textContent = "Nothing at that URL — scanning your project for the function…";
        try {
          const found = await findAgentFunction();
          if (found) {
            store.updateSettings({ agentUrl: found });
            slot.querySelector("#ag-url").value = found;
            const name = found.split("/").pop();
            await testAgent();
            testOut.textContent = `✓ Found your function ("${name}") — URL fixed and connected.`;
            toast("Voice agent connected", "success");
            testBtn.disabled = false;
            return;
          }
        } catch (e2) {
          testOut.textContent = `✗ Found the function, but: ${e2.message || "it errored"}`;
          testBtn.disabled = false;
          return;
        }
      }
      testOut.textContent = `✗ ${msg}`;
    }
    testBtn.disabled = false;
  });
}

// Email: tap-to-email works out of the box; automated sending is optional and
// runs through the same Supabase function (Resend secrets).
function buildEmail(slot) {
  const s = store.getSettings();
  slot.innerHTML = `
    <div class="small muted" style="margin-bottom:10px">Tap-to-email with templates already works from any customer — it opens your mail app with the message filled in. Optionally, entoa can also <b>send cadence emails automatically</b> when you open the app, so follow-ups go out without you touching them.</div>
    <details class="cloud-setup" style="margin-bottom:12px">
      <summary class="strong small">${icon("help")} Set up automated sending (optional)</summary>
      <ol class="small muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
        <li>Create a free account at <span class="mono">resend.com</span> and verify a domain you own (so emails come from your address, not spam).</li>
        <li>In Supabase → Edge Functions → <b>Secrets</b>, add <span class="mono">RESEND_API_KEY</span> (from Resend) and <span class="mono">EMAIL_FROM</span> (like <span class="mono">Parm &lt;parm@yourdomain.com&gt;</span>).</li>
        <li>Make sure your function has the latest entoa code, then use <b>Send a test</b> below.</li>
      </ol>
    </details>
    <label class="switch" style="margin-bottom:12px">
      <input type="checkbox" id="em-auto" ${s.emailAutoSend ? "checked" : ""}>
      Send due cadence emails automatically when the app opens
    </label>
    <div class="field"><label>Send a test to</label><input id="em-test-to" type="email" placeholder="you@email.com" value="${esc(s.contactEmail || "")}"></div>
    <button class="btn btn-sm" id="em-test" type="button">Send a test email</button>
    <div class="hint" id="em-test-out"></div>

    <hr class="divider" />
    <div class="strong" style="margin-bottom:6px">${icon("mail")} Outlook inbox</div>
    <div class="small muted" style="margin-bottom:10px">Connect your Outlook and entoa pulls customer replies into each lead's email history automatically. Only mail from your customers is kept — everything else is ignored, and nothing leaves your phone.</div>
    <details class="cloud-setup" style="margin-bottom:12px">
      <summary class="strong small">${icon("help")} One-time setup (~5 min)</summary>
      <ol class="small muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
        <li>Go to <span class="mono">entra.microsoft.com</span> → <b>App registrations</b> → <b>New registration</b>. Name it "entoa".</li>
        <li>Supported accounts: <b>any org directory and personal Microsoft accounts</b>.</li>
        <li>Redirect URI: choose platform <b>Single-page application (SPA)</b> and enter <span class="mono">${esc(location.origin + location.pathname)}</span></li>
        <li>Copy the <b>Application (client) ID</b> and paste it below, then tap Connect.</li>
      </ol>
      <div class="small muted" style="margin-top:6px">A work (O'Regan's) mailbox may need IT to allow the sign-in; a personal Outlook/Hotmail account works right away.</div>
    </details>
    ${outlookConnected() ? `
      <div class="small" style="margin-bottom:10px">${icon("checkline")} Connected as <b>${esc((outlookAccount() || {}).email || "your account")}</b>${lastMailPull() ? ` <span class="muted">· last checked ${esc(timeAgo(lastMailPull()))}</span>` : ""}</div>
      <div class="btn-row">
        <button class="btn btn-sm btn-primary" id="ms-pull" type="button">Check mail now</button>
        <button class="btn btn-sm btn-ghost" id="ms-off" type="button">Disconnect</button>
      </div>
    ` : `
      <div class="field"><label>Application (client) ID</label><input id="ms-client" value="${esc(s.msClientId || "")}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
      <button class="btn btn-sm btn-primary" id="ms-connect" type="button">Connect Outlook</button>
    `}
    <div class="hint" id="ms-out"></div>
  `;
  slot.querySelector("#em-auto").addEventListener("change", (e) => {
    store.updateSettings({ emailAutoSend: e.target.checked });
    toast(e.target.checked ? "Automated emails on" : "Automated emails off", "success");
  });
  const out = slot.querySelector("#em-test-out");
  const btn = slot.querySelector("#em-test");
  btn.addEventListener("click", async () => {
    const to = (slot.querySelector("#em-test-to").value || "").trim();
    if (!to) { out.textContent = "Enter an address to send the test to"; return; }
    if (!emailSendConfigured()) { out.textContent = "Set up the voice agent first (its function does the sending)"; return; }
    btn.disabled = true;
    out.textContent = "Sending…";
    try {
      await sendEmail({ to, subject: "entoa test email", text: "This is a test from entoa — automated sending is working. 🎉" });
      out.textContent = "✓ Sent! Check that inbox (and spam, the first time).";
      toast("Test email sent", "success");
    } catch (e) {
      out.textContent = `✗ ${e.message || "Send failed"}`;
    }
    btn.disabled = false;
  });

  // --- Outlook inbox controls ---
  const msOut = slot.querySelector("#ms-out");
  const msClient = slot.querySelector("#ms-client");
  if (msClient) msClient.addEventListener("change", (e) => store.updateSettings({ msClientId: e.target.value.trim() }));
  const msConnect = slot.querySelector("#ms-connect");
  if (msConnect) msConnect.addEventListener("click", async () => {
    if (msClient) store.updateSettings({ msClientId: msClient.value.trim() });
    try { await connectOutlook(); } catch (e) { msOut.textContent = `✗ ${e.message}`; }
  });
  const msPull = slot.querySelector("#ms-pull");
  if (msPull) msPull.addEventListener("click", async () => {
    msPull.disabled = true;
    msOut.textContent = "Checking your inbox…";
    try {
      const r = await pullOutlookMail();
      msOut.textContent = `✓ Checked ${r.checked} message${r.checked === 1 ? "" : "s"} — ${r.linked ? `${r.linked} filed to customers` : "none from customers"}.`;
      if (r.linked) toast(`${r.linked} customer email${r.linked === 1 ? "" : "s"} filed`, "success");
    } catch (e) {
      msOut.textContent = `✗ ${e.message || "Mail check failed"}`;
    }
    msPull.disabled = false;
  });
  const msOff = slot.querySelector("#ms-off");
  if (msOff) msOff.addEventListener("click", () => {
    disconnectOutlook();
    toast("Outlook disconnected");
    buildEmail(slot);
  });
}

// Self-serve booking page: customers book their own slot from a link; the
// appointment lands in the cloud and syncs into the app.
export function bookingLink() {
  const s = store.getSettings();
  const cfg = {
    u: backend.currentUser().id,
    fn: (s.agentUrl || "").trim().replace(/\/+$/, ""),
    n: s.salesperson || "",
    d: s.dealership || "",
    h: [s.bookStart ?? 9, s.bookEnd ?? 19],
    slot: s.bookSlot || 30,
    days: s.bookDays || [1, 2, 3, 4, 5, 6],
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(cfg))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const base = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
  return `${base}/book.html?c=${b64}`;
}

function buildBooking(slot) {
  const s = store.getSettings();
  const user = backend.currentUser();
  const ready = !!(user && user.id && (s.agentUrl || "").trim());
  const days = s.bookDays || [1, 2, 3, 4, 5, 6];
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hourOpts = (sel) => Array.from({ length: 15 }, (_, i) => i + 7)
    .map((h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${h > 12 ? h - 12 : h}${h >= 12 ? "pm" : "am"}</option>`).join("");

  slot.innerHTML = `
    <div class="small muted" style="margin-bottom:10px">Your personal booking link. Text it to a customer and they pick their own time slot — the appointment lands on your calendar, confirmed, and they become a customer automatically. No back-and-forth.</div>
    ${!ready ? `<div class="hint" style="margin-bottom:6px">Needs two things you may already have: sign in to <b>Cloud sync</b> (bookings travel through it) and set up the <b>Voice agent</b> function (it hosts the booking API — make sure it's on the latest code).</div>` : `
    <div class="field-inline">
      <div class="field"><label>Open from</label><select id="bk-start">${hourOpts(s.bookStart ?? 9)}</select></div>
      <div class="field"><label>Until</label><select id="bk-end">${hourOpts(s.bookEnd ?? 19)}</select></div>
    </div>
    <div class="field"><label>Slot length</label><select id="bk-slot">
      <option value="15" ${s.bookSlot === 15 ? "selected" : ""}>15 minutes</option>
      <option value="30" ${(s.bookSlot || 30) === 30 ? "selected" : ""}>30 minutes</option>
      <option value="60" ${s.bookSlot === 60 ? "selected" : ""}>1 hour</option>
    </select></div>
    <div class="field"><label>Bookable days</label>
      <div class="btn-row">${DAY_LABELS.map((lb, i) =>
        `<button type="button" class="btn btn-sm ${days.includes(i) ? "btn-primary" : "btn-ghost"}" data-bk-day="${i}">${lb}</button>`).join("")}</div>
    </div>
    <div class="field"><label>Your link</label><input id="bk-link" readonly value="${esc(bookingLink())}" style="font-size:0.8rem"></div>
    <div class="btn-row">
      <button class="btn btn-sm btn-primary" id="bk-copy" type="button">${icon("file")} Copy link</button>
      <a class="btn btn-sm btn-ghost" id="bk-sms" href="#">${icon("message")} Text it</a>
      <a class="btn btn-sm btn-ghost" id="bk-open" href="#" target="_blank" rel="noopener">Preview</a>
    </div>`}
  `;
  if (!ready) return;

  const refreshLink = () => {
    const link = bookingLink();
    slot.querySelector("#bk-link").value = link;
    const first = (store.getSettings().salesperson || "").split(" ")[0];
    slot.querySelector("#bk-sms").href = `sms:?&body=${encodeURIComponent(
      `Hi! ${first ? `It's ${first} — ` : ""}here's my calendar. Grab any time that works for you and I'll have everything ready when you come in:\n\n${link}`
    )}`;
    slot.querySelector("#bk-open").href = link;
  };
  refreshLink();

  slot.querySelector("#bk-start").addEventListener("change", (e) => { store.updateSettings({ bookStart: +e.target.value }); refreshLink(); });
  slot.querySelector("#bk-end").addEventListener("change", (e) => { store.updateSettings({ bookEnd: +e.target.value }); refreshLink(); });
  slot.querySelector("#bk-slot").addEventListener("change", (e) => { store.updateSettings({ bookSlot: +e.target.value }); refreshLink(); });
  slot.querySelectorAll("[data-bk-day]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = +b.dataset.bkDay;
      const cur = store.getSettings().bookDays || [1, 2, 3, 4, 5, 6];
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : cur.concat([d]).sort();
      store.updateSettings({ bookDays: next });
      b.classList.toggle("btn-primary");
      b.classList.toggle("btn-ghost");
      refreshLink();
    }));
  slot.querySelector("#bk-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(slot.querySelector("#bk-link").value); toast("Booking link copied", "success"); }
    catch { slot.querySelector("#bk-link").select(); toast("Select and copy the link", ""); }
  });
}

// External calendar feeds (Apple/Outlook/Google via .ics subscription).
function buildFeeds(slot) {
  const s = store.getSettings();
  const feeds = s.calendarFeeds || [];
  const rerender = () => buildFeeds(slot);

  slot.innerHTML = `
    <div class="small muted" style="margin-bottom:10px">Show your Apple, Outlook and Google events on your calendar (read-only). Feeds come through the same Supabase function that powers voice — no extra setup beyond a one-time code update.</div>
    <details class="cloud-setup" style="margin-bottom:12px">
      <summary class="strong small">${icon("help")} How to set this up</summary>
      <ol class="small muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
        <li><b>One-time:</b> in Supabase → Edge Functions → your function, replace its code with the latest <span class="mono">supabase/functions/voice-agent/index.ts</span> from entoa and deploy. (The update adds calendar fetching to the function voice already uses.)</li>
        <li><b>Google:</b> Calendar settings → your calendar → <b>Secret address in iCal format</b>.</li>
        <li><b>Apple:</b> Calendar app → share a calendar → <b>Public Calendar</b> → copy the <span class="mono">webcal://</span> link.</li>
        <li><b>Outlook:</b> Calendar → <b>Share → Publish</b> → copy the ICS link (may need IT on a work account).</li>
        <li>Add each calendar below, then tap <b>Refresh now</b>.</li>
      </ol>
    </details>
    <div class="field"><label>Calendar proxy URL <span class="muted">(optional)</span></label><input id="cf-proxy" type="url" value="${esc(s.calendarProxyUrl || "")}" placeholder="Leave blank to use your voice agent function"></div>
    ${!s.calendarProxyUrl && s.agentUrl ? `<div class="hint" style="margin-top:-8px;margin-bottom:12px">${icon("checkline")} Using your voice agent function.</div>` : ""}
    <div class="feeds-list"></div>
    <div class="section-title" style="margin-top:6px">Add a calendar</div>
    <div class="field"><label>Name</label><input id="cf-name" placeholder="My Google / Work Outlook / iPhone"></div>
    <div class="field"><label>Feed URL (.ics or webcal)</label><input id="cf-url" type="url" placeholder="https://…  or  webcal://…"></div>
    <button class="btn btn-ghost btn-block" data-cf="add">${icon("plus")} Add calendar</button>
    <button class="btn btn-primary btn-block" data-cf="refresh" style="margin-top:10px">${icon("download")} Refresh now</button>
    <div class="feeds-status small muted" style="margin-top:10px;text-align:center"></div>
  `;

  slot.querySelector("#cf-proxy").addEventListener("change", (e) => store.updateSettings({ calendarProxyUrl: e.target.value.trim() }));

  const list = slot.querySelector(".feeds-list");
  if (!feeds.length) list.innerHTML = `<div class="muted small" style="margin:4px 0 8px">No calendars added yet.</div>`;
  feeds.forEach((f) => {
    const row = document.createElement("div");
    row.className = "check-item";
    row.innerHTML = `
      <label class="switch" style="flex:1"><input type="checkbox" ${f.enabled !== false ? "checked" : ""} data-cf-en="${f.id}"><span class="strong">${esc(f.name || "Calendar")}</span></label>
      <button class="modal-close" data-cf-del="${f.id}" aria-label="Remove" style="font-size:1.2rem">&times;</button>`;
    row.querySelector("[data-cf-en]").addEventListener("change", (e) => {
      const next = (store.getSettings().calendarFeeds || []).map((x) => x.id === f.id ? { ...x, enabled: e.target.checked } : x);
      store.updateSettings({ calendarFeeds: next });
    });
    row.querySelector("[data-cf-del]").addEventListener("click", () => {
      const next = (store.getSettings().calendarFeeds || []).filter((x) => x.id !== f.id);
      store.updateSettings({ calendarFeeds: next });
      rerender();
    });
    list.appendChild(row);
  });

  const status = slot.querySelector(".feeds-status");
  const last = calfeeds.lastFeedSync();
  status.textContent = last ? `${calfeeds.externalEventCount()} events · updated ${timeAgo(last)}` : "Not synced yet";

  slot.querySelector('[data-cf="add"]').addEventListener("click", () => {
    const name = (slot.querySelector("#cf-name").value || "").trim();
    const url = (slot.querySelector("#cf-url").value || "").trim();
    if (!url) { status.textContent = "Enter a feed URL"; return; }
    const id = "feed_" + Date.now().toString(36);
    const next = (store.getSettings().calendarFeeds || []).concat([{ id, name: name || "Calendar", url, enabled: true }]);
    store.updateSettings({ calendarFeeds: next });
    rerender();
  });

  slot.querySelector('[data-cf="refresh"]').addEventListener("click", async () => {
    status.textContent = "Refreshing…";
    try {
      const r = await calfeeds.refreshFeeds();
      status.textContent = r.errors.length
        ? `Some feeds failed: ${r.errors.join("; ")}`
        : `Updated ${calfeeds.externalEventCount()} events just now`;
    } catch (e) { status.textContent = e.message || "Refresh failed"; }
  });
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
