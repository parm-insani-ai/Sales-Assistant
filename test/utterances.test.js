// The assistant against the sentences a salesperson actually says.
//
// Everything else in test/ fakes the model, which is right for testing the
// app around it and useless for the one question that decides whether voice
// is any good: given this sentence, does the model reach for the right tool?
// This runs the real brief, the real tools and the real model over a fixed
// set of utterances and reports what each one picked. Run it before and
// after a change to the brief or the tool descriptions — the score is the
// measurement, and a sentence that stops matching is the regression.
//
// It needs the key: `ANTHROPIC_API_KEY=… node test/server.js`, then this.
// Without it the stub's /__model answers 503 and the eval says so and skips.
const { launch } = require("./browser.js");

// Each: what's said, and the tool(s) that answer it. Several where more than
// one is a fair reading. `ask` means the right move is a question first.
const CASES = [
  ["Ken's coming in Thursday at 4", ["book_appointment"]],
  ["book Dana a test drive tomorrow at 2", ["book_appointment"]],
  ["add Lena Porter, 902 555 1212, she's after a used Rogue, loves the SV moonroof", ["create_lead"]],
  // Dana is already on file: adding her again is a duplicate. Updating her,
  // or asking whether it's the same Dana, is right.
  ["add Dana Muise, 902 555 1212, she's after a used Rogue", ["update_lead", "ask_user"]],
  ["add Ann Fraser, she wants a Kicks", ["ask_user"]],                 // no number: ask for it first
  ["sold one to Moe, made 800", ["log_sale"]],
  // "That" needs something before it: in a fresh session there's nothing to
  // point at, so the sale is logged first and only the second line is scored.
  [["sold one to Moe, made 800", "that wasn't a sale"], ["undo_sale", "undo_last"]],
  ["Sara's cell is 902 555 9876", ["update_lead"]],
  ["Parm said he loves the SV moonroof and his wife has to sign off", ["add_context"]],
  ["Ken's bought elsewhere", ["update_lead"]],
  ["delete Tony", ["ask_user", "delete_customer"]],
  ["undo that", ["undo_last"]],
  ["what's on my plate", ["get_tasks"]],
  ["mark the plates thing done", ["complete_task"]],
  ["remind me to call the bank tomorrow", ["add_task"]],
  ["text Ken that his car is ready", ["text_customer"]],
  ["call Moe", ["call_customer"]],
  ["text 902 555 4444 that the Rogue came in", ["text_customer"]],
  ["who's waiting on me", ["get_messages", "get_nudges"]],
  ["what did Dana say", ["get_messages", "get_customer"]],
  ["what's the story with Ken", ["get_customer"]],
  ["who should I call today", ["get_prospects", "get_plays"]],
  ["what should I do right now", ["get_plays", "get_nudges"]],
  ["who can I get into a car for less than they're paying now", ["deal_radar"]],
  ["what could I put Dana in", ["deal_options"]],
  ["when do my leases end", ["lease_ends"]],
  ["when should I go back to Dana", ["when_it_makes_sense"]],
  ["compare the Kicks with the CR-V", ["compare_vehicles"]],
  ["do we have any Rogue SVs", ["lot_lookup"]],
  ["what's the payment on 42 grand over 72 months", ["payment_quote"]],
  ["0% on Rogues till Monday", ["add_special"]],
  ["500 bucks on every Pathfinder this weekend", ["add_spif"]],
  ["how am I doing against my target", ["sales_target"]],
  ["how am I doing this week", ["get_coach"]],
  ["text everyone who owns a Sentra that double loyalty is on this month", ["mass_outreach"]],
  ["Sara's car is handed over", ["complete_delivery"]],
  ["Ken didn't show", ["appointment_outcome"]],
  ["Ken's confirmed for Thursday", ["appointment_outcome"]],
  ["text Ken my booking link", ["get_booking_link", "text_customer"]],
  ["did anyone look at what I sent", ["get_link_activity"]],
  ["open the calendar", ["open_page"]],
];

(async () => {
const APP = "http://127.0.0.1:8137";
const probe = await fetch(APP + "/__model", { method: "POST", body: "{}" }).then((r) => r.status).catch(() => 0);
if (probe === 503) { console.log("utterances.test.js skipped — start the stub with ANTHROPIC_API_KEY set to run the eval against the live model"); return; }

const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

// A book with the people the sentences mention, so names resolve and the
// brief's "customers on file" list has something in it.
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [
      { id: "ken", name: "Ken Boudreau", phone: "9025551001", stage: "appointment", vehicleInterest: "2026 Rogue SV", ...x },
      { id: "dana", name: "Dana Muise", phone: "9025551002", stage: "working", vehicleInterest: "Nissan Kicks", ...x },
      { id: "sara", name: "Sara Pike", phone: "9025551003", stage: "sold", vehicleInterest: "Pathfinder", ...x },
      { id: "moe", name: "Moe Hassan", phone: "9025551004", stage: "negotiating", vehicleInterest: "Frontier", ...x },
      { id: "tony", name: "Tony Montana", phone: "9025551005", stage: "new", vehicleInterest: "Sentra", ...x },
      { id: "parm", name: "Parm Gill", phone: "9025551006", stage: "working", vehicleInterest: "Rogue SV", ...x },
    ],
    appointments: [{ id: "ap1", leadId: "ken", customerName: "Ken Boudreau", when: today + "T15:00", status: "scheduled", confirmed: false, ...x }],
    tasks: [{ id: "t1", title: "Order plates for Sara", due: today, done: false, ...x }],
    deliveries: [{ id: "d1", leadId: "sara", customerName: "Sara Pike", vehicle: "Pathfinder", status: "prep", checklist: [], ...x }],
    sales: [{ id: "s1", leadId: "moe", customerName: "Moe Hassan", vehicle: "Frontier", saleDate: today, commission: 800, ...x }],
    settings: { salesperson: "Parm", dealership: "O'Regan's Nissan Halifax", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" },
  }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(500);

// Each sentence on a fresh session: the real brief and tools, the live
// model, and a stand-in executor that records the first tool and answers
// "done" so the turn can finish without touching the book. A case given as
// several sentences says them in turn and scores only the last.
const rows = [];
for (const [lines, want] of CASES) {
  const turns = Array.isArray(lines) ? lines : [lines];
  const said = turns.join(" → ");
  const got = await p.evaluate(async ([turns]) => {
    const a = await import("/js/agent.js");
    const picked = [];
    const call = async (messages) => {
      const req = a.agentRequest(messages);
      const r = await fetch("/__model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      return j;
    };
    const exec = async (name, input) => { picked.push({ name, input }); return { result: name === "ask_user" ? "" : "done (simulated)", note: "" }; };
    const s = a.createAgentSession({ call, exec });
    try {
      for (const before of turns.slice(0, -1)) await s.send(before);
      picked.length = 0;
      const res = await s.send(turns[turns.length - 1]);
      // ask_user never reaches exec: it comes back as the turn's question.
      if (res.done === false) picked.push({ name: "ask_user", input: { question: res.say, options: res.options } });
      return { picked, say: res.say, error: "" };
    } catch (e) { return { picked, say: "", error: String(e && e.message || e) }; }
  }, [turns]);
  const first = got.picked[0] ? got.picked[0].name : (got.error ? "ERROR" : "(none)");
  const ok = want.includes(first);
  rows.push({ said, want, first, ok, say: got.say, error: got.error, input: got.picked[0] ? got.picked[0].input : null });
  console.log(`${ok ? "  ok " : "MISS "} ${said}\n       → ${first}${ok ? "" : `  (wanted ${want.join(" | ")})`}${got.error ? `  !! ${got.error}` : ""}`);
}
const hits = rows.filter((r) => r.ok).length;
const score = Math.round((100 * hits) / rows.length);
console.log(`\nscore: ${hits}/${rows.length} (${score}%)`);
rows.filter((r) => !r.ok).forEach((r) => console.log(`  miss: "${r.said}" → ${r.first}${r.input ? " " + JSON.stringify(r.input).slice(0, 120) : ""}${r.say ? ` — "${String(r.say).slice(0, 100)}"` : ""}`));
// The bar: a sentence in ten may be arguable; more than that is a brief or
// a tool description that needs work.
if (score < 90) fail(`tool choice is at ${score}% — under the 90% bar`);
if (rows.some((r) => r.error)) fail("some turns errored: " + rows.filter((r) => r.error).map((r) => r.error).join(" | "));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\nutterances.test.js FAILED" : "\nutterances.test.js passed");
})();
