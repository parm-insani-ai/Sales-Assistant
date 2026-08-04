// Small formatting + helper utilities shared across views.

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function currency(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function currency2(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(n) {
  return (Number(n) || 0).toLocaleString("en-US");
}

// Format a phone number as a clickable tel: friendly display.
export function phoneDisplay(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return p || "";
}

export function telHref(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d ? `tel:${d}` : "#";
}

export function smsHref(p, body = "") {
  const d = String(p || "").replace(/\D/g, "");
  if (!d) return "#";
  return `sms:${d}${body ? `?&body=${encodeURIComponent(body)}` : ""}`;
}

// --- Dates ---
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function parseDate(iso) {
  if (!iso) return null;
  // Treat a date-only string as local midnight to avoid TZ drift.
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  if (!y) return null;
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Whole-day difference from today (negative = past).
export function daysFromToday(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  return Math.round((d - startOfToday()) / 86400000);
}

export function relativeDay(iso) {
  const diff = daysFromToday(iso);
  if (diff === null) return "";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  if (diff < 7) return `In ${diff} days`;
  return formatDate(iso);
}

export function formatDate(iso) {
  const d = parseDate(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return formatDate(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Escape user text before inserting via innerHTML.
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
}

// Simple debounce for search inputs.
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
