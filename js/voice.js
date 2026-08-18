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

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export function voiceRecognitionSupported() { return !!SR; }

export function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
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
  let energy = 0, level = 0.06, mode = "listening", raf = 0;

  // Harmonize the lead ribbon with the theme's brand color.
  let brand = "#10c96f";
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
    else target = 0.13 + energy * 1.15; // listening
    level += (target - level) * 0.18;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const L of LAYERS) {
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
      ctx.shadowBlur = 12;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(frame);
  }
  resize();
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);
  return {
    bump(v = 1) { energy = Math.min(1, Math.max(energy, v)); },
    set(m) { mode = m; },
    stop() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); },
  };
}

export function startVoiceAssistant() {
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

  const statusEl = overlay.querySelector("#v-status");
  const transcriptEl = overlay.querySelector("#v-transcript");
  const textInput = overlay.querySelector("#v-text");
  const wave = makeWave(overlay.querySelector("#v-wave"));

  let rec = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { if (rec) rec.abort(); } catch {}
    wave.stop();
    overlay.remove();
  };
  overlay.querySelector(".voice-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  // Pulse the waveform as dictated/typed words stream in.
  textInput.addEventListener("input", () => wave.bump(0.85));
  overlay.querySelector("#v-wave").addEventListener("click", () => textInput.focus());

  // A conversational agent session for this panel (so it can ask a follow-up
  // and continue). Null when the agent isn't configured — we use the parser.
  const session = agentConfigured() ? createAgentSession() : null;

  const onParser = (text) => {
    const cmd = parseCommand(text);
    const say = cmd.action !== "error" ? executeCommand(cmd) : null;
    if (say) {
      statusEl.textContent = say;
      speak(say);
      toast(say, "success");
      setTimeout(close, 900);
    } else {
      statusEl.textContent = "Sorry, I didn't catch that — try rephrasing.";
      wave.set("idle");
      speak("Sorry, I didn't catch that.");
    }
  };

  const run = async (text) => {
    if (!text || !text.trim()) return;
    transcriptEl.textContent = `“${text.trim()}”`;

    // With the Claude-backed agent configured, hand it the request; it decides
    // which actions to run and we execute them locally. Fall back to the
    // on-device parser if the agent is unreachable.
    if (session) {
      statusEl.textContent = "Thinking…";
      wave.set("thinking");
      try {
        const res = await session.send(text, (n) => {
          if (n && !n.startsWith("⚠")) statusEl.textContent = n.charAt(0).toUpperCase() + n.slice(1) + "…";
        });
        const reply = res.say || "Done";
        statusEl.textContent = reply;
        speak(reply);
        if (res.done) {
          wave.set("idle");
          toast(reply, "success");
          setTimeout(close, 1300);
        } else {
          // The agent needs more info — keep the panel open for the answer.
          wave.set("listening");
          transcriptEl.textContent = "";
          textInput.value = "";
          textInput.focus();
        }
        return;
      } catch (e) {
        // Show the real error right in the panel so it's readable on the phone.
        const msg = e && e.message ? e.message : "couldn't reach the assistant";
        wave.set("idle");
        statusEl.textContent = "Voice agent error";
        transcriptEl.textContent = msg;
        toast(`Voice agent: ${msg}`, "danger");
        return;
      }
    }
    onParser(text);
  };

  overlay.querySelector("#v-form").addEventListener("submit", (e) => { e.preventDefault(); run(textInput.value); });

  // iOS Safari's speech recognition is unreliable and unavailable in installed
  // (home-screen) mode, so on iOS we lead with the text box + keyboard dictation,
  // which always works. Elsewhere we use live recognition.
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // Start speech recognition if available; otherwise fall straight to typing.
  if (SR && !isIOS) {
    try {
      rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      wave.set("listening");
      let finalText = "";
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        wave.bump(0.9);
        transcriptEl.textContent = `“${(finalText || interim).trim()}”`;
      };
      rec.onerror = (ev) => {
        wave.set("idle");
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed")
          statusEl.textContent = "Microphone blocked — type your command below.";
        else if (ev.error === "no-speech") statusEl.textContent = "Didn't hear anything — try again or type below.";
        else statusEl.textContent = "Voice unavailable — type your command below.";
      };
      rec.onend = () => {
        wave.set("idle");
        if (!closed && finalText.trim()) run(finalText);
        else if (!closed && statusEl.textContent === "Listening…") statusEl.textContent = "Go ahead — or type below.";
      };
      rec.start();
      setTimeout(() => textInput && textInput.setAttribute("placeholder", "Ask or tell me anything…"), 10);
    } catch {
      wave.set("idle");
      statusEl.textContent = "Type your command, or tap your keyboard's mic to dictate.";
      textInput.focus();
    }
  } else {
    wave.set("idle");
    statusEl.textContent = "Say your command";
    // Focus synchronously (within the tap gesture) so iOS opens the keyboard,
    // where the user can tap the dictation mic to speak.
    textInput.focus();
  }
}
