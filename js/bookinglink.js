// The self-serve booking link: customers book their own slot from it and the
// appointment lands in the cloud and syncs into the app. On its own here
// because the reply drafter, the touch reviewer, the campaign and the
// comparison page all send it, and none of them should have to load the
// Settings screen to do so.
import * as store from "./store.js";
import * as backend from "./backend.js";
import { shorten, shortUrl } from "./shortlink.js";

// Self-serve booking page: customers book their own slot from a link; the
// appointment lands in the cloud and syncs into the app.
export function bookingCfg() {
  const s = store.getSettings();
  return {
    u: backend.currentUser().id,
    fn: (s.agentUrl || "").trim().replace(/\/+$/, ""),
    n: s.salesperson || "",
    d: s.dealership || "",
    h: [s.bookStart ?? 9, s.bookEnd ?? 19],
    slot: s.bookSlot || 30,
    days: s.bookDays || [1, 2, 3, 4, 5, 6],
  };
}

export function bookingLink() {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(bookingCfg()))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const base = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
  return `${base}/book.html?c=${b64}`;
}

// The short booking link is minted once and cached; a config change (hours,
// days, name) invalidates it and the next refresh mints a fresh code.
export function cachedShortBookingLink() {
  try {
    const c = store.getSettings().bookShort;
    if (!c || !c.code || !c.s || c.sig !== JSON.stringify(bookingCfg())) return null;
    return shortUrl("book.html", c.code, c.s);
  } catch {
    return null;
  }
}

export async function shortBookingLink() {
  const cached = cachedShortBookingLink();
  if (cached) return cached;
  try {
    const cfg = bookingCfg();
    const r = await shorten("book", cfg, { label: "Booking link" });
    if (!r) return null;
    store.updateSettings({ bookShort: { code: r.code, s: r.s, sig: JSON.stringify(cfg) } });
    return shortUrl("book.html", r.code, r.s);
  } catch {
    return null;
  }
}

// A booking link that belongs to one customer.
//
// The shared link can't answer the question that makes link tracking worth
// having — WHO just opened it. Every customer who ever received it looks
// identical, so "your booking link was opened" names nobody and there's no one
// to follow up. A per-customer link carries leadId in its metadata, so an open
// arrives attached to a person and their thread can say so.
//
// Cached on the lead, and re-minted if the booking config changes (hours, days,
// slot length) so a stale link can't offer times you no longer work.
export async function bookingLinkForLead(lead) {
  if (!lead) return null;
  const cfg = bookingCfg();
  const sig = JSON.stringify(cfg);
  const cached = lead.bookLink;
  if (cached && cached.code && cached.s && cached.sig === sig) {
    return shortUrl("book.html", cached.code, cached.s);
  }
  try {
    const r = await shorten("book", cfg, {
      label: `Booking link — ${String(lead.name || "customer").split(" ")[0]}`,
      leadId: lead.id,
    });
    if (!r) return shortBookingLink(); // no cloud: fall back to the shared one
    store.update("leads", lead.id, { bookLink: { code: r.code, s: r.s, sig } });
    return shortUrl("book.html", r.code, r.s);
  } catch {
    return shortBookingLink();
  }
}

