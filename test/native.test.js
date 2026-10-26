// The iPhone app: the same web app with the phone's own speech and push
// behind it. A fake Capacitor bridge stands in for the shell. Checks that
// the native recogniser speaks the browser's SpeechRecognition dialect the
// way voice.js uses it (partials, a final result at the first silence,
// no-speech when nothing is said, abort without a result), that turning on
// notifications saves an Apple device token instead of a web subscription,
// and that a tap on a notification lands on the page it names.
const { launch } = require("./browser.js");

(async () => {
const APP = "http://127.0.0.1:8137";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

await p.addInitScript(() => {
  localStorage.setItem("viniva:auth", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "p@e.com" } }));
  localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], tasks: [], settings: { salesperson: "Parm", cloudAutoSync: false, agentUrl: "http://127.0.0.1:8137/fn" } }));
  // The shell's bridge, as the test's phone: plugins reachable through
  // nativePromise/addListener, and a log of what was asked of them.
  const listeners = {};
  const log = [];
  window.__cap = { log, emit: (plugin, ev, data) => (listeners[plugin + ":" + ev] || []).forEach((fn) => fn(data)) };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
    addListener: (plugin, ev, fn) => { (listeners[plugin + ":" + ev] = listeners[plugin + ":" + ev] || []).push(fn); return { remove: () => { listeners[plugin + ":" + ev] = listeners[plugin + ":" + ev].filter((x) => x !== fn); } }; },
    nativePromise: (plugin, method, options) => {
      log.push({ plugin, method, options });
      if (plugin === "SpeechRecognition") {
        if (method === "requestPermissions") return Promise.resolve({ speechRecognition: window.__denySpeech ? "denied" : "granted" });
        if (method === "start") { setTimeout(() => window.__cap.emit("SpeechRecognition", "listeningState", { status: "started" }), 5); return Promise.resolve(); }
        if (method === "stop") { setTimeout(() => window.__cap.emit("SpeechRecognition", "listeningState", { status: "stopped" }), 20); return Promise.resolve(); }
      }
      if (plugin === "PushNotifications") {
        if (method === "requestPermissions" || method === "checkPermissions") return Promise.resolve({ receive: "granted" });
        if (method === "register") { setTimeout(() => window.__cap.emit("PushNotifications", "registration", { value: "abc123devicetoken" }), 10); return Promise.resolve(); }
        return Promise.resolve();
      }
      return Promise.resolve({});
    },
  };
});
await p.goto(APP + "/#/");
await p.waitForTimeout(700);

// --- The recogniser is in place before the app read it.
const shape = await p.evaluate(async () => {
  const v = await import("/js/voice.js");
  const d = await import("/js/dictate.js");
  return { defined: typeof window.SpeechRecognition === "function", name: window.SpeechRecognition.name, voice: v.voiceRecognitionSupported(), dictate: d.dictationSupported(), nativeClass: document.documentElement.classList.contains("native-app") };
});
console.log("shape:", JSON.stringify(shape));
if (!shape.defined || shape.name !== "NativeSpeechRecognition" || !shape.voice || !shape.dictate || !shape.nativeClass) fail("the native recogniser should be what voice.js and dictate.js see: " + JSON.stringify(shape));

// --- Spoken words: partials come as interim results; the first silence ends the turn with a final one and onend.
const turn = await p.evaluate(() => new Promise((resolve) => {
  const rec = new window.SpeechRecognition();
  rec.lang = "en-CA"; rec.interimResults = true; rec.maxAlternatives = 5; rec.continuous = false;
  const out = { interim: [], final: null, errors: [], ended: false, startedAt: 0 };
  rec.onstart = () => { out.startedAt = Date.now(); };
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (!r.isFinal) { out.interim.push(r[0].transcript); continue; }
      const alts = []; for (let k = 0; k < r.length; k++) alts.push(r[k].transcript);
      out.final = alts;
    }
  };
  rec.onerror = (ev) => out.errors.push(ev.error);
  rec.onend = () => { out.ended = true; out.endedAt = Date.now(); out.startCall = window.__cap.log.find((l) => l.method === "start"); resolve(out); };
  rec.start();
  setTimeout(() => window.__cap.emit("SpeechRecognition", "partialResults", { matches: ["show me"] }), 60);
  setTimeout(() => window.__cap.emit("SpeechRecognition", "partialResults", { matches: ["show me the lot", "show me the lots"] }), 160);
}));
console.log("turn:", JSON.stringify(turn));
if (turn.interim.join("|") !== "show me|show me the lot") fail("partials should arrive as interim results: " + JSON.stringify(turn.interim));
if (!turn.final || turn.final.join("|") !== "show me the lot|show me the lots") fail("the first silence should end the turn with every alternative as the final result: " + JSON.stringify(turn.final));
if (!turn.ended || turn.errors.length) fail("the turn should end cleanly: " + JSON.stringify(turn));
if (!(turn.endedAt - turn.startedAt >= 1300 && turn.endedAt - turn.startedAt < 3500)) fail("the sentence should be done about a second and a half after the last word: " + (turn.endedAt - turn.startedAt) + "ms");
if (!turn.startCall || turn.startCall.options.language !== "en-CA" || turn.startCall.options.maxResults !== 5 || turn.startCall.options.partialResults !== true) fail("the engine should be started with the app's language and alternatives, streaming partials: " + JSON.stringify(turn.startCall));

// --- Nothing said: no-speech, then onend — what the browser does, and what voice.js waits for.
const silent = await p.evaluate(() => new Promise((resolve) => {
  const rec = new window.SpeechRecognition();
  const out = { errors: [], results: 0, ended: false, t0: Date.now() };
  rec.onresult = () => out.results++;
  rec.onerror = (ev) => out.errors.push(ev.error);
  rec.onend = () => { out.ended = true; out.ms = Date.now() - out.t0; resolve(out); };
  rec.start();
}));
console.log("silent:", JSON.stringify(silent));
if (silent.errors.join() !== "no-speech" || silent.results || !silent.ended || silent.ms < 6500) fail("silence should end as no-speech after the wait: " + JSON.stringify(silent));

// --- Abort: the engine stops, no result is reported, onend still fires. Permission denied: not-allowed.
const aborted = await p.evaluate(() => new Promise((resolve) => {
  const rec = new window.SpeechRecognition();
  const out = { results: 0, errors: [], ended: false, stops: 0 };
  rec.onresult = () => out.results++;
  rec.onerror = (ev) => out.errors.push(ev.error);
  rec.onend = () => { out.ended = true; out.stops = window.__cap.log.filter((l) => l.method === "stop").length; resolve(out); };
  rec.start();
  setTimeout(() => window.__cap.emit("SpeechRecognition", "partialResults", { matches: ["never mind"] }), 60);
  setTimeout(() => rec.abort(), 120);
}));
console.log("aborted:", JSON.stringify(aborted));
if (aborted.results || aborted.errors.length || !aborted.ended || !aborted.stops) fail("abort should stop the engine and report nothing but onend: " + JSON.stringify(aborted));
const denied = await p.evaluate(() => new Promise((resolve) => {
  window.__denySpeech = true;
  const rec = new window.SpeechRecognition();
  const out = { errors: [], ended: false };
  rec.onerror = (ev) => out.errors.push(ev.error);
  rec.onend = () => { out.ended = true; window.__denySpeech = false; resolve(out); };
  rec.start();
}));
if (denied.errors.join() !== "not-allowed" || !denied.ended) fail("a refused microphone should read as not-allowed: " + JSON.stringify(denied));

// --- Notifications: on the phone there's no Home Screen step, and turning
// them on saves Apple's device token for the function to send through.
const push = await p.evaluate(async () => {
  const m = await import("/js/push.js");
  const s = await import("/js/store.js");
  const before = { supported: m.pushSupported(), needsInstall: m.needsInstall(), enabled: await m.pushEnabled() };
  await m.enablePush();
  const rec = s.all("push")[0] || null;
  const after = { enabled: await m.pushEnabled(), record: rec && { kind: rec.kind, token: rec.token, platform: rec.platform, hasSub: !!rec.sub } };
  const registered = window.__cap.log.some((l) => l.plugin === "PushNotifications" && l.method === "register");
  return { before, after, registered };
});
console.log("push:", JSON.stringify(push));
if (!push.before.supported || push.before.needsInstall || push.before.enabled) fail("the app should offer notifications with no install step: " + JSON.stringify(push.before));
if (!push.registered || !push.after.enabled || !push.after.record || push.after.record.kind !== "apns" || push.after.record.token !== "abc123devicetoken" || push.after.record.platform !== "ios" || push.after.record.hasSub) fail("enabling should register with Apple and save the token as the device's push record: " + JSON.stringify(push.after));
const off = await p.evaluate(async () => { const m = await import("/js/push.js"); const s = await import("/js/store.js"); await m.disablePush(); return { records: s.all("push").length, enabled: await m.pushEnabled(), unregistered: window.__cap.log.some((l) => l.method === "unregister") }; });
if (off.records || off.enabled || !off.unregistered) fail("turning them off should drop the record and unregister: " + JSON.stringify(off));

// --- A tap on a notification opens the page it names.
await p.evaluate(() => window.__cap.emit("PushNotifications", "pushNotificationActionPerformed", { actionId: "tap", notification: { id: "1", data: { url: "./#/log", tag: "rem:x" } } }));
await p.waitForTimeout(400);
const where = await p.evaluate(() => ({ hash: location.hash, title: document.getElementById("page-title").textContent }));
console.log("tap:", JSON.stringify(where));
if (where.hash !== "#/log") fail("a tapped notification should open the page in its url: " + JSON.stringify(where));

// --- In a browser, none of this exists.
const web = await ctx.newPage();
await web.addInitScript(() => { localStorage.setItem("sales-assistant:v1", JSON.stringify({ leads: [], settings: { salesperson: "Parm", cloudAutoSync: false } })); });
await web.goto(APP + "/#/");
await web.waitForTimeout(400);
const plain = await web.evaluate(async () => { const n = await import("/js/native.js"); return { native: n.isNative(), platform: n.platform(), shim: window.SpeechRecognition && window.SpeechRecognition.name === "NativeSpeechRecognition", cls: document.documentElement.classList.contains("native-app") }; });
if (plain.native || plain.platform !== "web" || plain.shim || plain.cls) fail("a browser should see no native bridge: " + JSON.stringify(plain));

if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close();
console.log(process.exitCode ? "native: FAILED" : "native: ok");
})().catch((e) => { console.error(e); process.exit(1); });
