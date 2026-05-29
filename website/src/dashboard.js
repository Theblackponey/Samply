import {
  deleteMachine,
  ensureProfile,
  fetchProfile,
  formatDate,
  getActiveSession,
  isValidPassword,
  isValidUsername,
  listMachines,
  normalizeUsername,
  readBool,
  readOAuthCallback,
  signOut,
  updateAccountPassword,
  updateProfile,
} from "./supabase.js";
import { confirmCheckoutSession } from "./billing.js";

let state = {
  session: null,
  profile: null,
  machines: [],
};

function $(selector) {
  return document.querySelector(selector);
}

function text(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-status${type ? ` ${type}` : ""}`;
}

function initials(profile) {
  const source = profile?.username || profile?.email || "S";
  return String(source).trim().charAt(0).toUpperCase() || "S";
}

function machineName(machine) {
  return machine.machine_name || "Unnamed machine";
}

function machineMeta(machine) {
  const parts = [machine.platform, machine.arch, machine.app_version ? `v${machine.app_version}` : ""].filter(Boolean);
  const seen = formatDate(machine.last_seen);
  return `${parts.join(" / ") || "Unknown platform"} · Last seen ${seen}`;
}

async function loadMachines() {
  state.machines = await listMachines(state.session);
  renderMachines();
}

function renderMachines() {
  const list = $("#machine-list");
  const count = $("#machine-count");
  if (!list) return;

  if (count) count.textContent = `${state.machines.length} / 2`;

  if (!state.machines.length) {
    list.innerHTML = `<p class="hint">No desktop machine registered yet. Sign in from the Sonus app to register one.</p>`;
    return;
  }

  list.innerHTML = state.machines.map((machine) => `
    <div class="machine-card" data-machine-id="${machine.machine_id}">
      <div>
        <strong>${machineName(machine)}</strong>
        <span>${machineMeta(machine)}</span>
      </div>
      <button class="btn btn-muted" data-remove-machine="${machine.machine_id}">Remove</button>
    </div>
  `).join("");

  list.querySelectorAll("[data-remove-machine]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.confirming === "yes") {
        button.disabled = true;
        button.textContent = "Removing...";
        try {
          await deleteMachine(state.session, button.dataset.removeMachine);
          await loadMachines();
        } catch (error) {
          button.disabled = false;
          button.textContent = error?.message || "Failed";
        }
        return;
      }

      button.dataset.confirming = "yes";
      button.textContent = "Confirm?";
      window.setTimeout(() => {
        if (button.isConnected && button.dataset.confirming === "yes") {
          button.dataset.confirming = "";
          button.textContent = "Remove";
        }
      }, 2600);
    });
  });
}

function showUsernameSetup() {
  const needsPassword = !readBool(state.profile?.password_set);
  $("#username-setup").hidden = false;
  $("#dashboard-content").hidden = true;
  text("#dashboard-title", needsPassword ? "Finish your account" : "Choose your username");
  text("#dashboard-subtitle", needsPassword ? "Create a password so you can also log in with email or username." : "This is required before using the web dashboard.");
  text("#username-setup-title", needsPassword ? "Finish your account." : "Choose your username.");
  text("#username-setup-copy", needsPassword ? "Choose a unique username and create a password for direct login." : "Choose a unique username before the dashboard can continue.");
  $("#username-input").value = normalizeUsername(state.profile?.username || "");
  document.querySelectorAll("[data-password-setup]").forEach((element) => {
    element.hidden = !needsPassword;
    const input = element.querySelector("input");
    if (input) {
      input.required = needsPassword;
      input.value = "";
    }
  });
}

function renderDashboard() {
  $("#username-setup").hidden = true;
  $("#dashboard-content").hidden = false;
  const displayName = state.profile.username || state.profile.email || "there";

  text("#dashboard-title", `Hi ${displayName}`);
  text("#dashboard-subtitle", "Manage your account, licence, and desktop machines.");
  text("#account-heading", state.profile.username || state.profile.email || "Account");
  text("#account-email", state.profile.email || "-");
  text("#account-username-value", state.profile.username ? `@${state.profile.username}` : "-");
  const accountAccess = $("#account-access");
  if (accountAccess) {
    accountAccess.textContent = state.profile.premium ? "Unlocked" : "Locked";
    accountAccess.className = state.profile.premium ? "access-ok" : "access-no";
  }
  const licenceBadge = $("#licence-badge");
  if (licenceBadge) {
    licenceBadge.textContent = state.profile.premium ? "Active" : "Not active";
    licenceBadge.className = `status-pill ${state.profile.premium ? "status-pill-ok" : "status-pill-no"}`;
  }
  text("#licence-title", state.profile.premium ? "Your licence is active" : "No active licence yet");
  text("#licence-copy", state.profile.premium
    ? "Your account can open the Sonus desktop app on registered machines."
    : "Buy Sonus once to unlock the desktop app, collections, stack mode, waveform browsing, BPM and key tools, and two machine slots.");

  const licenceActions = $("#licence-actions");
  if (licenceActions) {
    licenceActions.innerHTML = state.profile.premium
      ? `<a class="btn btn-accent" href="/download/">Download app</a>`
      : `<a class="btn btn-accent" href="/pricing/">Buy Sonus</a>`;
  }

  const avatar = $("#account-avatar");
  if (avatar) avatar.textContent = initials(state.profile);
}

async function refreshProfile() {
  const latest = await fetchProfile(state.session);
  if (!latest) {
    await signOut(state.session);
    window.location.href = "/login/";
    return;
  }
  state.profile = latest;
  if (!isValidUsername(state.profile?.username || "") || !readBool(state.profile?.password_set)) {
    showUsernameSetup();
    return;
  }
  renderDashboard();
  await loadMachines();
}

function bindUsernameSetup() {
  $("#username-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#username-status");
    const button = $("#username-submit");
    setStatus(status, "");
    button.disabled = true;
    button.textContent = "Saving...";

    try {
      const username = normalizeUsername($("#username-input")?.value);
      const needsPassword = !readBool(state.profile?.password_set);
      const password = String($("#setup-password")?.value || "");
      const passwordConfirm = String($("#setup-password-confirm")?.value || "");
      if (needsPassword) {
        if (!isValidPassword(password)) {
          throw new Error("Password must be at least 8 characters.");
        }
        if (password !== passwordConfirm) {
          throw new Error("Passwords do not match.");
        }
      }

      let profile = await updateProfile(state.session, { username });
      if (needsPassword) {
        await updateAccountPassword(state.session, password);
        profile = await updateProfile(state.session, { password_set: true });
        if ($("#setup-password")) $("#setup-password").value = "";
        if ($("#setup-password-confirm")) $("#setup-password-confirm").value = "";
      }
      state.profile = profile || { ...state.profile, username, password_set: needsPassword ? true : state.profile?.password_set };
      setStatus(status, needsPassword ? "Account ready." : "Username saved.", "success");
      await refreshProfile();
    } catch (error) {
      setStatus(status, error?.message || "Unable to save username.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save";
    }
  });
}

function setInlineEditMode(field, editing) {
  const row = $(`[data-account-row="${field}"]`);
  const value = $("#account-username-value");
  const input = $("#account-username-input");
  const button = $(`[data-edit-profile="${field}"]`);
  if (!row || !value || !input || !button) return;

  row.classList.toggle("editing", editing);
  value.hidden = editing;
  input.hidden = !editing;
  button.textContent = editing ? "✓" : "✎";
  button.setAttribute("aria-label", editing ? `Save ${field}` : `Edit ${field}`);
  if (editing) {
    input.value = state.profile.username || "";
    input.focus();
    input.select();
  }
}

async function saveInlineProfileField(field) {
  const status = $("#account-edit-status");
  const button = $(`[data-edit-profile="${field}"]`);
  const input = $("#account-username-input");
  if (!input || !button) return;

  setStatus(status, "");
  button.disabled = true;
  try {
    const username = normalizeUsername(input.value);
    if (!isValidUsername(username)) {
      throw new Error("Username must be 3-24 characters: letters, numbers, or underscores.");
    }
    const patch = { username };

    const profile = await updateProfile(state.session, patch);
    state.profile = profile || { ...state.profile, ...patch };
    setInlineEditMode(field, false);
    setStatus(status, "Account updated.", "success");
    renderDashboard();
  } catch (error) {
    setStatus(status, error?.message || "Unable to update account.", "error");
  } finally {
    button.disabled = false;
  }
}

function bindInlineProfileEdits() {
  document.querySelectorAll("[data-edit-profile]").forEach((button) => {
    button.addEventListener("click", async () => {
      const field = button.dataset.editProfile;
      const row = $(`[data-account-row="${field}"]`);
      if (row?.classList.contains("editing")) {
        await saveInlineProfileField(field);
        return;
      }
      setInlineEditMode(field, true);
    });
  });

  document.querySelectorAll(".account-inline-input").forEach((input) => {
    input.addEventListener("keydown", async (event) => {
      const field = "username";
      if (event.key === "Enter") {
        event.preventDefault();
        await saveInlineProfileField(field);
      }
      if (event.key === "Escape") {
        setInlineEditMode(field, false);
        setStatus($("#account-edit-status"), "");
      }
    });
  });
}

async function boot() {
  try {
    const callbackSession = readOAuthCallback();
    state.session = callbackSession || await getActiveSession();

    if (!state.session) {
      window.location.href = "/login/";
      return;
    }

    const params = new URLSearchParams(window.location.search || "");
    if (params.get("checkout") === "success" && params.get("session_id")) {
      text("#dashboard-title", "Confirming payment...");
      text("#dashboard-subtitle", "Checking Stripe and unlocking your licence.");
      await confirmCheckoutSession(state.session, params.get("session_id"));
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    state.profile = await ensureProfile(state.session, {
      createIfFreshAuthUser: Boolean(callbackSession),
    });
    if (!isValidUsername(state.profile?.username || "") || !readBool(state.profile?.password_set)) {
      showUsernameSetup();
      return;
    }

    renderDashboard();
    await loadMachines();
  } catch (error) {
    if (
      error?.code === "PROFILE_MISSING" ||
      String(error?.message || "").toLowerCase().includes("jwt")
    ) {
      await signOut(state.session);
      window.location.href = "/login/";
      return;
    }

    text("#dashboard-title", "Unable to load dashboard");
    text("#dashboard-subtitle", error?.message || "Unknown error.");
  }
}

bindUsernameSetup();
bindInlineProfileEdits();
boot();
