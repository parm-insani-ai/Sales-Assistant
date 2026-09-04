// App bootstrap: routing, page titles, quick-add menu, service worker.

import { route, startRouter, currentBase, navigate } from "./router.js";
import * as store from "./store.js";
import { interceptSmsLinks } from "./sms.js";
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
import { renderTools, TOOL_LINKS, toolGrid } from "./views/tools.js";
import { renderCampaign } from "./views/campaign.js";
import { openReferralCapture } from "./views/referrals.js";
import { renderSpiffs, openSpifForm } from "./views/spiffs.js";
import { renderSpecials } from "./views/specials.js";
import { renderCompare } from "./views/compare.js";
import { renderComms } from "./views/comms.js";
import { renderInbox } from "./views/inbox.js";
import { renderSoldLog, openDealForm } from "./views/soldlog.js";
import { renderCoach } from "./views/coach.js";
import { renderPay } from "./views/pay.js";
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
  "/tools": { title: "Tools", render: renderTools },
  "/campaign": { title: "Campaign", render: renderCampaign },
  // Retired surfaces. The daily call list is the Home queue now, and the Deal
  // Radar is the "By opportunity" view of Leads — redirect rather than 404 so
  // old notifications, voice commands and bookmarks still land somewhere sane.
  "/prospecting": { title: "Prospecting", render: () => navigate("/") },
  "/deals": { title: "Deal Radar", render: () => {
    sessionStorage.setItem("leads-filter", "opportunity");
    navigate("/leads");
  } },
  "/spiffs": { title: "SPIF Organizer", render: renderSpiffs },
  "/specials": { title: "Monthly Specials", render: renderSpecials },
  "/compare": { title: "Compare Vehicles", render: renderCompare },
  "/comms": { title: "Communication", render: renderComms },
  "/inbox": { title: "Inbox", render: renderInbox },
  "/soldlog": { title: "Sold Tracker", render: renderSoldLog },
  "/coach": { title: "Sales Coach", render: renderCoach },
  "/pay": { title: "Paycheck", render: renderPay },
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
  return { "/leads": "Lead", "/inventory": "Vehicle", "/deliveries": "Delivery", "/calendar": "Appointment", "/inbox": "Conversation" }[base] || "Details";
}

function updateTabs(base) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.route === base));
}

// Register every page under one handler set.
Object.keys(PAGES).forEach((base) => {
  route(base, (ctx) => mount(base, ctx));
});

// Unread replies get a count on the Comms tab from anywhere in the app. A text
// answered in five minutes books far better than one answered in an hour, so
// this is the one thing worth interrupting whatever screen you're on.
function paintUnread() {
  const tab = document.querySelector('.tab[data-route="/comms"]');
  if (!tab) return;
  const n = store.unreadTexts().length;
  let dot = tab.querySelector(".tab-dot");
  if (!n) return dot && dot.remove();
  if (!dot) {
    dot = document.createElement("span");
    dot.className = "tab-dot";
    tab.appendChild(dot);
  }
  dot.textContent = n > 9 ? "9+" : String(n);
  dot.setAttribute("aria-label", `${n} unread ${n === 1 ? "reply" : "replies"}`);
}
store.subscribe(paintUnread);
paintUnread();

// With a texting number configured, every "Text" button in the app opens the
// conversation instead of handing off to the phone's messaging app — otherwise
// the customer's reply goes to a personal inbox the agent can't see.
interceptSmsLinks();

// Quick-add: context-aware based on the current tab. One modal holds
// everything — the add-a-record actions up top, every tool below — rendered
// as one uniform tile grid. There is deliberately no separate Tools screen.
document.getElementById("quick-add").addEventListener("click", () => {
  const base = currentBase();
  const byKey = {
    lead: { icon: "users", label: "Lead", fn: () => openLeadForm() },
    referral: { icon: "megaphone", label: "Referral", fn: () => openReferralCapture() },
    task: { icon: "check", label: "To-do", fn: () => openTaskForm() },
    appt: { icon: "calendar", label: "Appointment", fn: () => openAppointmentForm() },
    sale: { icon: "dollar", label: "Sale", fn: () => openSaleForm() },
    soldlog: { icon: "checkline", label: "Full deal", fn: () => openDealForm(null, () => navigate("/soldlog")) },
    vehicle: { icon: "car", label: "Vehicle", fn: () => openVehicleForm() },
    delivery: { icon: "box", label: "Delivery", fn: () => openDeliveryForm() },
    spif: { icon: "award", label: "Spif", fn: () => openSpifForm() },
  };
  // The most relevant add-action for the current tab goes first.
  const primaryFor = { "/leads": "lead", "/": "task", "/inventory": "vehicle", "/deliveries": "delivery", "/calendar": "appt", "/goals": "sale", "/soldlog": "soldlog", "/spiffs": "spif" };
  const order = ["lead", "referral", "task", "appt", "sale", "soldlog", "vehicle", "delivery", "spif"];
  const first = primaryFor[base];
  const keys = first ? [first, ...order.filter((k) => k !== first)] : order;

  openModal("Quick add", (close) => {
    const wrap = document.createElement("div");
    const section = (label, items) => {
      const title = document.createElement("div");
      title.className = "section-title";
      if (wrap.children.length) title.style.marginTop = "16px";
      else title.style.marginTop = "0";
      title.textContent = label;
      wrap.appendChild(title);
      wrap.appendChild(toolGrid(items, close));
    };
    section("Add new", keys.map((k) => byKey[k]));
    section("Tools", TOOL_LINKS);
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
