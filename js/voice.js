// Voice assistant. Uses the Web Speech API for hands-free capture where the
// browser supports it (with a typed-command fallback for iOS Safari, where the
// user can also tap the keyboard's dictation mic). Commands are parsed on-device
// — no backend, no API key — into create/navigate/search actions.

import * as store from "./store.js";
import { navigate } from "./router.js";
import { toast } from "./components.js";
import { icon } from "./icons.js";
import { openDealerSearch } from "./views/dealer.js";
import { maybeStartCadence } from "./cadence.js";
import { agentConfigured, createAgentSession } from "./agent.js";
import { pickBest, repair, recognitionLang, vocabulary } from "./asr.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export function voiceRecognitionSupported() { return !!SR; }

export function speak(text) {
  speakAsync(text);
}

// Speaking, but awaitable. In a conversation the app has to know when its own
// voice has stopped before it starts listening again — otherwise the microphone
// hears the reply and answers itself. Resolves on end, on error, and on a
// timeout, because some platforms simply never fire onend and a conversation
// that waits forever is worse than one that talks over itself occasionally.
export function speakAsync(text) {
  return new Promise((resolve) => {
    try {
      if (!("speechSynthesis" in window) || !text) return resolve();
      const u = new SpeechSynthesisUtterance(String(text));
      u.rate = 1.05;
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      u.onend = finish;
      u.onerror = finish;
      // Roughly the time it takes to say it, plus slack.
      setTimeout(finish, Math.min(20000, 1200 + String(text).length * 70));
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}

export function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch { }
}

// ---------- Date / time / number helpers ----------
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function nextWeekday(target) {
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7; // 0 = today
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function parseDay(t) {
  if (/\btoday\b/.test(t)) return isoOffset(0);
  if (/\btomorrow\b/.test(t)) return isoOffset(1);
  const m = t.match(/\bin (\d+) days?\b/);
  if (m) return isoOffset(parseInt(m[1], 10));
  if (/\bnext week\b/.test(t)) return isoOffset(7);
  for (let i = 0; i < 7; i++) if (new RegExp("\\b" + WEEKDAYS[i] + "\\b").test(t)) return nextWeekday(i);
  return null;
}
function parseTime(t) {
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (/p/.test(m[3])) h += 12;
    return [h, m[2] ? parseInt(m[2], 10) : 0];
  }
  if (/\bnoon\b/.test(t)) return [12, 0];
  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  return null;
}
function localDateTime(dayISO, hm) {
  const day = dayISO || isoOffset(0);
  const [h, m] = hm || [new Date().getHours() + 1, 0];
  const pad = (n) => String(n).padStart(2, "0");
  return `${day}T${pad(h)}:${pad(m)}`;
}
// Pull a number that follows a keyword, e.g. moneyAfter("commission 1,500", "commission") -> 1500
function moneyAfter(t, ...keys) {
  for (const k of keys) {
    const m = t.match(new RegExp(k + "\\s*(?:of|is|was)?\\s*\\$?([0-9][0-9,\\.]*)"));
    if (m) return Number(m[1].replace(/[,]/g, ""));
  }
  return null;
}
function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim();
}
// Grab the words between a start keyword and the next stop keyword.
function between(t, startRe, stopRe) {
  const s = t.match(startRe);
  if (!s) return "";
  let rest = t.slice(s.index + s[0].length);
  const stop = rest.match(stopRe);
  if (stop) rest = rest.slice(0, stop.index);
  return rest.trim();
}

// ---------- Command parser ----------
const NAV = [
  { re: /\b(home|dashboard)\b/, route: "/", label: "Home" },
  { re: /\b(leads?|customers?|pipeline|prospects?)\b/, route: "/leads", label: "Leads" },
  { re: /\b(inventory|vehicles?|cars?|stock)\b/, route: "/inventory", label: "Inventory" },
  { re: /\b(deal|calculator|payment)\b/, route: "/calculator", label: "the deal calculator" },
  { re: /\b(deliver(y|ies))\b/, route: "/deliveries", label: "Deliveries" },
  { re: /\b(calendar|appointments?|schedule)\b/, route: "/calendar", label: "Calendar" },
  { re: /\b(goals?|commissions?)\b/, route: "/goals", label: "Goals" },
  { re: /\b(settings|preferences)\b/, route: "/settings", label: "Settings" },
];

export function parseCommand(raw) {
  const t = " " + raw.toLowerCase().trim().replace(/[.!?]+$/g, "") + " ";

  // 1) Create lead
  if (/\b(new|add|create|log)\b.*\b(lead|customer|prospect)\b/.test(t)) {
    let name = between(t, /\b(lead|customer|prospect)\b/, /\b(interested|looking|wants|who wants|for a|follow|phone|number|email|$)/);
    const vehicle = between(t, /\b(interested in|looking for|wants|for a)\b/, /\b(follow|phone|number|email|$)/).replace(/^(a|an|the)\s+/i, "");
    const followUp = parseDay(t.match(/follow ?up[\s\S]*/)?.[0] || "");
    name = titleCase(name);
    if (!name) return { action: "error" };
    return { action: "lead", name, vehicleInterest: vehicle ? titleCase(vehicle) : "", followUp };
  }

  // 2) Add task / reminder
  if (/\b(add|new|create)\b.*\btask\b/.test(t) || /\bremind me to\b/.test(t) || /\bto-?do\b/.test(t)) {
    let title = between(t, /\b(task to|task|remind me to|to-?do)\b/, /\b(today|tomorrow|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next week|in \d+ days?|$)/);
    const due = parseDay(t);
    title = title.trim().replace(/^to\s+/, "");
    if (!title) return { action: "error" };
    return { action: "task", title: title.charAt(0).toUpperCase() + title.slice(1), due };
  }

  // 3) Log a sale
  if (/\blog (a )?sale\b|\brecord (a )?sale\b|\bmade a sale\b/.test(t)) {
    const name = titleCase(between(t, /\bsale (to|for|with)\b/, /\b(commission|gross|front|back|for \$|$)/));
    const commission = moneyAfter(t, "commission", "commish");
    const front = moneyAfter(t, "front", "front gross");
    const back = moneyAfter(t, "back", "back gross");
    return { action: "sale", customerName: name, commission, frontGross: front, backGross: back };
  }

  // 4) Schedule appointment
  if (/\b(schedule|book|set up)\b/.test(t) && !/\bfollow ?up\b/.test(t)) {
    let type = "appointment";
    if (/\btest ?drive\b/.test(t)) type = "testdrive";
    else if (/\bdeliver/.test(t)) type = "delivery";
    else if (/\bcall\b/.test(t)) type = "call";
    const name = titleCase(between(t, /\bwith\b/, /\b(at|on|tomorrow|today|next|for|about|$)/));
    const when = localDateTime(parseDay(t), parseTime(t));
    return { action: "appointment", type, customerName: name, when };
  }

  // 5) Dealer inventory search
  if (/\b(find|search|look for|show me)\b.*\b(car|vehicle|truck|suv|sedan|used|new|rogue|pathfinder|frontier|kicks|altima|sentra|titan|murano|maxima|versa|armada)\b/.test(t)
      || /\bsearch (the )?(network|store|inventory)\b/.test(t)) {
    const store_ = /\b(my store|store|new car)\b/.test(t) && !/\bnetwork\b/.test(t);
    const query = titleCase(between(t, /\b(find|search for|search|look for|show me)\b/, /\b(on the|in the|network|store|inventory|$)/)
      .replace(/\b(a|an|the|used|new|car|vehicle|for)\b/g, " "));
    return { action: "search", target: store_ ? "store" : "network", query };
  }

  // 6) Calculator
  if (/\b(calculate|figure|work out|payment on|quote|run numbers)\b/.test(t)) {
    const price = moneyAfter(t, "on", "of", "price", "payment on") || (t.match(/\$?([0-9][0-9,\.]{3,})/) ? Number(RegExp.$1.replace(/,/g, "")) : null);
    return { action: "calc", price };
  }

  // 7) Navigation (checked last so "add lead" isn't caught as "leads")
  if (/\b(go to|open|show|navigate to|take me to|switch to)\b/.test(t)) {
    for (const n of NAV) if (n.re.test(t)) return { action: "nav", route: n.route, label: n.label };
  }

  return { action: "error" };
}

// ---------- Execute a parsed command; returns a spoken confirmation ----------
export function executeCommand(cmd) {
  switch (cmd.action) {
    case "nav":
      navigate(cmd.route);
      return `Opening ${cmd.label}`;
    case "lead": {
      const lead = store.create("leads", {
        name: cmd.name, vehicleInterest: cmd.vehicleInterest || "", stage: "new",
        source: "Voice", followUp: cmd.followUp || null, phone: "", email: "", notes: "",
      });
      maybeStartCadence(lead.id);
      navigate(`/leads/${lead.id}`);
      return `Added lead ${cmd.name}${cmd.vehicleInterest ? ", interested in " + cmd.vehicleInterest : ""}. Add their phone number to start texting.`;
    }
    case "task": {
      store.create("tasks", { title: cmd.title, due: cmd.due || "", priority: "normal", done: false });
      navigate("/");
      return `Added to-do: ${cmd.title}${cmd.due ? "" : ""}`;
    }
    case "sale": {
      store.create("sales", {
        customerName: cmd.customerName || "Customer", vehicle: "",
        saleDate: isoOffset(0), commission: cmd.commission ?? null,
        frontGross: cmd.frontGross ?? null, backGross: cmd.backGross ?? null, notes: "",
      });
      navigate("/goals");
      return `Logged the sale${cmd.customerName ? " for " + cmd.customerName : ""}${cmd.commission ? ", commission $" + cmd.commission : ""}. Nice work!`;
    }
    case "appointment": {
      const label = { appointment: "Appointment", testdrive: "Test drive", delivery: "Delivery", call: "Phone call" }[cmd.type] || "Appointment";
      const a = store.create("appointments", {
        type: cmd.type, title: label, customerName: cmd.customerName || "", vehicle: "",
        when: cmd.when, status: "scheduled", leadId: null, notes: "",
      });
      navigate(`/calendar/${a.id}`);
      return `Scheduled a ${label.toLowerCase()}${cmd.customerName ? " with " + cmd.customerName : ""}`;
    }
    case "search":
      openDealerSearch({ vehicleInterest: cmd.query });
      return `Searching ${cmd.target === "store" ? "your store" : "the O'Regan's network"}${cmd.query ? " for " + cmd.query : ""}`;
    case "calc":
      if (cmd.price) sessionStorage.setItem("calc-prefill", JSON.stringify({ price: cmd.price, label: "Voice quote" }));
      navigate("/calculator");
      return cmd.price ? `Calculating a payment on ${cmd.price}` : "Opening the deal calculator";
    default:
      return null;
  }
}

// ---------- Overlay UI ----------
// A flowing Siri-style soundwave: several translucent sine ribbons layered in a
// cool gradient (brand → cyan → indigo) that taper to a point at both ends. The
// ribbon rests as a near-flat glow when idle, swells with your voice while
// listening (pulsed by each recognized/dictated chunk), and settles into a
// steady travelling shimmer while the assistant thinks. Returns { bump, set, stop }.
function makeWave(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const t0 = performance.now();
  let energy = 0, level = 0.06, mode = "listening", raf = 0, compact = false;

  // Harmonize the lead ribbon with the theme's brand color.
  let brand = "#46B681";
  try { const v = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim(); if (v) brand = v; } catch {}
  const LAYERS = [
    { amp: 1.00, cycles: 1.3, sp: 0.9,  w: 2.8, col: brand,     a: 0.95 },
    { amp: 0.74, cycles: 2.0, sp: -1.4, w: 2.3, col: "#22d3ee", a: 0.60 }, // cyan
    { amp: 0.52, cycles: 2.8, sp: 1.9,  w: 2.0, col: "#6366f1", a: 0.48 }, // indigo
  ];
  const TAU = Math.PI * 2;

  function resize() {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 140;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame(now) {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 140;
    const t = (now - t0) / 1000, mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    energy *= 0.93;
    // Ease the overall amplitude toward the target for the current mode.
    let target;
    if (mode === "idle") target = 0.05;
    else if (mode === "thinking") target = 0.32;
    // Speaking gets its own steady swell, so the ribbon distinguishes "I'm
    // talking" from "I'm listening to you" — otherwise you can't tell whether
    // it's your turn.
    else if (mode === "speaking") target = 0.5 + Math.sin(performance.now() / 260) * 0.12;
    else target = 0.13 + energy * 1.15; // listening
    level += (target - level) * 0.18;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const L of (compact ? LAYERS.slice(0, 1) : LAYERS)) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const nx = x / w;                                   // 0..1
        const env = Math.pow(Math.sin(Math.PI * nx), 1.7);  // taper both ends
        const A = level * (h * 0.44) * L.amp;
        const y = mid + env * A * Math.sin(nx * TAU * L.cycles + t * L.sp * 2.4);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = L.w;
      ctx.strokeStyle = L.col;
      ctx.globalAlpha = L.a;
      ctx.shadowColor = L.col;
      ctx.shadowBlur = compact ? 6 : 12;
      if (compact) ctx.lineWidth = Math.max(2.4, ctx.lineWidth);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(frame);
  }
  resize();
  window.addEventListener("resize", resize);
  // The canvas changes size when the panel docks — from the full-screen hero to
  // a strip an inch wide. Only listening to window resize left it rendering at
  // the old backing size and being squashed into the new box, which is what
  // made the docked ribbon look like a stray squiggle rather than a waveform.
  let ro = null;
  if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }
  raf = requestAnimationFrame(frame);
  return {
    bump(v = 1) { energy = Math.min(1, Math.max(energy, v)); },
    set(m) { mode = m; },
    // Docked, the ribbon is a status light an inch wide, not the hero of a
    // full-screen panel. Three interleaved colours at that size read as a stray
    // squiggle, so it drops to one line in the app's own green — which is also
    // the colour of the Voice button it now sits above.
    compact(on) { compact = !!on; },
    stop() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); if (ro) ro.disconnect(); },
  };
}

// The one live session, if there is one. Two overlays talking at once — each
// with its own recogniser fighting for the microphone — is never what the tap
// meant, and there are two buttons that can start one now.
let session_ = null;

/**
 * Open the voice assistant.
 *
 * `docked: true` starts it as the strip at the top rather than the full panel.
 * That's what the mic in a conversation wants: you're looking at the thread,
 * you have something to say about it, and covering the thread to say it would
 * be the same mistake docking exists to fix.
 */
export function startVoiceAssistant({ docked: startDocked = false } = {}) {
  // Already listening: bring that session to the user rather than stacking a
  // second one on top of it.
  if (session_) {
    if (startDocked) session_.dock(); else session_.undock();
    return session_;
  }
  const root = document.getElementById("modal-root");
  const overlay = document.createElement("div");
  overlay.className = "voice-overlay";
  overlay.innerHTML = `
    <div class="voice-sheet">
      <div class="voice-grip"></div>
      <button class="voice-close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="voice-stage">
        <canvas class="voice-wave" id="v-wave" aria-hidden="true"></canvas>
      </div>
      <div class="voice-status" id="v-status">Listening…</div>
      <div class="voice-transcript" id="v-transcript"></div>
      <form class="voice-input" id="v-form">
        <input id="v-text" type="text" placeholder="Ask or tell me anything…" autocomplete="off" enterkeyhint="send" />
        <button class="voice-send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12h13"/><path d="M12.5 6.5 19 12l-6.5 5.5"/></svg></button>
      </form>
    </div>
  `;
  root.appendChild(overlay);
  // The Voice button in the tab bar is this feature's own control; while a
  // session is live it carries the live state, so the strip isn't an orphan
  // indicator floating above a button that looks switched off.
  document.body.classList.add("voice-live");

  const statusEl = overlay.querySelector("#v-status");
  const transcriptEl = overlay.querySelector("#v-transcript");
  const textInput = overlay.querySelector("#v-text");
  const wave = makeWave(overlay.querySelector("#v-wave"));

  let rec = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { if (rec) { rec.onend = null; rec.abort(); } } catch { }
    window.removeEventListener("entoa-navigated", onRoute);
    document.body.classList.remove("voice-live");
    // Give the shell its top back, or the app stays pushed down behind a strip
    // that no longer exists.
    clearStrip();
    if (stripRO) stripRO.disconnect();
    stopSpeaking();
    wave.stop();
    overlay.remove();
    session_ = null;
  };
  overlay.querySelector(".voice-close").addEventListener("click", (e) => { e.stopPropagation(); close(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // --- Docking ---
  //
  // When the agent takes you somewhere to finish something — a conversation
  // with the text already written — the panel used to stay full-height over the
  // top of it. It would say "just hit send" while covering the send button.
  //
  // So a route change docks it. Tap to bring it back.
  //
  // The bar takes the top of the screen and the app shell is moved down to
  // start underneath it — it doesn't hover over the screen at all. Docked at
  // the bottom it was still a thing lying on top of the app: however flush it
  // was made against the tab bar, it covered a row of the conversation it had
  // just opened, and the first thing you did was scroll to see what was there.
  // Taking a slice of the screen instead of borrowing one means there is
  // nothing left to interfere with.
  let docked = false;
  const sheet = overlay.querySelector(".voice-sheet");

  // How far down to push the app. The strip's height isn't a constant — the
  // status-bar inset differs per device, and the text can change the line box —
  // so it's measured and published for the stylesheet to consume.
  function measureStrip() {
    if (!docked || closed) return;
    const h = Math.round(sheet.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty("--voice-strip-h", `${h}px`);
  }
  // Keep it honest: rotation, a longer status line wrapping, the keyboard
  // changing the insets. A stale height would leave a band of nothing under the
  // strip, or clip the top bar behind it.
  let stripRO = null;
  if (window.ResizeObserver) { stripRO = new ResizeObserver(measureStrip); stripRO.observe(sheet); }

  function clearStrip() {
    document.body.classList.remove("voice-docked");
    document.documentElement.style.removeProperty("--voice-strip-h");
  }

  function dock() {
    if (docked || closed) return;
    docked = true;
    overlay.classList.add("voice-docked");
    document.body.classList.add("voice-docked");
    wave.compact(true);
    // A frame, so the strip has been laid out at its docked size before it's
    // measured — otherwise the app is offset by the full panel's height.
    requestAnimationFrame(measureStrip);
  }
  function undock() {
    if (!docked || closed) return;
    docked = false;
    overlay.classList.remove("voice-docked");
    clearStrip();
    wave.compact(false);
  }
  sheet.addEventListener("click", () => { if (docked) undock(); });

  // The agent navigating IS the signal. Anything that moves the app — opening a
  // thread, a screen, a customer — means there's something on screen to look at.
  // Router event rather than hashchange: re-entering the screen you're already
  // on still puts an answer in front of you, and hashchange doesn't fire for it.
  const onRoute = () => { dock(); requestAnimationFrame(measureStrip); };
  window.addEventListener("entoa-navigated", onRoute);
  // Pulse the waveform as dictated/typed words stream in.
  textInput.addEventListener("input", () => wave.bump(0.85));
  overlay.querySelector("#v-wave").addEventListener("click", () => textInput.focus());

  // A conversational agent session for this panel, so it can ask a follow-up
  // and continue. Created on the first turn that needs it rather than at open,
  // because settings can arrive from cloud sync — or be fixed in Settings —
  // after the panel is already up, and a session decided once at open would
  // leave you talking to the keyword parser for the rest of the session.
  let session = null;
  const agentSession = () => {
    if (!agentConfigured()) return null;
    if (!session) session = createAgentSession();
    return session;
  };

  // --- Conversation ---
  //
  // The panel used to take one sentence, act, and close. That's a command box,
  // not a conversation: every follow-up meant tapping the mic again, and
  // anything the agent said back was the end of the exchange rather than the
  // middle of one. It now runs a loop — listen, act, answer, listen again —
  // until you close it or say you're done.
  // Built once when the panel opens: it walks every customer and vehicle, and
  // recognition results arrive several times a second.
  const vocab = vocabulary();
  let hearing = false;      // recognition is running right now
  let quiet = 0;            // consecutive rounds that heard nothing
  let busy = false;         // acting on something; don't listen over it

  // Ways to say "we're finished" that shouldn't be sent to the agent as a
  // command. People trail off with a thank-you — "that's all thanks" — so the
  // courtesy is stripped before the phrase is matched, and a bare thank-you
  // counts on its own.
  const THANKS = /\b(thanks?(\s+you)?|cheers|appreciate it)\b[.,! ]*$/i;
  const FAREWELL = /^(that'?s (it|all)|nothing( else)?|never ?mind|i'?m (good|done)|all good|we'?re done|done|stop|goodbye|bye|cancel|close)[.,! ]*$/i;
  function isFarewell(said) {
    // Dictation returns typographic apostrophes — "that\u2019s all" would sail
    // past a pattern written with the straight one and be sent to the agent as
    // a command.
    const bare = String(said).replace(/[\u2018\u2019\u02bc]/g, "'").trim();
    const core = bare.replace(THANKS, "").trim();
    if (!core) return THANKS.test(bare);       // just "thanks"
    // "no thanks" ends it; a bare "no" must not, or answering a yes/no question
    // from the agent would hang up on it.
    if (/^no(pe)?[.,! ]*$/i.test(core)) return core !== bare;
    return FAREWELL.test(core);
  }

  const setStatus = (t) => { statusEl.textContent = t; };

  function stopHearing() {
    try { if (rec) { rec.onend = null; rec.abort(); } } catch { }
    rec = null;
    hearing = false;
  }

  // The no-agent path. This is a fixed keyword grammar — it knows "book Ken
  // Thursday at 4" and a dozen shapes like it, and nothing else. Understanding
  // an arbitrary sentence is the model's job, so when it can't match, the
  // honest answer names the reason.
  //
  // It used to say "Sorry, I didn't catch that — try rephrasing." That blamed
  // the sentence for a missing connection, and sent you off rewording a
  // question that was never the problem: no rephrasing of anything reaches a
  // parser that doesn't have the concept.
  const onParser = (text) => {
    const cmd = parseCommand(text);
    const say = cmd.action !== "error" ? executeCommand(cmd) : null;
    if (say) return say;
    return "I can't work that out without the assistant connected — open Settings and tap Test connection under Voice agent.";
  };

  const run = async (text) => {
    const said = (text || "").trim();
    if (!said || busy) return;
    if (isFarewell(said)) {
      await speakAsync("Okay.");
      return close();
    }
    busy = true;
    stopHearing();
    transcriptEl.textContent = `\u201c${said}\u201d`;
    textInput.value = "";

    let reply = "";
    let ok = true;
    const agent = agentSession();
    if (agent) {
      setStatus("Thinking\u2026");
      wave.set("thinking");
      try {
        const res = await agent.send(said, (n) => {
          if (n && !n.startsWith("\u26a0")) setStatus(n.charAt(0).toUpperCase() + n.slice(1) + "\u2026");
        });
        reply = res.say || "Done";
      } catch (e) {
        ok = false;
        reply = e && e.message ? e.message : "I couldn't reach the assistant";
        toast(`Voice agent: ${reply}`, "danger");
      }
    } else {
      reply = onParser(said);
    }

    setStatus(docked && reply.length > 60 ? reply.slice(0, 58).trimEnd() + "\u2026" : reply);
    wave.set("speaking");
    busy = false;
    await speakAsync(reply);
    // Straight back to listening. A conversation doesn't end because one answer
    // did — the next thing said is usually a follow-up on the same subject, and
    // the agent session remembers it.
    if (!closed) { if (ok) listen(); else fallbackToTyping("Tap the mic to try again, or type below."); }
  };

  overlay.querySelector("#v-form").addEventListener("submit", (e) => { e.preventDefault(); run(textInput.value); });

  function fallbackToTyping(msg) {
    stopHearing();
    wave.set("idle");
    setStatus(msg);
    textInput.focus();
  }

  // One turn of listening. A fresh recogniser each time: these are one-shot on
  // most engines, and reusing one that has already ended silently never fires
  // again.
  function listen() {
    if (closed || busy || hearing || !SR) return;
    let heard = "";
    try {
      rec = new SR();
    } catch {
      return fallbackToTyping("Voice isn't available here \u2014 type below.");
    }
    rec.lang = recognitionLang();
    rec.interimResults = true;
    // Engines return several readings of the same audio and rank them for
    // general English. Asking for a handful lets the app pick the one that
    // mentions a customer who actually exists.
    rec.maxAlternatives = 5;
    rec.continuous = false;
    hearing = true;
    wave.set("listening");
    setStatus("Listening\u2026");

    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r.isFinal) { interim += r[0].transcript; continue; }
        // Every alternative for this chunk, best-of picked against the names
        // and models this salesperson actually deals in.
        const alts = [];
        for (let k = 0; k < r.length; k++) alts.push(r[k].transcript);
        heard += pickBest(alts, vocab);
      }
      wave.bump(0.9);
      transcriptEl.textContent = `\u201c${(heard || interim).trim()}\u201d`;
    };
    rec.onerror = (ev) => {
      hearing = false;
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed")
        return fallbackToTyping("Microphone blocked \u2014 type your command below.");
      if (ev.error === "no-speech") return; // onend deals with it
      // Anything else (network, aborted, audio-capture): one retry, then type.
      if (++quiet >= 2) fallbackToTyping("Voice isn't working here \u2014 type below.");
    };
    rec.onend = () => {
      hearing = false;
      if (closed || busy) return;
      const said = repair(heard.trim(), vocab);
      if (said) {
        quiet = 0;
        transcriptEl.textContent = `\u201c${said}\u201d`;
        return run(said);
      }
      // Heard nothing. Keep the conversation open for a couple of rounds, then
      // stop rather than holding the mic open forever.
      if (++quiet >= 3) return fallbackToTyping("Still here \u2014 tap the mic or type below.");
      setTimeout(() => { if (!closed && !busy) listen(); }, 250);
    };
    try { rec.start(); } catch { hearing = false; fallbackToTyping("Type your command below."); }
  }

  // Tapping the waveform interrupts: stop talking and listen. That's how you
  // cut the agent off mid-sentence when you already know what you want.
  overlay.querySelector("#v-wave").addEventListener("click", () => {
    if (docked) { undock(); return; }
    stopSpeaking();
    if (hearing) { stopHearing(); wave.set("idle"); setStatus("Paused \u2014 tap to talk."); }
    else { quiet = 0; listen(); }
  });

  // Speech recognition is attempted everywhere now, including iOS. It used to
  // be skipped there on the assumption it doesn't work in an installed app,
  // which made the mic button a keyboard on the one device this is built for.
  // If it genuinely isn't available the error handlers above fall through to
  // typing within a second, which is a better trade than never trying.
  if (SR) {
    listen();
  } else {
    wave.set("idle");
    setStatus("Type your command, or tap your keyboard's mic to dictate.");
    // Focus synchronously (within the tap gesture) so iOS opens the keyboard.
    textInput.focus();
  }

  // Started from a place that already has something on screen worth keeping —
  // the mic in a conversation — so open as the strip, not over the top of it.
  if (startDocked) dock();

  session_ = { dock, undock, close, isDocked: () => docked };
  return session_;
}
