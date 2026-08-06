// App bootstrap: routing, page titles, quick-add menu, service worker.

import { route, startRouter, currentBase, navigate } from "./router.js";
import { openModal } from "./components.js";
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
import { startVoiceAssistant } from "./voice.js";

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

// Quick-add: context-aware based on the current tab.
document.getElementById("quick-add").addEventListener("click", () => {
  const base = currentBase();
  const byKey = {
    lead: { icon: "users", label: "New lead", fn: () => openLeadForm() },
    prospect: { icon: "target", label: "Prospecting call list", fn: () => navigate("/prospecting") },
    referral: { icon: "users", label: "Add a referral", fn: () => openReferralCapture() },
    task: { icon: "check", label: "New to-do", fn: () => openTaskForm() },
    appt: { icon: "calendar", label: "New appointment", fn: () => openAppointmentForm() },
    sale: { icon: "dollar", label: "Log a sale", fn: () => openSaleForm() },
    vehicle: { icon: "car", label: "Add vehicle", fn: () => openVehicleForm() },
    delivery: { icon: "box", label: "New delivery", fn: () => openDeliveryForm() },
    calc: { icon: "calculator", label: "Deal calculator", fn: () => navigate("/calculator") },
    dealer: { icon: "search", label: "Search O'Regan's inventory", fn: () => openDealerSearch() },
    import: { icon: "file", label: "Import from spreadsheet", fn: () => navigate("/import") },
  };
  // The most relevant action for the current tab goes first.
  const primaryFor = { "/leads": "lead", "/": "task", "/inventory": "vehicle", "/deliveries": "delivery", "/calculator": "calc", "/calendar": "appt", "/goals": "sale" };
  const order = ["lead", "prospect", "referral", "task", "appt", "sale", "vehicle", "delivery", "calc", "dealer", "import"];
  const first = primaryFor[base];
  const keys = first ? [first, ...order.filter((k) => k !== first)] : order;
  const actions = keys.map((k) => byKey[k]);
  actions.push({ icon: "settings", label: "Settings", fn: () => navigate("/settings") });

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
    return wrap;
  });
});

document.getElementById("voice-btn").addEventListener("click", startVoiceAssistant);

startRouter();

// Register service worker for offline / installability.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
