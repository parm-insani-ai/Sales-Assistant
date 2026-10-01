// How this salesperson works — the preferences every message-writer reads.
//
// The assistant and the drafters used to start every turn from the same
// brief: the same tone for everyone, no sign-off, booking hours it had to
// guess. These are the few things that differ per rep and don't change
// from day to day, kept in settings (synced with everything else) and
// turned into one paragraph that goes into the brief, the follow-up texts,
// the replies and the emails alike — so a preference set once holds
// everywhere the app writes in the salesperson's name.

import * as store from "./store.js";

export const TONES = {
  warm: { label: "Warm", say: "warm and personal — like a text to someone you've met and liked" },
  straight: { label: "Straight", say: "straight and brief — friendly, no padding, gets to it" },
  upbeat: { label: "Upbeat", say: "upbeat and energetic — enthusiasm shows, still never pushy" },
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";

// The preferences, with defaults.
export function repStyle(s = store.getSettings()) {
  const tone = TONES[s.agentTone] ? s.agentTone : "warm";
  const days = Array.isArray(s.hoursDays) && s.hoursDays.length ? s.hoursDays : [1, 2, 3, 4, 5, 6];
  return {
    tone,
    signoff: String(s.agentSignoff || "").trim(),
    notes: String(s.agentNotes || "").trim(),
    hoursFrom: Number(s.hoursFrom ?? 9),
    hoursTo: Number(s.hoursTo ?? 18),
    days,
    name: first(s.salesperson),
  };
}

// The hours, in words: "9am to 6pm, Mon to Sat".
export function hoursLine(st = repStyle()) {
  const h = (n) => (n === 0 || n === 24 ? "midnight" : n === 12 ? "noon" : n < 12 ? `${n}am` : `${n - 12}pm`);
  const d = st.days.slice().sort((a, b) => a - b);
  const consecutive = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  const days = d.length === 7 ? "every day" : consecutive && d.length > 2 ? `${DAYS[d[0]]} to ${DAYS[d[d.length - 1]]}` : d.map((x) => DAYS[x]).join(", ");
  return `${h(st.hoursFrom)} to ${h(st.hoursTo)}, ${days}`;
}

// How a text or email should read, for a drafter's HOW TO WRITE section.
export function writingLine(st = repStyle()) {
  const bits = [`Tone: ${TONES[st.tone].say}.`];
  bits.push(st.signoff ? `Sign off with "${st.signoff}" — exactly that, nothing else after it.` : "Sign off only if it reads naturally; they know who it's from.");
  return bits.join(" ");
}

// The paragraph for the assistant's brief: tone, sign-off, hours, and
// whatever the salesperson wants it to always know.
export function styleBrief(st = repStyle()) {
  const lines = [
    `HOW ${st.name ? st.name.toUpperCase() : "THE SALESPERSON"} WORKS: messages to customers read ${TONES[st.tone].say}.`,
    st.signoff ? `Texts and emails are signed "${st.signoff}".` : "",
    `Appointments are booked ${hoursLine(st)}; when no time is said, pick one inside those hours.`,
    st.notes ? `Standing instructions from the salesperson, which always apply:\n${st.notes.split("\n").map((r) => r.replace(/^[-•*]\s*/, "").trim()).filter(Boolean).map((r) => `- ${r}`).join("\n")}` : "",
  ];
  return lines.filter(Boolean).join(" ");
}
