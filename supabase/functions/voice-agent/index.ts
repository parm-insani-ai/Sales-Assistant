// entoa voice agent — a Supabase Edge Function that relays a tool-use
// conversation to Claude. The app runs a real agent loop: it sends the running
// message history, Claude replies (often calling tools), the app runs the tools
// locally against on-device data and sends the results back, and so on. This
// function is a thin gateway: it holds your Anthropic API key, adds the system
// prompt + tool schema, forwards the messages, and returns Claude's raw turn
// ({ content, stop_reason }). No customer data is stored here.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy voice-agent --no-verify-jwt
// Then paste the function URL into entoa → Settings → Voice agent.
// Optional: set MODEL secret to override the model.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOLS = [
  // ---- reads ----
  { name: "find_customers", description: "Look up customers/leads. Filter by a name/vehicle query, stage, whether they need a follow-up, or whether they have positive trade equity.",
    input_schema: { type: "object", properties: { query: { type: "string" }, stage: { type: "string" }, needsFollowUp: { type: "boolean" }, hasEquity: { type: "boolean" } } } },
  { name: "get_customer", description: "Get full details for one customer by name (phone, stage, payment, payoff, value, equity, APR, follow-up, lease end).",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "get_appointments", description: "List appointments, optionally for a specific date (YYYY-MM-DD).",
    input_schema: { type: "object", properties: { date: { type: "string" } } } },
  { name: "deal_radar", description: "Top trade-up opportunities: customers who can move into a new vehicle near their current payment, with the matched vehicle and monthly.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_stats", description: "This month's numbers: appointment funnel (set/confirmed/showed/sold, show rate), units sold, commission, and goals.",
    input_schema: { type: "object", properties: {} } },
  // ---- writes ----
  { name: "open_page", description: "Open a screen.", input_schema: { type: "object", properties: { page: { type: "string", enum: ["home", "leads", "inventory", "calculator", "deliveries", "calendar", "goals", "radar", "prospecting", "tools", "spiffs", "specials", "compare", "import", "settings"] } }, required: ["page"] } },
  { name: "create_lead", description: "Add a new customer/lead.", input_schema: { type: "object", properties: { name: { type: "string" }, vehicle: { type: "string" }, phone: { type: "string" }, followUp: { type: "string" } }, required: ["name"] } },
  { name: "update_lead", description: "Update an existing customer (match by name).", input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, stage: { type: "string", enum: ["new", "working", "appointment", "negotiating", "sold", "delivered", "lost"] }, followUp: { type: "string" }, vehicle: { type: "string" } }, required: ["name"] } },
  { name: "add_task", description: "Add a to-do/reminder.", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string" } }, required: ["title"] } },
  { name: "log_sale", description: "Log a sale.", input_schema: { type: "object", properties: { customer: { type: "string" }, commission: { type: "number" }, front: { type: "number" }, back: { type: "number" }, vehicle: { type: "string" } }, required: ["customer"] } },
  { name: "book_appointment", description: "Book an appointment with a customer.", input_schema: { type: "object", properties: { customer: { type: "string" }, type: { type: "string", enum: ["appointment", "testdrive", "delivery", "call"] }, when: { type: "string", description: "local datetime YYYY-MM-DDTHH:MM" }, vehicle: { type: "string" } }, required: ["customer", "when"] } },
  { name: "appointment_outcome", description: "Set the outcome of a customer's appointment.", input_schema: { type: "object", properties: { customer: { type: "string" }, outcome: { type: "string", enum: ["confirmed", "showed", "no_show", "sold"] } }, required: ["customer", "outcome"] } },
  { name: "start_cadence", description: "Start the automated follow-up plan for a customer.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "search_inventory", description: "Search dealer inventory for a vehicle.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
];

function systemPrompt(ctx: any): string {
  return [
    `You are entoa's voice assistant for a car salesperson${ctx.salesperson ? " named " + ctx.salesperson : ""}.`,
    `Today is ${ctx.weekday} ${ctx.today}, current time ${ctx.nowTime} (local). Resolve relative dates/times ("tomorrow", "Thursday at 4") to strings — dates as YYYY-MM-DD, datetimes as YYYY-MM-DDTHH:MM. If an appointment time isn't given, pick a sensible business-hours time.`,
    `Use the READ tools to look things up before acting (e.g. deal_radar or find_customers to pick who to call, get_appointments to find today's schedule). Then use the WRITE tools to carry out the request. You can take multiple steps.`,
    `When you're finished, reply with ONE short spoken sentence summarizing what you did or answering the question. Match people to existing customers by name; create them only if clearly new.`,
    ctx.counts ? `The salesperson has ${ctx.counts.leads} customers and ${ctx.counts.appointments} appointments on file.` : ``,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) return json({ error: "No messages" }, 400);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("MODEL") || "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt(body.context || {}),
        tools: TOOLS,
        messages,
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || `Claude error ${r.status}` }, 502);
    return json({ content: data.content || [], stop_reason: data.stop_reason || "end_turn" }, 200);
  } catch (err) {
    return json({ error: `Agent failed: ${err}` }, 502);
  }

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
