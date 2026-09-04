// entoa's one Supabase Edge Function — four jobs, one URL:
//   POST {system, tools, messages}  → Claude relay for the voice agent.
//   POST {email: {to, subject, text}} → send a real email via Resend
//                                     (needs RESEND_API_KEY + EMAIL_FROM
//                                     secrets; optional).
//   GET  ?url=<calendar feed>       → CORS proxy for Apple/Outlook/Google
//                                     (.ics) feeds, which browsers can't
//                                     fetch cross-origin themselves.
//   GET  ?avail=1&u=<uid>&date=…    → booked time slots for the public
//   POST {book: {...}}                self-serve booking page, and booking a
//                                     slot: the appointment is written into
//                                     the salesperson's synced records so it
//                                     appears in their app on the next sync.
//   POST ?sms=1&u=<uid>             → inbound text webhook (Twilio, signed).
//   POST {sms: {u, to, body}}       → send a text from the dedicated number.
// The agent's brain (system prompt + tools) lives in the app, so it improves
// via normal app updates without redeploying this. No customer data is stored
// here.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (or set it in the
//     dashboard: Edge Functions → Secrets)
//   deploy the function and turn OFF "Verify JWT" so the app can call it.

import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Calendar hosts the proxy will fetch from (suffix match). Add your own if you
// use another provider.
const ICS_ALLOW = [
  "calendar.google.com",
  "icloud.com",       // p##-caldav.icloud.com, p##-calendars.icloud.com
  "me.com",
  "outlook.office365.com",
  "outlook.office.com",
  "outlook.live.com",
  "office.com",
  "calendar.yahoo.com",
];

async function proxyICS(req: Request): Promise<Response> {
  const reqUrl = new URL(req.url);
  // Calendar apps hand out webcal:// links — they're just https.
  const target = (reqUrl.searchParams.get("url") || "").replace(/^webcal:\/\//i, "https://");

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Bad or missing ?url", { status: 400, headers: CORS });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return new Response("Only http(s) feeds allowed", { status: 400, headers: CORS });
  }
  const host = parsed.hostname.toLowerCase();
  if (!ICS_ALLOW.some((h) => host === h || host.endsWith("." + h))) {
    return new Response(`Host not allowed: ${host}`, { status: 403, headers: CORS });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { "User-Agent": "entoa-ics-proxy", "Accept": "text/calendar, text/plain, */*" },
      redirect: "follow",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8" },
    });
  } catch (err) {
    return new Response(`Fetch failed: ${err}`, { status: 502, headers: CORS });
  }
}

// ---- Self-serve booking (records table via the service role) ----
function sbHeaders() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
function sbUrl(path: string) {
  return `${Deno.env.get("SUPABASE_URL") || ""}/rest/v1${path}`;
}

// Times already taken on one date, for the booking page's slot grid.
async function bookedTimes(uid: string, date: string): Promise<string[]> {
  const q = `/records?user_id=eq.${encodeURIComponent(uid)}&collection=eq.appointments&deleted=eq.false&select=data`;
  const res = await fetch(sbUrl(q), { headers: sbHeaders() });
  if (!res.ok) throw new Error(`availability lookup failed (${res.status})`);
  const rows = await res.json();
  return rows
    .map((r: any) => String(r.data?.when || ""))
    .filter((w: string) => w.startsWith(date) && w.includes("T"))
    .map((w: string) => w.slice(11, 16));
}

// ---- Web push (the agent's voice when the app is closed) ----
// Subscriptions live in the records table (collection "push", one row per
// device, written by the app). Needs secrets: VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, and optionally VAPID_SUBJECT (mailto:you@...).
let vapidConfigured = false;
function ensureVapid(): boolean {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  if (!vapidConfigured) {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:push@entoa.ai", pub, priv);
    vapidConfigured = true;
  }
  return true;
}

async function pushSubs(uid: string, errs?: string[]): Promise<any[]> {
  const q = `/records?user_id=eq.${encodeURIComponent(uid)}&collection=eq.push&deleted=eq.false&select=id,data`;
  const res = await fetch(sbUrl(q), { headers: sbHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = `subscription lookup failed (${res.status}): ${body.slice(0, 200)}`;
    console.error(detail);
    errs?.push(detail);
    return [];
  }
  return res.json();
}

// Send {title, body, url, tag} to every device the user registered.
// Dead subscriptions (404/410 from the push service) are tombstoned so we
// stop trying them. Returns how many devices accepted.
async function sendPush(uid: string, payload: Record<string, unknown>, errs?: string[]): Promise<number> {
  if (!ensureVapid()) { errs?.push("VAPID keys not configured"); return 0; }
  const rows = await pushSubs(uid, errs);
  if (!rows.length && !errs?.length) errs?.push(`no subscription rows for user ${uid.slice(0, 8)}`);
  let sent = 0;
  for (const row of rows) {
    const sub = row.data?.sub;
    if (!sub?.endpoint) { errs?.push(`row ${row.id}: no endpoint in stored subscription`); continue; }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
    } catch (e: any) {
      const code = e?.statusCode || 0;
      const detail = `push failed (${code || "no status"}): ${String(e?.body || e?.message || e).slice(0, 300)}`;
      console.error(detail);
      errs?.push(detail);
      if (code === 404 || code === 410) {
        fetch(sbUrl(`/records?id=eq.${encodeURIComponent(row.id)}&collection=eq.push`), {
          method: "PATCH", headers: sbHeaders(),
          body: JSON.stringify({ deleted: true, updated_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }
  }
  return sent;
}

// The morning play sheet: a scheduled job POSTs {plays:1} (Supabase
// Dashboard → Integrations → Cron). Every user with a registered device
// gets one summary push; the app computes the full ranked sheet on open.
async function handleMorningPlays(body: any): Promise<Response> {
  const cronKey = Deno.env.get("CRON_KEY");
  if (cronKey && body.key !== cronKey) return json({ error: "bad key" }, 403);
  if (!ensureVapid()) return json({ error: "VAPID keys not set" }, 500);

  const res = await fetch(sbUrl(`/records?collection=eq.push&deleted=eq.false&select=user_id`), { headers: sbHeaders() });
  if (!res.ok) return json({ error: `lookup failed (${res.status})` }, 502);
  const users = [...new Set(((await res.json()) as any[]).map((r) => r.user_id))];
  const today = new Date().toISOString().slice(0, 10);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let pushed = 0;

  for (const uid of users) {
    const rows = async (coll: string) => {
      const r = await fetch(
        sbUrl(`/records?user_id=eq.${encodeURIComponent(uid)}&collection=eq.${coll}&deleted=eq.false&select=data`),
        { headers: sbHeaders() });
      return r.ok ? (await r.json()).map((x: any) => x.data || {}) : [];
    };
    const appts = (await rows("appointments")).filter((a: any) =>
      a.status === "scheduled" && !a.outcome && String(a.when || "").startsWith(today));
    const unconfirmed = appts.filter((a: any) => !a.confirmed).length;
    const tasksDue = (await rows("tasks")).filter((t: any) =>
      !t.done && t.due && String(t.due).slice(0, 10) <= today).length;
    const links = (await rows("links")).filter((l: any) => l.lastOpenAt && l.lastOpenAt >= dayAgo);

    const bits: string[] = [];
    if (links.length) {
      const label = links[0]?.meta?.label;
      bits.push(label ? `${label} was opened overnight 👀` : `${links.length} link${links.length === 1 ? "" : "s"} opened overnight 👀`);
    }
    if (appts.length) bits.push(`${appts.length} appointment${appts.length === 1 ? "" : "s"} today${unconfirmed ? ` (${unconfirmed} unconfirmed)` : ""}`);
    if (tasksDue) bits.push(`${tasksDue} follow-up${tasksDue === 1 ? "" : "s"} due`);
    if (!bits.length) continue; // quiet day — no noise

    pushed += await sendPush(uid, {
      title: "Your plays today",
      body: bits.join(" · "),
      tag: "plays",
      url: "./#/",
    });
  }
  return json({ users: users.length, pushed });
}

// ---- Short links (clean URLs for shared pages) ----
// POST {shorten:{u, kind, data}} stores the payload in the salesperson's
// records and returns a short code; GET ?l=<code> returns it. The code is the
// only secret — unguessable, random, no auth needed to resolve.
function randCode(n = 7): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (const b of buf) s += a[b % a.length];
  return s;
}

async function handleShorten(sh: any): Promise<Response> {
  const uid = String(sh?.u || "");
  if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: "bad link" }, 400);
  const kind = sh.kind === "book" ? "book" : "compare";
  const payload = sh.data;
  if (!payload || JSON.stringify(payload).length > 100000) return json({ error: "bad payload" }, 400);
  // Optional label ("Rogue vs CR-V") so the app can show which link got opened.
  const meta = sh.meta && typeof sh.meta === "object"
    ? { label: String(sh.meta.label || "").slice(0, 120) } : {};
  const code = randCode();
  const now = new Date().toISOString();
  const res = await fetch(sbUrl("/records"), {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: "lnk_" + code, user_id: uid, collection: "links",
      data: { kind, payload, meta, opens: 0, createdAt: now, updatedAt: now }, deleted: false,
    }),
  });
  if (!res.ok) return json({ error: `save failed (${res.status})` }, 502);
  return json({ code });
}

async function handleResolve(code: string): Promise<Response> {
  if (!/^[a-z0-9]{5,12}$/.test(code)) return json({ error: "bad link" }, 400);
  const res = await fetch(
    sbUrl(`/records?id=eq.lnk_${encodeURIComponent(code)}&collection=eq.links&deleted=eq.false&select=data,user_id&limit=1`),
    { headers: sbHeaders() },
  );
  if (!res.ok) return json({ error: `lookup failed (${res.status})` }, 502);
  const rows = await res.json();
  if (!rows.length) return json({ error: "not found" }, 404);
  const d = rows[0].data || {};
  const uid = rows[0].user_id;
  // Count the open (best-effort; the customer's page never waits on it). The
  // bumped updatedAt makes the app's next cloud pull pick the activity up.
  const now = new Date().toISOString();
  const tracked = {
    ...d, opens: (Number(d.opens) || 0) + 1,
    firstOpenAt: d.firstOpenAt || now, lastOpenAt: now, updatedAt: now,
  };
  fetch(sbUrl(`/records?id=eq.lnk_${encodeURIComponent(code)}&collection=eq.links`), {
    method: "PATCH",
    headers: sbHeaders(),
    body: JSON.stringify({ data: tracked, updated_at: now }),
  }).catch(() => {});
  // Speed-to-lead reflex: tell the salesperson the moment a customer opens a
  // link — but at most once per 10 minutes per link, so a customer scrolling
  // and reloading doesn't spam the phone.
  const quiet = !d.lastOpenAt || Date.now() - new Date(d.lastOpenAt).getTime() > 10 * 60 * 1000;
  if (uid && quiet) {
    const label = d.meta?.label || (d.kind === "book" ? "Your booking link" : "Your comparison");
    sendPush(uid, {
      title: `👀 ${label} was just opened`,
      body: `Opened ${tracked.opens}× so far — they're looking right now. Strike while it's warm.`,
      tag: `link-${code}`,
      url: "./#/comms",
    }).catch(() => {});
  }
  return json(d);
}

async function handleAvail(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const uid = u.searchParams.get("u") || "";
  const date = u.searchParams.get("date") || "";
  if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: "bad link" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad date" }, 400);
  try {
    return json({ busy: await bookedTimes(uid, date) });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
}

async function handleBook(body: any): Promise<Response> {
  const b = body.book || {};
  const uid = String(b.u || "");
  const date = String(b.date || "");
  const time = String(b.time || "");
  const name = String(b.name || "").trim().slice(0, 80);
  const phone = String(b.phone || "").trim().slice(0, 25);
  const email = String(b.email || "").trim().slice(0, 120);
  const vehicle = String(b.vehicle || "").trim().slice(0, 80);
  const type = ["appointment", "testdrive"].includes(b.type) ? b.type : "appointment";
  if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: "bad link" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return json({ error: "bad slot" }, 400);
  if (!name || !phone) return json({ error: "name and phone required" }, 400);

  try {
    // The slot may have been taken since the grid loaded.
    const busy = await bookedTimes(uid, date);
    if (busy.includes(time)) return json({ error: "slot_taken" }, 409);

    const now = new Date().toISOString();
    const id = "apt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const data = {
      id, type, title: type === "testdrive" ? "Test drive" : "Appointment",
      customerName: name, phone, email, vehicle,
      when: `${date}T${time}`, status: "scheduled", confirmed: true,
      outcome: "", leadId: null, source: "self-booked",
      notes: String(b.note || "").trim().slice(0, 400),
      createdAt: now, updatedAt: now,
    };
    const res = await fetch(sbUrl("/records"), {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id, user_id: uid, collection: "appointments", data, deleted: false }),
    });
    if (!res.ok) return json({ error: `booking save failed (${res.status})` }, 502);

    // Best-effort confirmation email to the customer (needs the Resend setup).
    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("EMAIL_FROM");
    if (key && from && email) {
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to: [email],
          subject: `You're booked — ${date} at ${time}`,
          text: `Hi ${name},\n\nYour ${data.title.toLowerCase()} is confirmed for ${date} at ${time}.\n\nSee you then!`,
        }),
      }).catch(() => {});
    }
    // Reflex push: a self-booking is the hottest possible signal.
    sendPush(uid, {
      title: "📅 New booking!",
      body: `${name} booked ${date} at ${time}${vehicle ? ` — ${vehicle}` : ""}. It's on your calendar.`,
      tag: "booking",
      url: "./#/calendar",
    }).catch(() => {});
    return json({ booked: true, when: data.when });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
}

// ---- Text messaging (Twilio) ----
// Outbound goes through {sms:{...}}; inbound arrives on this same URL with
// ?sms=1&u=<uid> as the number's webhook. Both write a "texts" record, so the
// thread is whole on the next sync no matter which side spoke.
//
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (E.164).

function twilioCfg() {
  return {
    sid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
    token: Deno.env.get("TWILIO_AUTH_TOKEN") || "",
    from: Deno.env.get("TWILIO_FROM") || "",
  };
}

// Last ten digits, so every shape of the same number matches.
function phoneKey(p: string): string {
  const d = String(p || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

// Twilio signs each webhook: HMAC-SHA1 over the full URL with every POST
// parameter appended in sorted order. Verifying JWT is off for this function,
// so without this check anyone who learns the URL could write messages into a
// salesperson's inbox.
async function twilioSigned(url: string, params: Record<string, string>, sig: string, token: string): Promise<boolean> {
  if (!sig || !token) return false;
  const data = Object.keys(params).sort().reduce((s, k) => s + k + params[k], url);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // Constant-time: compare every byte regardless of where the first difference is.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function saveRecord(uid: string, collection: string, id: string, data: unknown) {
  const res = await fetch(sbUrl("/records"), {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id, user_id: uid, collection, data, deleted: false }),
  });
  if (!res.ok) throw new Error(`${collection} save failed (${res.status})`);
}

async function leadsFor(uid: string): Promise<any[]> {
  const q = `/records?user_id=eq.${encodeURIComponent(uid)}&collection=eq.leads&deleted=eq.false&select=id,data`;
  const res = await fetch(sbUrl(q), { headers: sbHeaders() });
  if (!res.ok) throw new Error(`lead lookup failed (${res.status})`);
  return await res.json();
}

function prettyPhone(p: string): string {
  const d = phoneKey(p);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

// Carrier-standard keywords. Twilio itself blocks further sending on STOP; we
// mirror it onto the lead so the app's own campaigns stop offering them too.
const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "arret", "arrêt"];
const START_WORDS = ["start", "unstop", "yes"];

// Rate-limit the "rejected" warning. The webhook URL is public, so anyone who
// learns it could otherwise drive a stream of notifications by posting garbage.
// In-memory: instances are short-lived, so this dampens rather than guarantees.
const warned = new Map<string, number>();
function shouldWarn(uid: string): boolean {
  const now = Date.now();
  const last = warned.get(uid) || 0;
  if (now - last < 10 * 60 * 1000) return false;
  warned.set(uid, now);
  return true;
}

// Every inbound hit is recorded, accepted or rejected, so the setup check can
// tell apart the two failures that look identical from the app: the webhook
// never reached us at all (still pointed somewhere else), and it reached us and
// was turned away. Without this the only evidence is an empty inbox, which is
// what both look like. One row, overwritten each time.
async function noteInboundHit(uid: string, outcome: string, from: string) {
  if (!/^[0-9a-f-]{36}$/.test(uid)) return;
  try {
    await saveRecord(uid, "smshits", "last", {
      id: "last", outcome, from: from.slice(-4), at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch { /* diagnostics must never break delivery */ }
}

async function handleInboundSms(req: Request): Promise<Response> {
  const { token } = twilioCfg();
  const url = new URL(req.url);
  const uid = String(url.searchParams.get("u") || "");
  // TwiML: an empty response means "no auto-reply". Returned on every path,
  // including failures — a 500 makes Twilio retry and double-post the message.
  const empty = new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200, headers: { "Content-Type": "text/xml" },
  });

  let params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } catch { return empty; }

  // Twilio signs the exact URL it requested. This function runs behind a
  // proxy, so req.url can differ from that — most often http:// where Twilio
  // used https://, or an internal host in place of the public one. When it
  // differs the signature can't match, every text is dropped with a 403, and
  // nothing anywhere says why. So try the plausible candidates rather than
  // assuming req.url survived the hop.
  const sig = req.headers.get("x-twilio-signature") || "";
  const fwdProto = req.headers.get("x-forwarded-proto");
  const fwdHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const candidates = [req.url];
  try {
    const u2 = new URL(req.url);
    if (fwdProto) u2.protocol = `${fwdProto}:`;
    if (fwdHost) u2.host = fwdHost;
    candidates.push(u2.toString());
    // Twilio normalises away a default port; a rebuilt URL might not.
    candidates.push(u2.toString().replace(/:443(?=\/|$)/, ""));
    const https = new URL(req.url);
    https.protocol = "https:";
    candidates.push(https.toString());
  } catch { /* req.url is all we have */ }

  let ok = false;
  for (const cand of candidates) {
    if (await twilioSigned(cand, params, sig, token)) { ok = true; break; }
  }
  if (!ok) {
    // A 403 here is invisible from inside the app: the customer's text simply
    // never appears. Say so out loud, once in a while, so a wrong auth token
    // isn't diagnosed by staring at an empty inbox.
    if (/^[0-9a-f-]{36}$/.test(uid) && shouldWarn(uid)) {
      sendPush(uid, {
        title: "A text was rejected",
        body: "Someone texted your number but the signature check failed — usually TWILIO_AUTH_TOKEN not matching the account the number is on.",
        tag: "sms-badsig",
        url: "./#/settings",
      }).catch(() => {});
    }
    noteInboundHit(uid, "rejected: signature", String(params.From || ""));
    return new Response("bad signature", { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/.test(uid)) return empty;
  noteInboundHit(uid, "accepted", String(params.From || ""));

  const from = String(params.From || "");
  const body = String(params.Body || "").trim().slice(0, 1600);
  if (!from) return empty;
  const now = new Date().toISOString();

  try {
    const rows = await leadsFor(uid);
    const key = phoneKey(from);
    let lead = rows.find((r: any) => phoneKey(r.data?.phone) === key);

    // A text from a stranger is still a lead — it's the most engaged kind
    // there is. Better a row to name later than a message with nowhere to sit.
    if (!lead) {
      const id = "led_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const data = {
        id, name: prettyPhone(from), phone: from, email: "", stage: "new",
        source: "text", vehicleInterest: "", notes: "", createdAt: now, updatedAt: now,
      };
      await saveRecord(uid, "leads", id, data);
      lead = { id, data };
    }

    const word = body.toLowerCase().replace(/[^a-zà-ÿ]/g, "");
    const isStop = STOP_WORDS.includes(word);
    const isStart = START_WORDS.includes(word);
    if (isStop || isStart) {
      await saveRecord(uid, "leads", lead.id, { ...lead.data, smsOptOut: isStop, updatedAt: now });
    }

    const tid = "txt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    await saveRecord(uid, "texts", tid, {
      id: tid, leadId: lead.id, dir: "in", body, phone: from,
      at: now, read: false, sid: String(params.MessageSid || ""),
      createdAt: now, updatedAt: now,
    });

    const who = lead.data?.name || prettyPhone(from);
    sendPush(uid, {
      title: isStop ? `${who} opted out` : `💬 ${who} replied`,
      body: isStop ? "They won't be included in campaigns any more." : body.slice(0, 140),
      tag: "sms-" + lead.id,
      url: `./#/leads/${lead.id}`,
    }).catch(() => {});
  } catch (_e) {
    // Swallow: a retry would deliver the same message twice, which is worse
    // than losing the push. The text is already the customer's second attempt.
  }
  return empty;
}

// Twilio's failures come back as terse strings — code 20003 is the single word
// "Authenticate" — which tells a salesperson nothing about what to go and fix.
// Translate the ones that actually happen during setup into the action.
function twilioReason(out: any, status: number): string {
  const code = Number(out?.code) || 0;
  const raw = String(out?.message || "").trim();
  const map: Record<number, string> = {
    20003: "Twilio rejected the account details. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your Supabase secrets — the SID starts with AC, and if the number lives in a subaccount you need that subaccount's SID and token, not the parent's.",
    20404: "Twilio couldn't find that account. TWILIO_ACCOUNT_SID is probably from a different account than the auth token.",
    21211: "That customer's phone number isn't a valid number Twilio can text.",
    21212: "TWILIO_FROM isn't a valid number. It has to be E.164 — like +19025550123, no spaces or brackets.",
    21606: "TWILIO_FROM isn't a number on this account, or it can't send SMS. Check it's the number you own and that SMS is enabled on it.",
    21608: "This is a Twilio trial account, which can only text numbers you've verified. Verify the number in Twilio, or upgrade the account.",
    21610: "That customer texted STOP, so Twilio won't deliver to them. They have to text START to come back.",
    21614: "That number can't receive texts — it looks like a landline.",
    63038: "Twilio's daily message limit for this account has been hit (trial accounts are capped).",
  };
  if (map[code]) return map[code];
  if (status === 401 || status === 403) return `Twilio rejected the credentials (${raw || status}). Check the SID and auth token in your Supabase secrets.`;
  return raw ? `Twilio: ${raw}${code ? ` (code ${code})` : ""}` : `send failed (${status})`;
}

// Setup diagnosis. "Authenticate" tells you a credential was rejected but not
// which one or why, and guessing from the outside is slow and often wrong. This
// reports what the function can actually see — shapes and lengths, never the
// secrets themselves — then asks Twilio directly whether the credentials work
// and whether the number belongs to the account, which are separate questions
// that the send path collapses into one error.
async function handleSmsCheck(body: any): Promise<Response> {
  const uid = String(body.smscheck?.u || "");
  if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: "bad user" }, 400);
  const { sid, token, from } = twilioCfg();

  // Whitespace pasted into a secret is invisible in the dashboard and fatal here.
  const shape = (v: string) => ({
    set: !!v,
    length: v.length,
    hasWhitespace: v !== v.trim() || /\s/.test(v),
    hasQuotes: /^["']|["']$/.test(v),
  });
  const secrets = {
    TWILIO_ACCOUNT_SID: { ...shape(sid), startsWith: sid.slice(0, 2), looksRight: /^AC[0-9a-f]{32}$/i.test(sid) },
    TWILIO_AUTH_TOKEN: { ...shape(token), looksRight: /^[0-9a-f]{32}$/i.test(token) },
    // Not a secret — it's the number customers see.
    TWILIO_FROM: { ...shape(from), value: from, looksRight: /^\+[1-9]\d{7,14}$/.test(from) },
  };
  if (!sid || !token) return json({ secrets, auth: { ok: false, why: "missing credentials" } });

  const basic = "Basic " + btoa(`${sid.trim()}:${token.trim()}`);
  const out: any = { secrets };

  // Does this pair authenticate at all, independent of sending?
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid.trim()}.json`, { headers: { Authorization: basic } });
    const j = await r.json().catch(() => ({}));
    out.auth = r.ok
      ? { ok: true, accountStatus: j.status, accountType: j.type, friendlyName: j.friendly_name }
      : { ok: false, status: r.status, code: j.code ?? null, message: j.message || "" };
  } catch (e) {
    out.auth = { ok: false, why: String(e).slice(0, 120) };
  }

  // Separate question: is TWILIO_FROM a number on THIS account, and can it text?
  if (out.auth?.ok && from) {
    try {
      const q = `https://api.twilio.com/2010-04-01/Accounts/${sid.trim()}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from.trim())}`;
      const r = await fetch(q, { headers: { Authorization: basic } });
      const j = await r.json().catch(() => ({}));
      const row = (j.incoming_phone_numbers || [])[0];
      out.number = row
        ? { owned: true, smsCapable: !!row.capabilities?.sms, friendlyName: row.friendly_name,
            // A number attached to a Messaging Service takes its inbound webhook
            // from the service, not from the number — the usual reason replies
            // never arrive even though sending works.
            inMessagingService: !!row.messaging_service_sid,
            smsUrl: row.sms_url || "", statusCallback: row.status_callback || "" }
        : { owned: false, note: "That number isn't on this account — check you're using the right account or subaccount." };
    } catch (e) {
      out.number = { error: String(e).slice(0, 120) };
    }
  }
  // Has an inbound webhook ever actually reached this function?
  try {
    const q = `/records?user_id=eq.${encodeURIComponent(uid)}&collection=eq.smshits&deleted=eq.false&select=data`;
    const r = await fetch(sbUrl(q), { headers: sbHeaders() });
    const rows = r.ok ? await r.json() : [];
    out.inbound = rows[0]?.data || null;
  } catch { out.inbound = null; }

  return json(out);
}

async function handleSendSms(body: any): Promise<Response> {
  const { sid, token, from } = twilioCfg();
  const s = body.sms || {};
  const uid = String(s.u || "");
  const to = String(s.to || "").trim();
  const text = String(s.body || "").trim();
  if (!sid || !token || !from) return json({ error: "Texting is not set up on the server (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)" }, 500);
  if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: "bad user" }, 400);
  if (phoneKey(to).length < 10) return json({ error: "bad number" }, 400);
  if (!text) return json({ error: "empty message" }, 400);

  const form = new URLSearchParams({ To: to, From: from, Body: text.slice(0, 1600) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: twilioReason(out, res.status), code: out?.code ?? null }, 502);

  // Log it on the server so the thread is complete even if this device never
  // syncs again — the app writes its own optimistic copy under the same id.
  const now = new Date().toISOString();
  const tid = String(s.id || "txt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16));
  try {
    await saveRecord(uid, "texts", tid, {
      id: tid, leadId: String(s.leadId || ""), dir: "out", body: text, phone: to,
      at: now, read: true, sid: out?.sid || "", createdAt: now, updatedAt: now,
    });
  } catch { /* the message is sent; the log is best-effort */ }
  return json({ sent: true, id: tid, sid: out?.sid || "" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Twilio posts form-encoded, so this has to come before the JSON parse below.
  if (req.method === "POST" && new URL(req.url).searchParams.get("sms")) return handleInboundSms(req);
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("push") === "cfg") return json({ publicKey: Deno.env.get("VAPID_PUBLIC_KEY") || null });
    if (u.searchParams.get("l")) return handleResolve(u.searchParams.get("l") || "");
    if (u.searchParams.get("avail")) return handleAvail(req);
    return proxyICS(req);
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  if (body.smscheck) return handleSmsCheck(body);
  if (body.sms) return handleSendSms(body);
  if (body.book) return handleBook(body);
  if (body.shorten) return handleShorten(body.shorten);
  if (body.plays) return handleMorningPlays(body);
  if (body.testpush) {
    const uid = String(body.testpush.u || "");
    if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: "bad user" }, 400);
    if (!ensureVapid()) return json({ error: "VAPID keys not set — add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to the function's secrets" }, 500);
    const errs: string[] = [];
    const sent = await sendPush(uid, {
      title: "entoa is live 🎉",
      body: "This is what a play will look like. The agent can reach you now.",
      tag: "test",
      url: "./#/",
    }, errs);
    return json({ sent, errors: errs });
  }

  // --- Optional email sending (Resend) ---
  if (body.email) {
    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM");
    if (!key) return json({ error: "Server missing RESEND_API_KEY" }, 500);
    if (!from) return json({ error: "Server missing EMAIL_FROM" }, 500);
    const { to, subject, text } = body.email || {};
    if (!to || !subject) return json({ error: "email needs to + subject" }, 400);
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text: String(text || "") }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: data?.message || `Email failed (${r.status})` }, 502);
      return json({ sent: true, id: data?.id || null });
    } catch (err) {
      return json({ error: `Email failed: ${err}` }, 502);
    }
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: "No messages" }, 400);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("MODEL") || "claude-haiku-4-5-20251001",
        max_tokens: Math.min(Number(body.max_tokens) || 1024, 2048),
        system: typeof body.system === "string" ? body.system : undefined,
        tools: Array.isArray(body.tools) ? body.tools : undefined,
        messages: body.messages,
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || `Claude error ${r.status}` }, 502);
    return json({ content: data.content || [], stop_reason: data.stop_reason || "end_turn" });
  } catch (err) {
    return json({ error: `Agent failed: ${err}` }, 502);
  }
});
