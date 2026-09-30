// "I don't have a tool to delete or remove a customer" — now it does, and it
// confirms first: nothing is removed until the salesperson has said yes,
// then the customer goes with their open follow-ups and upcoming
// appointments, an Undo on screen for a moment.
const { launch } = require("./browser.js");
(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const soon = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
await p.addInitScript((soon) => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  const x = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads: [{ id: "t", name: "Tony Montana", phone: "9025550001", stage: "working", vehicleInterest: "Armada", ...x }, { id: "d", name: "Dana Muise", phone: "9025550002", stage: "working", ...x }],
    tasks: [{ id: "k1", leadId: "t", title: "Call Tony", done: false, cadence: true, ...x }, { id: "k2", leadId: "t", title: "Old one", done: true, ...x }, { id: "k3", leadId: "d", title: "Call Dana", done: false, ...x }],
    appointments: [{ id: "a1", leadId: "t", customerName: "Tony Montana", when: soon, status: "scheduled", type: "appointment", ...x }],
    texts: [{ id: "x1", leadId: "t", dir: "in", body: "Say hello to my little Armada", at: "2026-09-20T10:00:00.000Z", ...x }],
    settings: { salesperson: "Parm", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/functions/v1/quick-api" },
  }));
}, soon);
await p.goto(APP + "/#/leads/t");
await p.waitForTimeout(600);

const r = await p.evaluate(async () => {
  const a = await import("/js/agent.js"); const s = await import("/js/store.js");
  const first = await a.execTool("delete_customer", { customer: "Tony" });
  const stillThere = !!s.get("leads", "t");
  const second = await a.execTool("delete_customer", { customer: "Tony Montana", confirmed: true });
  await new Promise((r) => setTimeout(r, 200));
  return {
    first: first.result, note: first.note, stillThere,
    second: second.result,
    gone: !s.get("leads", "t"), tasks: s.all("tasks").map((t) => t.id).sort().join(","), appts: s.all("appointments").length, texts: s.all("texts").length,
    undo: !!document.querySelector(".toast-undo"), hash: location.hash,
    label: a.stepLabel("delete_customer", { customer: "Tony", confirmed: true }),
  };
});
console.log(JSON.stringify(r, null, 1));
if (!r.stillThere || !/Not deleted\. Confirm first with ask_user: "Delete Tony Montana from your customers, with 1 open follow-up and 1 upcoming appointment\? This can't be undone\."/.test(r.first) || !/checking before deleting/.test(r.note)) fail("the first call must ask, not delete: " + JSON.stringify(r));
if (!r.gone || r.tasks !== "k2,k3" || r.appts !== 0 || r.texts !== 1) fail("confirmed: the customer, their open follow-up and their appointment go; done tasks, other people's tasks and the texts stay: " + JSON.stringify(r));
if (!/deleted Tony Montana, 1 open follow-up, 1 upcoming appointment/.test(r.second) || !r.undo || r.hash !== "#/leads") fail("the reply should say what went, with an Undo on screen and the page moved off him: " + JSON.stringify(r));
if (r.label !== "Deleting Tony") fail("the thread step should read as deleting: " + r.label);

// Undo puts it all back.
await p.click(".toast-undo button");
await p.waitForTimeout(200);
const back = await p.evaluate(async () => { const s = await import("/js/store.js"); return { lead: !!s.get("leads", "t"), tasks: s.all("tasks").length, appts: s.all("appointments").length }; });
if (!back.lead || back.tasks !== 3 || back.appts !== 1) fail("Undo should restore the customer with their follow-up and appointment: " + JSON.stringify(back));

// The assistant is told it can, and how.
const relay = await p.evaluate(async () => { const a = await import("/js/agent.js"); const sess = a.createAgentSession(); try { await sess.send("delete Tony"); } catch { } return true; });
void relay;
const relays = await fetch(APP + "/__relays").then((r) => r.json());
const sys = (relays[relays.length - 1] || {}).system || "";
const tools = (relays[relays.length - 1] || {}).tools || [];
if (!tools.includes("delete_customer") || !/Never say there's no way to delete a customer/.test(sys) || !/ONE confirming question/.test(sys)) fail("the assistant should carry the tool and the rule: " + tools.join(",") + " / " + sys.slice(-400));

if (errs.length) { console.error("PAGE ERRORS: " + errs.join(" | ")); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "\ndeletecust.test.js FAILED" : "\ndeletecust.test.js passed");
})();
