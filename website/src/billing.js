import { getActiveSession } from "./supabase.js";

export async function startCheckout(button = null) {
  const session = await getActiveSession();
  if (!session?.access_token) {
    window.location.href = "/login/";
    return;
  }

  if (button) {
    if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
    button.disabled = true;
    button.textContent = "Opening Stripe...";
  }

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) {
      throw new Error(data.error || "Unable to start checkout.");
    }
    window.location.href = data.url;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.idleText || "Buy";
    }
  }
}

export async function confirmCheckoutSession(session, sessionId) {
  if (!session?.access_token || !sessionId) return null;
  const response = await fetch("/api/confirm-checkout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Unable to confirm checkout.");
  }
  return data;
}
