import { getActiveSession } from "./supabase.js";
import { confirmCheckoutSession } from "./billing.js";

const REDIRECT_SECONDS = 5;

function $(selector) {
  return document.querySelector(selector);
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setState({ kicker, title, copy, primaryHidden = false, retryHidden = true }) {
  setText("#success-kicker", kicker);
  setText("#success-title", title);
  setText("#success-copy", copy);
  const primary = $("#success-primary");
  const retry = $("#success-retry");
  if (primary) primary.hidden = primaryHidden;
  if (retry) retry.hidden = retryHidden;
}

function startDashboardCountdown() {
  const countdown = $("#success-countdown");
  let remaining = REDIRECT_SECONDS;

  const render = () => {
    if (countdown) {
      countdown.textContent = `Opening your dashboard in ${remaining} second${remaining === 1 ? "" : "s"}...`;
    }
  };

  render();
  const timer = window.setInterval(() => {
    remaining -= 1;
    render();
    if (remaining <= 0) {
      window.clearInterval(timer);
      window.location.href = "/dashboard/";
    }
  }, 1000);
}

async function confirmPurchase() {
  const params = new URLSearchParams(window.location.search || "");
  const sessionId = params.get("session_id");

  if (!sessionId) {
    setState({
      kicker: "Checkout complete",
      title: "Thank you for buying Sonus.",
      copy: "Your purchase is complete. Your dashboard is opening now.",
    });
    startDashboardCountdown();
    return;
  }

  const session = await getActiveSession();
  if (!session) {
    setState({
      kicker: "Sign in required",
      title: "Payment received.",
      copy: "Log in with the account you used for checkout so Sonus can finish unlocking your licence.",
    });
    const primary = $("#success-primary");
    if (primary) {
      primary.href = "/login/";
      primary.textContent = "Log in";
      primary.hidden = false;
    }
    return;
  }

  await confirmCheckoutSession(session, sessionId);
  window.history.replaceState({}, document.title, window.location.pathname);
  setState({
    kicker: "Purchase confirmed",
    title: "Thank you for buying Sonus.",
    copy: "Your licence is active. You can now open the dashboard and download the desktop app.",
  });
  startDashboardCountdown();
}

async function boot() {
  $("#success-retry")?.addEventListener("click", async () => {
    $("#success-retry").hidden = true;
    setState({
      kicker: "Retrying",
      title: "Finalizing your purchase...",
      copy: "Checking Stripe again and unlocking your licence.",
      primaryHidden: true,
    });
    try {
      await confirmPurchase();
    } catch (error) {
      showConfirmationError(error);
    }
  });

  try {
    await confirmPurchase();
  } catch (error) {
    showConfirmationError(error);
  }
}

function showConfirmationError(error) {
  setState({
    kicker: "Payment received",
    title: "We could not confirm it automatically.",
    copy: error?.message || "Open the dashboard in a moment. If Stripe has completed the payment, the webhook can still unlock your licence.",
    retryHidden: false,
  });
  setText("#success-countdown", "");
}

boot();
