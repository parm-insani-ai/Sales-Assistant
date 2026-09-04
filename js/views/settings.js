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
import { checkForUpdate, getVersion, runningVersion, hardRefresh } from "../updater.js";
import { testAgent, findAgentFunction } from "../agent.js";
import { sendEmail, emailSendConfigured } from "../email.js";
import { connectOutlook, outlookConnected, outlookAccount, disconnectOutlook, pullOutlookMail, lastMailPull } from "../msmail.js";
import { shorten, shortUrl } from "../shortlink.js";
import { enablePush, disablePush, pushEnabled, pushSupported, needsInstall, sendTestPush } from "../push.js";

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
      <div class="field"><label>Your email</label><input id="s-email" type="email" value="${esc(s.contactEmail || "")}" placeholder="you@email.com"></div>
      <div class="field" style="margin-bottom:0"><label>Google review link</label><input id="s-review" type="url" value="${esc(s.reviewLink || "")}" placeholder="https://g.page/r/…/review"></div>
      <div class="hint">Used to fill in {salesperson} / {dealership} in message templates, your contact info in Marketplace listings, and as the default address for email tests. The review link gets folded into the day-after-delivery thank-you text (Google Business Profile → Ask for reviews → copy the link).</div>
    </div>

    <div class="section-title">Cloud sync &amp; account</div>
    <div class="card" id="cloud-slot"></div>

    <div class="section-title">Notifications</div>
    <div class="card" id="push-slot"></div>

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
        <div class="field"><label>Sales tax % (HST)</label><input id="s-tax" type="number" step="0.01" inputmode="decimal" value="${esc(s.taxRate)}"></div>
        <div class="field"><label>Doc fee (every car)</label><input id="s-doc" type="number" inputmode="decimal" value="${esc(s.docFee)}"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>Default APR %</label><input id="s-apr" type="number" step="0.01" inputmode="decimal" value="${esc(s.defaultApr)}"></div>
        <div class="field"><label>Default term</label><input id="s-term" type="number" inputmode="numeric" value="${esc(s.defaultTerm)}"></div>
      </div>
      <div class="small strong" style="margin:4px 0 8px">New-vehicle fees</div>
      <div class="field-inline">
        <div class="field"><label>Freight</label><input id="s-freight" type="number" inputmode="decimal" value="${esc(s.feeFreight ?? 2100)}"></div>
        <div class="field"><label>Air tax</label><input id="s-airtax" type="number" inputmode="decimal" value="${esc(s.feeAirTax ?? 100)}"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>Plate registration</label><input id="s-plate" type="number" step="0.01" inputmode="decimal" value="${esc(s.feePlateReg ?? 13.20)}"></div>
        <div class="field"><label>Tire levy</label><input id="s-tire" type="number" step="0.01" inputmode="decimal" value="${esc(s.feeTireLevy ?? 22.50)}"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>AVP — Rogue</label><input id="s-avp-rogue" type="number" inputmode="decimal" value="${esc(s.avpRogue ?? 699)}"></div>
        <div class="field"><label>AVP — all others</label><input id="s-avp-other" type="number" inputmode="decimal" value="${esc(s.avpOther ?? 599)}"></div>
      </div>
      <div class="hint" style="margin-bottom:10px">The doc fee is charged on every car sold, new or used. New vehicles add these on top: AVP, freight, air tax and tire levy are all taxed; plate registration isn't.</div>
      <div class="small strong" style="margin:4px 0 8px">Trade estimate (when no appraisal is on file)</div>
      <div class="field-inline">
        <div class="field"><label>Expected km / year</label><input id="s-tr-kmyr" type="number" inputmode="numeric" value="${esc(s.tradeKmPerYear ?? 20000)}"></div>
        <div class="field"><label>$ per km over/under</label><input id="s-tr-kmrate" type="number" step="0.01" inputmode="decimal" value="${esc(s.tradeKmRate ?? 0.05)}"></div>
      </div>
      <div class="field-inline">
        <div class="field"><label>Recon budget $</label><input id="s-tr-recon" type="number" inputmode="decimal" value="${esc(s.tradeRecon ?? 1500)}"></div>
        <div class="field"><label>Wholesale margin %</label><input id="s-tr-margin" type="number" step="0.1" inputmode="decimal" value="${esc(s.tradeMarginPct ?? 9)}"></div>
      </div>
      <div class="hint" style="margin-bottom:10px">The book estimate works like an appraisal: trim MSRP on an age curve, adjusted for km and condition, sanity-checked against comparable used units on your own lot (retail − margin − recon). Tune these to match how your desk actually appraises.</div>
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
  buildPush(el.querySelector("#push-slot"));
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
  el.querySelector("#s-review").addEventListener("change", (e) =>
    store.updateSettings({ reviewLink: e.target.value.trim() }));

  const dealerBind = { "d-store-name": "storeSiteName", "d-store-url": "storeSiteUrl", "d-net-name": "networkSiteName", "d-net-url": "networkSiteUrl", "d-net-suffix": "networkUsedSuffix" };
  Object.entries(dealerBind).forEach(([id, key]) =>
    el.querySelector("#" + id).addEventListener("change", (e) =>
      store.updateSettings({ [key]: e.target.value.trim() })));

  el.querySelector('[data-act="save-defaults"]').addEventListener("click", () => {
    store.updateSettings({
      taxRate: Number(el.querySelector("#s-tax").value) || 0,
      docFee: Number(el.querySelector("#s-doc").value) || 0,
      feeFreight: Number(el.querySelector("#s-freight").value) || 0,
      feeAirTax: Number(el.querySelector("#s-airtax").value) || 0,
      feePlateReg: Number(el.querySelector("#s-plate").value) || 0,
      feeTireLevy: Number(el.querySelector("#s-tire").value) || 0,
      avpRogue: Number(el.querySelector("#s-avp-rogue").value) || 0,
      avpOther: Number(el.querySelector("#s-avp-other").value) || 0,
      defaultApr: Number(el.querySelector("#s-apr").value) || 0,
      defaultTerm: Number(el.querySelector("#s-term").value) || 0,
      tradeKmPerYear: Number(el.querySelector("#s-tr-kmyr").value) || 20000,
      tradeKmRate: Number(el.querySelector("#s-tr-kmrate").value) || 0.05,
      tradeRecon: Number(el.querySelector("#s-tr-recon").value) || 0,
      tradeMarginPct: Number(el.querySelector("#s-tr-margin").value) || 0,
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
  // Report what's RUNNING, and only claim "latest" when the worker serving the
  // code agrees. Reporting the deployed version alone is what let a stale app
  // look current — the number was right and the code was old.
  Promise.all([getVersion(), runningVersion()]).then(([v, running]) => {
    if (!verEl) return;
    if (!v) return void (verEl.textContent = "entoa");
    const date = new Date(v.built).toLocaleDateString();
    // The worker's cache name is "entoa-<build>"; version.json carries <build>.
    const stale = running && running !== `entoa-${v.version}`;
    if (!stale) { verEl.textContent = `Version ${v.version} · ${date}`; return; }
    verEl.innerHTML = `Running <span class="mono">${esc(running.replace(/^entoa-/, ""))}</span> —
      <b>${esc(v.version)}</b> is available but hasn't taken over.<br>
      <button class="btn btn-sm btn-ghost" data-act="hard-refresh" style="margin-top:8px">Force update</button>`;
    verEl.querySelector('[data-act="hard-refresh"]').addEventListener("click", async () => {
      toast("Clearing and reloading…");
      await hardRefresh();
    });
  });
  el.querySelector('[data-act="update"]').addEventListener("click", async () => {
    toast("Checking for updates…");
    const updating = await checkForUpdate();
    if (updating) return toast("Update found — refreshing…", "success");
    // reg.update() found nothing, but the running code may still be behind — a
    // worker that failed to install leaves exactly this state.
    const [v, running] = await Promise.all([getVersion(), runningVersion()]);
    if (v && running && running !== `entoa-${v.version}`) {
      toast("Stuck on an old version — use Force update below", "warn");
      return;
    }
    setTimeout(() => toast("You're on the latest version", "success"), 500);
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
  // Proof that the webhook is actually pointing here: an inbound text can only
  // exist if the carrier reached the function.
  const lastInbound = store.all("texts")
    .filter((t) => t.dir === "in")
    .map((t) => t.at || t.createdAt)
    .sort()
    .pop() || null;
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
    <div class="strong" style="margin-bottom:6px">${icon("message")} Texting number</div>
    <div class="small muted" style="margin-bottom:10px">Without this, texts hand off to your phone's own SMS app and replies never reach entoa. With a dedicated number, the whole conversation lives in the <b>Inbox</b> — and the agent can draft your replies. Customers see this number instead of your personal one.</div>
    <details class="cloud-setup" style="margin-bottom:12px">
      <summary class="strong small">${icon("help")} One-time setup (~15 min)</summary>
      <ol class="small muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
        <li>At <span class="mono">twilio.com</span>, buy a local number (a 902 keeps it familiar to Halifax customers) — or reuse one you already own, see below.</li>
        <li>In Supabase → Edge Functions → <b>Secrets</b>, add <span class="mono">TWILIO_ACCOUNT_SID</span>, <span class="mono">TWILIO_AUTH_TOKEN</span> and <span class="mono">TWILIO_FROM</span> (the number, as <span class="mono">+1902…</span>).</li>
        <li>In Twilio, open the number → <b>Messaging</b> → "A message comes in" → <b>Webhook (HTTP POST)</b> and paste:<br><span class="mono" style="word-break:break-all">${esc(((s.agentUrl || "your function URL").trim().replace(/\/+$/, "")) + "?sms=1&u=" + ((backend.currentUser() || {}).id || "<sign in first>"))}</span></li>
        <li>Paste the same number below.</li>
      </ol>
      <div class="small muted" style="margin-top:6px">Carriers require working opt-out: a customer who texts STOP is excluded from campaigns automatically, and texting START brings them back.</div>
    </details>
    <details class="cloud-setup" style="margin-bottom:12px">
      <summary class="strong small">${icon("help")} Using a number that's already on another project</summary>
      <div class="small muted" style="margin-top:8px;line-height:1.5">
        A number can only deliver its texts to one place, so pointing it here takes it off the other project. Nothing needs to be bought or transferred — just repointed.
        <ul style="margin:8px 0 0;padding-left:18px">
          <li><b>Check for a Messaging Service first.</b> In Twilio, open the number and look at <b>Messaging</b> → "A message comes in". If it says the number is in a Messaging Service, that service's inbound webhook wins and editing the number here does nothing. Either remove the number from the service, or set the webhook on the service itself (Messaging → Services → your service → Integration).</li>
          <li><b>Same Twilio account:</b> nothing else to do — repoint the webhook and use that account's SID and auth token.</li>
          <li><b>A subaccount:</b> use the <i>subaccount's</i> SID and auth token in the secrets, not the parent's, or sending is rejected as if the number weren't yours.</li>
          <li><b>A different Twilio login:</b> numbers can't be self-served between separate accounts — Twilio support has to move it, which takes days. Buying a fresh number is usually faster.</li>
        </ul>
      </div>
    </details>
    <div class="field"><label>Your texting number</label><input id="sms-from" type="tel" value="${esc(s.smsFrom || "")}" placeholder="+19025550123"></div>
    <div class="hint" id="sms-out">${s.smsFrom ? `${icon("checkline")} Replies come into the Inbox.` : "Not set — texts open your phone's SMS app and replies won't come back."}</div>
    ${s.smsFrom ? `
    <div class="field" style="margin-top:12px"><label>Test it — send yourself a text</label><input id="sms-test-to" type="tel" value="${esc(s.contactPhone || "")}" placeholder="(902) 555-1234"></div>
    <div class="btn-row">
      <button class="btn btn-sm" id="sms-test" type="button">${icon("message")} Send a test text</button>
      <button class="btn btn-sm btn-ghost" id="sms-check" type="button">${icon("help")} Check setup</button>
    </div>
    <div class="hint" id="sms-test-out"></div>
    <div class="small" id="sms-check-out" style="margin-top:8px"></div>
    <div class="small muted" style="margin-top:10px;line-height:1.5">
      ${lastInbound
        ? `${icon("checkline")} <b>Replies are arriving.</b> Last one ${esc(timeAgo(lastInbound))}.`
        : `<b>Inbound not confirmed yet.</b> Text something to ${esc(s.smsFrom)} from your own phone — it should appear in the Inbox within a few seconds. If it doesn't, the number's webhook is still pointing at wherever it was before (and if the number belongs to a Messaging Service, the service's webhook is the one that counts).`}
    </div>` : ""}

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
  slot.querySelector("#sms-from").addEventListener("change", (e) => {
    const raw = e.target.value.trim();
    // Twilio wants E.164; a North American 10-digit entry is unambiguous.
    const digits = raw.replace(/\D/g, "");
    const val = !raw ? "" : raw.startsWith("+") ? raw
      : digits.length === 10 ? "+1" + digits
      : digits.length === 11 && digits[0] === "1" ? "+" + digits
      : raw;
    e.target.value = val;
    store.updateSettings({ smsFrom: val });
    const hint = slot.querySelector("#sms-out");
    if (hint) hint.innerHTML = val
      ? `${icon("checkline")} Replies come into the Inbox.`
      : "Not set — texts open your phone's SMS app and replies won't come back.";
    toast(val ? "Texting number saved" : "Texting number cleared", "success");
  });
  // Sends through the real path — function, secrets, Twilio — so a failure
  // reports the actual reason instead of leaving you to guess which of the
  // three is wrong.
  const smsTest = slot.querySelector("#sms-test");
  if (smsTest) smsTest.addEventListener("click", async () => {
    const box = slot.querySelector("#sms-test-out");
    const to = (slot.querySelector("#sms-test-to").value || "").trim();
    if (!to) { box.textContent = "Enter a number to send the test to"; return; }
    const user = backend.currentUser();
    if (!user) { box.textContent = "Sign in to your cloud account first"; return; }
    const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
    if (!url) { box.textContent = "Set the agent function URL first (above)"; return; }
    smsTest.disabled = true;
    box.textContent = "Sending…";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sms: { u: user.id, to, body: "Test from entoa — texting is working. Reply to this and it should land in your Inbox." } }),
      });
      const j = await res.json().catch(() => ({}));
      box.innerHTML = res.ok && j.sent
        ? `${icon("checkline")} Sent. Now <b>reply to it</b> — your answer should show up in the Inbox, which proves the webhook too.`
        : `Didn't send: ${esc(j.error || `error ${res.status}`)}`;
    } catch {
      box.textContent = "Couldn't reach the function — check the URL and that it's deployed.";
    }
    smsTest.disabled = false;
  });

  // Asks the function what it can actually see, so a failure names itself
  // instead of being narrowed down by guesswork. No secret is returned — only
  // lengths, shapes, and Twilio's own verdict on the credentials.
  const smsCheck = slot.querySelector("#sms-check");
  if (smsCheck) smsCheck.addEventListener("click", async () => {
    const box = slot.querySelector("#sms-check-out");
    const user = backend.currentUser();
    const url = (store.getSettings().agentUrl || "").trim().replace(/\/+$/, "");
    if (!user) { box.textContent = "Sign in to your cloud account first"; return; }
    if (!url) { box.textContent = "Set the agent function URL first"; return; }
    smsCheck.disabled = true;
    box.textContent = "Checking…";
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smscheck: { u: user.id } }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.secrets) {
        box.innerHTML = `Couldn't check (${esc(d.error || res.status)}). If this says 404, the function hasn't been redeployed with the latest code yet.`;
        smsCheck.disabled = false;
        return;
      }
      const rows = [];
      const mark = (ok) => ok ? "✅" : "❌";
      const s = d.secrets;
      const shapeNote = (x) =>
        !x.set ? "not set at all" :
        x.hasQuotes ? `${x.length} chars — has quote marks around it, remove them` :
        x.hasWhitespace ? `${x.length} chars — has a stray space or newline, re-paste it` :
        x.looksRight ? `${x.length} chars, right shape` :
        `${x.length} chars — wrong shape`;
      rows.push(`${mark(s.TWILIO_ACCOUNT_SID.looksRight && !s.TWILIO_ACCOUNT_SID.hasWhitespace)} <b>Account SID</b> — ${esc(shapeNote(s.TWILIO_ACCOUNT_SID))}${
        s.TWILIO_ACCOUNT_SID.set && s.TWILIO_ACCOUNT_SID.startsWith !== "AC"
          ? ` (starts <span class="mono">${esc(s.TWILIO_ACCOUNT_SID.startsWith)}</span>, should start <span class="mono">AC</span>)` : ""}`);
      rows.push(`${mark(s.TWILIO_AUTH_TOKEN.looksRight && !s.TWILIO_AUTH_TOKEN.hasWhitespace)} <b>Auth token</b> — ${esc(shapeNote(s.TWILIO_AUTH_TOKEN))}`);
      rows.push(`${mark(s.TWILIO_FROM.looksRight)} <b>From number</b> — ${s.TWILIO_FROM.set ? `<span class="mono">${esc(s.TWILIO_FROM.value)}</span>${s.TWILIO_FROM.looksRight ? "" : " — needs to be like +19025550123"}` : "not set at all"}`);

      if (d.auth) {
        rows.push(d.auth.ok
          ? `✅ <b>Twilio accepted the credentials</b> — account “${esc(d.auth.friendlyName || "")}”, ${esc(d.auth.accountType || "")}, ${esc(d.auth.accountStatus || "")}`
          : `❌ <b>Twilio rejected the credentials</b>${d.auth.message ? ` — ${esc(d.auth.message)}` : ""}${d.auth.code ? ` (code ${d.auth.code})` : ""}`);
        if (d.auth.ok && /trial/i.test(d.auth.accountType || ""))
          rows.push(`⚠️ This is a <b>trial account</b> — it can only text numbers you've verified in Twilio, and it adds a trial prefix to every message. Upgrade before texting real customers.`);
        if (d.auth.ok && d.auth.accountStatus && !/active/i.test(d.auth.accountStatus))
          rows.push(`⚠️ The account is <b>${esc(d.auth.accountStatus)}</b>, not active — Twilio won't send until that's resolved.`);
      }
      if (d.number) {
        if (d.number.owned) {
          rows.push(`${mark(d.number.smsCapable)} <b>The number is on this account</b>${d.number.smsCapable ? " and can send SMS" : " but is NOT SMS-capable"}`);
          if (d.number.inMessagingService)
            rows.push(`⚠️ The number belongs to a <b>Messaging Service</b>. Sending still works, but its <i>inbound</i> webhook comes from the service — set the URL there, not on the number, or replies will never arrive.`);
          else if (d.number.smsUrl)
            rows.push(`Inbound webhook currently: <span class="mono" style="word-break:break-all">${esc(d.number.smsUrl)}</span>`);
          else
            rows.push(`⚠️ The number has <b>no inbound webhook set</b> — sending will work, but replies go nowhere.`);
        } else {
          rows.push(`❌ <b>${esc(d.number.note || "That number isn't on this account.")}</b>`);
        }
      }
      box.innerHTML = `<div style="line-height:1.6">${rows.join("<br>")}</div>`;
    } catch {
      box.textContent = "Couldn't reach the function.";
    }
    smsCheck.disabled = false;
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
function bookingCfg() {
  const s = store.getSettings();
  return {
    u: backend.currentUser().id,
    fn: (s.agentUrl || "").trim().replace(/\/+$/, ""),
    n: s.salesperson || "",
    d: s.dealership || "",
    h: [s.bookStart ?? 9, s.bookEnd ?? 19],
    slot: s.bookSlot || 30,
    days: s.bookDays || [1, 2, 3, 4, 5, 6],
  };
}

export function bookingLink() {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(bookingCfg()))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const base = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
  return `${base}/book.html?c=${b64}`;
}

// The short booking link is minted once and cached; a config change (hours,
// days, name) invalidates it and the next refresh mints a fresh code.
export function cachedShortBookingLink() {
  try {
    const c = store.getSettings().bookShort;
    if (!c || !c.code || !c.s || c.sig !== JSON.stringify(bookingCfg())) return null;
    return shortUrl("book.html", c.code, c.s);
  } catch {
    return null;
  }
}

export async function shortBookingLink() {
  const cached = cachedShortBookingLink();
  if (cached) return cached;
  try {
    const cfg = bookingCfg();
    const r = await shorten("book", cfg, { label: "Booking link" });
    if (!r) return null;
    store.updateSettings({ bookShort: { code: r.code, s: r.s, sig: JSON.stringify(cfg) } });
    return shortUrl("book.html", r.code, r.s);
  } catch {
    return null;
  }
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

  const applyLink = (link) => {
    const input = slot.querySelector("#bk-link");
    if (!input) return;
    input.value = link;
    const first = (store.getSettings().salesperson || "").split(" ")[0];
    slot.querySelector("#bk-sms").href = `sms:?&body=${encodeURIComponent(
      `Hi! ${first ? `It's ${first} — ` : ""}here's my calendar. Grab any time that works for you and I'll have everything ready when you come in:\n\n${link}`
    )}`;
    slot.querySelector("#bk-open").href = link;
  };
  const refreshLink = () => {
    // Long link right away so the field is never empty; the clean short link
    // replaces it as soon as the cloud hands back a code.
    applyLink(bookingLink());
    shortBookingLink().then((u) => { if (u) applyLink(u); });
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

// Push notifications — the agent's ability to start conversations: the
// morning play sheet, link-open alerts, and instant booking alerts.
function buildPush(slot) {
  const render = async () => {
    const on = await pushEnabled().catch(() => false);
    slot.innerHTML = `
      <div class="small muted" style="margin-bottom:10px">Turns entoa from an assistant into an agent: a morning "your plays today" push, an instant heads-up when a customer opens a link you sent, and a ping the moment someone books on your calendar — even with the app closed.</div>
      ${needsInstall() ? `<div class="hint" style="margin-bottom:10px">On iPhone, first add entoa to your Home Screen (Share → Add to Home Screen) — Apple only allows notifications for installed apps.</div>` : ""}
      <details class="cloud-setup" style="margin-bottom:12px">
        <summary class="strong small">${icon("help")} One-time server setup</summary>
        <ol class="small muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
          <li>Re-paste the latest <span class="mono">voice-agent/index.ts</span> into your Supabase function and deploy.</li>
          <li>In Supabase → Edge Functions → Secrets, add <span class="mono">VAPID_PUBLIC_KEY</span> and <span class="mono">VAPID_PRIVATE_KEY</span> (ask Claude for your generated pair, or run <span class="mono">npx web-push generate-vapid-keys</span>).</li>
          <li>For the morning push: Supabase → Integrations → Cron → new job, schedule <span class="mono">0 11 * * *</span> (8am Halifax), HTTP request to your function URL with body <span class="mono">{"plays":1}</span>.</li>
          <li>Come back here and tap <b>Turn on notifications</b>.</li>
        </ol>
      </details>
      <button class="btn ${on ? "btn-ghost" : "btn-primary"} btn-block" id="push-toggle">${on ? "Turn off on this device" : `${icon("bell")} Turn on notifications`}</button>
      ${on ? `<button class="btn btn-ghost btn-block" id="push-test" style="margin-top:10px">Send a test push</button>
      <div class="hint" style="margin-top:10px">${icon("checkline")} This device is registered.</div>` : ""}
    `;
    slot.querySelector("#push-toggle").addEventListener("click", async () => {
      try {
        if (on) { await disablePush(); toast("Notifications off on this device"); }
        else { await enablePush(); toast("Notifications on — the agent can reach you now", "success"); }
      } catch (e) {
        toast(e && e.message ? e.message : "Couldn't set up notifications", "danger");
      }
      render();
    });
    const test = slot.querySelector("#push-test");
    if (test) test.addEventListener("click", async () => {
      try {
        const sent = await sendTestPush();
        toast(sent ? `Sent to ${sent} device${sent === 1 ? "" : "s"} — check your notifications` : "No registered devices found yet — sync may still be running", sent ? "success" : "");
      } catch (e) {
        toast(e && e.message ? e.message : "Test failed", "danger");
      }
    });
  };
  render();
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
