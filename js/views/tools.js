// Tools — everything that isn't the daily loop (Home, Leads, Today, Comms).
// One list, rendered as the lower half of the "+" sheet, so every tool is
// one tap from any screen and none of them needs a tab.

import { navigate } from "../router.js";
import { icon } from "../icons.js";
import { openDealerSearch } from "./dealer.js";
import { canManage, setViewMode } from "../team.js";

// The tools, in the groups a salesperson thinks in. TOOL_LINKS stays the
// flat list for anything that wants one.
export const TOOL_GROUPS = [
  { label: "Your book", items: [
    { icon: "tag", label: "Lists", fn: () => navigate("/lists") },
    { icon: "calendar", label: "Timing", fn: () => navigate("/horizon") },
    { icon: "dollar", label: "Deal Radar", fn: () => navigate("/deals") },
    { icon: "calendar", label: "Calendar", fn: () => navigate("/calendar") },
  ] },
  { label: "Follow up", items: [
    { icon: "sliders", label: "Follow-up plans", fn: () => navigate("/plans") },
    { icon: "megaphone", label: "Mass outreach", fn: () => navigate("/outreach") },
    { icon: "sparkles", label: "Sales Coach", fn: () => navigate("/coach") },
  ] },
  { label: "Deals", items: [
    { icon: "calculator", label: "Calculator", fn: () => navigate("/calculator") },
    { icon: "compare", label: "Compare", fn: () => navigate("/compare") },
    { icon: "tag", label: "Specials", fn: () => navigate("/specials") },
    { icon: "search", label: "Inventory", fn: () => openDealerSearch() },
    { icon: "box", label: "Deliveries", fn: () => navigate("/deliveries") },
    { icon: "check", label: "Delivered", fn: () => navigate("/delivered") },
  ] },
  { label: "Numbers", items: [
    { icon: "checkline", label: "Sold Tracker", fn: () => navigate("/soldlog") },
    { icon: "target", label: "Performance", fn: () => navigate("/performance") },
    { icon: "checkline", label: "Paycheck", fn: () => navigate("/pay") },
    { icon: "award", label: "SPIFs", fn: () => navigate("/spiffs") },
  ] },
  { label: "Setup", items: [
    { icon: "file", label: "Import", fn: () => navigate("/import") },
    { icon: "users", label: "Team", fn: () => navigate("/team") },
  ] },
];
export const TOOL_LINKS = TOOL_GROUPS.flatMap((g) => g.items);

// The tools for this person. A manager or admin who also sells can step
// over to the store's app from here.
const manageTile = () => ({ icon: "store", label: "Management view", fn: () => { setViewMode("manage"); location.hash = "#/"; location.reload(); } });
export function toolLinks() {
  return canManage() ? [manageTile(), ...TOOL_LINKS] : TOOL_LINKS;
}
/** The groups for the "+" sheet; a manager who also sells gets the store's app first. */
export function toolGroups() {
  return canManage() ? [{ label: "The store", items: [manageTile()] }, ...TOOL_GROUPS] : TOOL_GROUPS;
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
