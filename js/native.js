// The bridge to the phone, for when viniva runs inside its own app.
//
// The web app is the product. Wrapped by Capacitor (see native/README.md),
// the same files run inside an iPhone app, and the native shell injects
// `window.Capacitor` before any page script runs. This module is loaded
// first (index.html) and, when that bridge is present, gives the rest of the
// app the two things the iPhone's browser engine does badly:
//
//   • window.SpeechRecognition — Apple's own recognizer, behind the shape
//     voice.js and dictate.js already use (start/stop/abort, onresult with
//     alternatives, onerror, onend). The browser's version stops listening
//     after a few seconds, fails in home-screen mode on some iOS versions,
//     and can't hear a showroom. This one can.
//   • push — a real device token from Apple's push service (or Google's, on
//     Android), saved to the "push" collection the function already reads,
//     as {kind:"apns"|"fcm", token} instead of a web subscription. No "add
//     to Home Screen first".
//
// In a browser it defines nothing and its helpers answer "not native".
// Everything goes through the bridge's own calls (nativePromise/addListener),
// so no Capacitor runtime bundle is needed — the app stays plain modules.

const cap = () => window.Capacitor;

export function isNative() {
  const c = cap();
  if (!c) return false;
  try { return typeof c.isNativePlatform === "function" ? !!c.isNativePlatform() : !!c.isNative; } catch { return false; }
}
export function platform() {
  try { return isNative() ? String(cap().getPlatform()) : "web"; } catch { return "web"; }
}

// What happened on the native side, for Settings → Storage check: a phone
// can't be attached to a debugger, and "the mic just gives me the keyboard"
// has to be answerable from a screenshot. Failures also go into the same
// error list the page-level catcher keeps (index.html), so they show there.
export const nativeDiag = { bridge: !!window.Capacitor, native: isNative(), platform: platform(), speechStarts: 0, speechOk: 0, lastSpeechError: "", lastSpeechAt: "", trail: [] };
// A short trail of what the recognizer did, newest last — the shape of a
// failed turn is readable from it: start, words arriving, the stop, what
// was handed over.
function trail(what) {
  const t = new Date();
  nativeDiag.trail.push(`${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")} ${what}`);
  if (nativeDiag.trail.length > 24) nativeDiag.trail.shift();
}
// The voice panel adds its own steps to the same trail (what it did with
// the words), so a turn can be followed end to end.
export function diagTrail(what) { trail(what); }
function note(kind, msg, src = "native.js") {
  try {
    const K = "viniva:errors";
    const l = JSON.parse(localStorage.getItem(K) || "[]");
    l.push({ at: new Date().toISOString(), kind, msg: String(msg || "").slice(0, 300), src, hash: location.hash });
    localStorage.setItem(K, JSON.stringify(l.slice(-20)));
  } catch { /* no storage, no note */ }
}
// For other modules: a failure worth seeing in Settings → Storage check.
export function noteError(kind, msg, src = "") { note(kind, msg, src); }

// A plugin call. The shell's bridge exposes nativePromise for any plugin the
// app was built with; a registered proxy (Capacitor.Plugins.X) is used when
// that's what there is — which is also how the test stands in for the phone.
function call(plugin, method, options) {
  const c = cap();
  if (c && typeof c.nativePromise === "function") return c.nativePromise(plugin, method, options);
  const p = c && c.Plugins && c.Plugins[plugin];
  if (p && typeof p[method] === "function") return Promise.resolve(p[method](options));
  return Promise.reject(new Error(`${plugin}.${method}: no native bridge`));
}
// Returns a promise of a handle with remove(), or of null when nothing listens.
function listen(plugin, event, fn) {
  const c = cap();
  if (c && typeof c.addListener === "function") return Promise.resolve(c.addListener(plugin, event, fn));
  const p = c && c.Plugins && c.Plugins[plugin];
  if (p && typeof p.addListener === "function") return Promise.resolve(p.addListener(event, fn));
  return Promise.resolve(null);
}

// ---- Speech: Apple's recognizer behind the browser's interface ----
//
// The plugin streams whole-utterance partials ("show me", "show me the",
// "show me the lot") and only stops when told to, or after about a minute.
// The browser engine the app was written for stops itself at the first real
// silence and reports a final result then. So this watches the partials: a
// pause after words means the sentence is done (report it as final); no
// words at all for a while means "no-speech", as the browser would say.
//
// One native session serves several turns. Stopping the engine at every
// pause and starting it again a moment later is what failed on the phone:
// the teardown is slow and a start that lands inside it is refused
// ("Session activation failed"). So a pause hands the words over and leaves
// the engine running; the next recogniser adopts it and sees only the words
// that come after. The engine is really stopped when the app asks (abort —
// the top of a turn, the pause button, closing the panel), when nobody has
// claimed it for a few seconds, or when it ends by itself.
export const SILENCE_MS = 1300;   // quiet this long after words: the sentence is done
export const NO_SPEECH_MS = 7000; // nothing at all this long: no-speech
const STOP_GRACE_MS = 300;        // after the engine stops, a last partial may still land
const STOP_TIMEOUT_MS = 1500;     // the engine's "stopped" never came: finish anyway
const IDLE_STOP_MS = 2500;        // running with nobody listening this long: stop it

let current = null;  // the recogniser whose turn it is — the engine is one
let wired = null;    // the plugin listeners, attached once
// The engine as this module believes it to be: whether it's up, how many
// words of its running transcription have already been handed over, and a
// promise that its "stopped" resolves so the next real start can wait for
// the teardown to finish.
const engine = { running: false, consumed: 0, settled: Promise.resolve(), settle: null, idle: 0 };
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);
const cleanMatches = (m) => (Array.isArray(m) ? m : []).map((s) => String(s || "").trim()).filter(Boolean);
function engineStopping() {
  if (!engine.settle) engine.settled = new Promise((r) => { engine.settle = r; });
  engine.running = false; engine.consumed = 0;
}
function engineStopped() {
  engine.running = false; engine.consumed = 0;
  if (engine.settle) { const r = engine.settle; engine.settle = null; r(); }
}
function realStop(why) {
  clearTimeout(engine.idle); engine.idle = 0;
  trail(`stop (${why})`);
  engineStopping();
  call("SpeechRecognition", "stop").catch(() => {});
}
// Running with nobody listening: a leak, and a microphone left open.
function scheduleIdleStop() {
  clearTimeout(engine.idle);
  engine.idle = setTimeout(() => { engine.idle = 0; if (engine.running && !current) realStop("idle"); }, IDLE_STOP_MS);
}

// The plugin's events carry no session id, and a session that was just
// stopped can still report a last word or a second "stopped" after the next
// one has begun. So a recogniser takes events only once it is live — the
// engine said "started" for it, or it adopted a running engine — and
// anything else belongs to a predecessor and is dropped.
function wire() {
  if (!wired) {
    wired = Promise.all([
      listen("SpeechRecognition", "partialResults", (d) => {
        const m = cleanMatches(d && d.matches);
        if (!m.length) return;
        if (current && current._live) current._partial(m);
        else trail(`stray words (${m.length}) ignored`);
      }),
      listen("SpeechRecognition", "listeningState", (d) => {
        const s = d && d.status;
        if (s === "started") engine.running = true;
        if (s === "stopped") engineStopped();
        if (!current) { trail(`stray ${s} ignored`); return; }
        if (s === "started") { current._live = true; trail("engine started"); }
        else if (s === "stopped") { if (current._live) current._stopped(); else trail("stray stopped ignored"); }
      }),
    ]);
  }
  return wired;
}

// Array-like, the way SpeechRecognitionResult is: r[k].transcript, r.length, r.isFinal.
function resultOf(matches, isFinal) {
  const r = matches.map((t) => ({ transcript: String(t), confidence: isFinal ? 0.9 : 0.5 }));
  r.isFinal = isFinal;
  return r;
}

export class NativeSpeechRecognition {
  constructor() {
    this.lang = "en-US";
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.continuous = false;
    this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null;
    this._matches = [];   // the words this turn, beyond what earlier turns took
    this._total = 0;      // words in the engine's whole running transcription
    this._started = false; this._done = false; this._aborted = false; this._live = false;
    this._silence = 0; this._quiet = 0; this._grace = 0; this._stopGuard = 0;
  }
  _emit(name, ev) {
    const fn = this[name];
    if (typeof fn !== "function") return;
    try { fn.call(this, ev); } catch (e) { console.error(e); note("speech", `${name} handler: ${String((e && e.message) || e)}`); }
  }
  _event(isFinal) { return { resultIndex: 0, results: [resultOf(this._matches, isFinal)] }; }
  _clear() { clearTimeout(this._silence); clearTimeout(this._quiet); clearTimeout(this._grace); clearTimeout(this._stopGuard); }
  _release() { this._done = true; this._clear(); if (current === this) current = null; }

  // The browser's start() is synchronous and throws if already started; this
  // one never throws into the caller — a start that can't happen reports
  // itself through onerror/onend, which is where the app already looks.
  start() {
    if (this._started) { this._emit("onerror", { error: "aborted", message: "already started" }); return; }
    this._started = true;
    if (current && current !== this) current._abandon();
    current = this;
    clearTimeout(engine.idle); engine.idle = 0;
    nativeDiag.speechStarts++;
    (async () => {
      try {
        await wire();
        if (this._done) return;
        // An engine already running from the last turn is this turn's too.
        if (engine.running && !engine.settle) {
          this._live = true;
          nativeDiag.speechOk++;
          trail("listening on (same session)");
          this._emit("onstart", {});
          this._quiet = setTimeout(() => this._quietOut(), NO_SPEECH_MS);
          return;
        }
        // Let the last session finish tearing down (its "stopped", or a
        // second at most), then a breath for the audio session to settle.
        await Promise.race([engine.settled, new Promise((r) => setTimeout(r, 1000))]);
        await new Promise((r) => setTimeout(r, 150));
        if (this._done) return;
        const p = await call("SpeechRecognition", "requestPermissions");
        if (p && p.speechRecognition && p.speechRecognition !== "granted") return this._fail("not-allowed");
        const opts = {
          language: this.lang || "en-US",
          maxResults: Math.min(5, Math.max(1, Number(this.maxAlternatives) || 1)),
          partialResults: true,
          popup: false,
        };
        // The microphone may not be ready, or the phone's audio session
        // still held by the recognizer that just stopped or the voice that
        // just finished speaking ("Session activation failed"): wait, try
        // again, a few times, a little longer each time.
        for (let attempt = 0; ; attempt++) {
          try {
            engine.consumed = 0;
            await call("SpeechRecognition", "start", opts);
            engine.running = true;
            break;
          } catch (e) {
            const msg = String((e && e.message) || e || "");
            const transient = /already running|isn't ready|not ready|activation failed|audio session/i.test(msg);
            if (!transient || attempt >= 3) throw e;
            trail(`retry ${attempt + 1}: ${msg.slice(0, 40)}`);
            engineStopping();
            await call("SpeechRecognition", "stop").catch(() => {});
            await Promise.race([engine.settled, new Promise((r) => setTimeout(r, 1000))]);
            await new Promise((r) => setTimeout(r, [500, 1000, 1500, 2500][attempt]));
            if (this._done) return;
          }
        }
      } catch (e) {
        const msg = String((e && e.message) || e || "");
        nativeDiag.lastSpeechError = msg; nativeDiag.lastSpeechAt = new Date().toISOString();
        note("speech", `start failed: ${msg}`);
        return this._fail(/permission|denied|authori/i.test(msg) ? "not-allowed" : "audio-capture");
      }
      if (this._done) return;
      nativeDiag.speechOk++;
      trail("start ok");
      this._emit("onstart", {});
      this._quiet = setTimeout(() => this._quietOut(), NO_SPEECH_MS);
    })();
  }
  // Words from the engine: the whole transcription so far. Only what comes
  // after the words earlier turns already took belongs to this one.
  _partial(matches) {
    if (this._done) return;
    const total = words(matches[0]).length;
    if (total <= engine.consumed) return;
    const fresh = matches.map((m) => words(m).slice(engine.consumed).join(" ")).filter(Boolean);
    if (!fresh.length) return;
    clearTimeout(this._quiet); this._quiet = 0;
    if (!this._matches.length) trail("words arriving");
    this._matches = fresh;
    this._total = total;
    if (this._grace) return; // the engine has stopped; this is its last word
    if (this.interimResults) this._emit("onresult", this._event(false));
    clearTimeout(this._silence);
    this._silence = setTimeout(() => this._pause(), SILENCE_MS);
  }
  // Quiet after words: the sentence is done. Hand it over, leave the engine
  // running for whoever listens next.
  _pause() {
    if (this._done) return;
    engine.consumed = this._total;
    trail(`pause: ${words(this._matches[0]).length} words handed over`);
    this._release();
    scheduleIdleStop();
    this._emit("onresult", this._event(true));
    this._emit("onend", {});
  }
  // Nothing said for a while: no-speech, as the browser says. The engine
  // stays up for a retry; the idle stop takes it down if none comes.
  _quietOut() {
    if (this._done) return;
    trail("no speech");
    this._release();
    scheduleIdleStop();
    this._emit("onerror", { error: "no-speech", message: "" });
    this._emit("onend", {});
  }
  // The engine stopped — on our stop(), by itself, or on an error. A final
  // partial can arrive just after; give it a moment.
  _stopped() {
    if (this._done || this._grace) return;
    clearTimeout(this._stopGuard);
    this._grace = setTimeout(() => this._finish(), STOP_GRACE_MS);
  }
  _finish() {
    if (this._done) return;
    this._release();
    if (!this._aborted) {
      if (this._matches.length) { trail(`final: ${words(this._matches[0]).length} words`); this._emit("onresult", this._event(true)); }
      else { trail("no speech"); this._emit("onerror", { error: "no-speech", message: "" }); }
    } else trail("aborted");
    this._emit("onend", {});
  }
  _fail(code) {
    if (this._done) return;
    this._release();
    trail(`failed: ${code}`);
    this._emit("onerror", { error: code, message: "" });
    this._emit("onend", {});
  }
  _abandon() { this._aborted = true; this._release(); }
  // The app's own stop: finish for real, engine and all.
  stop() {
    if (this._done || !this._started) return;
    clearTimeout(this._silence); clearTimeout(this._quiet);
    realStop(this._matches.length ? "asked, with words" : "asked");
    if (!this._stopGuard) this._stopGuard = setTimeout(() => this._stopped(), STOP_TIMEOUT_MS);
  }
  // Aborting while live stops the engine. Aborting a recogniser that has
  // already finished (voice.js does, at the top of every turn, before it
  // starts the next) touches nothing: the engine stays up for the next one,
  // and the idle stop takes it down if none comes.
  abort() {
    this._aborted = true;
    if (this._started && !this._done) { this.stop(); return; }
    this._abandon();
  }
}

// ---- Requests through the phone's own networking ----
// The shell carries a native HTTP plugin (CapacitorHttp, always registered
// on iOS and Android). Inside the web view a large POST to the function was
// dying a few seconds in while small requests got through; the phone's own
// URL loader has none of the web view's quirks, so the assistant's calls go
// this way when the app is native. Returns { status, headers, data } with
// data already parsed when the reply is JSON. Throws when there's no bridge.
export function nativeHttpAvailable() {
  const c = cap();
  return isNative() && !!c && typeof c.nativePromise === "function";
}
export async function nativeRequest({ url, method = "GET", headers = {}, body = undefined, timeoutMs = 120000 }) {
  if (!nativeHttpAvailable()) throw new Error("no native http");
  let data = body;
  const ct = String(headers["Content-Type"] || headers["content-type"] || "");
  if (typeof body === "string" && /application\/json/i.test(ct)) { try { data = JSON.parse(body); } catch { /* send as text */ } }
  const res = await call("CapacitorHttp", "request", {
    url, method, headers, data,
    dataType: data !== undefined && typeof data !== "string" ? "json" : undefined,
    connectTimeout: Math.min(timeoutMs, 60000), readTimeout: timeoutMs,
    responseType: "json",
  });
  return { status: Number(res && res.status) || 0, headers: (res && res.headers) || {}, data: res ? res.data : null, url: res && res.url };
}

// ---- Push: Apple's device token, saved where the function looks ----
export async function nativePushGranted() {
  try { const p = await call("PushNotifications", "checkPermissions"); return !!(p && p.receive === "granted"); } catch { return false; }
}
// Ask, register, and hand back the device token. Throws plain-language messages.
export async function nativePushRegister() {
  const android = platform() === "android";
  const perm = await call("PushNotifications", "requestPermissions");
  if (!perm || perm.receive !== "granted") throw new Error(`Notifications were declined — enable them for viniva in ${android ? "the phone's" : "iOS"} Settings, then try again.`);
  // Android groups notifications by channel; this is viniva's.
  if (android) await call("PushNotifications", "createChannel", { id: "viniva", name: "viniva", description: "Reminders, replies and what's come in", importance: 4, visibility: 1, vibration: true }).catch(() => {});
  const handles = [];
  // On Android the token comes from Google's messaging service, which is only
  // in the build when the Firebase file was (native/README.md).
  const explain = (e) => /firebase|default firebaseapp|google/i.test(String(e)) ? "This Android build has no Firebase file in it, so it can't receive notifications — see native/README.md." : "Couldn't register for notifications: " + String(e);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The phone didn't hand back a push token — check the signal and try again.")), 15000);
      handles.push(listen("PushNotifications", "registration", (tok) => { clearTimeout(timer); resolve(String((tok && tok.value) || "")); }));
      handles.push(listen("PushNotifications", "registrationError", (err) => { clearTimeout(timer); reject(new Error(explain((err && err.error) || err))); }));
      call("PushNotifications", "register").catch((e) => { clearTimeout(timer); reject(new Error(explain((e && e.message) || e))); });
    });
  } finally {
    for (const h of handles) h.then((x) => x && x.remove && x.remove()).catch(() => {});
  }
}
export async function nativePushUnregister() {
  try { await call("PushNotifications", "unregister"); } catch { /* nothing to undo */ }
}

// A tap on a notification: go where it points. Payloads carry the same
// url the web push does ("./#/inbox/<id>"); only the hash matters here.
export function openPushUrl(url) {
  const s = String(url || "");
  const i = s.indexOf("#");
  const hash = i >= 0 ? s.slice(i) : (s.startsWith("/") ? "#" + s : "");
  if (hash && hash !== location.hash) location.hash = hash;
  else if (hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

if (isNative()) {
  // Defined before voice.js and dictate.js read it (this module is the first
  // script on the page, and app.js's imports come after).
  window.SpeechRecognition = NativeSpeechRecognition;
  // The shell's own errors (a plugin that isn't in this build, say) land in
  // the same list the Storage check shows.
  wire().then((handles) => { if (handles.every((h) => !h)) note("native", "no listener bridge: speech events can't arrive"); }).catch((e) => note("native", "speech listeners: " + String((e && e.message) || e)));
  listen("PushNotifications", "pushNotificationActionPerformed", (a) => {
    const n = (a && a.notification) || {};
    const d = n.data || {};
    openPushUrl(d.url || n.link || "");
  }).catch(() => {});
  // Opening the app clears what's piled up in the notification tray.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") call("PushNotifications", "removeAllDeliveredNotifications").catch(() => {});
  });
  document.documentElement.classList.add("native-app");
}
