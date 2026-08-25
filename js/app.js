// App bootstrap: routing, page titles, quick-add menu, service worker.

import { route, startRouter, currentBase, navigate } from "./router.js";
import { openModal, toast } from "./components.js";
import { icon } from "./icons.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderLeads, openLeadForm } from "./views/leads.js";
import { renderInventory, openVehicleForm } from "./views/inventory.js";
import { renderCalculator } from "./views/calculator.js";
import { renderDeliveries, openDeliveryForm } from "./views/deliveries.js";
import { renderSettings } from "./views/settings.js";
import { openTaskForm } from "./views/tasks.js";
import { renderCalendar, openAppointmentForm } from "./views/calendar.js";
import { renderGoals, openSaleForm } from "./views/goals.js";
import { renderImport } from "./views/import.js";
import { openDealerSearch } from "./views/dealer.js";
import { renderProspecting } from "./views/prospecting.js";
import { openReferralCapture } from "./views/referrals.js";
import { renderDeals } from "./views/dealbuilder.js";
import { renderSpiffs, openSpifForm } from "./views/spiffs.js";
import { renderSpecials } from "./views/specials.js";
import { renderCompare } from "./views/compare.js";
import { renderComms } from "./views/comms.js";
import { renderSoldLog, openDealForm } from "./views/soldlog.js";
import { renderCoach } from "./views/coach.js";
import { startVoiceAssistant } from "./voice.js";
import * as sync from "./sync.js";
import { initAutoUpdate } from "./updater.js";
import { autoSendDueEmails, autoSendAppointmentReminders } from "./email.js";
import { reconcileLinks } from "./connections.js";
import { handleAuthRedirect, pullMailIfStale } from "./msmail.js";

const view = document.getElementById("view");
const title = document.getElementById("page-title");

const PAGES = {
  "/": { title: "Dashboard", render: renderDashboard },
  "/leads": { title: "Leads", render: renderLeads },
  "/inventory": { title: "Inventory", render: renderInventory },
  "/calculator": { title: "Deal Calculator", render: renderCalculator },
  "/deliveries": { title: "Deliveries", render: renderDeliveries },
  "/calendar": { title: "Calendar", render: renderCalendar },
  "/goals": { title: "Goals & Commission", render: renderGoals },
  "/prospecting": { title: "Prospecting", render: renderProspecting },
  "/deals": { title: "Deal Radar", render: renderDeals },
  "/spiffs": { title: "SPIF Organizer", render: renderSpiffs },
  "/specials": { title: "Monthly Specials", render: renderSpecials },
  "/compare": { title: "Compare Vehicles", render: renderCompare },
  "/comms": { title: "Communication", render: renderComms },
  "/soldlog": { title: "Sold Tracker", render: renderSoldLog },
  "/coach": { title: "Sales Coach", render: renderCoach },
  "/import": { title: "Import", render: renderImport },
  "/settings": { title: "Settings", render: renderSettings },
};

function mount(base, ctx) {
  const page = PAGES[base] || PAGES["/"];
  view.innerHTML = "";
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  // Detail pages set their own contextual title inside the view.
  title.textContent = ctx.param ? detailTitle(base) : page.title;
  page.render(view, ctx);
  updateTabs(base);
}

function detailTitle(base) {
  return { "/leads": "Lead", "/inventory": "Vehicle", "/deliveries": "Delivery", "/calendar": "Appointment" }[base] || "Details";
}

function updateTabs(base) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.route === base));
}

// Register every page under one handler set.
Object.keys(PAGES).forEach((base) => {
  route(base, (ctx) => mount(base, ctx));
});

// Quick-add: context-aware based on the current tab. One modal holds
// everything — the add-a-record actions up top, every tool below. There is
// deliberately no separate Tools screen.
document.getElementById("quick-add").addEventListener("click", () => {
  const base = currentBase();
  const byKey = {
    lead: { icon: "users", label: "New lead", fn: () => openLeadForm() },
    referral: { icon: "users", label: "Add a referral", fn: () => openReferralCapture() },
    task: { icon: "check", label: "New to-do", fn: () => openTaskForm() },
    appt: { icon: "calendar", label: "New appointment", fn: () => openAppointmentForm() },
    sale: { icon: "dollar", label: "Log a sale", fn: () => openSaleForm() },
    soldlog: { icon: "checkline", label: "Sold Tracker (full deal)", fn: () => openDealForm(null, () => navigate("/soldlog")) },
    vehicle: { icon: "car", label: "Add vehicle", fn: () => openVehicleForm() },
    delivery: { icon: "box", label: "New delivery", fn: () => openDeliveryForm() },
    spif: { icon: "award", label: "Add a spif", fn: () => openSpifForm() },
  };
  const TOOL_LINKS = [
    { icon: "calculator", label: "Deal Calculator", fn: () => navigate("/calculator") },
    { icon: "dollar", label: "Deal Radar", fn: () => navigate("/deals") },
    { icon: "compare", label: "Compare vehicles", fn: () => navigate("/compare") },
    { icon: "sparkles", label: "Sales Coach", fn: () => navigate("/coach") },
    { icon: "checkline", label: "Sold Tracker", fn: () => navigate("/soldlog") },
    { icon: "target", label: "Prospecting", fn: () => navigate("/prospecting") },
    { icon: "dollar", label: "Goals & commission", fn: () => navigate("/goals") },
    { icon: "award", label: "SPIF organizer", fn: () => navigate("/spiffs") },
    { icon: "tag", label: "Monthly specials", fn: () => navigate("/specials") },
    { icon: "search", label: "Search inventory", fn: () => openDealerSearch() },
    { icon: "calendar", label: "Calendar", fn: () => navigate("/calendar") },
    { icon: "file", label: "Import spreadsheet", fn: () => navigate("/import") },
    { icon: "settings", label: "Settings", fn: () => navigate("/settings") },
  ];
  // The most relevant add-action for the current tab goes first.
  const primaryFor = { "/leads": "lead", "/": "task", "/inventory": "vehicle", "/deliveries": "delivery", "/calendar": "appt", "/goals": "sale", "/soldlog": "soldlog", "/spiffs": "spif" };
  const order = ["lead", "referral", "task", "appt", "sale", "soldlog", "vehicle", "delivery", "spif"];
  const first = primaryFor[base];
  const keys = first ? [first, ...order.filter((k) => k !== first)] : order;
  const actions = keys.map((k) => byKey[k]);

  openModal("Quick add", (close) => {
    const wrap = document.createElement("div");
    actions.forEach((a) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-block";
      btn.style.cssText = "justify-content:flex-start;margin-bottom:10px;gap:12px";
      btn.innerHTML = `<span style="color:var(--brand);display:inline-flex">${icon(a.icon, "ico-lg")}</span>${a.label}`;
      btn.addEventListener("click", () => { close(); a.fn(); });
      wrap.appendChild(btn);
    });

    const title = document.createElement("div");
    title.className = "section-title";
    title.style.marginTop = "6px";
    title.textContent = "Tools";
    wrap.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "tool-grid";
    TOOL_LINKS.forEach((t) => {
      const tile = document.createElement("button");
      tile.className = "tool-tile card card-tap";
      tile.innerHTML = `
        <span class="tool-ico" style="color:var(--brand)">${icon(t.icon, "ico-lg")}</span>
        <span class="tool-label">${t.label}</span>`;
      tile.addEventListener("click", () => { close(); t.fn(); });
      grid.appendChild(tile);
    });
    wrap.appendChild(grid);
    return wrap;
  });
});

document.getElementById("voice-btn").addEventListener("click", startVoiceAssistant);

startRouter();

// Start cloud sync if it's configured and signed in (no-op otherwise).
sync.init();

// Register the service worker and keep the app auto-updating to new deploys.
initAutoUpdate();

// Heal any pre-linking records (sales/deliveries without a customer) so old
// data participates in the connected graph too.
try { reconcileLinks(); } catch {}

// Outlook inbox: finish an in-flight sign-in if Microsoft just redirected
// back, then pull new customer mail in the background.
handleAuthRedirect()
  .then((connected) => {
    if (connected) {
      toast("Outlook connected — pulling your mail", "success");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    pullMailIfStale();
  })
  .catch((e) => toast(`Outlook: ${e.message || "sign-in failed"}`, "danger"));
window.addEventListener("entoa-mail", (e) => {
  const n = e.detail && e.detail.linked;
  if (n) toast(`${n} customer email${n === 1 ? "" : "s"} filed from Outlook`, "success");
});

// Automated cadence emails + appointment reminder emails (optional): send
// anything due, quietly, on open.
autoSendDueEmails().then(async (r) => {
  const r2 = await autoSendAppointmentReminders().catch(() => ({ sent: 0, errors: [] }));
  const sent = (r.sent || 0) + (r2.sent || 0);
  const errs = (r.errors || []).concat(r2.errors || []);
  if (sent) toast(`${sent} email${sent === 1 ? "" : "s"} sent automatically`, "success");
  else if (errs.length) toast(`Auto-email: ${errs[0]}`, "danger");
}).catch(() => {});

// New synced records (e.g. a customer self-booking from the booking page) get
// linked into the connected graph as soon as they arrive.
window.addEventListener("entoa-sync", (e) => {
  if (e.detail && e.detail.status === "synced" && e.detail.applied) {
    try { reconcileLinks(); } catch {}
  }
});
