import { countdownParts, fetchLaunchSettings, formatLaunchDate, getLaunchState } from "./launch.js";
import { DEFAULT_NORMALIZED_SITE_CONFIG, getSiteConfig } from "./site-config.js";
import { getActiveSession, ensureProfile, readOAuthCallback, signOut, startOAuth, supabaseRequest } from "./supabase.js";

const page = document.body?.dataset.page || "home";

function $(selector) {
  return document.querySelector(selector);
}

function initials(profile) {
  const source = profile?.username || profile?.email || "S";
  return String(source).trim().charAt(0).toUpperCase() || "S";
}

function accountDisplayName(profile) {
  return String(profile?.username || profile?.email || "Account").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function closeAccountMenu() {
  const menu = $("#account-menu");
  const button = $("#account-menu-button");
  if (!menu || !button) return;
  menu.classList.remove("open");
  button.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  const menu = $("#account-menu");
  const button = $("#account-menu-button");
  if (!menu || !button) return;
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

const mainNavLinks = [
  { href: "/", label: "Home", nav: "home" },
  { href: "/download/", label: "Download", nav: "download" },
  { href: "/patch-notes/", label: "Patch notes", nav: "patch-notes" },
];

function closeMobileNav() {
  document.body.classList.remove("mobile-nav-open");
  $("#mobile-nav-toggle")?.setAttribute("aria-expanded", "false");
}

function toggleMobileNav() {
  const open = !document.body.classList.contains("mobile-nav-open");
  document.body.classList.toggle("mobile-nav-open", open);
  $("#mobile-nav-toggle")?.setAttribute("aria-expanded", open ? "true" : "false");
}

function bindMobileNav() {
  const header = $(".site-header");
  if (!header || $("#mobile-nav-toggle")) return;

  const button = document.createElement("button");
  button.className = "mobile-nav-toggle";
  button.id = "mobile-nav-toggle";
  button.type = "button";
  button.setAttribute("aria-label", "Open navigation");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = "<span></span>";

  const drawer = document.createElement("aside");
  drawer.className = "mobile-nav-drawer";
  drawer.id = "mobile-nav-drawer";
  drawer.setAttribute("aria-label", "Mobile navigation");
  drawer.innerHTML = `
    <a class="brand small" href="/">
      <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
      <span>Sonus</span>
    </a>
    <nav>
      ${mainNavLinks.map((link) => `<a href="${link.href}" ${link.nav ? `data-mobile-nav="${link.nav}"` : ""}>${link.label}</a>`).join("")}
    </nav>
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "mobile-nav-backdrop";
  backdrop.id = "mobile-nav-backdrop";

  header.querySelector(".brand")?.after(button);
  document.body.append(backdrop, drawer);

  button.addEventListener("click", toggleMobileNav);
  backdrop.addEventListener("click", closeMobileNav);
  drawer.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMobileNav));
}

function renderNavActions(session, profile) {
  const target = $("#site-nav-actions");
  if (!target) return;

  if (!session) {
    target.innerHTML = `
      <a class="header-login-link" href="/login/">Log in</a>
      <a class="btn btn-accent keep-mobile" href="/pricing/">Buy</a>
    `;
    return;
  }

  target.innerHTML = `
    <a class="btn btn-accent keep-mobile" href="/pricing/">Buy</a>
    <div class="account-menu-wrap">
      <button class="avatar-button" id="account-menu-button" type="button" aria-haspopup="menu" aria-expanded="false">${initials(profile)}</button>
      <div class="account-menu" id="account-menu" role="menu">
        <div class="account-menu-head">
          <strong>${escapeHtml(accountDisplayName(profile))}</strong>
          <span>${escapeHtml(profile?.email || "")}</span>
        </div>
        <a href="/dashboard/" role="menuitem">Dashboard</a>
        ${profile?.administrator ? `<a href="/admin/" role="menuitem">Admin panel</a>` : ""}
        <button class="account-menu-logout" type="button" id="account-menu-logout" role="menuitem">Log out</button>
      </div>
    </div>
  `;

  $("#account-menu-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAccountMenu();
  });

  $("#account-menu-logout")?.addEventListener("click", async () => {
    await signOut(session);
    window.location.href = "/login/";
  });
}

async function hydrateNav() {
  const active = document.querySelector(`[data-nav="${page}"]`);
  active?.classList.add("active");
  document.querySelector(`[data-mobile-nav="${page}"]`)?.classList.add("active");

  let callbackSession = null;
  try {
    callbackSession = readOAuthCallback();
  } catch {
    // Page-specific auth screens own visible OAuth error states.
  }

  const session = await getActiveSession();
  if (!session) {
    renderNavActions(null, null);
    return;
  }

  try {
    const profile = await ensureProfile(session, {
      createIfFreshAuthUser: Boolean(callbackSession),
    });
    renderNavActions(session, profile);
  } catch {
    await signOut(session);
    renderNavActions(null, null);
  }
}

function bindDownloadPlaceholder() {
  if (window.__sonusDownloadPlaceholderBound) return;
  window.__sonusDownloadPlaceholderBound = true;
  document.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-download-missing], .download-panel .btn.disabled");
    if (!target) return;
    event.preventDefault();
    const toast = $("#site-toast");
    if (!toast) return;
    toast.textContent = "This download will be available as soon as the installer has been published.";
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 3200);
  });
}

function bindOAuthButtons() {
  document.querySelectorAll("[data-oauth-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      button.disabled = true;
      startOAuth(button.dataset.oauthProvider, button.dataset.oauthFlow || "login");
    });
  });
}

function renderPasswordToggleIcon(button, visible) {
  button.innerHTML = visible
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5 0 8.5 4 10 8a14.6 14.6 0 0 1-2.1 3.6"/><path d="M6.5 6.5C4.4 7.8 2.9 9.8 2 12c1.5 4 5 8 10 8 1.6 0 3-.4 4.2-1"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

function bindPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    renderPasswordToggleIcon(button, false);
    button.addEventListener("click", () => {
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", visible ? "true" : "false");
      button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      renderPasswordToggleIcon(button, visible);
    });
  });
}

function hydratePlatformDownloadLabels() {
  const platform = `${navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ""}`.toLowerCase();
  let label = "Download";
  if (platform.includes("mac")) label = "Download for macOS";
  if (platform.includes("win")) label = "Download for Windows";

  document.querySelectorAll("[data-platform-download]").forEach((link) => {
    link.textContent = label;
  });
}

async function hydrateSiteConfigLinks() {
  try {
    const config = await getSiteConfig();
    const supportEmail = String(config.supportEmail || "").trim();
    if (!supportEmail) return;
    document.querySelectorAll("[data-support-email]").forEach((link) => {
      link.textContent = supportEmail;
      link.setAttribute("href", `mailto:${supportEmail}`);
    });
  } catch {
    // Keep static fallback content.
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function loginRedirectUrl() {
  return `/login/?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search || ""}`)}`;
}

function renderCountdown(target, remainingMs) {
  if (!target) return;
  const parts = countdownParts(remainingMs);
  const setPart = (selector, value) => {
    const element = target.querySelector(selector);
    if (element) element.textContent = String(value).padStart(2, "0");
  };
  setPart("[data-launch-days]", parts.days);
  setPart("[data-launch-hours]", parts.hours);
  setPart("[data-launch-minutes]", parts.minutes);
  setPart("[data-launch-seconds]", parts.seconds);
}

function launchHeroMarkup(launchAt) {
  return `
    <p class="launch-kicker">Sonus launches on ${formatLaunchDate(launchAt)}</p>
    <div class="launch-countdown" data-launch-countdown aria-label="Launch countdown">
      <span><strong data-launch-days>00</strong><em>Days</em></span>
      <span><strong data-launch-hours>00</strong><em>Hours</em></span>
      <span><strong data-launch-minutes>00</strong><em>Minutes</em></span>
      <span><strong data-launch-seconds>00</strong><em>Seconds</em></span>
    </div>
    <p class="hero-lede launch-copy">The first release supports macOS Apple Silicon and Windows x64.</p>
    <p class="launch-platform-copy">You can create your account now and join the launch waitlist. If you purchase a licence at launch, it stays attached to your account and remains valid across supported desktop builds.</p>
    <div class="hero-actions launch-actions">
      <div class="launch-waitlist" data-waitlist-widget>
        <button class="btn btn-accent btn-lg launch-waitlist-trigger" type="button">Join waitlist</button>
        <form class="launch-waitlist-form" hidden novalidate>
          <input type="email" name="email" autocomplete="email" placeholder="Email address" aria-label="Email address" />
          <button class="launch-icon-btn launch-confirm" type="submit" aria-label="Join waitlist">✓</button>
          <button class="launch-icon-btn launch-cancel" type="button" aria-label="Cancel">×</button>
        </form>
        <p class="launch-waitlist-status" aria-live="polite"></p>
      </div>
    </div>
  `;
}

function bindWaitlistPreview(hero) {
  const widget = hero.querySelector("[data-waitlist-widget]");
  const trigger = widget?.querySelector(".launch-waitlist-trigger");
  const form = widget?.querySelector(".launch-waitlist-form");
  const input = widget?.querySelector("input");
  const cancel = widget?.querySelector(".launch-cancel");
  const status = widget?.querySelector(".launch-waitlist-status");
  if (!widget || !trigger || !form || !input || !cancel || widget.dataset.bound === "true") return;
  widget.dataset.bound = "true";

  const markJoined = () => {
    form.hidden = true;
    trigger.hidden = false;
    trigger.textContent = "Joined";
    trigger.disabled = true;
  };

  getActiveSession().then(async (session) => {
    if (!session?.access_token) return;
    try {
      const response = await fetch("/api/waitlist", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.joined) {
        markJoined();
        status.textContent = "You are already on the waitlist.";
        status.className = "launch-waitlist-status is-success";
      }
    } catch {
      // The signup action still handles visible errors.
    }
  });

  trigger.addEventListener("click", () => {
    getActiveSession().then((session) => {
      if (!session?.access_token) {
        window.location.href = loginRedirectUrl();
        return;
      }
      trigger.hidden = true;
      form.hidden = false;
      input.value = session.user?.email || "";
      status.textContent = "";
      requestAnimationFrame(() => input.focus());
    });
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    trigger.click();
  });

  cancel.addEventListener("click", () => {
    form.hidden = true;
    trigger.hidden = false;
    input.value = "";
    status.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const session = await getActiveSession();
    if (!session?.access_token) {
      window.location.href = loginRedirectUrl();
      return;
    }
    const email = String(input.value || session.user?.email || "").trim();
    if (!isValidEmail(email)) {
      status.textContent = "Enter a valid email address.";
      status.className = "launch-waitlist-status is-error";
      return;
    }
    const submit = form.querySelector(".launch-confirm");
    submit.disabled = true;
    status.textContent = "Joining waitlist...";
    status.className = "launch-waitlist-status";
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, source: "home_launch_hero" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to join waitlist.");
      status.textContent = data.alreadyJoined
        ? "You are already on the waitlist. Check your inbox for the launch email."
        : "You are on the waitlist. Check your inbox for the confirmation email.";
      status.className = "launch-waitlist-status is-success";
      markJoined();
    } catch (error) {
      status.textContent = error.message || "Unable to join waitlist.";
      status.className = "launch-waitlist-status is-error";
    } finally {
      submit.disabled = false;
    }
  });
}

async function hydrateLaunchGate() {
  const hero = document.querySelector(".home-hero .hero-copy");
  if (!hero && page !== "pricing") return;

  const settings = await fetchLaunchSettings();
  const initialState = getLaunchState(settings);

  if (hero) {
    if (!hero.dataset.defaultHtml) hero.dataset.defaultHtml = hero.innerHTML;
    if (initialState.locked) {
      hero.classList.add("is-launch-mode");
      hero.innerHTML = launchHeroMarkup(initialState.launchAt);
      bindWaitlistPreview(hero);
    } else if (hero.classList.contains("is-launch-mode")) {
      hero.classList.remove("is-launch-mode");
      hero.innerHTML = hero.dataset.defaultHtml;
      hydratePlatformDownloadLabels();
    }
  }

  const tick = () => {
    const state = getLaunchState(settings);
    document.body.classList.toggle("launch-locked", state.locked);
    if (hero && state.locked) {
      renderCountdown(hero.querySelector("[data-launch-countdown]"), state.remainingMs);
    }
    if (hero && !state.locked && hero.classList.contains("is-launch-mode")) {
      hero.classList.remove("is-launch-mode");
      hero.innerHTML = hero.dataset.defaultHtml;
      hydratePlatformDownloadLabels();
    }
    if (!state.locked && window.__sonusLaunchTimer) {
      window.clearInterval(window.__sonusLaunchTimer);
      window.__sonusLaunchTimer = null;
    }
  };

  tick();
  if (initialState.locked) {
    window.__sonusLaunchTimer = window.setInterval(tick, 1000);
  }
}

function formatReleaseDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeRelease(value = {}) {
  const data = value?.value && typeof value.value === "object" ? value.value : value;
  const version = String(data?.version || "").trim().replace(/^v/i, "");
  const releaseDate = String(data?.releaseDate || data?.release_date || "").trim();
  const rawDownloadUrl = String(data?.downloadUrl || data?.download_url || DEFAULT_NORMALIZED_SITE_CONFIG.downloadUrl).trim();
  const downloadUrl = rawDownloadUrl.startsWith("/")
    ? `${DEFAULT_NORMALIZED_SITE_CONFIG.siteUrl}${rawDownloadUrl}`
    : rawDownloadUrl;
  const notes = Array.isArray(data?.notes)
    ? data.notes.map((note) => String(note || "").trim()).filter(Boolean)
    : [];
  const rawDownloads = data?.downloads && typeof data.downloads === "object" ? data.downloads : {};
  const downloads = ["macos-arm64", "macos-intel", "windows"].reduce((acc, platform) => {
    const item = rawDownloads[platform] && typeof rawDownloads[platform] === "object" ? rawDownloads[platform] : {};
    const fileName = String(item.fileName || item.file_name || "").trim();
    acc[platform] = {
      url: String(item.url || `/api/download/${platform}`).trim(),
      fileName,
      size: Number(item.size || 0) || 0,
      available: Boolean(fileName),
    };
    return acc;
  }, {});
  return {
    version,
    releaseDate,
    downloadUrl,
    title: String(data?.title || (version ? `Sonus ${version}` : "")).trim(),
    notes,
    downloads,
  };
}

async function fetchCurrentReleaseFromSupabase() {
  const rows = await supabaseRequest("/rest/v1/app_settings?select=value&key=eq.desktop_release&limit=1");
  const release = normalizeRelease(Array.isArray(rows) ? rows[0] : null);
  if (!release.downloadUrl || release.downloadUrl === DEFAULT_NORMALIZED_SITE_CONFIG.downloadUrl) {
    const config = await getSiteConfig();
    release.downloadUrl = String(Array.isArray(rows) ? rows[0]?.value?.downloadUrl || rows[0]?.value?.download_url || "" : "").startsWith("/")
      ? `${config.siteUrl}${Array.isArray(rows) ? rows[0]?.value?.downloadUrl || rows[0]?.value?.download_url : ""}`
      : config.downloadUrl;
  }
  return release;
}

function normalizeDownloadAvailability(value = {}) {
  const data = value?.value && typeof value.value === "object" ? value.value : value;
  const platforms = data?.platforms && typeof data.platforms === "object" ? data.platforms : data;
  return ["macos-arm64", "macos-intel", "windows"].reduce((acc, platform) => {
    acc[platform] = platforms?.[platform] !== false;
    return acc;
  }, {});
}

function applyDownloadAvailability(release, availability) {
  const next = {
    ...release,
    downloads: { ...(release.downloads || {}) },
  };
  ["macos-arm64", "macos-intel", "windows"].forEach((platform) => {
    const item = next.downloads[platform] || {};
    next.downloads[platform] = {
      ...item,
      available: availability[platform] !== false && Boolean(item.fileName),
    };
  });
  return next;
}

async function fetchDownloadAvailabilityFromSupabase() {
  try {
    const response = await fetch("/api/download-availability", { headers: { Accept: "application/json" } });
    if (response.ok) return normalizeDownloadAvailability(await response.json());
  } catch {
    // Fall back to the public Supabase policy for static hosting.
  }
  const rows = await supabaseRequest("/rest/v1/app_settings?select=value&key=eq.download_availability&limit=1");
  return normalizeDownloadAvailability(Array.isArray(rows) ? rows[0] : null);
}

async function fetchReleaseHistoryFromSupabase() {
  const rows = await supabaseRequest("/rest/v1/app_releases?select=version,release_date,title,notes,download_url&order=release_date.desc,created_at.desc&limit=50");
  return Array.isArray(rows) ? rows.map(normalizeRelease).filter((release) => release.version) : [];
}

async function hydrateCurrentAppVersion() {
  const targets = document.querySelectorAll("[data-current-app-version]");
  const titleTargets = document.querySelectorAll("[data-current-app-title]");
  const dateTargets = document.querySelectorAll("[data-current-release-date]");
  const notesTargets = document.querySelectorAll("[data-current-release-notes]");
  if (!targets.length && !titleTargets.length && !dateTargets.length && !notesTargets.length) return;
  try {
    const data = await fetchCurrentReleaseFromSupabase();
    const version = String(data?.version || "").trim();
    if (!version) return;
    targets.forEach((target) => {
      target.textContent = `v${version}`;
    });
    titleTargets.forEach((target) => {
      target.textContent = String(data?.title || `Sonus ${version}`);
    });
    dateTargets.forEach((target) => {
      const releaseDate = String(data?.releaseDate || "").trim();
      if (!releaseDate) return;
      target.textContent = formatReleaseDate(releaseDate);
      target.setAttribute("datetime", releaseDate);
    });
    const notes = Array.isArray(data?.notes) ? data.notes.map((note) => String(note || "").trim()).filter(Boolean) : [];
    if (notes.length) {
      notesTargets.forEach((target) => {
        target.innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
      });
    }
  } catch {
    // Keep the static fallback version in the HTML.
  }
}

function setDownloadCardState(card, available, url = "") {
  const action = card?.querySelector("[data-download-action]");
  const status = card?.querySelector("[data-download-status]");
  if (!card || !action) return;
  card.classList.toggle("muted", !available);
  action.classList.toggle("disabled", !available);
  action.setAttribute("aria-disabled", available ? "false" : "true");
  if (available) {
    action.href = url;
    action.removeAttribute("data-download-missing");
    if (status) status.textContent = "Available";
    return;
  }
  action.removeAttribute("href");
  action.setAttribute("data-download-missing", "");
  if (status) status.textContent = "Soon";
}

function updateMacDownloadVariant(platformId) {
  const card = document.querySelector("[data-mac-download-card]");
  if (!card) return;
  const release = window.__sonusCurrentRelease || {};
  const item = release.downloads?.[platformId] || {};
  const available = Boolean(item.fileName && item.available !== false);
  const title = card.querySelector("[data-mac-download-title]");
  const copy = card.querySelector("[data-mac-download-copy]");
  const action = card.querySelector("[data-download-action]");
  if (title) title.textContent = platformId === "macos-intel" ? "macOS Intel" : "macOS Apple Silicon";
  if (copy) {
    copy.textContent = platformId === "macos-intel"
      ? "Native build for Intel Macs. Requires macOS 12 Monterey or later."
      : "Native build for M1, M2, M3, and M4 Macs. Requires macOS 12 Monterey or later.";
  }
  if (action) action.textContent = platformId === "macos-intel" ? "Download for macOS Intel" : "Download for macOS ARM64";
  setDownloadCardState(card, available, item.url || `/api/download/${platformId}`);
  card.querySelectorAll("[data-mac-download-option]").forEach((button) => {
    const active = button.dataset.macDownloadOption === platformId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

async function hydrateDownloadCards() {
  if (!document.querySelector("[data-download-platform], [data-mac-download-card]")) return;
  try {
    const [rawRelease, availability] = await Promise.all([
      fetchCurrentReleaseFromSupabase(),
      fetchDownloadAvailabilityFromSupabase().catch(() => normalizeDownloadAvailability()),
    ]);
    const release = applyDownloadAvailability(rawRelease, availability);
    window.__sonusCurrentRelease = release;
    document.querySelectorAll("[data-download-platform]").forEach((card) => {
      const platform = card.dataset.downloadPlatform;
      const item = release.downloads?.[platform] || {};
      setDownloadCardState(card, Boolean(item.fileName && item.available !== false), item.url || `/api/download/${platform}`);
    });
    const arm64 = release.downloads?.["macos-arm64"];
    const intel = release.downloads?.["macos-intel"];
    const defaultMac = arm64?.fileName && arm64.available !== false
      ? "macos-arm64"
      : intel?.fileName && intel.available !== false
        ? "macos-intel"
        : "macos-arm64";
    updateMacDownloadVariant(defaultMac);
  } catch {
    bindDownloadPlaceholder();
  }
}

async function hydrateAppReleases() {
  const list = document.querySelector("[data-release-list]");
  if (!list) return;

  try {
    const releases = await fetchReleaseHistoryFromSupabase();
    if (!Array.isArray(releases) || !releases.length) return;

    list.innerHTML = releases.map((release, index) => {
      const version = String(release?.version || "").trim();
      const releaseDate = String(release?.releaseDate || "").trim();
      const title = String(release?.title || `Sonus ${version}`).trim();
      const notes = Array.isArray(release?.notes)
        ? release.notes.map((note) => String(note || "").trim()).filter(Boolean)
        : [];
      return `
        <article class="patch-note-card">
          <div class="patch-note-meta">
            <span>${index === 0 ? "Current" : "Release"}</span>
            <time datetime="${escapeHtml(releaseDate)}">${escapeHtml(formatReleaseDate(releaseDate) || releaseDate)}</time>
          </div>
          <div class="patch-note-body">
            <h2>${escapeHtml(title)}</h2>
            <ul>
              ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
            </ul>
          </div>
        </article>
      `;
    }).join("");
  } catch {
    // Keep the static fallback release notes in the HTML.
  }
}

bindMobileNav();
hydrateNav();
hydratePlatformDownloadLabels();
hydrateSiteConfigLinks();
hydrateCurrentAppVersion();
hydrateDownloadCards();
hydrateAppReleases();
hydrateLaunchGate();
bindDownloadPlaceholder();
bindOAuthButtons();
bindPasswordToggles();

document.querySelectorAll("[data-mac-download-option]").forEach((button) => {
  button.addEventListener("click", () => updateMacDownloadVariant(button.dataset.macDownloadOption || "macos-arm64"));
});

document.addEventListener("click", closeAccountMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAccountMenu();
    closeMobileNav();
  }
});
