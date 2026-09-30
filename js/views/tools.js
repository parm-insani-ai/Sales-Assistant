// Tools — everything that isn't the daily loop (Home, Leads, Today, Comms).
// One list, rendered as the lower half of the "+" sheet, so every tool is
// one tap from any screen and none of them needs a tab.

import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { openDealerSearch } from "./dealer.js";
import { canManage, setViewMode } from "../team.js";

export const TOOL_LINKS = [
  { icon: "users", label: "Team", fn: () => navigate("/team") },
  { icon: "megaphone", label: "Mass outreach", fn: () => navigate("/outreach") },
  { icon: "target", label: "Campaign", fn: () => navigate("/campaign") },
  { icon: "calendar", label: "Timing", fn: () => navigate("/horizon") },
  { icon: "calculator", label: "Calculator", fn: () => navigate("/calculator") },
  { icon: "compare", label: "Compare", fn: () => navigate("/compare") },
  { icon: "tag", label: "Specials", fn: () => navigate("/specials") },
  { icon: "search", label: "Inventory", fn: () => openDealerSearch() },
  { icon: "sparkles", label: "Sales Coach", fn: () => navigate("/coach") },
  { icon: "checkline", label: "Sold Tracker", fn: () => navigate("/soldlog") },
  { icon: "checkline", label: "Paycheck", fn: () => navigate("/pay") },
  { icon: "award", label: "SPIFs", fn: () => navigate("/spiffs") },
  { icon: "box", label: "Deliveries", fn: () => navigate("/deliveries") },
  { icon: "calendar", label: "Calendar", fn: () => navigate("/calendar") },
  { icon: "file", label: "Import", fn: () => navigate("/import") },
  { icon: "settings", label: "Settings", fn: () => navigate("/settings") },
];

// The tools for this person. A manager or admin who also sells can step
// over to the store's app from here.
export function toolLinks() {
  return canManage()
    ? [{ icon: "store", label: "Management view", fn: () => { setViewMode("manage"); location.hash = "#/"; location.reload(); } }, ...TOOL_LINKS]
    : TOOL_LINKS;
}

// Shared tile grid, used by the "+" sheet (and the store's own).
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
