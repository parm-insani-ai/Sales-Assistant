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
//   • push — a real device token from Apple's push service, saved to the
//     "push" collection the function already reads, as {kind:"apns", token}
//     instead of a web subscription. No "add to Home Screen first".
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
// pause after words means the sentence is done (stop, report it as final);
// no words at all for a while means "no-speech", as the browser would say.
export const SILENCE_MS = 1300;   // quiet this long after words: the sentence is done
export const NO_SPEECH_MS = 7000; // nothing at all this long: no-speech
const STOP_GRACE_MS = 300;        // after the engine stops, a last partial may still land
const STOP_TIMEOUT_MS = 1500;     // the engine's "stopped" never came: finish anyway

let current = null;  // the recogniser whose turn it is — the engine is one
let wired = null;    // the plugin listeners, attached once

function wire() {
  if (!wired) {
    wired = Promise.all([
      listen("SpeechRecognition", "partialResults", (d) => { if (current) current._partial(Array.isArray(d && d.matches) ? d.matches : []); }),
      listen("SpeechRecognition", "listeningState", (d) => { if (current && d && d.status === "stopped") current._stopped(); }),
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
    this._matches = [];
    this._started = false; this._done = false; this._aborted = false;
    this._silence = 0; this._quiet = 0; this._grace = 0; this._stopGuard = 0;
  }
  _emit(name, ev) { const fn = this[name]; if (typeof fn === "function") { try { fn.call(this, ev); } catch (e) { console.error(e); } } }
  _event(isFinal) { return { resultIndex: 0, results: [resultOf(this._matches, isFinal)] }; }
  _clear() { clearTimeout(this._silence); clearTimeout(this._quiet); clearTimeout(this._grace); clearTimeout(this._stopGuard); }

  // The browser's start() is synchronous and throws if already started; this
  // one never throws into the caller — a start that can't happen reports
  // itself through onerror/onend, which is where the app already looks.
  start() {
    if (this._started) { this._emit("onerror", { error: "aborted", message: "already started" }); return; }
    this._started = true;
    if (current && current !== this) current._abandon();
    current = this;
    (async () => {
      try {
        await wire();
        const p = await call("SpeechRecognition", "requestPermissions");
        if (p && p.speechRecognition && p.speechRecognition !== "granted") return this._fail("not-allowed");
        await call("SpeechRecognition", "start", {
          language: this.lang || "en-US",
          maxResults: Math.min(5, Math.max(1, Number(this.maxAlternatives) || 1)),
          partialResults: true,
          popup: false,
        });
      } catch (e) {
        const msg = String((e && e.message) || e || "");
        return this._fail(/permission|denied|authori/i.test(msg) ? "not-allowed" : "audio-capture");
      }
      if (this._done) return;
      this._emit("onstart", {});
      this._quiet = setTimeout(() => this.stop(), NO_SPEECH_MS);
    })();
  }
  _partial(matches) {
    if (this._done || !matches.length) return;
    clearTimeout(this._quiet); this._quiet = 0;
    this._matches = matches;
    if (this._grace) return; // the engine has stopped; this is its last word
    if (this.interimResults) this._emit("onresult", this._event(false));
    clearTimeout(this._silence);
    this._silence = setTimeout(() => this.stop(), SILENCE_MS);
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
    this._done = true; this._clear();
    if (current === this) current = null;
    if (!this._aborted) {
      if (this._matches.length) this._emit("onresult", this._event(true));
      else this._emit("onerror", { error: "no-speech", message: "" });
    }
    this._emit("onend", {});
  }
  _fail(code) {
    if (this._done) return;
    this._done = true; this._clear();
    if (current === this) current = null;
    this._emit("onerror", { error: code, message: "" });
    this._emit("onend", {});
  }
  _abandon() { this._aborted = true; this._done = true; this._clear(); }
  stop() {
    if (this._done || !this._started) return;
    clearTimeout(this._silence); clearTimeout(this._quiet);
    call("SpeechRecognition", "stop").catch(() => {});
    if (!this._stopGuard) this._stopGuard = setTimeout(() => this._stopped(), STOP_TIMEOUT_MS);
  }
  abort() { this._aborted = true; if (this._started && !this._done) this.stop(); else this._abandon(); }
}

// ---- Push: Apple's device token, saved where the function looks ----
export async function nativePushGranted() {
  try { const p = await call("PushNotifications", "checkPermissions"); return !!(p && p.receive === "granted"); } catch { return false; }
}
// Ask, register, and hand back the device token. Throws plain-language messages.
export async function nativePushRegister() {
  const perm = await call("PushNotifications", "requestPermissions");
  if (!perm || perm.receive !== "granted") throw new Error("Notifications were declined — enable them for viniva in iOS Settings, then try again.");
  const handles = [];
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The phone didn't hand back a push token — check the signal and try again.")), 15000);
      handles.push(listen("PushNotifications", "registration", (tok) => { clearTimeout(timer); resolve(String((tok && tok.value) || "")); }));
      handles.push(listen("PushNotifications", "registrationError", (err) => { clearTimeout(timer); reject(new Error("Couldn't register for notifications: " + String((err && err.error) || err))); }));
      call("PushNotifications", "register").catch((e) => { clearTimeout(timer); reject(e); });
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
