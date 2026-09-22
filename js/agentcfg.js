// Is the voice assistant's relay set up? Asked from the reply drafter and the
// touch reviewer on Home, so it lives here on its own: the assistant itself
// (agent.js, with every tool it can call) loads only when the mic is tapped.
import * as store from "./store.js";

export function agentConfigured() {
  return !!(store.getSettings().agentUrl || "").trim();
}
