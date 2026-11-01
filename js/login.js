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
        <button type="submit" class="login-go">Continue</button>
        <div class="login-note" aria-live="polite"></div>
        <button type="button" class="login-switch">New here? Create an account</button>
      </form>`;
    document.body.appendChild(root);

    const form = root.querySelector("form");
    const emailBox = root.querySelector('[name="email"]');
    const passBox = root.querySelector('[name="password"]');
    const note = root.querySelector(".login-note");
    const button = root.querySelector(".login-go");
    const switcher = root.querySelector(".login-switch");
    let busy = false;
    // Sign in, or create an account: same two boxes, different last step.
    let creating = false;
    const label = () => (emailBox.hidden ? (creating ? "Create account" : "Sign in") : "Continue");
    switcher.addEventListener("click", () => {
      creating = !creating;
      switcher.textContent = creating ? "Have an account? Sign in" : "New here? Create an account";
      passBox.autocomplete = creating ? "new-password" : "current-password";
      button.textContent = label();
      if (emailBox.hidden) say(creating ? "Choose a password of 6+ characters" : "");
    });

    const say = (html) => { note.innerHTML = html; };
    const askEmail = () => {
      passBox.hidden = true; passBox.value = "";
      emailBox.hidden = false;
      button.textContent = "Continue";
      say("");
      emailBox.focus();
    };
    const askPassword = () => {
      emailBox.hidden = true;
      passBox.hidden = false;
      button.textContent = label();
      // The email you gave, as the way back to it — and, signing in, the way
      // out of a forgotten password.
      say(`<button type="button" class="login-back">${esc(emailBox.value.trim())}</button>${creating ? " · choose a password of 6+ characters" : ` · <button type="button" class="login-forgot">Forgot password?</button>`}`);
      note.querySelector(".login-back").addEventListener("click", askEmail);
      const forgot = note.querySelector(".login-forgot");
      if (forgot) forgot.addEventListener("click", sendReset);
      passBox.focus();
    };
    // A reset link to the email in the box; the link opens the app on a
    // new-password screen (app.js, backend.recoverySession).
    async function sendReset() {
      if (busy) return;
      const email = emailBox.value.trim();
      busy = true; root.classList.add("busy"); button.disabled = true;
      say("Sending a reset link…");
      try {
        await backend.requestPasswordReset(email);
        say(`Check ${esc(email)} for a link to choose a new password. <button type="button" class="login-back">Back</button>`);
      } catch (err) {
        say(`${esc(navigator.onLine === false ? "You're offline" : (err && err.message) || "Couldn't send the link")} · <button type="button" class="login-back">Back</button>`);
      } finally {
        busy = false; root.classList.remove("busy"); button.disabled = false;
        const back = note.querySelector(".login-back");
        if (back) back.addEventListener("click", askPassword);
      }
    }

    // The button, or Enter (the keyboard's Go). Wired directly rather than
    // through the form's own submission so a stray Enter can't double-fire.
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
      if (!password) { say(creating ? "Choose a password" : "Enter your password"); return; }
      if (creating && password.length < 6) { say("Use a password of 6+ characters"); return; }
      busy = true;
      root.classList.add("busy");
      button.disabled = true;
      say(creating ? "Creating your account…" : "Signing in…");
      try {
        if (creating) {
          const r = await backend.signUp(emailBox.value.trim(), password);
          if (r.needsConfirmation) {
            // The project asks new accounts to confirm by email first.
            creating = false; switcher.textContent = "New here? Create an account"; button.textContent = label();
            say(`Check ${esc(emailBox.value.trim())} for a confirmation link, then sign in here.`);
            return;
          }
        } else {
          await backend.signIn(emailBox.value.trim(), password);
        }
        root.classList.add("login-out");
        setTimeout(() => root.remove(), 260);
        resolve(backend.currentUser());
      } catch (err) {
        let msg = navigator.onLine === false ? "You're offline" : (err && err.message) || (creating ? "Couldn't create the account" : "Sign-in failed");
        if (!creating && /invalid login credentials/i.test(msg)) msg = "Wrong password, or no account with this email yet";
        say(`${esc(msg)} · <button type="button" class="login-back">${esc(emailBox.value.trim())}</button>`);
        note.querySelector(".login-back").addEventListener("click", askEmail);
        passBox.focus();
        passBox.select();
      } finally {
        busy = false;
        button.disabled = false;
        root.classList.remove("busy");
      }
    }

    setTimeout(() => emailBox.focus(), 60);
  });
}

/**
 * The same door, for one job: a new password. Shown when the app opens from
 * a reset link (already signed in by it) — and reused by Change password
 * from the "+" sheet. Resolves once the password is saved; the cover goes.
 */
export function showNewPassword({ email = "", reason = "reset" } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.id = "login";
    root.innerHTML = `
      <form class="login-form" novalidate>
        <div class="login-word">viniva</div>
        <input class="login-box" name="password" type="password" autocomplete="new-password"
          enterkeyhint="go" placeholder="New password" aria-label="New password" />
        <button type="submit" class="login-go">Save password</button>
        <div class="login-note" aria-live="polite">${email ? `${esc(email)} · ` : ""}choose a password of 6+ characters</div>
        ${reason === "change" ? `<button type="button" class="login-switch">Keep the one I have</button>` : ""}
      </form>`;
    document.body.appendChild(root);
    const form = root.querySelector("form"), box = root.querySelector('[name="password"]'), note = root.querySelector(".login-note"), button = root.querySelector(".login-go");
    const say = (html) => { note.innerHTML = html; };
    const done = (ok) => { root.classList.add("login-out"); setTimeout(() => root.remove(), 260); resolve(ok); };
    const keep = root.querySelector(".login-switch");
    if (keep) keep.addEventListener("click", () => done(false));
    let busy = false;
    async function go() {
      if (busy) return;
      const password = box.value;
      if (password.length < 6) { say("Use a password of 6+ characters"); box.focus(); return; }
      busy = true; root.classList.add("busy"); button.disabled = true;
      say("Saving…");
      try {
        await backend.changePassword(password);
        done(true);
      } catch (err) {
        say(esc(navigator.onLine === false ? "You're offline" : (err && err.message) || "Couldn't save the password"));
        box.focus(); box.select();
      } finally { busy = false; root.classList.remove("busy"); button.disabled = false; }
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); go(); });
    form.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    setTimeout(() => box.focus(), 60);
  });
}
