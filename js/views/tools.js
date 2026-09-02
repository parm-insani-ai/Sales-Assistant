// Tools — everything that isn't the daily loop (queue, customers, comms).
// One list, rendered both as this page and inside the "+" sheet, so a tool
// never exists in one place and not the other.

import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { openDealerSearch } from "./dealer.js";

export const TOOL_LINKS = [
  { icon: "calculator", label: "Calculator", fn: () => navigate("/calculator") },
  { icon: "compare", label: "Compare", fn: () => navigate("/compare") },
  { icon: "tag", label: "Specials", fn: () => navigate("/specials") },
  { icon: "search", label: "Inventory", fn: () => openDealerSearch() },
  { icon: "sparkles", label: "Sales Coach", fn: () => navigate("/coach") },
  { icon: "checkline", label: "Sold Tracker", fn: () => navigate("/soldlog") },
  { icon: "dollar", label: "Goals", fn: () => navigate("/goals") },
  { icon: "checkline", label: "Paycheck", fn: () => navigate("/pay") },
  { icon: "award", label: "SPIFs", fn: () => navigate("/spiffs") },
  { icon: "box", label: "Deliveries", fn: () => navigate("/deliveries") },
  { icon: "calendar", label: "Calendar", fn: () => navigate("/calendar") },
  { icon: "file", label: "Import", fn: () => navigate("/import") },
  { icon: "settings", label: "Settings", fn: () => navigate("/settings") },
];

// Shared tile grid, used by this page and the "+" sheet.
export function toolGrid(items, onPick) {
  const grid = document.createElement("div");
  grid.className = "qa-grid";
  items.forEach((a) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "qa-tile";
    tile.innerHTML = `<span class="qa-ico">${icon(a.icon)}</span><span class="qa-label">${a.label}</span>`;
    tile.addEventListener("click", () => { if (onPick) onPick(); a.fn(); });
    grid.appendChild(tile);
  });
  return grid;
}

export function renderTools(view) {
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="hero">
      <div class="hero-greeting">Tools</div>
      <div class="hero-title">Everything else</div>
    </div>
    <div class="fab-note" style="margin:0 2px 14px;text-align:left">Your day runs on Home, Leads and Comms. This is the rest — pricing, tracking and setup.</div>
    <div class="tools-slot"></div>
  `;
  view.appendChild(el);
  el.querySelector(".tools-slot").appendChild(toolGrid(TOOL_LINKS));
}
