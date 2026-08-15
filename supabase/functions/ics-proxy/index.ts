// entoa calendar proxy — a Supabase Edge Function.
// Browsers can't fetch calendar (.ics) feeds directly (the calendar servers
// don't send CORS headers), so this tiny function fetches the feed server-side
// and returns it with permissive CORS. It only fetches known calendar hosts.
//
// Deploy (Supabase CLI):
//   supabase functions deploy ics-proxy --no-verify-jwt
// Then use the printed URL as your "Calendar proxy URL" in entoa Settings.
//
// Usage: GET  <function-url>?url=<encoded feed url or webcal:// link>

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Allowed feed hosts (suffix match). Add your own if you use another provider.
const ALLOW = [
  "calendar.google.com",
  "icloud.com",       // p##-caldav.icloud.com, p##-calendars.icloud.com
  "me.com",
  "outlook.office365.com",
  "outlook.office.com",
  "outlook.live.com",
  "office.com",
  "calendar.yahoo.com",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const reqUrl = new URL(req.url);
  let target = reqUrl.searchParams.get("url") || "";
  // Calendar apps hand out webcal:// links — they're just https.
  target = target.replace(/^webcal:\/\//i, "https://");

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
  if (!ALLOW.some((h) => host === h || host.endsWith("." + h))) {
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
});
