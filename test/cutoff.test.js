// A turn that runs out of room partway through a tool call. Thinking counts
// against the output cap, so this can happen on a long turn. Nothing
// half-written runs, the salesperson hears why, and the next thing they say
// still works: the cut call isn't left in the history without a result.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Parm", cloudAutoSync: false } }));
});
await p.goto(APP + "/#/");
await p.waitForTimeout(500);

const out = await p.evaluate(async () => {
  const a = await import("/js/agent.js");
  const sent = [], ran = [];
  let n = 0;
  const call = async (messages) => {
    sent.push(JSON.parse(JSON.stringify(messages)));
    n++;
    if (n === 1) return { stop_reason: "max_tokens", content: [
      { type: "text", text: "Booking that now." },
      { type: "tool_use", id: "tu_cut", name: "book_appointment", input: { customer: "Ken" } },
    ] };
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Sure." }] };
  };
  const exec = async (name) => { ran.push(name); return { result: "done", note: "" }; };
  const s = a.createAgentSession({ call, exec });
  const first = await s.send("book Ken Thursday at 4 and text him the address and confirm his trade");
  const second = await s.send("just book Ken Thursday at 4");
  // Every tool_use in what was sent must have its tool_result in the next message.
  const orphan = sent[1].some((m, i, all) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use" && !(all[i + 1] && Array.isArray(all[i + 1].content) && all[i + 1].content.some((r) => r.type === "tool_result" && r.tool_use_id === b.id))));
  return { first, second, ran, orphan };
});
console.log(JSON.stringify(out));
if (out.ran.length) fail("a half-written tool call ran: " + out.ran.join(","));
if (!out.first.done || !/Booking that now/.test(out.first.say)) fail("the cut-off turn didn't end with what was said: " + JSON.stringify(out.first));
if (out.orphan) fail("the cut tool call was left in the history with no result, so the next request would be rejected");
if (out.second.say !== "Sure.") fail("the next turn didn't go through: " + JSON.stringify(out.second));

// Nothing said before the cut: a plain reason, not silence.
const empty = await p.evaluate(async () => {
  const a = await import("/js/agent.js");
  const s = a.createAgentSession({ call: async () => ({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "" }] }), exec: async () => ({ result: "" }) });
  return s.send("do everything");
});
console.log(JSON.stringify(empty));
if (!/cut off/.test(empty.say)) fail("a cut-off turn with nothing said came back silent: " + JSON.stringify(empty));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ncutoff.test.js FAILED" : "\ncutoff.test.js passed");
})();
