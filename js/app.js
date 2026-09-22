// App bootstrap: routing, page titles, quick-add menu, service worker.

import { route, startRouter, currentBase, navigate } from "./router.js";
import * as store from "./store.js";
import { interceptSmsLinks } from "./sms.js";
import { initViewport } from "./viewport.js";
import { initPullToRefresh } from "./pulltorefresh.js";
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
import { autoSendDueEmails, autoSendAppointmentReminders, isSetupError } from "./email.js";
import { reconcileLinks } from "./connections.js";
import { adaptToReplies } from "./cadence.js";
import { reviewTouch } from "./touches.js";
import { assessAll } from "./assess.js";
import { handleAuthRedirect, pullMailIfStale } from "./msmail.js";
import * as backend from "./backend.js";
import { showLogin } from "./login.js";
import { claimDevice } from "./account.js";
import { initSaveState } from "./savestate.js";
import { needsInstall } from "./push.js";

// Register the service worker and keep the app auto-updating to new deploys.
// First, before anything that waits: the sign-in door below can hold the
// boot for as long as it takes to type a password, and a worker registered
// only after that is a worker a fresh install may never get.
initAutoUpdate();

// The store loads from IndexedDB, which is asynchronous. Nothing below reads
// or writes it until it's ready — a route rendering against an empty store
// would show a blank app for the half-second the load takes, then flicker.
await store.ready;

// Signed out means the front door, not the app. Everything after this line
// runs only for someone who is signed in — a session already on the device,
// or one just made at the door.
if (!backend.isSignedIn()) await showLogin();

// The book on this phone belongs to whoever is signed in. A different
// account than last time starts with an empty one — their own comes down
// from the cloud on the first sync.
try { claimDevice(backend.currentUser()); } catch { }

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
  // Where a "your text is ready" notification lands: draft the step for its
  // customer and open the conversation with it in the box. Not a screen of
  // its own — it hands straight over.
  "/review": { title: "Review", render: (view, { param }) => { reviewTouch(param); } },
};

function mount(base, ctx) {
  const page = PAGES[base] || PAGES["/"];
  view.innerHTML = "";
  // The view is the scroll container, so resetting it IS resetting the page.
  view.className = "view";
  view.scrollTop = 0;
  // A view may replace the title and put its own controls in the bar (a
  // conversation shows the customer's name and a call button). Put both back
  // to the defaults first, so leaving that screen doesn't strand them.
  document.getElementById("topbar-actions").querySelectorAll(":scope > :not(#quick-add)")
    .forEach((n) => n.remove());
  document.getElementById("quick-add").hidden = false;
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

// In Safari on an iPhone, viniva is a second copy: iOS gives Safari and the
// Home Screen app separate storage, so a contact logged here shows up in
// the other only once it syncs — which reads as "it didn't save". Say so,
// once per visit, and point at the one copy that also gets notifications.
if (needsInstall()) {
  try {
    if (!sessionStorage.getItem("viniva:safari-note")) {
      const note = document.createElement("div");
      note.className = "install-note";
      note.innerHTML = `<div><b>You're in Safari.</b> This is a separate copy of viniva from the Home Screen app — use the Home Screen icon so there's one. Not added yet? Share → Add to Home Screen.</div><button type="button" class="btn btn-ghost btn-sm">Got it</button>`;
      note.querySelector("button").addEventListener("click", () => { note.remove(); try { sessionStorage.setItem("viniva:safari-note", "1"); } catch { } });
      document.getElementById("app").insertBefore(note, document.getElementById("view"));
    }
  } catch { }
}

// Tell the server this device's timezone and quiet hours, so the proactive
// sweep can notify at sensible times, and mirror the settings to the cloud,
// so an install that predates the mirror backs itself up the first time it
// opens rather than waiting for a settings edit that may never come.
//
// Not before this device's first sync for the account, though. A fresh
// install holds only defaults, and a mirror written now would be newer than
// the real one in the cloud — so the pull would skip the real one and the
// push would replace it. The first sync mirrors once the pull is in.
if (!backend.isSignedIn() || sync.initializedFor() === backend.currentUser()?.id) {
  try { store.publishPrefs(); } catch { }
  try { store.publishConfig(); } catch { }
}

// Track the visible viewport so the tab bar and the reply row follow the
// keyboard instead of being left behind by it. Has to run before the first
// render so --vvh exists when the CSS first asks for it.
initViewport();

// Pull down to refresh. Inbound texts are written on the server and only reach
// this device on a pull, so "is there anything new" has to be answerable by
// hand and not only by the 20-second poll.
initPullToRefresh();

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

// Wrapped, not passed directly: the click event would arrive as the options
// argument.
document.getElementById("voice-btn").addEventListener("click", () => startVoiceAssistant());

startRouter();

// Read the book while nothing else is happening, so the first visit to Leads
// (sorted by that read) opens as fast as the second. It's cached until
// something it reads changes; a cold read of three thousand people is a few
// hundred milliseconds that shouldn't be paid on a tap.
setTimeout(() => { try { assessAll(); } catch {} }, 2500);

// Start cloud sync if it's configured and signed in (no-op otherwise).
sync.init();
// And the word in the top bar that says every action is saved and synced.
initSaveState();

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
window.addEventListener("viniva-mail", (e) => {
  const n = e.detail && e.detail.linked;
  if (n) toast(`${n} customer email${n === 1 ? "" : "s"} filed from Outlook`, "success");
});

// Automated cadence emails + appointment reminder emails (optional): send
// anything due, quietly, on open.
autoSendDueEmails().then(async (r) => {
  const r2 = await autoSendAppointmentReminders().catch(() => ({ sent: 0, errors: [] }));
  const sent = (r.sent || 0) + (r2.sent || 0);
  const errs = (r.errors || []).concat(r2.errors || []);
  if (sent) return toast(`${sent} email${sent === 1 ? "" : "s"} sent automatically`, "success");
  if (!errs.length) return;
  // A missing server secret isn't news — it's the same on every launch, and
  // the emails stay due, so this fired on every single open. Setup problems
  // are reported where the setting lives (Comms → Email, and Settings); only
  // genuine send failures are worth interrupting for, and even those at most
  // once a day so one bad address doesn't nag forever.
  if (isSetupError(errs[0])) return;
  const key = "viniva:autoemail-warned";
  const last = Number(localStorage.getItem(key) || 0);
  if (Date.now() - last < 24 * 3600 * 1000) return;
  try { localStorage.setItem(key, String(Date.now())); } catch { }
  toast(`Auto-email: ${errs[0]}`, "danger");
}).catch(() => {});

// New synced records (e.g. a customer self-booking from the booking page) get
// linked into the connected graph as soon as they arrive.
window.addEventListener("viniva-sync", (e) => {
  if (e.detail && e.detail.status === "synced" && e.detail.applied) {
    try { reconcileLinks(); } catch {}
    // A customer who replied is in a conversation; their plan steps back.
    try { adaptToReplies(); } catch {}
  }
});
try { adaptToReplies(); } catch {}
