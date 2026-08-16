// entoa voice agent — a Supabase Edge Function that turns a spoken request into
// app actions using Claude. It holds your Anthropic API key server-side (never
// in the app) and returns { say, actions } — a short spoken reply plus the list
// of actions for the app to run locally.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy voice-agent --no-verify-jwt
// Then paste the function URL into entoa → Settings → Voice agent.
//
// Optional: set MODEL secret to override the model (default: fast Haiku).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOLS = [
  { name: "open_page", description: "Open a screen in the app.",
    input_schema: { type: "object", properties: { page: { type: "string", enum: ["home", "leads", "inventory", "calculator", "deliveries", "calendar", "goals", "radar", "prospecting", "tools", "spiffs", "specials", "compare", "import", "settings"] } }, required: ["page"] } },
  { name: "create_lead", description: "Add a new customer/lead.",
    input_schema: { type: "object", properties: { name: { type: "string" }, vehicle: { type: "string" }, phone: { type: "string" }, followUp: { type: "string", description: "date YYYY-MM-DD" } }, required: ["name"] } },
  { name: "update_lead", description: "Update an existing customer (match by name).",
    input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, stage: { type: "string", enum: ["new", "working", "appointment", "negotiating", "sold", "delivered", "lost"] }, followUp: { type: "string" }, vehicle: { type: "string" } }, required: ["name"] } },
  { name: "add_task", description: "Add a to-do/reminder.",
    input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string", description: "date YYYY-MM-DD" } }, required: ["title"] } },
  { name: "log_sale", description: "Log a sale.",
    input_schema: { type: "object", properties: { customer: { type: "string" }, commission: { type: "number" }, front: { type: "number" }, back: { type: "number" }, vehicle: { type: "string" } }, required: ["customer"] } },
  { name: "book_appointment", description: "Book an appointment with a customer.",
    input_schema: { type: "object", properties: { customer: { type: "string" }, type: { type: "string", enum: ["appointment", "testdrive", "delivery", "call"] }, when: { type: "string", description: "local datetime YYYY-MM-DDTHH:MM" }, vehicle: { type: "string" } }, required: ["customer", "when"] } },
  { name: "appointment_outcome", description: "Set the outcome of a customer's appointment.",
    input_schema: { type: "object", properties: { customer: { type: "string" }, outcome: { type: "string", enum: ["confirmed", "showed", "no_show", "sold"] } }, required: ["customer", "outcome"] } },
  { name: "start_cadence", description: "Start the automated follow-up plan for a customer.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "search_inventory", description: "Search dealer inventory for a vehicle.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
];

function systemPrompt(ctx: any): string {
  const leads = (ctx.leads || []).map((l: any) => `${l.name}${l.vehicle ? " (" + l.vehicle + ")" : ""} [${l.stage}]`).join("; ");
  const appts = (ctx.appts || []).map((a: any) => `${a.customer} ${a.when}${a.outcome ? " " + a.outcome : ""}`).join("; ");
  return [
    `You are entoa's voice assistant for a car salesperson${ctx.salesperson ? " named " + ctx.salesperson : ""}.`,
    `Today is ${ctx.weekday} ${ctx.today}, current time ${ctx.nowTime} (local). Resolve relative dates/times ("tomorrow", "Thursday at 4") to strings — dates as YYYY-MM-DD, datetimes as YYYY-MM-DDTHH:MM. If an appointment time isn't given, pick a sensible business-hours time.`,
    `Use the tools to carry out the request. You may call multiple tools. Match people to the EXISTING customers below when the name is close; otherwise create them.`,
    `Keep your text reply to ONE short spoken sentence confirming what you did. If the request is just a question, answer it in that sentence with no tools.`,
    leads ? `Active customers: ${leads}.` : `No customers yet.`,
    appts ? `Appointments: ${appts}.` : ``,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "Server missing ANTHROPIC_API_KEY" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Bad JSON" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }); }
  const transcript = String(body.transcript || "").slice(0, 1000);
  if (!transcript) return new Response(JSON.stringify({ error: "No transcript" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("MODEL") || "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt(body.context || {}),
        tools: TOOLS,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: transcript }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return new Response(JSON.stringify({ error: data?.error?.message || `Claude error ${r.status}` }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });

    const actions: any[] = [];
    let say = "";
    for (const block of data.content || []) {
      if (block.type === "text") say += block.text;
      else if (block.type === "tool_use") actions.push({ tool: block.name, args: block.input });
    }
    return new Response(JSON.stringify({ say: say.trim(), actions }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Agent failed: ${err}` }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
