// entoa's one Supabase Edge Function — three jobs, one URL:
//   POST {system, tools, messages}  → Claude relay for the voice agent.
//   POST {email: {to, subject, text}} → send a real email via Resend
//                                     (needs RESEND_API_KEY + EMAIL_FROM
//                                     secrets; optional).
//   GET  ?url=<calendar feed>       → CORS proxy for Apple/Outlook/Google
//                                     (.ics) feeds, which browsers can't
//                                     fetch cross-origin themselves.
// The agent's brain (system prompt + tools) lives in the app, so it improves
// via normal app updates without redeploying this. No customer data is stored
// here.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (or set it in the
//     dashboard: Edge Functions → Secrets)
//   deploy the function and turn OFF "Verify JWT" so the app can call it.

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return proxyICS(req);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

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
