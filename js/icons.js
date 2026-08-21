// Line-icon system. Returns inline SVG markup that inherits the current text
// color (stroke = currentColor), matching the navigation bar's icon style.
// Usage in templates:  `${icon("phone")} Call`
// Size scales with font-size via the .ico CSS class; pass "ico-xl" for big
// empty-state icons.

const PATHS = {
  phone: '<path d="M6.8 10.6a12.5 12.5 0 0 0 5.6 5.6l1.9-1.9a1.3 1.3 0 0 1 1.3-.3 8.6 8.6 0 0 0 2.7.4A1.3 1.3 0 0 1 19.6 15.7V18.4a1.3 1.3 0 0 1-1.3 1.3A15.3 15.3 0 0 1 4.3 5.7 1.3 1.3 0 0 1 5.6 4.4H8.3a1.3 1.3 0 0 1 1.3 1.3 8.6 8.6 0 0 0 .4 2.7 1.3 1.3 0 0 1-.3 1.3z"/>',
  message: '<path d="M20 11.5a7 7 0 0 1-9.9 6.4L4.5 19.5l1.2-5.4A7 7 0 1 1 20 11.5z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="m3.6 7 8.4 6 8.4-6"/>',
  file: '<path d="M13 3H7.5A2 2 0 0 0 5.5 5v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.3 2.5 2.5 4.7-5.1"/>',
  checkline: '<path d="M4 12.5 9 17.5 20 6.5"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5v3M8.5 17.5h3.5"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h2.8l6.2 4V5L6.8 9H4a1 1 0 0 0-1 1z"/><path d="M17 8.2a5 5 0 0 1 0 7.6"/>',
  edit: '<path d="M12.5 20H21"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z"/>',
  sparkles: '<path d="M12 3.2l1.8 4.9 4.9 1.9-4.9 1.8L12 16.7l-1.8-4.9L5.3 10l4.9-1.9z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  users: '<circle cx="9" cy="8" r="3.3"/><path d="M3.4 20a5.6 5.6 0 0 1 11.2 0"/><path d="M16.2 5.3a3.3 3.3 0 0 1 0 5.9"/><path d="M18.4 20a5.6 5.6 0 0 0-3-4.95"/>',
  car: '<path d="M4.5 13.2 6 8.9A2 2 0 0 1 7.9 7.5h8.2a2 2 0 0 1 1.9 1.4l1.5 4.3"/><path d="M3.5 13.2h17V18a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1z"/><path d="M7 15.5h.01M17 15.5h.01"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  dollar: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9a2.7 2.7 0 0 0-2.6-1.7c-1.5 0-2.6.9-2.6 2.1s1.1 1.8 2.6 2.1 2.6.9 2.6 2.1-1.1 2.1-2.6 2.1A2.7 2.7 0 0 1 9.4 15"/><path d="M12 6v1.3M12 16.7V18"/>',
  calendar: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v3M16 3v3"/>',
  settings: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.9 15H3.8a2 2 0 1 1 0-4H4a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.5 4V3.8a2 2 0 1 1 4 0V4a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.5 1z"/>',
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.7"/>',
  alert: '<path d="M12 3.2 2.6 20h18.8z"/><path d="M12 9.5v4.5M12 17.4v.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.7 1.2c0 1.7-2.3 2.2-2.3 3.6"/><path d="M12 17.4v.1"/>',
  store: '<path d="M4 9.4 5.1 4h13.8L20 9.4"/><path d="M4 9.4a2.4 2.4 0 0 0 4 1.8 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4-1.8"/><path d="M5.2 11v8.5h13.6V11"/><path d="M9.8 19.5V15h4.4v4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6V12l3 1.9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M21.5 2.5 11 13"/><path d="M21.5 2.5 14.8 21.5l-3.8-8.5-8.5-3.8z"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5"/><path d="M10 10.5v6M14 10.5v6"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z"/><path d="M10.5 19a1.8 1.8 0 0 0 3 0"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.8 10.3 4.2 4.2 4.2-4.2"/><path d="M4.5 20h15"/>',
  upload: '<path d="M12 20.5v-11"/><path d="m7.8 13.7 4.2-4.2 4.2 4.2"/><path d="M4.5 4h15"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
  award: '<circle cx="12" cy="9" r="5"/><path d="m9 13.4-1.6 7.1 4.6-2.6 4.6 2.6L15 13.4"/>',
  compare: '<rect x="4" y="4.5" width="6.4" height="15" rx="1.4"/><rect x="13.6" y="8" width="6.4" height="11.5" rx="1.4"/>',
  tag: '<path d="M20.5 12.3 12.3 20.5 3.5 11.7V4a.5.5 0 0 1 .5-.5h7.7z"/><circle cx="8.4" cy="8" r="1.4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/>',
};

export function icon(name, extra = "") {
  const p = PATHS[name] || PATHS.pin;
  return `<svg class="ico${extra ? " " + extra : ""}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}
