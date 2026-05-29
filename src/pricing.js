import { ensureProfile, getActiveSession, readBool, signOut } from "./supabase.js";
import { startCheckout } from "./billing.js";
import { fetchLaunchSettings, formatCountdownCompact, formatLaunchDate, getLaunchState } from "./launch.js";

function $(selector) {
  return document.querySelector(selector);
}

function showStatus(message, type = "") {
  const status = $("#pricing-status");
  if (!status) return;
  status.textContent = message || "";
  status.className = `form-status${type ? ` ${type}` : ""}`;
}

async function bootPricing() {
  const params = new URLSearchParams(window.location.search || "");
  if (params.get("checkout") === "cancelled") {
    showStatus("Checkout cancelled. Your card was not charged.", "error");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const session = await getActiveSession();
  document.querySelectorAll("[data-pricing-auth]").forEach((element) => {
    element.hidden = Boolean(session);
  });

  let alreadyBought = false;
  if (session) {
    try {
      const profile = await ensureProfile(session);
      alreadyBought = readBool(profile?.premium);
    } catch {
      await signOut(session);
      alreadyBought = false;
    }
  }

  const launchSettings = await fetchLaunchSettings();
  let launchLocked = getLaunchState(launchSettings).locked;
  const updateLaunchButtons = () => {
    const state = getLaunchState(launchSettings);
    launchLocked = state.locked;
    document.querySelectorAll("[data-buy-sonus]").forEach((button) => {
      if (button.dataset.alreadyBought === "true") return;
      if (state.locked) {
        button.disabled = true;
        button.classList.add("is-launch-locked");
        button.textContent = `Launches in ${formatCountdownCompact(state.remainingMs)}`;
        button.setAttribute("aria-disabled", "true");
      } else {
        button.disabled = false;
        button.classList.remove("is-launch-locked");
        button.textContent = button.dataset.idleText || "Buy lifetime licence";
        button.removeAttribute("aria-disabled");
      }
    });
  };

  document.querySelectorAll("[data-buy-sonus]").forEach((button) => {
    if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
    if (alreadyBought) {
      button.dataset.alreadyBought = "true";
      button.disabled = true;
      button.textContent = "Already bought";
      button.setAttribute("aria-disabled", "true");
      showStatus("Your Sonus licence is already active.", "success");
      return;
    }

    button.addEventListener("click", async () => {
      if (launchLocked) return;
      showStatus("");
      try {
        await startCheckout(button);
      } catch (error) {
        showStatus(error?.message || "Checkout failed.", "error");
      }
    });
  });

  updateLaunchButtons();
  if (launchLocked) {
    showStatus(`Sonus launches on ${formatLaunchDate(getLaunchState(launchSettings).launchAt)}. Checkout unlocks automatically at launch.`, "success");
    const interval = window.setInterval(() => {
      updateLaunchButtons();
      if (!launchLocked) {
        window.clearInterval(interval);
        showStatus("");
      }
    }, 1000);
  }
}

bootPricing();
