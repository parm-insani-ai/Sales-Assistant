// Dealer inventory search launcher. A phone app can't read another site's
// inventory (cross-origin + bot protection), but it CAN deep-link straight into
// the dealer's own search — pre-filtered — which is what a salesperson needs on
// the lot. The network site is pre-filtered to Used to honor the rule that only
// used cars can be sold from other stores in the group.

import * as store from "../store.js";
import { openModal } from "../components.js";
import { esc } from "../utils.js";

export function storeSearchUrl() {
  const s = store.getSettings();
  return s.storeSiteUrl || "";
}

// Network search, pre-filtered to Used inventory.
export function networkUsedUrl() {
  const s = store.getSettings();
  if (!s.networkSiteUrl) return "";
  return s.networkSiteUrl + (s.networkUsedSuffix || "");
}

// context: optional { vehicleInterest, name } from a lead.
export function openDealerSearch(context = {}) {
  const s = store.getSettings();
  const want = (context.vehicleInterest || "").trim();

  openModal("Find inventory", (close) => {
    const wrap = document.createElement("div");
    const storeUrl = storeSearchUrl();
    const netUrl = networkUsedUrl();

    wrap.innerHTML = `
      ${want ? `<div class="card" style="border-color:var(--primary);margin-bottom:14px">
        <div class="small muted">${context.name ? esc(context.name) + " is looking for" : "Customer wants"}</div>
        <div class="strong" style="font-size:1.05rem">${esc(want)}</div>
      </div>` : ""}

      <a class="btn btn-primary btn-block" style="margin-bottom:10px" href="${esc(storeUrl)}" target="_blank" rel="noopener">
        🏬 Search ${esc(s.storeSiteName || "my store")} — all inventory
      </a>
      <a class="btn btn-success btn-block" href="${esc(netUrl)}" target="_blank" rel="noopener">
        🔎 Search ${esc(s.networkSiteName || "the network")} — used only
      </a>

      <div class="hint" style="margin-top:14px">
        Opens the dealer site in your browser. ${want ? `Narrow by <b>make &amp; model</b> on the site to find ${esc(want.split(" ").slice(-1)[0] || "the match")}.` : "Then filter by make, model and price on the site."}
        The network search is pre-set to <b>used</b> vehicles.
      </div>
    `;
    // Close the sheet after a link is tapped (the new tab opens over it).
    wrap.querySelectorAll("a[target=_blank]").forEach((a) =>
      a.addEventListener("click", () => setTimeout(close, 100)));
    return wrap;
  });
}
