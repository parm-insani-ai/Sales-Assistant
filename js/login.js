// The front door. Nothing of the app shows until someone has signed in: one
// word in the middle of the screen and one box under it. The box asks for the
// email, then for the password — one thing to look at at a time.

import * as backend from "./backend.js";
import { esc } from "./utils.js";

/**
 * Cover the screen until a sign-in succeeds. Resolves with the signed-in
 * user once the session is stored; the caller decides what to do next.
 */
export function showLogin() {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.id = "login";
    root.innerHTML = `
      <form class="login-form" novalidate>
        <div class="login-word">viniva</div>
        <input class="login-box" name="email" type="email" inputmode="email" autocomplete="username"
          autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"
          placeholder="Email" aria-label="Email" />
        <input class="login-box" name="password" type="password" autocomplete="current-password"
          enterkeyhint="go" placeholder="Password" aria-label="Password" hidden />
        <div class="login-note" aria-live="polite"></div>
      </form>`;
    document.body.appendChild(root);

    const form = root.querySelector("form");
    const emailBox = root.querySelector('[name="email"]');
    const passBox = root.querySelector('[name="password"]');
    const note = root.querySelector(".login-note");
    let busy = false;

    const say = (html) => { note.innerHTML = html; };
    const askEmail = () => {
      passBox.hidden = true; passBox.value = "";
      emailBox.hidden = false;
      say("");
      emailBox.focus();
    };
    const askPassword = () => {
      emailBox.hidden = true;
      passBox.hidden = false;
      // The email you gave, as the way back to it.
      say(`<button type="button" class="login-back">${esc(emailBox.value.trim())}</button>`);
      note.querySelector(".login-back").addEventListener("click", askEmail);
      passBox.focus();
    };

    // Enter (or the keyboard's Go) is the only way through: there's no button.
    // A form with two fields and no submit button doesn't submit on Enter by
    // itself, so wire the key directly.
    form.addEventListener("submit", (e) => { e.preventDefault(); go(); });
    form.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });

    async function go() {
      if (busy) return;
      if (!emailBox.hidden) {
        const email = emailBox.value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) { say("Enter your email"); return; }
        askPassword();
        return;
      }
      const password = passBox.value;
      if (!password) { say("Enter your password"); return; }
      busy = true;
      root.classList.add("busy");
      say("Signing in…");
      try {
        await backend.signIn(emailBox.value.trim(), password);
        root.classList.add("login-out");
        setTimeout(() => root.remove(), 260);
        resolve(backend.currentUser());
      } catch (err) {
        const msg = navigator.onLine === false ? "You're offline" : (err && err.message) || "Sign-in failed";
        say(`${esc(msg)} · <button type="button" class="login-back">${esc(emailBox.value.trim())}</button>`);
        note.querySelector(".login-back").addEventListener("click", askEmail);
        passBox.focus();
        passBox.select();
      } finally {
        busy = false;
        root.classList.remove("busy");
      }
    }

    setTimeout(() => emailBox.focus(), 60);
  });
}
