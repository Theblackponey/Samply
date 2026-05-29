const DEFAULT_SITE_CONFIG = {
  siteUrl: typeof window !== "undefined" ? window.location.origin : "",
  supportEmail: "",
  downloadPath: "/download/",
  pricingPath: "/pricing/",
};

let siteConfigPromise = null;

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function cleanPath(value, fallback) {
  const text = String(value || fallback || "/").trim();
  const withLeading = text.startsWith("/") ? text : `/${text}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function inferSupportEmail(siteUrl) {
  try {
    const hostname = new URL(siteUrl).hostname.replace(/^www\./i, "");
    return hostname ? `support@${hostname}` : "";
  } catch {
    return "";
  }
}

export function normalizeSiteConfig(value = {}) {
  const siteUrl = cleanBaseUrl(value.siteUrl || value.baseUrl || DEFAULT_SITE_CONFIG.siteUrl);
  const supportEmail = String(value.supportEmail || value.support_email || DEFAULT_SITE_CONFIG.supportEmail || inferSupportEmail(siteUrl)).trim();
  const downloadPath = cleanPath(value.downloadPath, DEFAULT_SITE_CONFIG.downloadPath);
  const pricingPath = cleanPath(value.pricingPath, DEFAULT_SITE_CONFIG.pricingPath);
  return {
    siteUrl,
    supportEmail,
    downloadPath,
    pricingPath,
    downloadUrl: `${siteUrl}${downloadPath}`,
    pricingUrl: `${siteUrl}${pricingPath}`,
  };
}

export async function getSiteConfig() {
  siteConfigPromise ||= fetch("/site-config.json", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : {})
    .catch(() => ({}))
    .then(normalizeSiteConfig);
  return siteConfigPromise;
}

export const DEFAULT_NORMALIZED_SITE_CONFIG = normalizeSiteConfig(DEFAULT_SITE_CONFIG);
