// One short dictation: press, talk, done. The speech engine's readings are
// picked against the names and models this salesperson actually deals in
// (asr.js), the same as the voice assistant does — but this is not a
// conversation. Nothing is parsed as a command and nothing talks back. It
// is for a note, said once, straight after a call.
//
//   const d = dictate({ onInterim(text), onFinal(text), onFallback(reason) });
//   d.stop();   // finish early and hand over what was heard
//
// Must be started from a tap: browsers only open the microphone inside a
// user gesture. When there is no engine, the mic is blocked, or the signal
// is bad, onFallback fires with a plain sentence and the caller offers the
// keyboard (whose own mic key still dictates).

import { pickBest, repair, recognitionLang, vocabulary } from "./asr.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function dictationSupported() { return !!SR; }

export function dictate({ onInterim, onFinal, onFallback } = {}) {
  let rec = null, heard = "", done = false;
  const vocab = vocabulary();
  const finish = (text) => {
    if (done) return;
    done = true;
    if (onFinal) onFinal(repair(String(text || "").trim(), vocab));
  };
  const fallback = (why) => {
    if (done) return;
    done = true;
    if (onFallback) onFallback(why, repair(heard.trim(), vocab));
  };
  if (!SR) { setTimeout(() => fallback("Voice isn't available here — type it below."), 0); return { stop() {} }; }
  try { rec = new SR(); } catch { setTimeout(() => fallback("Voice isn't available here — type it below."), 0); return { stop() {} }; }
  rec.lang = recognitionLang();
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  rec.continuous = false;
  rec.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (!r.isFinal) { interim += r[0].transcript; continue; }
      const alts = [];
      for (let k = 0; k < r.length; k++) alts.push(r[k].transcript);
      heard += pickBest(alts, vocab);
    }
    if (onInterim) onInterim((heard + interim).trim());
  };
  rec.onerror = (ev) => {
    if (ev.error === "aborted") return; // stop() — onend hands over what was heard
    if (ev.error === "no-speech") return;
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") return fallback("Microphone blocked — type it below.");
    if (ev.error === "network") return fallback("Can't reach the speech service — type it below.");
    fallback("Voice isn't working here — type it below.");
  };
  rec.onend = () => finish(heard);
  try { rec.start(); } catch { setTimeout(() => fallback("Voice isn't available here — type it below."), 0); }
  return {
    stop() { try { rec.stop(); } catch { finish(heard); } },
  };
}
