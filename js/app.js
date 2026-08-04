// App bootstrap: routing, page titles, quick-add menu, service worker.

import { route, startRouter, currentBase, navigate } from "./router.js";
import { openModal } from "./components.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderLeads, openLeadForm } from "./views/leads.js";
import { renderInventory, openVehicleForm } from "./views/inventory.js";
import { renderCalculator } from "./views/calculator.js";
import { renderDeliveries, openDeliveryForm } from "./views/deliveries.js";
import { renderSettings } from "./views/settings.js";
import { openTaskForm } from "./views/tasks.js";

const view = document.getElementById("view");
const title = document.getElementById("page-title");

const PAGES = {
  "/": { title: "Dashboard", render: renderDashboard },
  "/leads": { title: "Leads", render: renderLeads },
  "/inventory": { title: "Inventory", render: renderInventory },
  "/calculator": { title: "Deal Calculator", render: renderCalculator },
  "/deliveries": { title: "Deliveries", render: renderDeliveries },
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
  return { "/leads": "Lead", "/inventory": "Vehicle", "/deliveries": "Delivery" }[base] || "Details";
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
    lead: { icon: "👥", label: "New lead", fn: () => openLeadForm() },
    task: { icon: "✅", label: "New to-do", fn: () => openTaskForm() },
    vehicle: { icon: "🚗", label: "Add vehicle", fn: () => openVehicleForm() },
    delivery: { icon: "📦", label: "New delivery", fn: () => openDeliveryForm() },
    calc: { icon: "🧮", label: "Deal calculator", fn: () => navigate("/calculator") },
  };
  // The most relevant action for the current tab goes first.
  const primaryFor = { "/leads": "lead", "/": "task", "/inventory": "vehicle", "/deliveries": "delivery", "/calculator": "calc" };
  const order = ["lead", "task", "vehicle", "delivery", "calc"];
  const first = primaryFor[base];
  const keys = first ? [first, ...order.filter((k) => k !== first)] : order;
  const actions = keys.map((k) => byKey[k]);
  actions.push({ icon: "⚙️", label: "Settings", fn: () => navigate("/settings") });

  openModal("Quick add", (close) => {
    const wrap = document.createElement("div");
    actions.forEach((a) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost btn-block";
      btn.style.justifyContent = "flex-start";
      btn.style.marginBottom = "10px";
      btn.innerHTML = `<span style="font-size:1.3rem;margin-right:6px">${a.icon}</span> ${a.label}`;
      btn.addEventListener("click", () => { close(); a.fn(); });
      wrap.appendChild(btn);
    });
    return wrap;
  });
});

startRouter();

// Register service worker for offline / installability.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
