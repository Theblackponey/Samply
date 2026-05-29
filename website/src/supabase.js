export const SUPABASE_URL = "https://scypgutogbufbtrshdoe.supabase.co";
export const SUPABASE_KEY = "sb_publishable_SMrAxMNHKpkvbQcY_CgGPg_N1FqdXi4";

const SESSION_KEY = "samply.web.session";
const PROFILE_TABLE = "profiles";
const PROFILE_CREATE_GRACE_MS = 10 * 60 * 1000;

export function cleanText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

export function normalizeUsername(value) {
  return cleanText(value, 32)
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

export function isValidUsername(value) {
  return /^[a-z0-9_]{3,32}$/.test(String(value || ""));
}

export function isValidPassword(value) {
  return String(value || "").length >= 8;
}

export function readBool(value) {
  if (typeof value === "boolean") return value;
  return ["true", "yes", "1"].includes(String(value || "").toLowerCase());
}

export function readableSupabaseError(data, fallback = "Supabase request failed") {
  const message = data?.error_description || data?.msg || data?.message || data?.error || fallback;
  const raw = [
    data?.code,
    data?.details,
    data?.hint,
    message,
  ].filter(Boolean).join(" ").toLowerCase();

  if (
    raw.includes("profiles_username_unique") ||
    raw.includes("lower(username)") ||
    (raw.includes("duplicate key") && raw.includes("username"))
  ) {
    return "This username is already taken.";
  }

  return message;
}

export async function supabaseRequest(path, options = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${options.token || SUPABASE_KEY}`,
    ...options.headers,
  };

  let body = options.body;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(readableSupabaseError(data));
  }

  return data;
}

export function extractSession(data) {
  if (!data) return null;
  const session = data.session || data;
  if (!session.access_token) return null;

  const expiresAt = session.expires_at || (
    Number.isFinite(Number(session.expires_in))
      ? Math.floor(Date.now() / 1000) + Number(session.expires_in)
      : null
  );

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token || null,
    expires_at: expiresAt,
    token_type: session.token_type || "bearer",
    user: session.user || data.user || null,
  };
}

export function saveSession(session) {
  if (!session?.access_token) return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function isRecentlyCreatedUser(user) {
  const createdAt = Date.parse(user?.created_at || "");
  return Number.isFinite(createdAt) && Date.now() - createdAt <= PROFILE_CREATE_GRACE_MS;
}

function missingProfileError() {
  const error = new Error("This account is no longer available. Please log in again.");
  error.code = "PROFILE_MISSING";
  return error;
}

export async function refreshSession(session) {
  if (!session?.refresh_token) return session;
  const expiresAt = Number(session.expires_at || 0);
  const shouldRefresh = !expiresAt || expiresAt - Math.floor(Date.now() / 1000) < 90;
  if (!shouldRefresh) return session;

  const data = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: session.refresh_token },
  });
  const nextSession = extractSession(data);
  if (nextSession) saveSession(nextSession);
  return nextSession;
}

export async function getActiveSession() {
  const saved = loadSession();
  if (!saved?.access_token) return null;
  try {
    const session = await refreshSession(saved);
    if (!session?.access_token) return null;
    const user = await getUser(session, true);
    session.user = user;
    saveSession(session);
    return session;
  } catch {
    clearSession();
    return null;
  }
}

export async function getUser(session, force = false) {
  if (!force && session?.user?.id) return session.user;
  return supabaseRequest("/auth/v1/user", { token: session.access_token });
}

export async function resolveLoginEmail(identifier) {
  const login = cleanText(identifier, 240);
  if (!login) return "";
  if (login.includes("@")) return login;

  const username = normalizeUsername(login);
  if (!isValidUsername(username)) {
    throw new Error("Username must be 3-32 characters: letters, numbers or underscore.");
  }

  const resolved = await supabaseRequest("/rest/v1/rpc/resolve_login_email", {
    method: "POST",
    body: { login: username },
  });

  if (!resolved) throw new Error("No account found for this username.");
  return String(resolved);
}

export async function signInWithPassword(identifier, password) {
  const email = await resolveLoginEmail(identifier);
  const data = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  const session = extractSession(data);
  if (!session) throw new Error("No session returned by Supabase.");
  saveSession(session);
  return session;
}

export async function signUpWithPassword({ username, email, password }) {
  const normalizedUsername = normalizeUsername(username);
  if (!isValidUsername(normalizedUsername)) {
    throw new Error("Username must be 3-32 characters: letters, numbers or underscore.");
  }

  const data = await supabaseRequest("/auth/v1/signup", {
    method: "POST",
    body: {
      email: cleanText(email, 240),
      password,
      data: {
        username: normalizedUsername,
        password_set: true,
      },
    },
  });

  const session = extractSession(data);
  if (session) {
    saveSession(session);
    await ensureProfile(session, {
      createIfMissing: true,
      overrides: {
        username: normalizedUsername,
        password_set: true,
      },
    });
  }
  return { data, session };
}

export function buildOAuthUrl(provider) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  const redirect = new URLSearchParams(window.location.search || "").get("redirect") || "";
  const safeRedirect = redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "";
  url.searchParams.set("provider", provider);
  url.searchParams.set("redirect_to", `${window.location.origin}${safeRedirect || "/dashboard/"}`);
  return url.toString();
}

export function startOAuth(provider, flow = "login") {
  if (!["google", "discord"].includes(provider)) return;
  sessionStorage.setItem("samply.oauth.flow", flow);
  window.location.href = buildOAuthUrl(provider);
}

export function readOAuthCallback() {
  const params = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  hash.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });

  const error = params.get("error_description") || params.get("error");
  if (error) throw new Error(error);

  const accessToken = params.get("access_token");
  if (!accessToken) return null;

  const expiresIn = Number(params.get("expires_in") || 3600);
  const session = extractSession({
    access_token: accessToken,
    refresh_token: params.get("refresh_token"),
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 3600,
    token_type: params.get("token_type") || "bearer",
  });

  if (session) {
    saveSession(session);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  return session;
}

export function profileFromUser(user) {
  const metadata = user?.user_metadata || {};
  const appMetadata = user?.app_metadata || {};
  const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers : [];
  return {
    id: user?.id,
    email: user?.email || "",
    username: normalizeUsername(metadata.username || ""),
    password_set: readBool(metadata.password_set) || appMetadata.provider === "email" || providers.includes("email"),
    tutorial_completed: readBool(metadata.tutorial_completed),
  };
}

export async function fetchProfile(session) {
  const user = await getUser(session);
  const rows = await supabaseRequest(`/rest/v1/${PROFILE_TABLE}?select=id,email,username,password_set,tutorial_completed,premium,administrator&id=eq.${encodeURIComponent(user.id)}`, {
    token: session.access_token,
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function upsertProfile(session, overrides = {}) {
  const user = await getUser(session);
  const metaProfile = profileFromUser(user);
  const payload = {
    id: user.id,
    email: user.email || "",
    username: normalizeUsername(overrides.username ?? metaProfile.username),
    password_set: readBool(overrides.password_set ?? metaProfile.password_set),
    tutorial_completed: readBool(overrides.tutorial_completed ?? metaProfile.tutorial_completed),
  };

  const rows = await supabaseRequest(`/rest/v1/${PROFILE_TABLE}?on_conflict=id`, {
    method: "POST",
    token: session.access_token,
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: payload,
  });

  return Array.isArray(rows) ? rows[0] || payload : payload;
}

export async function ensureProfile(session, options = {}) {
  const existing = await fetchProfile(session);
  if (existing) return existing;

  const user = await getUser(session);
  const canCreate = options.createIfMissing === true ||
    (options.createIfFreshAuthUser === true && isRecentlyCreatedUser(user));
  if (!canCreate) throw missingProfileError();

  return upsertProfile(session, options.overrides || {});
}

export async function updateProfile(session, updates) {
  const user = await getUser(session);
  const body = {};
  if ("username" in updates) {
    const username = normalizeUsername(updates.username);
    if (!isValidUsername(username)) {
      throw new Error("Username must be 3-32 characters: letters, numbers or underscore.");
    }
    body.username = username;
  }
  if ("password_set" in updates) body.password_set = readBool(updates.password_set);
  if ("tutorial_completed" in updates) body.tutorial_completed = readBool(updates.tutorial_completed);

  const rows = await supabaseRequest(`/rest/v1/${PROFILE_TABLE}?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    token: session.access_token,
    headers: { Prefer: "return=representation" },
    body,
  });

  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function updateAccountPassword(session, password) {
  return supabaseRequest("/auth/v1/user", {
    method: "PUT",
    token: session.access_token,
    body: { password },
  });
}

export async function listMachines(session) {
  const rows = await supabaseRequest("/rest/v1/account_machines?select=machine_id,machine_name,platform,arch,app_version,created_at,last_seen&order=last_seen.desc", {
    token: session.access_token,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function deleteMachine(session, machineId) {
  await supabaseRequest(`/rest/v1/account_machines?machine_id=eq.${encodeURIComponent(machineId)}`, {
    method: "DELETE",
    token: session.access_token,
  });
}

export async function listFeedbackMessages(session) {
  const rows = await supabaseRequest("/rest/v1/feedback_messages?select=id,user_id,email,username,type,title,subject,message,source,app_version,platform,user_agent,read_at,created_at&order=created_at.desc&limit=200", {
    token: session.access_token,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function markFeedbackRead(session, id) {
  const rows = await supabaseRequest(`/rest/v1/feedback_messages?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    token: session.access_token,
    headers: { Prefer: "return=representation" },
    body: { read_at: new Date().toISOString() },
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function signOut(session, options = {}) {
  try {
    if (options.revoke === true && session?.access_token) {
      await supabaseRequest("/auth/v1/logout?scope=local", {
        method: "POST",
        token: session.access_token,
      }).catch(() => null);
    }
  } finally {
    clearSession();
  }
}

export function formatDate(value) {
  if (!value) return "Unknown";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "Unknown";
  }
}
