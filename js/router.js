// Minimal hash-based router for the single-page app.

const routes = new Map();
let notFound = null;

export function route(path, handler) {
  routes.set(path, handler);
}

export function setNotFound(handler) {
  notFound = handler;
}

// Parse "#/leads/abc123" -> { path: "/leads", param: "abc123" }
function parse() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean); // ["leads","abc123"]
  const base = "/" + (parts[0] || "");
  return { base: base === "/" ? "/" : base, param: parts[1] || null, parts };
}

export function currentBase() {
  return parse().base;
}

export function navigate(path) {
  location.hash = path;
}

function render() {
  const { base, param, parts } = parse();
  const handler = routes.get(base) || notFound;
  if (handler) handler({ param, parts });
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  render();
}
