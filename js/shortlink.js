// Short links for shared pages. Long links pack the whole payload into the URL
// (thousands of characters — ugly in a text message); short ones store the
// payload in the cloud via the agent function and send a 7-character code:
//   https://entoa.ai/compare.html?l=x7k2mfa&s=<host>~<function>
// The public page resolves ?l= against the function named in ?s=. Every caller
// must keep the long link as a fallback — shortening needs the network and a
// signed-in cloud account.

import * as store from "./store.js";
import * as backend from "./backend.js";

// Split an agent function URL into the pieces the ?s= parameter carries.
// (http is allowed so local test servers work; production is always https.)
export function fnParts(url) {
  const m = /^https?:\/\/([^/]+)\/functions\/v1\/([\w-]+)$/.exec((url || "").trim().replace(/\/+$/, ""));
  return m ? { host: m[1], fn: m[2] } : null;
}

// Store a payload and get back {code, s} for building short URLs, or null when
// shortening isn't possible (offline, not signed in, no agent function).
// `meta` (optional) labels the link — {label: "Rogue vs CR-V"} — so the app's
// link-activity panel can say which link got opened.
export async function shorten(kind, payload, meta) {
  try {
    const s = store.getSettings();
    const user = backend.currentUser();
    const parts = fnParts(s.agentUrl);
    if (!user || !user.id || !parts) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch((s.agentUrl || "").trim().replace(/\/+$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shorten: { u: user.id, kind, data: payload, meta: meta || undefined } }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || !j.code) return null;
    return { code: j.code, s: `${parts.host}~${parts.fn}` };
  } catch {
    return null;
  }
}

// Build the customer-facing short URL for a public page.
export function shortUrl(page, code, s) {
  const base = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
  return `${base}/${page}?l=${encodeURIComponent(code)}&s=${encodeURIComponent(s)}`;
}

// One-call convenience: shorten and return the finished URL (or null).
export async function shortenLink(page, kind, payload, meta) {
  const r = await shorten(kind, payload, meta);
  return r ? shortUrl(page, r.code, r.s) : null;
}
