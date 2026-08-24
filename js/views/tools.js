// Tools hub — one launcher for every utility in the app, so nothing is buried.

import { navigate } from "../router.js";
import { openDealerSearch } from "./dealer.js";
import { esc } from "../utils.js";
import { icon } from "../icons.js";

const TOOLS = [
  { icon: "calculator", label: "Deal Calculator", sub: "Payments, tax, term", go: () => navigate("/calculator") },
  { icon: "dollar", label: "Deal Radar", sub: "Who can trade up now", go: () => navigate("/deals") },
  { icon: "compare", label: "Compare vehicles", sub: "Side-by-side specs", go: () => navigate("/compare") },
  { icon: "award", label: "SPIF organizer", sub: "Track bonus money", go: () => navigate("/spiffs") },
  { icon: "tag", label: "Monthly specials", sub: "APR / lease / cash", go: () => navigate("/specials") },
  { icon: "target", label: "Prospecting", sub: "Today's call list", go: () => navigate("/prospecting") },
  { icon: "dollar", label: "Goals & commission", sub: "Month-to-date", go: () => navigate("/goals") },
  { icon: "checkline", label: "Sold Tracker", sub: "Full deal log & summaries", go: () => navigate("/soldlog") },
  { icon: "search", label: "Search inventory", sub: "Find a car for a customer", go: () => openDealerSearch() },
  { icon: "file", label: "Import spreadsheet", sub: "Customers & inventory", go: () => navigate("/import") },
  { icon: "calendar", label: "Calendar", sub: "Appointments", go: () => navigate("/calendar") },
];

export function renderTools(view) {
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="section-title" style="margin-top:2px">Sales tools</div>
    <div class="tool-grid"></div>
  `;
  view.appendChild(el);

  const grid = el.querySelector(".tool-grid");
  TOOLS.forEach((t) => {
    const tile = document.createElement("button");
    tile.className = "tool-tile card card-tap";
    tile.innerHTML = `
      <span class="tool-ico">${icon(t.icon, "ico-lg")}</span>
      <span class="tool-label">${esc(t.label)}</span>
      <span class="tool-sub muted small">${esc(t.sub)}</span>`;
    tile.addEventListener("click", t.go);
    grid.appendChild(tile);
  });
}
