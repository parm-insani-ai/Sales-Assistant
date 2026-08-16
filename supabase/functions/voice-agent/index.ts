// entoa voice agent — a thin Claude relay (Supabase Edge Function).
// The agent's brain (system prompt + tools) lives in the app now, so it can be
// improved via normal app updates without redeploying this. This function just
// holds your Anthropic API key, forwards the request to Claude, and returns the
// raw turn ({ content, stop_reason }). No customer data is stored here.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (or set it in the
//     dashboard: Edge Functions → Secrets)
//   deploy the function and turn OFF "Verify JWT" so the app can call it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
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
