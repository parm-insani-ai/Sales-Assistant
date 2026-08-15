// Minimal iCalendar (.ics) parser — dependency-free. Turns a calendar feed into
// a flat list of event occurrences the app can drop onto the month grid. Handles
// folded lines, UTC / floating / all-day times, and a practical subset of RRULE
// (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, and weekly BYDAY),
// expanded within a bounded window so recurring meetings show up.

const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// RFC 5545 line unfolding: a leading space/tab means "continuation of previous".
function unfold(text) {
  const raw = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function unescapeText(s) {
  return String(s).replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

const pad = (n) => String(n).padStart(2, "0");

// Parse a DATE or DATE-TIME value into a JS Date (+ allDay flag).
function parseDate(val, params = {}) {
  const v = String(val).trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8);
    return { date: new Date(y, m - 1, d), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { date: null, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s); // floating / TZID → treat as local
  return { date, allDay: false };
}

function parseRRule(val) {
  const r = {};
  String(val).split(";").forEach((kv) => {
    const [k, v] = kv.split("=");
    if (k) r[k.toUpperCase()] = v;
  });
  return r;
}

function whenISO(date, allDay) {
  return allDay ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00` : date.toISOString();
}

// Expand one VEVENT into occurrences within [rangeStart, rangeEnd].
function expand(ev, rangeStart, rangeEnd) {
  const out = [];
  const push = (start) => {
    if (rangeStart && start < rangeStart) return;
    if (rangeEnd && start > rangeEnd) return;
    const end = ev.durMs ? new Date(start.getTime() + ev.durMs) : null;
    out.push({
      uid: ev.uid, title: ev.title || "(busy)", location: ev.location || "", allDay: ev.allDay,
      whenISO: whenISO(start, ev.allDay), endISO: end ? whenISO(end, ev.allDay) : null,
    });
  };

  if (!ev.start) return out;
  if (!ev.rrule) { push(ev.start); return out; }

  const r = ev.rrule;
  const freq = r.FREQ;
  const interval = Math.max(1, parseInt(r.INTERVAL || "1", 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
  const until = r.UNTIL ? parseDate(r.UNTIL).date : null;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((d) => DOW[d.trim().slice(-2)]).filter((n) => n != null) : null;
  const CAP = 800;
  let made = 0;
  let cursor = new Date(ev.start);

  for (let i = 0; i < CAP; i++) {
    let occs = [new Date(cursor)];
    if (freq === "WEEKLY" && byday && byday.length) {
      // Start of this cursor's week (Sunday), then each requested weekday.
      const weekStart = new Date(cursor); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      occs = byday.map((wd) => {
        const dt = new Date(weekStart); dt.setDate(dt.getDate() + wd);
        dt.setHours(ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds(), 0);
        return dt;
      }).filter((dt) => dt >= ev.start);
    }
    occs.sort((a, b) => a - b);
    for (const oc of occs) {
      if (until && oc > until) return out;
      if (count && made >= count) return out;
      push(oc); made++;
      if (count && made >= count) return out;
    }
    if (freq === "DAILY") cursor.setDate(cursor.getDate() + interval);
    else if (freq === "WEEKLY") cursor.setDate(cursor.getDate() + 7 * interval);
    else if (freq === "MONTHLY") cursor.setMonth(cursor.getMonth() + interval);
    else if (freq === "YEARLY") cursor.setFullYear(cursor.getFullYear() + interval);
    else return out; // unknown frequency → just the first occurrence already pushed
    if (rangeEnd && cursor > rangeEnd) break;
    if (until && cursor > until) break;
  }
  return out;
}

export function parseICS(text, { rangeStart, rangeEnd } = {}) {
  const lines = unfold(text);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start) {
        cur.durMs = cur.end ? (cur.end - cur.start) : 0;
        events.push(...expand(cur, rangeStart, rangeEnd));
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const rawKey = line.slice(0, idx);
    const val = line.slice(idx + 1);
    const parts = rawKey.split(";");
    const name = parts[0].toUpperCase();
    const params = {};
    parts.slice(1).forEach((pp) => { const [k, v] = pp.split("="); if (k) params[k.toUpperCase()] = v; });
    switch (name) {
      case "SUMMARY": cur.title = unescapeText(val); break;
      case "LOCATION": cur.location = unescapeText(val); break;
      case "UID": cur.uid = val.trim(); break;
      case "DTSTART": { const r = parseDate(val, params); cur.start = r.date; cur.allDay = r.allDay; break; }
      case "DTEND": { const r = parseDate(val, params); cur.end = r.date; break; }
      case "RRULE": cur.rrule = parseRRule(val); break;
      default: break;
    }
  }
  // Sort by start time.
  events.sort((a, b) => String(a.whenISO).localeCompare(String(b.whenISO)));
  return events;
}
