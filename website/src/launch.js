import { supabaseRequest } from "./supabase.js";

export const LAUNCH_SETTING_KEY = "launch_settings";
export const DEFAULT_LAUNCH_AT = "2026-06-01T00:00:00+02:00";

export function normalizeLaunchSettings(rowOrValue = {}) {
  const data = rowOrValue?.value && typeof rowOrValue.value === "object" ? rowOrValue.value : rowOrValue;
  return {
    enabled: data?.enabled !== false,
    launchAt: String(data?.launchAt || data?.launch_at || DEFAULT_LAUNCH_AT).trim(),
  };
}

export async function fetchLaunchSettings() {
  try {
    const rows = await supabaseRequest(`/rest/v1/app_settings?select=value&key=eq.${LAUNCH_SETTING_KEY}&limit=1`);
    return normalizeLaunchSettings(Array.isArray(rows) ? rows[0] : null);
  } catch {
    return normalizeLaunchSettings();
  }
}

export function getLaunchState(settings = normalizeLaunchSettings(), now = new Date()) {
  const launchTime = new Date(settings.launchAt).getTime();
  const validLaunchTime = Number.isFinite(launchTime) ? launchTime : new Date(DEFAULT_LAUNCH_AT).getTime();
  const remainingMs = Math.max(0, validLaunchTime - now.getTime());
  return {
    enabled: settings.enabled !== false,
    launchAt: new Date(validLaunchTime),
    remainingMs,
    locked: settings.enabled !== false && remainingMs > 0,
  };
}

export function countdownParts(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

export function formatCountdownCompact(ms) {
  const { days, hours, minutes, seconds } = countdownParts(ms);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function formatLaunchDate(date) {
  return date.toLocaleString("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
