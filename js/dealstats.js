// The deal math behind the Sold Tracker, the Performance screen and the
// tracker export — one place, so a number on screen is the number in the
// sheet. The "Vehicles Sold Track" sheet is the template: its columns, its
// summary panels (New / Used / Total, business managers, manufacturers,
// models, type of lead) and its fixed brand and model lists live here, and
// trackerSheet() fills that template from the app's deals.

export const LEAD_TYPES = ["Walk-in", "Hand Off", "Referral", "Facebook", "BDC", "Service", "Auto Alert", "Other"];
export const MAKE_READY = [
  ["file", "File"], ["etch", "ETCH"], ["gas", "Gas"], ["mvi", "MVI"],
  ["clean", "Clean"], ["ncar", "NCAR"], ["nvis", "NVIS"],
];
// The sheet's manufacturer and model panels list these whether or not a
// deal was done — the zeros are part of the read.
export const SHEET_BRANDS = ["Nissan", "Toyota", "Ford", "Honda", "Chevrolet", "Cadillac", "KIA", "Chrysler", "Mitsubishi", "Infiniti", "VW", "Mazda", "BMW", "Hyundai", "Audi"];
export const SHEET_MODELS = ["Kicks Play", "Kicks", "Murano", "Rogue", "Pathfinder", "Sentra", "Versa", "Armada", "Frontier", "Altima", "LEAF", "Ariya", "Qashqai", "Micra", "Maxima"];

// Commission on a deal: front + business office when tracked separately,
// otherwise whatever the simple form recorded.
const nNum = (v) => (v == null || v === "" ? null : Number(v) || 0);
export function dealTotal(s) {
  const f = nNum(s.frontComm), b = nNum(s.boComm);
  if (f != null || b != null) return (f || 0) + (b || 0);
  return nNum(s.commission) || 0;
}
export const dealFront = (s) => nNum(s.frontComm) ?? nNum(s.commission) ?? 0;
export const dealBO = (s) => nNum(s.boComm) ?? 0;
export const dealGross = (s) => nNum(s.bizGross) ?? 0;

const r2 = (v) => Math.round(v * 100) / 100;
export const avgOf = (arr, fn) => (arr.length ? r2(arr.reduce((t, s) => t + fn(s), 0) / arr.length) : 0);
export const sumOf = (arr, fn) => r2(arr.reduce((t, s) => t + fn(s), 0));

// Group deals by a key, biggest group first. Keys that match a fixed
// list keep the list's order and show zeros.
export function groupDeals(deals, fn, fixed = null) {
  const m = new Map();
  (fixed || []).forEach((k) => m.set(k, []));
  deals.forEach((s) => { const k = fn(s); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
  const rows = [...m.entries()];
  return fixed ? rows : rows.sort((a, b) => b[1].length - a[1].length);
}
// A brand or model the way the sheet spells it, so "nissan" and "Nissan"
// are one row and "Hyuindai" on the old sheet still lands on Hyundai.
const canon = (v, list) => { const q = String(v || "").trim().toLowerCase(); return list.find((x) => x.toLowerCase() === q) || String(v || "").trim(); };
export const brandOf = (s) => canon(s.brand, SHEET_BRANDS);
export const modelOf = (s) => canon(s.model, SHEET_MODELS);

/**
 * Everything the sheet's panels say about a set of deals.
 */
export function dealSummary(deals) {
  const news = deals.filter((s) => s.newUsed === "New");
  const useds = deals.filter((s) => s.newUsed === "Used");
  const pct = (n) => (deals.length ? r2((n / deals.length) * 100) : 0);
  const nu = (fn) => ({ New: fn(news), Used: fn(useds), Total: fn(deals) });
  return {
    count: deals.length, news: news.length, useds: useds.length,
    share: nu((a) => pct(a.length)),
    avgFront: nu((a) => avgOf(a, dealFront)),
    frontTotal: nu((a) => sumOf(a, dealFront)),
    avgBO: nu((a) => avgOf(a, dealBO)),
    avgTotal: nu((a) => avgOf(a, dealTotal)),
    total: sumOf(deals, dealTotal), front: sumOf(deals, dealFront), bo: sumOf(deals, dealBO), gross: sumOf(deals, dealGross),
    avgDeal: avgOf(deals, dealTotal),
    byLead: groupDeals(deals, (s) => s.leadType || "", LEAD_TYPES).map(([k, arr]) => ({ type: k, deals: arr.length, total: sumOf(arr, dealTotal), avg: avgOf(arr, dealTotal), pct: pct(arr.length) })),
    untyped: deals.filter((s) => !s.leadType).length,
    byBM: groupDeals(deals, (s) => s.bm || "").map(([k, arr]) => ({ bm: k, deals: arr.length, total: sumOf(arr, dealBO), avg: avgOf(arr, dealBO) })),
    byBrand: groupDeals(deals, brandOf, SHEET_BRANDS).map(([k, arr]) => ({ brand: k, deals: arr.length })),
    byModel: groupDeals(deals, modelOf, SHEET_MODELS).map(([k, arr]) => ({ model: k, deals: arr.length, news: arr.filter((s) => s.newUsed === "New").length, useds: arr.filter((s) => s.newUsed === "Used").length })),
  };
}

// The sheet's columns, in its order.
export const SHEET_COLUMNS = ["Month", "Deal", "Type", "Name", "Phone", "Brand", "Model", "Trim", "KMS", "Year", "Type", "Stock",
  ...MAKE_READY.map(([, lb]) => lb), "VIN", "Etch", "Delivered", "BM", "Front Commission", "Business Gross", "B. Off Comm", "Total Comm", "Notes"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const n = (v) => { const x = Number(v); return v == null || v === "" || !isFinite(x) ? "" : x; };
const prettyPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || ""); };

/**
 * The "Vehicles Sold Track" sheet, filled in: the deal rows in the sheet's
 * columns, and the summary panels to the right where the sheet keeps them
 * — New / Used / Total, business managers, manufacturers, models, type of
 * lead. `leads` fills the phone column; `plate` is the "My Plate =" header.
 * Returns { name, rows, widths } for downloadXlsx.
 */
export function trackerSheet(deals, { leads = [], plate = "", title = "Vehicles Sold Track" } = {}) {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const sum = dealSummary(deals);
  const grid = [];
  const put = (r, c, v) => { while (grid.length <= r) grid.push([]); grid[r][c] = v; };
  const putRow = (r, c, vals) => vals.forEach((v, i) => put(r, c + i, v));

  // Header rows: the groups the sheet draws over its columns, then the columns.
  putRow(0, 3, ["Customer"]); putRow(0, 5, ["Vehicle"]); putRow(0, 12, ["Make Ready"]); putRow(0, 21, [`My Plate = ${plate || ""}`]);
  putRow(1, 0, SHEET_COLUMNS);
  deals.forEach((s, i) => {
    const lead = s.leadId ? byId.get(s.leadId) : null;
    const d = String(s.saleDate || s.createdAt || "");
    const month = /^\d{4}-\d{2}/.test(d) ? MONTHS[Number(d.slice(5, 7)) - 1] : "";
    putRow(2 + i, 0, [
      month, i + 1, s.leadType || "", s.customerName || "", prettyPhone(s.phone || (lead && lead.phone) || ""),
      s.brand || "", s.model || "", s.trim || "", n(s.kms), n(s.year), s.newUsed || "", s.stock || "",
      ...MAKE_READY.map(([k]) => (s.makeReady && s.makeReady[k] ? "✓" : "")),
      s.vin || "", s.etchNo || "", s.deliveredAt || "", s.bm || "",
      n(s.frontComm), n(s.bizGross), n(s.boComm), r2(dealTotal(s)), s.notes || "",
    ]);
  });

  // The panels, down the right as the sheet has them.
  const P = SHEET_COLUMNS.length + 1;
  let r = 0;
  putRow(r++, P, ["New", "Used", "Total"]);
  putRow(r++, P, [sum.news, sum.useds, sum.count]);
  putRow(r++, P, [`${sum.share.New}%`, `${sum.share.Used}%`, "%"]);
  putRow(r++, P, [sum.avgFront.New, sum.avgFront.Used, "Av Com"]);
  putRow(r++, P, [sum.frontTotal.New, sum.frontTotal.Used, "Total Car Comm"]);
  putRow(r++, P, [sum.avgBO.New, sum.avgBO.Used, "Av B.O"]);
  putRow(r++, P, [sum.avgTotal.New, sum.avgTotal.Used, "Av Tot"]);
  r++;
  putRow(r++, P, ["B Manager", "Deals", "Average"]);
  sum.byBM.forEach((b) => putRow(r++, P, [b.bm, b.deals, b.avg]));
  r++;
  putRow(r++, P, ["Manufacturer", "Total"]);
  sum.byBrand.forEach((b) => putRow(r++, P, [b.brand, b.deals]));
  r++;
  putRow(r++, P, ["Model", "Total", "New", "Used"]);
  sum.byModel.forEach((m) => putRow(r++, P, [m.model, m.deals, m.news, m.useds]));
  r++;
  putRow(r++, P, ["Type of lead", "Sales", "Total", "Average", "%"]);
  sum.byLead.forEach((l) => putRow(r++, P, [l.type, l.deals, l.total, l.avg, `${l.pct}%`]));
  putRow(r++, P, ["", sum.count, sum.total, sum.avgDeal, sum.count ? "100%" : "0%"]);

  // Arrays with holes become empty cells; fill them so every row is a row.
  const width = Math.max(...grid.map((row) => row.length));
  const rows = grid.map((row) => Array.from({ length: width }, (_, i) => (row[i] === undefined ? "" : row[i])));
  const widths = [6, 5, 10, 20, 15, 10, 12, 10, 9, 6, 6, 10, ...MAKE_READY.map(() => 6), 19, 13, 11, 6, 12, 13, 12, 11, 28, 3, 16, 10, 12, 12, 8];
  return { name: title, rows, widths };
}
