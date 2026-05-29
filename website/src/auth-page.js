import {
  cleanText,
  getActiveSession,
  signInWithPassword,
  signUpWithPassword,
} from "./supabase.js";

function $(selector) {
  return document.querySelector(selector);
}

function authRedirectTarget() {
  const params = new URLSearchParams(window.location.search || "");
  const redirect = String(params.get("redirect") || "/dashboard/");
  return redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/dashboard/";
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-status${type ? ` ${type}` : ""}`;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.idleText;
}

async function redirectIfSignedIn() {
  const session = await getActiveSession();
  if (session) window.location.href = authRedirectTarget();
}

function bindLogin() {
  const form = $("#login-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-submit");
    const status = $("#login-status");
    setStatus(status, "");
    setBusy(button, true, "Logging in...");

    try {
      const identifier = cleanText($("#login-identifier")?.value, 240);
      const password = String($("#login-password")?.value || "");
      await signInWithPassword(identifier, password);
      setStatus(status, "Logged in. Opening Sonus...", "success");
      window.location.href = authRedirectTarget();
    } catch (error) {
      setStatus(status, error?.message || "Login failed.", "error");
    } finally {
      setBusy(button, false);
    }
  });
}

function bindSignup() {
  const form = $("#signup-form");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#signup-submit");
    const status = $("#signup-status");
    setStatus(status, "");
    setBusy(button, true, "Creating...");

    try {
      const password = String($("#signup-password")?.value || "");
      const passwordConfirm = String($("#signup-password-confirm")?.value || "");
      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      if (password !== passwordConfirm) {
        throw new Error("Passwords do not match.");
      }

      const result = await signUpWithPassword({
        username: $("#signup-username")?.value,
        email: $("#signup-email")?.value,
        password,
      });

      if (result.session) {
        setStatus(status, "Account created. Opening Sonus...", "success");
        window.location.href = authRedirectTarget();
      } else {
        setStatus(status, "Account created. If email confirmation is enabled, confirm it before logging in.", "success");
      }
    } catch (error) {
      setStatus(status, error?.message || "Signup failed.", "error");
    } finally {
      setBusy(button, false);
    }
  });
}

redirectIfSignedIn();
bindLogin();
bindSignup();
