import {
  ensureProfile,
  formatDate,
  getActiveSession,
  signOut,
} from "./supabase.js";
import { formatLaunchDate, getLaunchState } from "./launch.js";

const state = {
  session: null,
  profile: null,
  messages: [],
  filter: "all",
  selectedId: null,
  view: "home",
  versionInfo: null,
  releases: [],
  downloadAvailability: null,
  launchSettings: null,
  adminUnlocked: false,
};

function $(selector) {
  return document.querySelector(selector);
}

function text(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isRead(message) {
  return Boolean(message.read_at);
}

function visibleMessages() {
  if (state.filter === "new") return state.messages.filter((message) => !isRead(message));
  if (state.filter === "read") return state.messages.filter(isRead);
  return state.messages;
}

function setHeader(title, subtitle, refreshVisible = false) {
  text(".admin-head h1", title);
  text("#admin-subtitle", subtitle);
  const refresh = $("#admin-refresh-btn");
  if (refresh) refresh.hidden = !refreshVisible;
}

function setView(view) {
  state.view = view;
  $("#admin-home").hidden = view !== "home";
  $("#admin-feedback-view").hidden = view !== "feedback";
  $("#admin-options-view").hidden = view !== "options";

  if (view === "home") {
    setHeader("Admin panel", "Choose what you want to manage.");
    return;
  }

  if (view === "feedback") {
    setHeader("Feedback inbox", `${state.messages.length} feedback message${state.messages.length === 1 ? "" : "s"} loaded.`, true);
    if (!state.messages.length) refreshFeedback();
    return;
  }

  setHeader("Admin options", "Manage the public Sonus version, launch gate, and update prompt.");
  loadOptions();
}

function showAdminLocked(message = "This account is not an administrator.") {
  $("#admin-locked").hidden = false;
  $("#admin-password-panel").hidden = true;
  $("#admin-content").hidden = true;
  setHeader("Admin panel", message);
}

function showAdminPassword() {
  $("#admin-locked").hidden = true;
  $("#admin-password-panel").hidden = false;
  $("#admin-content").hidden = true;
  setHeader("Admin panel", "Enter the admin password to continue.");
  $("#admin-password-input")?.focus();
}

function showAdminContent() {
  $("#admin-locked").hidden = true;
  $("#admin-password-panel").hidden = true;
  $("#admin-content").hidden = false;
  setView("home");
}

function updateCounts() {
  text("#admin-count-all", state.messages.length);
  text("#admin-count-new", state.messages.filter((message) => !isRead(message)).length);
  text("#admin-count-read", state.messages.filter(isRead).length);
}

function renderInbox() {
  updateCounts();
  document.querySelectorAll("[data-admin-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminFilter === state.filter);
  });

  const inbox = $("#feedback-inbox");
  if (!inbox) return;
  const messages = visibleMessages();
  if (!messages.length) {
    inbox.innerHTML = `<div class="feedback-empty">No feedback in this view.</div>`;
    return;
  }

  inbox.innerHTML = messages.map((message) => `
    <button class="feedback-item ${state.selectedId === message.id ? "active" : ""} ${isRead(message) ? "is-read" : "is-new"}" type="button" data-feedback-id="${message.id}">
      <span class="feedback-item-top">
        <strong>${escapeHtml(message.title || "Untitled")}</strong>
        <em>${isRead(message) ? "Opened" : "Unread"}</em>
      </span>
      <span class="feedback-item-meta">${escapeHtml(message.type || "Feedback")} · ${escapeHtml(message.email || message.username || "Unknown user")}</span>
      <span class="feedback-item-date">${formatDate(message.created_at)}</span>
    </button>
  `).join("");

  inbox.querySelectorAll("[data-feedback-id]").forEach((button) => {
    button.addEventListener("click", () => openFeedback(Number(button.dataset.feedbackId)));
  });
}

function renderDetail(message) {
  const detail = $("#feedback-detail");
  if (!detail || !message) return;

  detail.innerHTML = `
    <div class="feedback-detail-top">
      <p class="panel-kicker">${escapeHtml(message.type || "Feedback")}</p>
      <span class="status-pill">${isRead(message) ? "Opened" : "Unread"}</span>
    </div>
    <h2>${escapeHtml(message.title || "Untitled")}</h2>
    ${message.subject ? `<p class="feedback-subject">${escapeHtml(message.subject)}</p>` : ""}
    <div class="feedback-author">
      <span>${escapeHtml(message.email || "Unknown email")}</span>
      <span>${message.username ? `@${escapeHtml(message.username)}` : "No username"}</span>
      <span>${formatDate(message.created_at)}</span>
    </div>
    <div class="feedback-message">${escapeHtml(message.message || "").replaceAll("\n", "<br>")}</div>
    <dl class="feedback-meta">
      <div><dt>Source</dt><dd>${escapeHtml(message.source || "-")}</dd></div>
      <div><dt>App version</dt><dd>${escapeHtml(message.app_version || "-")}</dd></div>
      <div><dt>Platform</dt><dd>${escapeHtml(message.platform || "-")}</dd></div>
      <div><dt>User agent</dt><dd>${escapeHtml(message.user_agent || "-")}</dd></div>
    </dl>
  `;
}

async function openFeedback(id) {
  const message = state.messages.find((item) => item.id === id);
  if (!message) return;
  state.selectedId = id;
  renderDetail(message);
  renderInbox();

  if (!isRead(message)) {
    try {
      const updated = await adminFeedbackRequest("PATCH", { id });
      if (updated) {
        Object.assign(message, updated);
        renderDetail(message);
        renderInbox();
      }
    } catch (error) {
      console.warn("[Admin] Unable to mark feedback as read:", error);
    }
  }
}

async function refreshFeedback() {
  const button = $("#admin-refresh-btn");
  if (button) {
    button.disabled = true;
    button.textContent = "Refreshing...";
  }

  try {
    state.messages = await adminFeedbackRequest("GET");
    if (state.view === "feedback") setHeader("Feedback inbox", `${state.messages.length} feedback message${state.messages.length === 1 ? "" : "s"} loaded.`, true);
    renderInbox();
    const selected = state.messages.find((message) => message.id === state.selectedId);
    if (selected) renderDetail(selected);
  } catch (error) {
    if (state.view === "feedback") text("#admin-subtitle", error?.message || "Unable to load feedback.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Refresh";
    }
  }
}

async function adminVersionRequest(method = "GET", body) {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch("/api/admin/app-version", {
    method,
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
      ...(body && !isFormData ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Version request failed.");
  return data;
}

async function adminSessionRequest(method = "GET", body) {
  const response = await fetch("/api/admin/session", {
    method,
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Admin authentication failed.");
  return data;
}

async function adminFeedbackRequest(method = "GET", body) {
  const response = await fetch("/api/admin/feedback", {
    method,
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Feedback request failed.");
  return data;
}

async function adminReleasesRequest(method = "GET", version = "") {
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const response = await fetch(`/api/admin/app-releases${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Release request failed.");
  return data;
}

async function adminDownloadAvailabilityRequest(method = "GET", body) {
  const response = await fetch("/api/admin/download-availability", {
    method,
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Download availability request failed.");
  return data;
}

async function adminLaunchRequest(method = "GET", body) {
  const response = await fetch("/api/admin/launch-settings", {
    method,
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Launch settings request failed.");
  return data;
}

function renderVersionInfo() {
  const version = state.versionInfo?.version || "-";
  text("#admin-current-version", `v${version}`);
}

function normalizeAvailability(value = {}) {
  const platforms = value?.platforms && typeof value.platforms === "object" ? value.platforms : value;
  return {
    "macos-arm64": platforms?.["macos-arm64"] !== false,
    "macos-intel": platforms?.["macos-intel"] !== false,
    windows: platforms?.windows !== false,
  };
}

function renderDownloadAvailability() {
  const availability = normalizeAvailability(state.downloadAvailability || {});
  const arm64 = $("#admin-available-macos-arm64");
  const intel = $("#admin-available-macos-intel");
  const windows = $("#admin-available-windows");
  if (arm64) arm64.checked = availability["macos-arm64"];
  if (intel) intel.checked = availability["macos-intel"];
  if (windows) windows.checked = availability.windows;
}

const releaseArtifactSpecs = [
  { field: "zip_macos_arm64", selector: "#admin-zip-macos-arm64", label: "macOS ARM64", extensions: [".dmg", ".zip"] },
  { field: "zip_macos_intel", selector: "#admin-zip-macos-intel", label: "macOS Intel", extensions: [".dmg", ".zip"] },
  { field: "zip_windows", selector: "#admin-zip-windows", label: "Windows", extensions: [".exe", ".zip"] },
];

function formatExtensions(extensions = []) {
  return extensions.join(" or ");
}

function renderReleaseHistory() {
  const list = $("#admin-release-list");
  if (!list) return;

  if (!state.releases.length) {
    list.innerHTML = `<p class="admin-option-copy">No published versions yet.</p>`;
    return;
  }

  const currentVersion = String(state.versionInfo?.version || "").trim();
  list.innerHTML = state.releases.map((release) => {
    const version = String(release.version || "").trim();
    const isCurrent = version === currentVersion;
    const notes = Array.isArray(release.notes) ? release.notes : [];
    return `
      <article class="admin-release-item">
        <div>
          <div class="admin-release-top">
            <strong>${escapeHtml(release.title || `Sonus ${version}`)}</strong>
            ${isCurrent ? `<span class="status-pill">Current</span>` : ""}
          </div>
          <p>${escapeHtml(release.releaseDate || "-")}</p>
          ${notes.length ? `<ul>${notes.slice(0, 3).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
        </div>
        <button class="admin-delete-release-btn" type="button" data-delete-release="${escapeHtml(version)}">Delete</button>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-delete-release]").forEach((button) => {
    button.addEventListener("click", () => deleteRelease(button.dataset.deleteRelease || ""));
  });
}

function clearVersionForm() {
  $("#admin-version-form")?.reset();
}

function toDatetimeLocalValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function renderLaunchSettings() {
  const launchAtInput = $("#admin-launch-at-input");
  const enabledInput = $("#admin-launch-enabled-input");
  const launchState = $("#admin-launch-state");
  const settings = state.launchSettings || {};
  const launchAt = settings.launchAt || settings.launch_at || "";

  if (launchAtInput) launchAtInput.value = toDatetimeLocalValue(launchAt);
  if (enabledInput) enabledInput.checked = settings.enabled !== false;

  if (launchState) {
    const current = getLaunchState({ enabled: settings.enabled !== false, launchAt });
    launchState.textContent = current.locked ? "Locked" : "Unlocked";
    launchState.className = current.locked ? "is-locked" : "is-unlocked";
  }

  const status = $("#admin-launch-status");
  if (status && launchAt) {
    const current = getLaunchState({ enabled: settings.enabled !== false, launchAt });
    status.textContent = current.locked
      ? `Checkout unlocks on ${formatLaunchDate(current.launchAt)}.`
      : `Checkout is currently unlocked. Launch date: ${formatLaunchDate(current.launchAt)}.`;
    status.className = "form-status success";
  }
}

async function loadLaunchSettings() {
  try {
    state.launchSettings = await adminLaunchRequest("GET");
    renderLaunchSettings();
  } catch (error) {
    const status = $("#admin-launch-status");
    if (status) {
      status.textContent = error.message || "Unable to load launch settings.";
      status.className = "form-status error";
    }
  }
}

async function loadOptions() {
  await Promise.all([loadVersionInfo(), loadDownloadAvailability(), loadLaunchSettings()]);
}

async function loadVersionInfo() {
  try {
    state.versionInfo = await adminVersionRequest("GET");
    state.releases = await adminReleasesRequest("GET");
    renderVersionInfo();
    renderReleaseHistory();
  } catch (error) {
    text("#admin-version-status", error.message || "Unable to load current version.");
  }
}

async function loadDownloadAvailability() {
  try {
    state.downloadAvailability = await adminDownloadAvailabilityRequest("GET");
    renderDownloadAvailability();
  } catch (error) {
    const status = $("#admin-download-availability-status");
    if (status) {
      status.textContent = error.message || "Unable to load download availability.";
      status.className = "form-status error";
    }
  }
}

async function deleteRelease(version) {
  const status = $("#admin-version-status");
  const cleanVersion = String(version || "").trim();
  if (!cleanVersion) return;
  const isCurrent = cleanVersion === String(state.versionInfo?.version || "").trim();
  const message = isCurrent
    ? `Delete current version Sonus ${cleanVersion}? The app will roll back to the previous published version.`
    : `Delete Sonus ${cleanVersion} from release history?`;
  if (!window.confirm(message)) return;

  if (status) {
    status.textContent = "";
    status.className = "form-status";
  }

  const button = $(`[data-delete-release="${CSS.escape(cleanVersion)}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Deleting...";
  }

  try {
    const result = await adminReleasesRequest("DELETE", cleanVersion);
    if (result.currentVersion) state.versionInfo = result.currentVersion;
    state.releases = Array.isArray(result.releases) ? result.releases : state.releases.filter((release) => release.version !== cleanVersion);
    renderVersionInfo();
    renderReleaseHistory();
    if (status) {
      status.textContent = result.currentVersion?.version && isCurrent
        ? `Version v${cleanVersion} deleted. Current version rolled back to v${result.currentVersion.version}.`
        : `Version v${cleanVersion} deleted from release history.`;
      status.className = "form-status success";
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Unable to delete version.";
      status.className = "form-status error";
    }
    renderReleaseHistory();
  }
}

async function publishVersion(event) {
  event.preventDefault();
  const button = $("#admin-version-submit");
  const status = $("#admin-version-status");
  const version = String($("#admin-version-input")?.value || "").trim();
  const notes = String($("#admin-version-notes")?.value || "");
  const requiredFiles = releaseArtifactSpecs.map((spec) => ({
    ...spec,
    file: $(spec.selector)?.files?.[0],
  }));

  const missing = requiredFiles.find(({ file }) => !file);
  const invalid = requiredFiles.find(({ file, extensions }) => {
    const name = String(file?.name || "").toLowerCase();
    return file && !extensions.some((extension) => name.endsWith(extension));
  });
  if (missing || invalid) {
    if (status) {
      status.textContent = missing
        ? `${missing.label} installer is required.`
        : `${invalid.label} must be a ${formatExtensions(invalid.extensions)} file.`;
      status.className = "form-status error";
    }
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Uploading installers...";
  }
  if (status) {
    status.textContent = "Uploading all platform installers. The current download stays active until every upload succeeds.";
    status.className = "form-status";
  }

  try {
    const formData = new FormData();
    formData.set("version", version);
    formData.set("notes", notes);
    requiredFiles.forEach(({ field, file }) => formData.set(field, file));
    state.versionInfo = await adminVersionRequest("POST", formData);
    state.releases = await adminReleasesRequest("GET");
    renderVersionInfo();
    renderReleaseHistory();
    clearVersionForm();
    if (status) {
      status.textContent = `Version v${state.versionInfo.version} published with macOS ARM64, macOS Intel, and Windows installers.`;
      status.className = "form-status success";
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Unable to publish version.";
      status.className = "form-status error";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Publish version";
    }
  }
}

async function saveDownloadAvailability(event) {
  event.preventDefault();
  const button = $("#admin-download-availability-submit");
  const status = $("#admin-download-availability-status");
  const platforms = {
    "macos-arm64": $("#admin-available-macos-arm64")?.checked !== false,
    "macos-intel": $("#admin-available-macos-intel")?.checked !== false,
    windows: $("#admin-available-windows")?.checked !== false,
  };

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }
  if (status) {
    status.textContent = "";
    status.className = "form-status";
  }

  try {
    state.downloadAvailability = await adminDownloadAvailabilityRequest("POST", { platforms });
    renderDownloadAvailability();
    if (status) {
      const soon = Object.entries(platforms)
        .filter(([, available]) => !available)
        .map(([platform]) => ({
          "macos-arm64": "macOS ARM64",
          "macos-intel": "macOS Intel",
          windows: "Windows",
        }[platform]));
      status.textContent = soon.length
        ? `${soon.join(", ")} will show as Soon on the Download page.`
        : "All platform downloads are available.";
      status.className = "form-status success";
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Unable to save download availability.";
      status.className = "form-status error";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Save availability";
    }
  }
}

async function saveLaunchSettings(event) {
  event.preventDefault();
  const button = $("#admin-launch-submit");
  const status = $("#admin-launch-status");
  const launchAt = fromDatetimeLocalValue($("#admin-launch-at-input")?.value || "");
  const enabled = $("#admin-launch-enabled-input")?.checked !== false;

  if (!launchAt) {
    if (status) {
      status.textContent = "Choose a valid launch date and time.";
      status.className = "form-status error";
    }
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }
  if (status) {
    status.textContent = "";
    status.className = "form-status";
  }

  try {
    state.launchSettings = await adminLaunchRequest("POST", { enabled, launchAt });
    renderLaunchSettings();
    if (status) {
      status.textContent = `Launch gate saved. Checkout ${getLaunchState(state.launchSettings).locked ? "is locked" : "is unlocked"}.`;
      status.className = "form-status success";
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Unable to save launch settings.";
      status.className = "form-status error";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Save launch gate";
    }
  }
}

async function unlockAdmin(event) {
  event.preventDefault();
  const button = $("#admin-password-submit");
  const status = $("#admin-password-status");
  const password = String($("#admin-password-input")?.value || "");
  const remember = $("#admin-password-remember")?.checked === true;

  if (button) {
    button.disabled = true;
    button.textContent = "Unlocking...";
  }
  if (status) {
    status.textContent = "";
    status.className = "form-status";
  }

  try {
    const result = await adminSessionRequest("POST", { password, remember });
    state.adminUnlocked = result.authenticated === true;
    if (!state.adminUnlocked) throw new Error("Admin password required.");
    $("#admin-password-form")?.reset();
    showAdminContent();
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Unable to unlock admin panel.";
      status.className = "form-status error";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Unlock admin panel";
    }
  }
}

async function boot() {
  state.session = await getActiveSession();
  if (!state.session) {
    window.location.href = "/login/";
    return;
  }

  try {
    state.profile = await ensureProfile(state.session);
    if (!state.profile?.administrator) {
      showAdminLocked();
      return;
    }
  } catch {
    await signOut(state.session);
    window.location.href = "/login/";
    return;
  }

  try {
    const result = await adminSessionRequest("GET");
    state.adminUnlocked = result.authenticated === true;
  } catch {
    state.adminUnlocked = false;
  }

  if (!state.adminUnlocked) {
    showAdminPassword();
    return;
  }

  showAdminContent();
}

document.querySelectorAll("[data-admin-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.adminFilter || "all";
    renderInbox();
  });
});

document.querySelectorAll("[data-admin-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.adminView || "home"));
});

$("#admin-refresh-btn")?.addEventListener("click", refreshFeedback);
$("#admin-password-form")?.addEventListener("submit", unlockAdmin);
$("#admin-version-form")?.addEventListener("submit", publishVersion);
$("#admin-download-availability-form")?.addEventListener("submit", saveDownloadAvailability);
$("#admin-launch-form")?.addEventListener("submit", saveLaunchSettings);

boot();
