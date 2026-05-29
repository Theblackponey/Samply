const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const root = __dirname;
function readJsonFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function cleanPath(value, fallback) {
  const text = String(value || fallback || "/").trim();
  const withLeading = text.startsWith("/") ? text : `/${text}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function absoluteSiteUrl(value, fallback = siteUrl) {
  const text = String(value || fallback || "").trim();
  if (!text) return "";
  if (text.startsWith("/")) return `${siteUrl}${text}`;
  return text;
}

function inferSupportEmail(value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./i, "");
    return hostname ? `support@${hostname}` : "";
  } catch {
    return "";
  }
}

function loadLocalEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
loadLocalEnv();

const siteConfig = readJsonFile(path.join(root, "site-config.json"), {});
const configuredSiteUrl = cleanBaseUrl(siteConfig.siteUrl || siteConfig.baseUrl || "");
const configuredDownloadPath = cleanPath(siteConfig.downloadPath, "/download/");
const configuredPricingPath = cleanPath(siteConfig.pricingPath, "/pricing/");

const host = process.env.PORT ? "0.0.0.0" : (process.env.HOST || "127.0.0.1");
const port = Number(process.env.PORT || 4173);
const siteUrl = cleanBaseUrl(configuredSiteUrl || `http://${host}:${port}`);
const siteDownloadUrl = `${siteUrl}${configuredDownloadPath}`;
const sitePricingUrl = `${siteUrl}${configuredPricingPath}`;
const supportEmail = String(siteConfig.supportEmail || siteConfig.support_email || inferSupportEmail(siteUrl)).trim();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://scypgutogbufbtrshdoe.supabase.co";
const SUPABASE_PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || "sb_publishable_SMrAxMNHKpkvbQcY_CgGPg_N1FqdXi4";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID || "").trim();
const STRIPE_PRODUCT_ID = (process.env.STRIPE_PRODUCT_ID || "").trim();
const PRODUCT_NAME = "Sonus Lifetime Access";
const PRODUCT_PRICE_CENTS = 4900;
const PRODUCT_CURRENCY = "usd";
const APP_VERSION_SETTING_KEY = "desktop_release";
const DOWNLOAD_AVAILABILITY_SETTING_KEY = "download_availability";
const LAUNCH_SETTING_KEY = "launch_settings";
const DEFAULT_LAUNCH_AT = "2026-06-01T00:00:00+02:00";
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || (supportEmail ? `Sonus <${supportEmail}>` : "Sonus")).trim();
const RESEND_REPLY_TO = (process.env.RESEND_REPLY_TO || "").trim();
const WAITLIST_EMAIL_INTERVAL_MS = Math.max(60_000, Number(process.env.WAITLIST_EMAIL_INTERVAL_MS || 300_000));
const WAITLIST_EMAIL_BATCH_SIZE = Math.min(50, Math.max(1, Number(process.env.WAITLIST_EMAIL_BATCH_SIZE || 25)));
const PROMO_CODE_FREE = "FIRST100";
const PROMO_CODE_DISCOUNT = "FIRST25";
const configuredReleaseUploadMaxBytes = String(process.env.RELEASE_UPLOAD_MAX_BYTES || "").trim();
const RELEASE_UPLOAD_MAX_BYTES = configuredReleaseUploadMaxBytes && configuredReleaseUploadMaxBytes !== "0"
  ? Math.max(50 * 1024 * 1024, Number(configuredReleaseUploadMaxBytes))
  : Infinity;
const B2_KEY_ID = (process.env.B2_KEY_ID || process.env.BACKBLAZE_B2_KEY_ID || "").trim();
const B2_APPLICATION_KEY = (process.env.B2_APPLICATION_KEY || process.env.BACKBLAZE_B2_APPLICATION_KEY || "").trim();
const B2_BUCKET_ID = (process.env.B2_BUCKET_ID || process.env.BACKBLAZE_B2_BUCKET_ID || "").trim();
const B2_BUCKET_NAME = (process.env.B2_BUCKET_NAME || process.env.BACKBLAZE_B2_BUCKET_NAME || "sonus-app").trim();
const B2_DOWNLOAD_AUTH_SECONDS = Math.min(604800, Math.max(60, Number(process.env.B2_DOWNLOAD_AUTH_SECONDS || 900)));
const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH || "").trim();
const ADMIN_SESSION_SECRET = (process.env.ADMIN_SESSION_SECRET || SUPABASE_SERVICE_ROLE_KEY || STRIPE_SECRET_KEY || "").trim();
const ADMIN_SESSION_COOKIE = "sonus_admin_session";
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_SESSION_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const adminPasswordAttempts = new Map();

const RELEASE_PLATFORMS = [
  { id: "macos-arm64", field: "zip_macos_arm64", folder: "macOS - ARM64", label: "macOS ARM64", extensions: [".dmg", ".zip"], defaultExt: ".dmg" },
  { id: "macos-intel", field: "zip_macos_intel", folder: "macOS - Intel", label: "macOS Intel", extensions: [".dmg", ".zip"], defaultExt: ".dmg" },
  { id: "windows", field: "zip_windows", folder: "Windows", label: "Windows", extensions: [".exe", ".zip"], defaultExt: ".exe" },
];

const routeFiles = new Map([
  ["/", "index.html"],
  ["/favicon.ico", "assets/samply-icon.png"],
  ["/favicon.png", "assets/samply-icon.png"],
  ["/site-config.json", "site-config.json"],
  ["/download", "download/index.html"],
  ["/pricing", "pricing/index.html"],
  ["/buy", "pricing/index.html"],
  ["/checkout-success", "checkout-success/index.html"],
  ["/login", "login/index.html"],
  ["/signup", "signup/index.html"],
  ["/dashboard", "dashboard/index.html"],
  ["/admin", "admin/index.html"],
  ["/patch-notes", "patch-notes/index.html"],
  ["/privacy", "privacy/index.html"],
  ["/terms", "terms/index.html"],
  ["/cookies", "cookies/index.html"],
  ["/refund", "refund/index.html"],
  ["/legal", "legal/index.html"],
  ["/contact", "contact/index.html"],
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".ttf", "font/ttf"],
  [".dmg", "application/octet-stream"],
  [".exe", "application/vnd.microsoft.portable-executable"],
  [".zip", "application/zip"],
]);

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": statusCode === 200 ? "no-cache" : "no-store",
  });
  res.end(body);
}

function sendJson(res, statusCode, data) {
  send(res, statusCode, JSON.stringify(data), "application/json; charset=utf-8");
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(buffer) {
  if (!buffer?.length) return {};
  return JSON.parse(buffer.toString("utf8"));
}

function multipartBoundary(req) {
  const type = String(req.headers["content-type"] || "");
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  return match ? String(match[1] || match[2] || "").trim() : "";
}

function parseContentDisposition(value) {
  const parts = String(value || "").split(";").map((part) => part.trim());
  const result = {};
  for (const part of parts.slice(1)) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    let itemValue = part.slice(index + 1).trim();
    if (itemValue.startsWith('"') && itemValue.endsWith('"')) {
      itemValue = itemValue.slice(1, -1).replace(/\\"/g, '"');
    }
    result[key] = itemValue;
  }
  return result;
}

function safeUploadFilename(value) {
  return String(value || "upload.zip").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload.zip";
}

function createTempUploadPath(filename) {
  const suffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeUploadFilename(filename)}`;
  return path.join(os.tmpdir(), `sonus-release-${suffix}`);
}

function cleanupMultipartFiles(files) {
  for (const file of Object.values(files || {})) {
    if (file?.path) fs.promises.unlink(file.path).catch(() => {});
  }
}

function readMultipartForm(req, { maxBytes = RELEASE_UPLOAD_MAX_BYTES } = {}) {
  const boundary = multipartBoundary(req);
  if (!boundary) return Promise.reject(new Error("Missing multipart boundary."));

  const initialBoundary = Buffer.from(`--${boundary}`);
  const partBoundary = Buffer.from(`\r\n--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const fields = {};
  const files = {};
  const writePromises = [];
  let totalBytes = 0;
  let buffer = Buffer.alloc(0);
  let state = "preamble";
  let currentPart = null;
  let finished = false;

  const closeCurrentPart = () => {
    if (!currentPart) return;
    const part = currentPart;
    currentPart = null;
    if (part.stream) {
      writePromises.push(new Promise((resolve, reject) => {
        part.stream.on("finish", resolve);
        part.stream.on("error", reject);
        part.stream.end();
      }));
      files[part.name] = {
        path: part.path,
        filename: part.filename,
        contentType: part.contentType,
        size: part.size,
      };
      return;
    }
    fields[part.name] = Buffer.concat(part.chunks).toString("utf8");
  };

  const writePartData = (chunk) => {
    if (!chunk.length || !currentPart) return;
    if (currentPart.stream) {
      currentPart.size += chunk.length;
      currentPart.stream.write(chunk);
      return;
    }
    currentPart.chunks.push(chunk);
  };

  const startPart = (headersText) => {
    const headers = {};
    for (const line of headersText.split(/\r?\n/)) {
      const index = line.indexOf(":");
      if (index === -1) continue;
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
    const disposition = parseContentDisposition(headers["content-disposition"]);
    const name = disposition.name;
    if (!name) throw new Error("Multipart field is missing a name.");
    const filename = disposition.filename || "";
    if (filename) {
      const filePath = createTempUploadPath(filename);
      currentPart = {
        name,
        filename,
        contentType: headers["content-type"] || "application/octet-stream",
        path: filePath,
        stream: fs.createWriteStream(filePath),
        size: 0,
      };
      return;
    }
    currentPart = { name, chunks: [] };
  };

  const processBuffer = () => {
    while (!finished) {
      if (state === "preamble") {
        const index = buffer.indexOf(initialBoundary);
        if (index === -1) {
          buffer = buffer.subarray(Math.max(0, buffer.length - initialBoundary.length));
          return;
        }
        buffer = buffer.subarray(index + initialBoundary.length);
        if (buffer.length < 2) return;
        if (buffer.subarray(0, 2).toString() === "--") {
          finished = true;
          return;
        }
        if (buffer.subarray(0, 2).toString() !== "\r\n") throw new Error("Malformed multipart body.");
        buffer = buffer.subarray(2);
        state = "headers";
      }

      if (state === "headers") {
        const index = buffer.indexOf(headerSeparator);
        if (index === -1) return;
        startPart(buffer.subarray(0, index).toString("utf8"));
        buffer = buffer.subarray(index + headerSeparator.length);
        state = "content";
      }

      if (state === "content") {
        const index = buffer.indexOf(partBoundary);
        if (index === -1) {
          const keepLength = partBoundary.length + 4;
          const writeLength = Math.max(0, buffer.length - keepLength);
          if (writeLength > 0) {
            writePartData(buffer.subarray(0, writeLength));
            buffer = buffer.subarray(writeLength);
          }
          return;
        }

        if (buffer.length < index + partBoundary.length + 2) {
          if (index > 0) {
            writePartData(buffer.subarray(0, index));
            buffer = buffer.subarray(index);
          }
          return;
        }

        writePartData(buffer.subarray(0, index));
        buffer = buffer.subarray(index + partBoundary.length);
        const suffix = buffer.subarray(0, 2).toString();
        closeCurrentPart();
        if (suffix === "--") {
          finished = true;
          buffer = buffer.subarray(2);
          return;
        }
        if (suffix !== "\r\n") throw new Error("Malformed multipart boundary.");
        buffer = buffer.subarray(2);
        state = "headers";
      }
    }
  };

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      cleanupMultipartFiles(files);
      if (currentPart?.path) fs.promises.unlink(currentPart.path).catch(() => {});
      reject(error);
    };

    req.on("data", (chunk) => {
      try {
        totalBytes += chunk.length;
        if (Number.isFinite(maxBytes) && totalBytes > maxBytes) {
          req.destroy(new Error("Release upload is too large."));
          return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        processBuffer();
      } catch (error) {
        req.destroy(error);
      }
    });
    req.on("end", async () => {
      try {
        processBuffer();
        if (currentPart) closeCurrentPart();
        await Promise.all(writePromises);
        resolve({ fields, files });
      } catch (error) {
        fail(error);
      }
    });
    req.on("error", fail);
  });
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function parseCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  res.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || siteUrl.startsWith("https://");
}

function setAdminSessionCookie(req, res, token, remember) {
  const maxAge = remember ? Math.floor(ADMIN_SESSION_REMEMBER_TTL_MS / 1000) : Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  appendSetCookie(res, [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    isSecureRequest(req) ? "Secure" : "",
  ].filter(Boolean).join("; "));
}

function clearAdminSessionCookie(req, res) {
  appendSetCookie(res, [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    isSecureRequest(req) ? "Secure" : "",
  ].filter(Boolean).join("; "));
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPasswordHash(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expected] = parts;
  const hash = crypto.scryptSync(String(password || ""), Buffer.from(salt, "base64url"), 64, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  }).toString("base64url");
  return timingSafeEqualString(hash, expected);
}

function adminSessionSignature(payload) {
  if (!ADMIN_SESSION_SECRET) throw new Error("Missing ADMIN_SESSION_SECRET.");
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payload).digest("base64url");
}

function createAdminSessionToken(userId, remember) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    exp: Date.now() + (remember ? ADMIN_SESSION_REMEMBER_TTL_MS : ADMIN_SESSION_TTL_MS),
  })).toString("base64url");
  return `${payload}.${adminSessionSignature(payload)}`;
}

function verifyAdminSessionToken(token, userId) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || !timingSafeEqualString(adminSessionSignature(payload), signature)) return false;
  let data = null;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  return data?.uid === userId && Number(data?.exp || 0) > Date.now();
}

function verifyAdminSessionCookie(req, userId) {
  return verifyAdminSessionToken(parseCookies(req)[ADMIN_SESSION_COOKIE], userId);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function checkAdminPasswordThrottle(req) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = adminPasswordAttempts.get(key);
  if (entry?.blockedUntil > now) {
    const error = new Error("Too many admin password attempts. Try again later.");
    error.statusCode = 429;
    throw error;
  }
}

function recordAdminPasswordAttempt(req, success) {
  const key = clientIp(req);
  if (success) {
    adminPasswordAttempts.delete(key);
    return;
  }
  const now = Date.now();
  const entry = adminPasswordAttempts.get(key) || { count: 0, blockedUntil: 0 };
  const count = now > entry.blockedUntil ? entry.count + 1 : entry.count;
  adminPasswordAttempts.set(key, {
    count,
    blockedUntil: count >= 5 ? now + 10 * 60 * 1000 : 0,
  });
}

function requestJson(urlString, options = {}) {
  const url = new URL(urlString);
  const body = options.body || null;
  const requestOptions = {
    method: options.method || "GET",
    hostname: url.hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    headers: {
      ...(options.headers || {}),
    },
  };
  if (body) {
    requestOptions.headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        if (text) {
          try { data = JSON.parse(text); } catch { data = text; }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data?.error?.message || data?.message || data?.msg || text || `Request failed (${res.statusCode})`;
          reject(new Error(message));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestFileUploadJson(urlString, { filePath, fileSize, headers = {} }) {
  const url = new URL(urlString);
  const requestOptions = {
    method: "POST",
    hostname: url.hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    headers: {
      ...headers,
      "Content-Length": fileSize,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        if (text) {
          try { data = JSON.parse(text); } catch { data = text; }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data?.message || data?.error?.message || data?.code || text || `Upload failed (${res.statusCode})`;
          reject(new Error(message));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    fs.createReadStream(filePath).on("error", reject).pipe(req);
  });
}

function formBody(entries) {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  return params.toString();
}

function requireB2Config() {
  if (!B2_KEY_ID || !B2_APPLICATION_KEY || !B2_BUCKET_ID || !B2_BUCKET_NAME) {
    throw new Error("Missing Backblaze B2 configuration. Set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_ID, and B2_BUCKET_NAME.");
  }
}

function b2ApiBase(auth) {
  return String(auth.apiUrl || auth.apiInfo?.storageApi?.apiUrl || "").replace(/\/+$/, "");
}

function b2DownloadBase(auth) {
  return String(auth.downloadUrl || auth.apiInfo?.storageApi?.downloadUrl || "").replace(/\/+$/, "");
}

let b2AuthCache = null;

async function authorizeB2() {
  requireB2Config();
  if (b2AuthCache && b2AuthCache.expiresAt > Date.now() + 60_000) return b2AuthCache;
  const credentials = Buffer.from(`${B2_KEY_ID}:${B2_APPLICATION_KEY}`).toString("base64");
  const data = await requestJson("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  });
  const apiUrl = b2ApiBase(data);
  const downloadUrl = b2DownloadBase(data);
  if (!apiUrl || !downloadUrl || !data.authorizationToken) throw new Error("Backblaze B2 authorization response is incomplete.");
  b2AuthCache = {
    ...data,
    apiUrl,
    downloadUrl,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  };
  return b2AuthCache;
}

function encodeB2FileName(fileName) {
  return encodeURIComponent(fileName).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeDownloadPath(fileName) {
  return String(fileName || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

async function getB2UploadUrl(auth) {
  return requestJson(`${auth.apiUrl}/b2api/v4/b2_get_upload_url?bucketId=${encodeURIComponent(B2_BUCKET_ID)}`, {
    headers: {
      Authorization: auth.authorizationToken,
    },
  });
}

async function uploadReleaseFileToB2(file, fileName) {
  const auth = await authorizeB2();
  const sha1 = await sha1File(file.path);
  const upload = await getB2UploadUrl(auth);
  const uploaded = await requestFileUploadJson(upload.uploadUrl, {
    filePath: file.path,
    fileSize: file.size,
    headers: {
      Authorization: upload.authorizationToken,
      "Content-Type": mimeTypes.get(path.extname(fileName).toLowerCase()) || "application/octet-stream",
      "X-Bz-Content-Sha1": sha1,
      "X-Bz-File-Name": encodeB2FileName(fileName),
    },
  });
  return {
    fileId: uploaded.fileId,
    fileName: uploaded.fileName || fileName,
    size: Number(uploaded.contentLength || file.size || 0),
    sha1,
    uploadedAt: new Date().toISOString(),
  };
}

async function getB2DownloadAuthorization(fileName) {
  const auth = await authorizeB2();
  const data = await requestJson(`${auth.apiUrl}/b2api/v4/b2_get_download_authorization`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bucketId: B2_BUCKET_ID,
      fileNamePrefix: fileName,
      validDurationInSeconds: B2_DOWNLOAD_AUTH_SECONDS,
    }),
  });
  return {
    downloadUrl: auth.downloadUrl,
    authorizationToken: data.authorizationToken,
  };
}

function releaseFileName(platform, version, originalFilename) {
  const originalExt = path.extname(originalFilename || "").toLowerCase();
  const allowedExtensions = Array.isArray(platform.extensions) ? platform.extensions : [".zip"];
  const ext = allowedExtensions.includes(originalExt) ? originalExt : platform.defaultExt || allowedExtensions[0] || ".zip";
  return `${platform.folder}/Sonus-${version}-${platform.id}${ext}`;
}

function normalizeDownloads(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return RELEASE_PLATFORMS.reduce((acc, platform) => {
    const item = source[platform.id] && typeof source[platform.id] === "object" ? source[platform.id] : {};
    const fileName = String(item.fileName || item.file_name || "").trim();
    acc[platform.id] = {
      label: platform.label,
      url: `/api/download/${platform.id}`,
      fileName,
      fileId: String(item.fileId || item.file_id || "").trim(),
      size: Number(item.size || item.contentLength || 0) || 0,
      sha1: String(item.sha1 || "").trim(),
      uploadedAt: item.uploadedAt || item.uploaded_at || null,
      available: Boolean(fileName),
    };
    return acc;
  }, {});
}

function normalizeDownloadAvailability(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const platforms = source.platforms && typeof source.platforms === "object" ? source.platforms : source;
  const availability = RELEASE_PLATFORMS.reduce((acc, platform) => {
    acc[platform.id] = platforms[platform.id] !== false;
    return acc;
  }, {});
  return {
    platforms: availability,
    updatedAt: source.updatedAt || source.updated_at || null,
  };
}

function applyDownloadAvailability(downloads, settings = {}) {
  const normalized = normalizeDownloads(downloads);
  const availability = normalizeDownloadAvailability(settings).platforms;
  for (const platform of RELEASE_PLATFORMS) {
    normalized[platform.id].available = availability[platform.id] !== false && Boolean(normalized[platform.id].fileName);
  }
  return normalized;
}

function primaryReleaseDownloadUrl(downloads = {}) {
  const normalized = normalizeDownloads(downloads);
  const platform = RELEASE_PLATFORMS.find((item) => {
    const download = normalized[item.id];
    return download?.fileName && download.available !== false;
  });
  return platform ? `/api/download/${platform.id}` : configuredDownloadPath;
}

function formatExtensions(extensions = []) {
  return extensions.join(" or ");
}

function validateReleaseArtifact(file, platform) {
  if (!file?.path || !file.size) throw new Error(`${platform.label} installer is required.`);
  const ext = path.extname(file.filename || "").toLowerCase();
  const allowedExtensions = Array.isArray(platform.extensions) ? platform.extensions : [".zip"];
  if (!allowedExtensions.includes(ext)) {
    throw new Error(`${platform.label} must be a ${formatExtensions(allowedExtensions)} file.`);
  }
}

async function uploadReleaseArtifacts(files, version) {
  const result = {};
  for (const platform of RELEASE_PLATFORMS) {
    const file = files[platform.field];
    validateReleaseArtifact(file, platform);
    const fileName = releaseFileName(platform, version, file.filename);
    result[platform.id] = {
      label: platform.label,
      url: `/api/download/${platform.id}`,
      ...(await uploadReleaseFileToB2(file, fileName)),
    };
  }
  return normalizeDownloads(result);
}

async function listB2FileVersions(auth, prefix) {
  const files = [];
  let startFileName = prefix;
  let startFileId = "";
  while (true) {
    const params = new URLSearchParams({
      bucketId: B2_BUCKET_ID,
      startFileName,
      maxFileCount: "1000",
    });
    if (startFileId) params.set("startFileId", startFileId);
    const data = await requestJson(`${auth.apiUrl}/b2api/v4/b2_list_file_versions?${params.toString()}`, {
      headers: {
        Authorization: auth.authorizationToken,
      },
    });
    const batch = Array.isArray(data.files) ? data.files : [];
    for (const file of batch) {
      if (!String(file.fileName || "").startsWith(prefix)) return files;
      files.push(file);
    }
    if (!data.nextFileName) return files;
    startFileName = data.nextFileName;
    startFileId = data.nextFileId || "";
  }
}

async function deleteB2FileVersion(auth, file) {
  return requestJson(`${auth.apiUrl}/b2api/v4/b2_delete_file_version`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.fileName,
      fileId: file.fileId,
    }),
  });
}

async function cleanupOldReleaseFiles(downloads) {
  try {
    const auth = await authorizeB2();
    const keepIds = new Set(Object.values(downloads || {}).map((item) => item?.fileId).filter(Boolean));
    for (const platform of RELEASE_PLATFORMS) {
      const prefix = `${platform.folder}/`;
      const files = await listB2FileVersions(auth, prefix);
      for (const file of files) {
        if (!file.fileId || keepIds.has(file.fileId)) continue;
        await deleteB2FileVersion(auth, file);
      }
    }
  } catch (error) {
    console.warn("[B2] Release cleanup skipped:", error.message || error);
  }
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 240);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function serviceHeaders(extra = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function supabaseServiceRequest(pathname, { method = "GET", body = null, prefer = "" } = {}) {
  return requestJson(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: serviceHeaders({
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    }),
    body: body ? JSON.stringify(body) : null,
  });
}

function supabaseRestHeaders(token = SUPABASE_PUBLIC_KEY, extra = {}) {
  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: isServiceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_PUBLIC_KEY,
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function getSupabaseUser(accessToken) {
  if (!accessToken) throw new Error("Missing session token.");
  return requestJson(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLIC_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function requireAdminUser(req) {
  const accessToken = bearerToken(req);
  const user = await getSupabaseUser(accessToken);
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/profiles?select=administrator&id=eq.${encodeURIComponent(user.id)}&limit=1`, {
    headers: {
      apikey: SUPABASE_PUBLIC_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!Array.isArray(rows) || rows[0]?.administrator !== true) {
    const error = new Error("Admin access required.");
    error.statusCode = 403;
    throw error;
  }
  return { user, accessToken };
}

async function requireAdminAccess(req) {
  const admin = await requireAdminUser(req);
  if (!verifyAdminSessionCookie(req, admin.user.id)) {
    const error = new Error("Admin password required.");
    error.statusCode = 401;
    error.code = "admin_password_required";
    throw error;
  }
  return admin;
}

async function stripeRequest(pathname, { method = "GET", body = null } = {}) {
  if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY.");
  return requestJson(`https://api.stripe.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
}

let resolvedStripePriceIdPromise = null;

async function resolveStripePriceId() {
  if (STRIPE_PRICE_ID) return STRIPE_PRICE_ID;
  if (!STRIPE_PRODUCT_ID) return "";

  resolvedStripePriceIdPromise ||= (async () => {
    const product = await stripeRequest(`/v1/products/${encodeURIComponent(STRIPE_PRODUCT_ID)}?expand[]=default_price`);
    const defaultPrice = product.default_price;
    if (typeof defaultPrice === "string" && defaultPrice.startsWith("price_")) return defaultPrice;
    if (defaultPrice?.id?.startsWith("price_")) return defaultPrice.id;

    const prices = await stripeRequest(`/v1/prices?product=${encodeURIComponent(STRIPE_PRODUCT_ID)}&active=true&limit=1`);
    const firstPrice = prices.data?.[0]?.id || "";
    if (!firstPrice.startsWith("price_")) {
      throw new Error("Stripe product has no active price. Add a default price in Stripe or set STRIPE_PRICE_ID=price_...");
    }
    return firstPrice;
  })();

  return resolvedStripePriceIdPromise;
}

async function activatePremium(userId, email = "") {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  if (!userId) throw new Error("Missing user id.");
  await requestJson(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: userId,
      email: email || "",
      premium: true,
    }),
  });
}

function verifyStripeSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  if (!signatureHeader) throw new Error("Missing Stripe signature.");

  const parts = String(signatureHeader).split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(value);
    return acc;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) throw new Error("Invalid Stripe signature.");

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(signedPayload).digest("hex");
  return signatures.some((signature) => {
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  });
}

async function handleCreateCheckoutSession(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const accessToken = bearerToken(req);
  const user = await getSupabaseUser(accessToken);
  const launchSettings = await readLaunchSettingsFromSupabase();
  const launchState = getLaunchState(launchSettings);
  if (launchState.locked) {
    sendJson(res, 403, {
      error: `Sonus checkout unlocks at launch (${formatLaunchDate(launchState.launchAt)}).`,
      launchAt: launchSettings.launchAt,
      remainingMs: launchState.remainingMs,
    });
    return;
  }
  const catalogPriceId = await resolveStripePriceId();
  const successUrl = `${siteUrl}/checkout-success/?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${sitePricingUrl}?checkout=cancelled`;
  const checkoutEntries = [
    ["mode", "payment"],
    ["success_url", successUrl],
    ["cancel_url", cancelUrl],
    ["client_reference_id", user.id],
    ["customer_email", user.email || null],
    ["allow_promotion_codes", "true"],
    ["line_items[0][quantity]", "1"],
    ["metadata[user_id]", user.id],
    ["metadata[email]", user.email || ""],
    ["metadata[product]", "sonus_lifetime"],
    ["payment_intent_data[metadata][user_id]", user.id],
    ["payment_intent_data[metadata][product]", "sonus_lifetime"],
  ];

  if (catalogPriceId) {
    checkoutEntries.push(["line_items[0][price]", catalogPriceId]);
  } else {
    checkoutEntries.push(
      ["line_items[0][price_data][currency]", PRODUCT_CURRENCY],
      ["line_items[0][price_data][unit_amount]", PRODUCT_PRICE_CENTS],
      ["line_items[0][price_data][product_data][name]", PRODUCT_NAME],
      ["line_items[0][price_data][product_data][description]", "One-time Sonus desktop licence with sample browsing, collections, stack mode, waveform tools, and two machine slots."],
    );
  }

  const body = formBody(checkoutEntries);

  const session = await stripeRequest("/v1/checkout/sessions", { method: "POST", body });
  sendJson(res, 200, { url: session.url, id: session.id });
}

async function handleConfirmCheckout(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const accessToken = bearerToken(req);
  const user = await getSupabaseUser(accessToken);
  const payload = parseJsonBody(await readBody(req));
  const sessionId = String(payload.session_id || "");
  if (!sessionId.startsWith("cs_")) throw new Error("Invalid checkout session.");

  const session = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.client_reference_id !== user.id && session.metadata?.user_id !== user.id) {
    throw new Error("Checkout session does not belong to this user.");
  }
  if (session.payment_status !== "paid") {
    sendJson(res, 402, { error: "Checkout is not paid yet.", payment_status: session.payment_status });
    return;
  }

  await activatePremium(user.id, user.email || session.customer_details?.email || session.customer_email || "");
  sendJson(res, 200, { premium: true });
}

async function handleStripeWebhook(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const rawBody = await readBody(req);
  if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"])) {
    sendJson(res, 400, { error: "Invalid Stripe signature" });
    return;
  }

  const event = parseJsonBody(rawBody);
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    if (session.payment_status === "paid") {
      const userId = session.metadata?.user_id || session.client_reference_id;
      const email = session.metadata?.email || session.customer_details?.email || session.customer_email || "";
      await activatePremium(userId, email);
    }
  }

  sendJson(res, 200, { received: true });
}

function fallbackAppVersion() {
  return {
    version: "1.0b",
    releaseDate: "2026-05-19",
    downloadUrl: siteDownloadUrl,
    downloads: normalizeDownloads(),
    title: "Sonus 1.0b",
    notes: [
      "Initial desktop release for macOS Apple Silicon and Windows x64.",
      "Browse local sample folders from a focused native workspace.",
      "Preview sounds, read waveforms, organize collections, and drag files into your DAW.",
    ],
  };
}

function normalizeAppRelease(value, fallback = fallbackAppVersion()) {
  const data = value && typeof value === "object" ? value : {};
  const version = String(data.version || fallback.version || "1.0b").trim().replace(/^v/i, "");
  const releaseDate = String(data.release_date || data.releaseDate || fallback.releaseDate || new Date().toISOString().slice(0, 10));
  const downloadUrl = absoluteSiteUrl(data.download_url || data.downloadUrl || fallback.downloadUrl, siteDownloadUrl);
  const notes = Array.isArray(data.notes)
    ? data.notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 20)
    : [];
  return {
    version,
    releaseDate,
    downloadUrl,
    downloads: normalizeDownloads(data.downloads || fallback.downloads),
    title: String(data.title || fallback.title || `Sonus ${version}`).trim(),
    notes,
    updatedAt: data.updated_at || data.updatedAt || data.created_at || null,
  };
}

function fallbackAppReleases() {
  return [normalizeAppRelease(fallbackAppVersion())];
}

function normalizeAppVersion(value, fallback = fallbackAppVersion()) {
  const data = value && typeof value === "object" ? value : {};
  const version = String(data.version || fallback.version || "1.0b").trim().replace(/^v/i, "");
  const releaseDate = String(data.releaseDate || fallback.releaseDate || new Date().toISOString().slice(0, 10));
  const downloadUrl = absoluteSiteUrl(data.downloadUrl || fallback.downloadUrl, siteDownloadUrl);
  const notes = Array.isArray(data.notes)
    ? data.notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 20)
    : [];
  return {
    version,
    releaseDate,
    downloadUrl,
    downloads: normalizeDownloads(data.downloads || fallback.downloads),
    title: String(data.title || fallback.title || `Sonus ${version}`).trim(),
    notes,
    updatedAt: data.updatedAt || null,
  };
}

function fallbackLaunchSettings() {
  return {
    enabled: true,
    launchAt: DEFAULT_LAUNCH_AT,
    updatedAt: null,
  };
}

function normalizeLaunchSettings(value, fallback = fallbackLaunchSettings()) {
  const data = value && typeof value === "object" ? value : {};
  const launchAt = String(data.launchAt || data.launch_at || fallback.launchAt || DEFAULT_LAUNCH_AT).trim();
  return {
    enabled: data.enabled !== false,
    launchAt,
    updatedAt: data.updatedAt || data.updated_at || null,
  };
}

function getLaunchState(settings = fallbackLaunchSettings()) {
  const launchTime = new Date(settings.launchAt).getTime();
  const validLaunchTime = Number.isFinite(launchTime) ? launchTime : new Date(DEFAULT_LAUNCH_AT).getTime();
  const remainingMs = Math.max(0, validLaunchTime - Date.now());
  return {
    launchAt: new Date(validLaunchTime),
    remainingMs,
    locked: settings.enabled !== false && remainingMs > 0,
  };
}

function formatLaunchDate(date) {
  return date.toLocaleString("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function waitlistEmailHtml({ title, intro, launchAt, ctaLabel = "Open Sonus", ctaUrl = siteUrl }) {
  const launchDate = formatLaunchDate(launchAt);
  return `<!doctype html>
<html>
  <body style="margin:0;background:#242424;color:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:620px;margin:0 auto;padding:34px 22px">
      <p style="margin:0 0 14px;color:#ffc907;font-size:12px;font-weight:700;text-transform:uppercase">Sonus launch waitlist</p>
      <h1 style="margin:0 0 16px;font-size:30px;line-height:1.12;color:#fff">${escapeHtml(title)}</h1>
      <p style="margin:0 0 18px;color:#d8d8d8;font-size:16px;line-height:1.55">${escapeHtml(intro)}</p>
      <div style="margin:22px 0;padding:18px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#2f2f2f">
        <p style="margin:0 0 10px;color:#fff;font-size:15px"><strong>Launch:</strong> ${escapeHtml(launchDate)}</p>
        <p style="margin:0 0 10px;color:#fff;font-size:15px"><strong>5 free licences:</strong> code <strong style="color:#ffc907">${PROMO_CODE_FREE}</strong> for 100% off.</p>
        <p style="margin:0;color:#fff;font-size:15px"><strong>10 discounted licences:</strong> code <strong style="color:#ffc907">${PROMO_CODE_DISCOUNT}</strong> for 25% off.</p>
      </div>
      <p style="margin:0 0 22px;color:#c9c9c9;font-size:14px;line-height:1.55">Codes are first come, first served at launch. The first release supports macOS Apple Silicon and Windows x64. Future supported desktop builds will stay valid for the same account licence.</p>
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 16px;border-radius:5px;background:#ffc907;color:#221900;text-decoration:none;font-weight:700">${escapeHtml(ctaLabel)}</a>
    </div>
  </body>
</html>`;
}

function waitlistEmailText({ title, intro, launchAt, ctaUrl = siteUrl }) {
  return [
    title,
    "",
    intro,
    "",
    `Launch: ${formatLaunchDate(launchAt)}`,
    `5 free licences: code ${PROMO_CODE_FREE} for 100% off.`,
    `10 discounted licences: code ${PROMO_CODE_DISCOUNT} for 25% off.`,
    "Codes are first come, first served at launch.",
    "The first release supports macOS Apple Silicon and Windows x64.",
    "",
    ctaUrl,
  ].join("\n");
}

async function sendResendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY.");
  const body = {
    from: RESEND_FROM_EMAIL,
    to: [to],
    subject,
    html,
    text,
  };
  if (RESEND_REPLY_TO) body.reply_to = RESEND_REPLY_TO;

  return requestJson("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function upsertWaitlistEntry({ userId, email, source = "website" }) {
  const emailLower = cleanEmail(email);
  const existing = await supabaseServiceRequest(
    `/rest/v1/waitlist_entries?select=*&or=(user_id.eq.${encodeURIComponent(userId)},email_lower.eq.${encodeURIComponent(emailLower)})&limit=1`
  );

  if (Array.isArray(existing) && existing[0]?.id) {
    if (existing[0].user_id && existing[0].user_id !== userId) {
      const error = new Error("This email is already on the waitlist with another account.");
      error.statusCode = 409;
      throw error;
    }
    return updateWaitlistEntry(existing[0].id, {
      user_id: userId,
      email: emailLower,
      email_lower: emailLower,
      source: String(source || "website").slice(0, 80),
      last_email_error: "",
    });
  }

  const rows = await supabaseServiceRequest("/rest/v1/waitlist_entries", {
    method: "POST",
    prefer: "return=representation",
    body: {
      user_id: userId,
      email: emailLower,
      email_lower: emailLower,
      source: String(source || "website").slice(0, 80),
      last_email_error: "",
    },
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function readWaitlistEntryByUser(userId) {
  const rows = await supabaseServiceRequest(`/rest/v1/waitlist_entries?select=id,email,confirmation_sent_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateWaitlistEntry(id, patch) {
  const rows = await supabaseServiceRequest(`/rest/v1/waitlist_entries?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: patch,
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function sendWaitlistEmail(entry, phase, launchAt) {
  const phaseCopy = {
    confirmation: {
      subject: "You are on the Sonus launch waitlist",
      title: "You are on the Sonus waitlist.",
      intro: "You will get launch reminders before Sonus goes live, including the promo codes below.",
      ctaLabel: "View Sonus",
    },
    j8: {
      subject: "Sonus launches in 8 days",
      title: "Sonus launches in 8 days.",
      intro: "Get ready for launch. Promo codes are limited and will work on a first come, first served basis.",
      ctaLabel: "Prepare for launch",
    },
    j1: {
      subject: "Sonus launches tomorrow",
      title: "Sonus launches tomorrow.",
      intro: "Tomorrow is launch day. Keep these codes ready if you want to try grabbing one of the limited launch discounts.",
      ctaLabel: "Open Sonus",
    },
    t10: {
      subject: "Sonus launches in 10 minutes",
      title: "Sonus launches in 10 minutes.",
      intro: "The launch window is about to open. The fastest users get the limited promo codes.",
      ctaLabel: "Go to Sonus",
    },
  }[phase];

  const payload = {
    title: phaseCopy.title,
    intro: phaseCopy.intro,
    launchAt,
    ctaLabel: phaseCopy.ctaLabel,
    ctaUrl: phase === "confirmation" ? siteUrl : sitePricingUrl,
  };
  const result = await sendResendEmail({
    to: entry.email,
    subject: phaseCopy.subject,
    html: waitlistEmailHtml(payload),
    text: waitlistEmailText(payload),
    idempotencyKey: `waitlist-${entry.id}-${phase}`,
  });
  return result;
}

async function handleWaitlistSignup(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const accessToken = bearerToken(req);
  if (!accessToken) {
    sendJson(res, 401, { error: "Log in before joining the waitlist." });
    return;
  }
  const user = await getSupabaseUser(accessToken);

  if (req.method === "GET") {
    const entry = await readWaitlistEntryByUser(user.id);
    sendJson(res, 200, {
      joined: Boolean(entry?.id),
      email: entry?.email || user.email || "",
      confirmationSent: Boolean(entry?.confirmation_sent_at),
    });
    return;
  }

  const payload = parseJsonBody(await readBody(req));
  const email = cleanEmail(payload.email || user.email);
  if (!isValidEmail(email)) {
    sendJson(res, 400, { error: "Enter a valid email address." });
    return;
  }

  const entry = await upsertWaitlistEntry({
    userId: user.id,
    email,
    source: payload.source || "website",
  });
  if (!entry?.id) throw new Error("Unable to save waitlist entry.");

  if (!entry.confirmation_sent_at) {
    try {
      const launchSettings = await readLaunchSettingsFromSupabase();
      const launchAt = getLaunchState(launchSettings).launchAt;
      const result = await sendWaitlistEmail(entry, "confirmation", launchAt);
      await updateWaitlistEntry(entry.id, {
        confirmation_sent_at: new Date().toISOString(),
        last_email_error: "",
      });
      sendJson(res, 200, { ok: true, alreadyJoined: false, emailId: result?.id || null });
      return;
    } catch (error) {
      await updateWaitlistEntry(entry.id, {
        last_email_error: error.message || "Unable to send confirmation email.",
      }).catch(() => null);
      sendJson(res, 500, { error: error.message || "Unable to send confirmation email." });
      return;
    }
  }

  sendJson(res, 200, { ok: true, alreadyJoined: true });
}

const WAITLIST_PHASES = [
  { key: "j8", column: "j8_sent_at", offsetMs: 8 * 24 * 60 * 60 * 1000, expiresOffsetMs: 24 * 60 * 60 * 1000 },
  { key: "j1", column: "j1_sent_at", offsetMs: 24 * 60 * 60 * 1000, expiresOffsetMs: 10 * 60 * 1000 },
  { key: "t10", column: "t10_sent_at", offsetMs: 10 * 60 * 1000, expiresOffsetMs: 0 },
];

async function listWaitlistEntriesForPhase(column, dueAt) {
  const query = [
    "/rest/v1/waitlist_entries",
    `?select=id,email,created_at,${column}`,
    `&${column}=is.null`,
    `&confirmation_sent_at=not.is.null`,
    `&created_at=lte.${encodeURIComponent(dueAt.toISOString())}`,
    "&order=created_at.asc",
    `&limit=${WAITLIST_EMAIL_BATCH_SIZE}`,
  ].join("");
  return supabaseServiceRequest(query);
}

let waitlistDueRunInFlight = false;

async function sendDueWaitlistEmails() {
  if (waitlistDueRunInFlight) return { skipped: true, sent: 0, failed: 0 };
  waitlistDueRunInFlight = true;
  const summary = { sent: 0, failed: 0, phases: {} };
  try {
    const launchSettings = await readLaunchSettingsFromSupabase();
    const launchState = getLaunchState(launchSettings);
    const now = Date.now();
    const launchMs = launchState.launchAt.getTime();
    if (launchSettings.enabled === false || now >= launchMs) return summary;

    for (const phase of WAITLIST_PHASES) {
      const dueAt = new Date(launchMs - phase.offsetMs);
      const expiresAt = new Date(launchMs - phase.expiresOffsetMs);
      if (now < dueAt.getTime()) continue;
      if (phase.expiresOffsetMs > 0 && now >= expiresAt.getTime()) continue;
      const entries = await listWaitlistEntriesForPhase(phase.column, dueAt);
      summary.phases[phase.key] = { scanned: Array.isArray(entries) ? entries.length : 0, sent: 0, failed: 0 };
      for (const entry of Array.isArray(entries) ? entries : []) {
        try {
          await sendWaitlistEmail(entry, phase.key, launchState.launchAt);
          await updateWaitlistEntry(entry.id, {
            [phase.column]: new Date().toISOString(),
            last_email_error: "",
          });
          summary.sent += 1;
          summary.phases[phase.key].sent += 1;
        } catch (error) {
          await updateWaitlistEntry(entry.id, {
            last_email_error: error.message || `Unable to send ${phase.key} email.`,
          }).catch(() => null);
          summary.failed += 1;
          summary.phases[phase.key].failed += 1;
        }
      }
    }
    return summary;
  } finally {
    waitlistDueRunInFlight = false;
  }
}

async function handleWaitlistSendDue(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  await requireAdminAccess(req);
  sendJson(res, 200, await sendDueWaitlistEmails());
}

async function readAppVersionFromSupabase(token = SUPABASE_PUBLIC_KEY) {
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_settings?select=value&key=eq.${encodeURIComponent(APP_VERSION_SETTING_KEY)}&limit=1`, {
    headers: supabaseRestHeaders(token),
  });
  const value = Array.isArray(rows) ? rows[0]?.value : null;
  return normalizeAppVersion(value);
}

async function readDownloadAvailabilityFromSupabase(token = SUPABASE_PUBLIC_KEY) {
  try {
    const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_settings?select=value&key=eq.${encodeURIComponent(DOWNLOAD_AVAILABILITY_SETTING_KEY)}&limit=1`, {
      headers: supabaseRestHeaders(token),
    });
    const value = Array.isArray(rows) ? rows[0]?.value : null;
    return normalizeDownloadAvailability(value);
  } catch {
    return normalizeDownloadAvailability();
  }
}

async function readLaunchSettingsFromSupabase(token = SUPABASE_PUBLIC_KEY) {
  try {
    const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_settings?select=value&key=eq.${encodeURIComponent(LAUNCH_SETTING_KEY)}&limit=1`, {
      headers: supabaseRestHeaders(token),
    });
    const value = Array.isArray(rows) ? rows[0]?.value : null;
    return normalizeLaunchSettings(value);
  } catch {
    return fallbackLaunchSettings();
  }
}

async function readAppReleasesFromSupabase(token = SUPABASE_PUBLIC_KEY, useFallback = true) {
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_releases?select=version,release_date,title,notes,download_url,created_at,updated_at&order=release_date.desc,created_at.desc&limit=50`, {
    headers: supabaseRestHeaders(token),
  });
  const releases = Array.isArray(rows) ? rows.map((row) => normalizeAppRelease(row)).filter((row) => row.version) : [];
  return releases.length || !useFallback ? releases : fallbackAppReleases();
}

async function writeAppVersionToSupabase(accessToken, userId, value) {
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
    method: "POST",
    headers: supabaseRestHeaders(accessToken, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify({
      key: APP_VERSION_SETTING_KEY,
      value,
      updated_by: userId,
    }),
  });
  return normalizeAppVersion(Array.isArray(rows) ? rows[0]?.value : value);
}

async function writeDownloadAvailabilityToSupabase(accessToken, userId, value) {
  const availability = normalizeDownloadAvailability(value);
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
    method: "POST",
    headers: supabaseRestHeaders(accessToken, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify({
      key: DOWNLOAD_AVAILABILITY_SETTING_KEY,
      value: {
        ...availability,
        updatedAt: new Date().toISOString(),
      },
      updated_by: userId,
    }),
  });
  return normalizeDownloadAvailability(Array.isArray(rows) ? rows[0]?.value : availability);
}

async function writeLaunchSettingsToSupabase(accessToken, userId, value) {
  const launch = normalizeLaunchSettings(value);
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
    method: "POST",
    headers: supabaseRestHeaders(accessToken, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify({
      key: LAUNCH_SETTING_KEY,
      value: {
        ...launch,
        updatedAt: new Date().toISOString(),
      },
      updated_by: userId,
    }),
  });
  return normalizeLaunchSettings(Array.isArray(rows) ? rows[0]?.value : launch);
}

async function writeAppReleaseToSupabase(accessToken, userId, value) {
  const release = normalizeAppRelease(value);
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_releases?on_conflict=version`, {
    method: "POST",
    headers: supabaseRestHeaders(accessToken, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify({
      version: release.version,
      release_date: release.releaseDate,
      title: release.title,
      notes: release.notes,
      download_url: release.downloadUrl,
      created_by: userId,
    }),
  });
  return normalizeAppRelease(Array.isArray(rows) ? rows[0] : release);
}

async function deleteAppReleaseFromSupabase(accessToken, version) {
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/app_releases?version=eq.${encodeURIComponent(version)}`, {
    method: "DELETE",
    headers: supabaseRestHeaders(accessToken, {
      Prefer: "return=representation",
    }),
  });
  return Array.isArray(rows) ? rows.map((row) => normalizeAppRelease(row)) : [];
}

async function handleAdminSession(req, res) {
  let admin;
  try {
    admin = await requireAdminUser(req);
  } catch (error) {
    sendJson(res, error.statusCode || 401, { error: error.message || "Admin access required." });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { authenticated: verifyAdminSessionCookie(req, admin.user.id) });
    return;
  }

  if (req.method === "DELETE") {
    clearAdminSessionCookie(req, res);
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!ADMIN_PASSWORD_HASH) {
    sendJson(res, 500, { error: "Missing ADMIN_PASSWORD_HASH." });
    return;
  }

  checkAdminPasswordThrottle(req);
  const payload = parseJsonBody(await readBody(req));
  const success = verifyPasswordHash(payload.password || "", ADMIN_PASSWORD_HASH);
  recordAdminPasswordAttempt(req, success);
  if (!success) {
    sendJson(res, 401, { error: "Invalid admin password." });
    return;
  }

  const remember = payload.remember === true;
  setAdminSessionCookie(req, res, createAdminSessionToken(admin.user.id, remember), remember);
  sendJson(res, 200, { authenticated: true });
}

async function handleAdminFeedback(req, res) {
  await requireAdminAccess(req);

  if (req.method === "GET") {
    const rows = await requestJson(`${SUPABASE_URL}/rest/v1/feedback_messages?select=*&order=created_at.desc&limit=200`, {
      headers: serviceHeaders(),
    });
    sendJson(res, 200, Array.isArray(rows) ? rows : []);
    return;
  }

  if (req.method !== "PATCH") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const payload = parseJsonBody(await readBody(req));
  const id = Number(payload.id || 0);
  if (!Number.isInteger(id) || id <= 0) {
    sendJson(res, 400, { error: "Invalid feedback id." });
    return;
  }
  const rows = await requestJson(`${SUPABASE_URL}/rest/v1/feedback_messages?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({ read_at: new Date().toISOString() }),
  });
  sendJson(res, 200, Array.isArray(rows) ? rows[0] || null : null);
}

async function handleAdminAppVersion(req, res) {
  let admin;
  try {
    admin = await requireAdminAccess(req);
  } catch (error) {
    sendJson(res, error.statusCode || 401, { error: error.message || "Admin access required." });
    return;
  }

  if (req.method === "GET") {
    try {
      sendJson(res, 200, await readAppVersionFromSupabase(SUPABASE_SERVICE_ROLE_KEY));
    } catch {
      sendJson(res, 200, fallbackAppVersion());
    }
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    sendJson(res, 400, { error: "Publishing a version now requires the Windows, macOS ARM64, and macOS Intel installer files." });
    return;
  }

  const form = await readMultipartForm(req);
  const payload = form.fields;
  const version = String(payload.version || "").trim().replace(/^v/i, "");
  if (!/^(?:\d+\.\d+b|\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i.test(version)) {
    cleanupMultipartFiles(form.files);
    sendJson(res, 400, { error: "Version must look like 1.0b or 1.0.0." });
    return;
  }

  let current = fallbackAppVersion();
  try {
    current = await readAppVersionFromSupabase(SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    current = fallbackAppVersion();
  }
  const notes = Array.isArray(payload.notes)
    ? payload.notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 20)
    : String(payload.notes || "")
      .split(/\r?\n/)
      .map((note) => note.trim())
      .filter(Boolean)
      .slice(0, 20);

  try {
    const downloads = await uploadReleaseArtifacts(form.files, version);
    const next = {
      ...current,
      version,
      releaseDate: String(payload.releaseDate || new Date().toISOString().slice(0, 10)),
      downloadUrl: primaryReleaseDownloadUrl(downloads),
      downloads,
      title: String(payload.title || `Sonus ${version}`).trim(),
      notes,
      updatedAt: new Date().toISOString(),
    };

    const saved = await writeAppVersionToSupabase(SUPABASE_SERVICE_ROLE_KEY, admin.user.id, next);
    await writeAppReleaseToSupabase(SUPABASE_SERVICE_ROLE_KEY, admin.user.id, saved);
    cleanupOldReleaseFiles(downloads);
    sendJson(res, 200, saved);
  } finally {
    cleanupMultipartFiles(form.files);
  }
}

async function handleAdminDownloadAvailability(req, res) {
  let admin;
  try {
    admin = await requireAdminAccess(req);
  } catch (error) {
    sendJson(res, error.statusCode || 401, { error: error.message || "Admin access required." });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, await readDownloadAvailabilityFromSupabase(SUPABASE_SERVICE_ROLE_KEY));
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const payload = parseJsonBody(await readBody(req));
  const saved = await writeDownloadAvailabilityToSupabase(SUPABASE_SERVICE_ROLE_KEY, admin.user.id, {
    platforms: RELEASE_PLATFORMS.reduce((acc, platform) => {
      acc[platform.id] = payload.platforms?.[platform.id] !== false;
      return acc;
    }, {}),
  });
  sendJson(res, 200, saved);
}

async function handleDownloadAvailability(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  sendJson(res, 200, await readDownloadAvailabilityFromSupabase(SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLIC_KEY));
}

async function handleAdminAppReleases(req, res) {
  let admin;
  try {
    admin = await requireAdminAccess(req);
  } catch (error) {
    sendJson(res, error.statusCode || 401, { error: error.message || "Admin access required." });
    return;
  }

  if (req.method === "GET") {
    try {
      sendJson(res, 200, await readAppReleasesFromSupabase(SUPABASE_SERVICE_ROLE_KEY));
    } catch {
      sendJson(res, 200, fallbackAppReleases());
    }
    return;
  }

  if (req.method !== "DELETE") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const version = String(url.searchParams.get("version") || "").trim().replace(/^v/i, "");
  if (!/^(?:\d+\.\d+b|\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i.test(version)) {
    sendJson(res, 400, { error: "Version must look like 1.0b or 1.0.0." });
    return;
  }

  let current = fallbackAppVersion();
  try {
    current = await readAppVersionFromSupabase(SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    current = fallbackAppVersion();
  }
  const deleted = await deleteAppReleaseFromSupabase(SUPABASE_SERVICE_ROLE_KEY, version);
  if (!deleted.length) {
    sendJson(res, 404, { error: "Release not found." });
    return;
  }

  const releases = await readAppReleasesFromSupabase(SUPABASE_SERVICE_ROLE_KEY, false);
  let currentVersion = current;
  if (current.version === version) {
    const previous = releases[0];
    if (!previous?.version) {
      await writeAppReleaseToSupabase(SUPABASE_SERVICE_ROLE_KEY, admin.user.id, current);
      sendJson(res, 409, { error: "You cannot delete the only published version." });
      return;
    }
    currentVersion = await writeAppVersionToSupabase(SUPABASE_SERVICE_ROLE_KEY, admin.user.id, previous);
  }

  sendJson(res, 200, { deleted: deleted[0], currentVersion, releases });
}

async function handleAdminLaunchSettings(req, res) {
  let admin;
  try {
    admin = await requireAdminAccess(req);
  } catch (error) {
    sendJson(res, error.statusCode || 401, { error: error.message || "Admin access required." });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, await readLaunchSettingsFromSupabase(SUPABASE_SERVICE_ROLE_KEY));
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const payload = parseJsonBody(await readBody(req));
  const launchAt = String(payload.launchAt || "").trim();
  const launchTime = new Date(launchAt).getTime();
  if (!launchAt || !Number.isFinite(launchTime)) {
    sendJson(res, 400, { error: "Launch date must be a valid date and time." });
    return;
  }

  const saved = await writeLaunchSettingsToSupabase(SUPABASE_SERVICE_ROLE_KEY, admin.user.id, {
    enabled: payload.enabled !== false,
    launchAt: new Date(launchTime).toISOString(),
  });
  sendJson(res, 200, saved);
}

async function handleReleaseDownload(req, res, platformId) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const platform = RELEASE_PLATFORMS.find((item) => item.id === platformId);
  if (!platform) {
    sendJson(res, 404, { error: "Unknown platform." });
    return;
  }

  let release = fallbackAppVersion();
  const supabaseReadToken = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLIC_KEY;
  try {
    release = await readAppVersionFromSupabase(supabaseReadToken);
  } catch {
    release = fallbackAppVersion();
  }

  let availability = normalizeDownloadAvailability();
  try {
    availability = await readDownloadAvailabilityFromSupabase(supabaseReadToken);
  } catch {
    availability = normalizeDownloadAvailability();
  }

  const downloads = applyDownloadAvailability(release.downloads, availability);
  const item = downloads[platform.id];
  if (!item?.fileName || item.available === false) {
    sendJson(res, 404, { error: `${platform.label} download is not available yet.` });
    return;
  }

  const auth = await getB2DownloadAuthorization(item.fileName);
  const fileUrl = `${auth.downloadUrl}/file/${encodeURIComponent(B2_BUCKET_NAME)}/${encodeDownloadPath(item.fileName)}?Authorization=${encodeURIComponent(auth.authorizationToken)}`;
  redirect(res, fileUrl);
}

function resolveRoute(urlPath) {
  const normalized = urlPath.endsWith("/") && urlPath !== "/" ? urlPath.slice(0, -1) : urlPath;
  const routeFile = routeFiles.get(normalized);
  if (routeFile) return path.join(root, routeFile);

  const decoded = decodeURIComponent(urlPath);
  if (decoded.startsWith("/fonts/")) {
    const fontPath = path.normalize(path.join(root, "..", decoded));
    const fontsRoot = path.normalize(path.join(root, "..", "fonts"));
    if (!fontPath.startsWith(fontsRoot)) return null;
    if (fs.existsSync(fontPath) && fs.statSync(fontPath).isFile()) return fontPath;
    return null;
  }

  const requested = path.normalize(path.join(root, decoded));
  if (!requested.startsWith(root)) return null;
  if (path.basename(requested).startsWith(".")) return null;

  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
    return requested;
  }

  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/waitlist") {
    handleWaitlistSignup(req, res).catch((error) => sendJson(res, 500, { error: error.message || "Waitlist signup failed" }));
    return;
  }
  if (url.pathname === "/api/admin/waitlist/send-due") {
    handleWaitlistSendDue(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Waitlist email send failed" }));
    return;
  }
  if (url.pathname === "/api/admin/session") {
    handleAdminSession(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Admin session failed" }));
    return;
  }
  if (url.pathname === "/api/admin/feedback") {
    handleAdminFeedback(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Feedback request failed" }));
    return;
  }
  if (url.pathname === "/api/create-checkout-session") {
    handleCreateCheckoutSession(req, res).catch((error) => sendJson(res, 500, { error: error.message || "Checkout failed" }));
    return;
  }
  if (url.pathname === "/api/confirm-checkout") {
    handleConfirmCheckout(req, res).catch((error) => sendJson(res, 500, { error: error.message || "Checkout confirmation failed" }));
    return;
  }
  if (url.pathname === "/api/stripe-webhook") {
    handleStripeWebhook(req, res).catch((error) => sendJson(res, 400, { error: error.message || "Webhook failed" }));
    return;
  }
  if (url.pathname === "/api/admin/app-version") {
    handleAdminAppVersion(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Version update failed" }));
    return;
  }
  if (url.pathname === "/api/admin/download-availability") {
    handleAdminDownloadAvailability(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Download availability request failed" }));
    return;
  }
  if (url.pathname === "/api/download-availability") {
    handleDownloadAvailability(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Download availability request failed" }));
    return;
  }
  if (url.pathname === "/api/admin/app-releases") {
    handleAdminAppReleases(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Release request failed" }));
    return;
  }
  if (url.pathname === "/api/admin/launch-settings") {
    handleAdminLaunchSettings(req, res).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Launch settings request failed" }));
    return;
  }
  if (url.pathname.startsWith("/api/download/")) {
    const platformId = decodeURIComponent(url.pathname.slice("/api/download/".length));
    handleReleaseDownload(req, res, platformId).catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || "Download failed" }));
    return;
  }
  const filePath = resolveRoute(url.pathname);

  if (!filePath) {
    send(res, 404, "Not found");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 500, "Server error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, mimeTypes.get(ext) || "application/octet-stream");
  });
});

server.listen(port, host, () => {
  console.log(`Sonus website running at http://${host}:${port}`);
  if (RESEND_API_KEY && SUPABASE_SERVICE_ROLE_KEY) {
    setInterval(() => sendDueWaitlistEmails().catch((error) => {
      console.warn("[Waitlist] Reminder check failed:", error.message || error);
    }), WAITLIST_EMAIL_INTERVAL_MS);
    setTimeout(() => sendDueWaitlistEmails().catch((error) => {
      console.warn("[Waitlist] Initial reminder check failed:", error.message || error);
    }), 5000);
  }
});
