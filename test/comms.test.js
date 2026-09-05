// Comms is the inbox: one row per customer, unanswered first, live link opens
// second, and the customer's whole timeline — texts, calls and the times they
// opened a link you sent — in one thread.
//
// The ordering is the load-bearing part. A reply means a person is waiting; a
// link open means they're reading right now and don't know you can see it.
// Both beat recency, and getting that wrong makes the screen worth nothing.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

(async () => {
const APP="http://127.0.0.1:8137";
const b = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
  colorScheme:"dark", serviceWorkers:"block" })).newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
const mins = (n) => new Date(Date.now()-n*60000).toISOString();
await p.addInitScript(([recent, older, old2]) => {
  localStorage.setItem("entoa:auth", JSON.stringify({ access_token:"t", refresh_token:"r",
    user:{ id:"00000000-0000-4000-8000-000000000001", email:"p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({
    leads:[
      {id:"a",name:"Ann Lee",phone:"9025551111",email:"ann@e.com",stage:"working",vehicleInterest:"2023 Nissan Rogue",createdAt:"x",updatedAt:"x"},
      {id:"c",name:"Cy Poe",phone:"9025553333",email:"cy@e.com",stage:"appointment",vehicleInterest:"2019 Nissan Frontier",createdAt:"x",updatedAt:"x"},
      {id:"d",name:"Dee Marsh",phone:"9025554444",stage:"new",vehicleInterest:"2022 Nissan Sentra",createdAt:"x",updatedAt:"x"},
    ],
    texts:[
      {id:"t1",leadId:"a",dir:"out",body:"Hi Ann, worth a ten-minute look at where your Rogue sits.",at:old2,read:true,status:"sent",createdAt:"x",updatedAt:"x"},
      {id:"t2",leadId:"a",dir:"in",body:"what's my car worth? just ballpark it",at:older,read:false,createdAt:"x",updatedAt:"x"},
      {id:"t3",leadId:"c",dir:"out",body:"Your Frontier is paid off — worth understanding before you decide.",at:old2,read:true,status:"sent",createdAt:"x",updatedAt:"x"},
      // A reply whose customer record hasn't synced yet. Messages and leads
      // arrive as separate rows, so this really happens — and hiding the thread
      // means a customer texted and nothing anywhere shows it.
      {id:"t7",leadId:"nolead",dir:"in",body:"is the Rogue still available?",phone:"9025557777",at:older,read:false,createdAt:"x",updatedAt:"x"},
    ],
    calls:[{id:"cl1",leadId:"c",dir:"out",at:older,outcome:"left a voicemail",createdAt:"x",updatedAt:"x"}],
    // Cy opened his own booking link 3 times, minutes ago — the hot signal.
    links:[
      {id:"lk1",code:"abc",kind:"book",opens:3,firstOpenAt:older,lastOpenAt:recent,
       createdAt:old2,meta:{label:"Booking link — Cy",leadId:"c"},updatedAt:"x"},
      {id:"lk2",code:"xyz",kind:"invite",opens:1,firstOpenAt:old2,lastOpenAt:old2,
       createdAt:old2,meta:{label:"Rogue",leadId:"a"},updatedAt:"x"},
    ],
    emails:[
      {id:"e1",leadId:"a",direction:"out",subject:"Following up on the Rogue",body:"...",via:"auto",createdAt:older,updatedAt:"x"},
      {id:"e2",leadId:"c",direction:"in",subject:"Re: your Frontier",body:"...",via:"outlook",createdAt:old2,updatedAt:"x"},
    ],
    settings:{salesperson:"Parm",dealership:"O'Regan's Nissan",cloudAutoSync:false,smsFrom:"+19025550123",
      emailAutoSend:true, agentUrl:"http://127.0.0.1:8137/functions/v1/voice-agent"},
  }));
}, [mins(6), mins(90), mins(600)]);

await p.goto(APP+"/#/comms"); await p.waitForTimeout(900);
const order = await p.$$eval("#c-body .conv-row", n=>n.map(c=>c.textContent.replace(/\s+/g," ").trim().slice(0,95)));
console.log("MESSAGES tab:"); order.forEach(o=>console.log("  "+o));

// Cy has the live open, Ann has the unread reply — unread wins, hot is second.
if (!order.some(o=>/9025557777|\(902\) 555-7777/.test(o)))
  throw new Error("FAIL: a text whose lead hasn't synced was hidden — the customer is invisible");
// Ann and the orphan both have unread replies; both must be above Cy.
const cyAt = order.findIndex(o=>/Cy Poe/.test(o));
if (!order.slice(0, cyAt).some(o=>/Ann Lee/.test(o)))
  throw new Error("FAIL: unanswered reply should sort above a link open");
if (cyAt < 0) throw new Error("FAIL: Cy's thread is missing");
if (!/Opened/.test(order[cyAt]||"")) throw new Error("FAIL: Cy's row doesn't mention the open");

await p.$eval('[data-tab="email"]', x=>x.dispatchEvent(new MouseEvent("click",{bubbles:true})));
await p.waitForTimeout(500);
const em = await p.$$eval("#c-body .conv-row", n=>n.map(c=>c.textContent.replace(/\s+/g," ").trim().slice(0,85)));
console.log("\nEMAIL tab:"); em.forEach(o=>console.log("  "+o));
if (!em.some(x=>/automatic/i.test(x))) throw new Error("FAIL: automated email not marked");

// Thread: text + call + open all in one timeline.
await p.goto(APP+"/#/inbox/c"); await p.waitForTimeout(800);
const ev = await p.$$eval(".chat > *", n=>n.map(x=>x.className.split(" ")[0]+": "+x.textContent.replace(/\s+/g," ").trim().slice(0,70)));
console.log("\nCY'S THREAD:"); ev.forEach(x=>console.log("  "+x));
if (!ev.some(x=>/chat-event.*Opened/.test(x))) throw new Error("FAIL: link open missing from the thread");
if (!ev.some(x=>/chat-event.*called/i.test(x))) throw new Error("FAIL: call missing from the thread");
if (!ev.some(x=>/bubble/.test(x))) throw new Error("FAIL: text missing from the thread");
console.log("\npage errors:", errs.length?errs.join(" | "):"none");
if (errs.length) process.exit(1);
console.log("COMMS OK");
await b.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
