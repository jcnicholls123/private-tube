import crypto from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3020);
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, "media"));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const BOOTSTRAP_METUBE_URL = (process.env.METUBE_URL || "").replace(/\/$/, "");
const BOOTSTRAP_PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 5 * 60 * 1000);
const CHANNEL_CHECK_INTERVAL_MS = Number(process.env.CHANNEL_CHECK_INTERVAL_MS || 15 * 60 * 1000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const AUTH_ENABLED = process.env.AUTH_ENABLED !== "false";
const RESET_ADMIN_PASSWORD = process.env.RESET_ADMIN_PASSWORD === "true";
const ALLOW_DELETE = process.env.ALLOW_DELETE === "true";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi"]);
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const QUALITY_PRESETS = [
  { id: "best", label: "Best available" },
  { id: "2160", label: "2160p" },
  { id: "1440", label: "1440p" },
  { id: "1080", label: "1080p" },
  { id: "720", label: "720p" },
  { id: "480", label: "480p" },
  { id: "audio", label: "Audio only" }
];

let library = {
  generatedAt: null,
  videos: [],
  channels: []
};
let db;
let castSecret = "";
const sessions = new Map();

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(json)
  });
  res.end(json);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

function absoluteUrl(req, relativeUrl) {
  return `${getAppSetting("public_url") || requestOrigin(req)}${relativeUrl}`;
}

function mediaContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";
}

function signCastUrl(videoId, expires) {
  return crypto.createHmac("sha256", castSecret).update(`${videoId}:${expires}`).digest("hex");
}

function verifyCastUrl(videoId, expires, sig) {
  if (!videoId || !expires || !sig || Date.now() > Number(expires)) return false;
  const expected = signCastUrl(videoId, expires);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function setSessionCookie(res, token) {
  res.setHeader("set-cookie", `pt_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", "pt_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getSession(req) {
  if (!AUTH_ENABLED) return { username: "local", role: "admin" };
  const token = parseCookies(req).pt_session;
  if (!token) return null;
  return sessions.get(token) || null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  const actual = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function publicUser(user) {
  return {
    username: user.username,
    role: user.role || "viewer",
    createdAt: user.createdAt
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function legacyStorePath() {
  return path.join(DATA_DIR, "private-tube.json");
}

function databasePath() {
  return path.join(DATA_DIR, "private-tube.sqlite");
}

async function openDatabase() {
  const sqlite = await import("node:sqlite");
  return new sqlite.DatabaseSync(databasePath());
}

function run(sql, params = []) {
  db.prepare(sql).run(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function initSchema() {
  run("PRAGMA journal_mode = WAL");
  run("PRAGMA foreign_keys = ON");
  run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'viewer',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`);
  run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT 'best',
    interval_hours INTEGER NOT NULL DEFAULT 24,
    retention_days INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_run_at TEXT,
    last_status TEXT
  )`);
  run(`CREATE TABLE IF NOT EXISTS secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`);
  run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`);
}

function getSecret(key) {
  return get("SELECT value FROM secrets WHERE key = ?", [key])?.value || "";
}

function setSecret(key, value) {
  const now = new Date().toISOString();
  run(`INSERT INTO secrets (key, value, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [key, value, now, now]);
}

function getAppSetting(key) {
  return get("SELECT value FROM settings WHERE key = ?", [key])?.value || "";
}

function setAppSetting(key, value) {
  const now = new Date().toISOString();
  run(`INSERT INTO settings (key, value, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [key, value || "", now, now]);
}

function appSettings() {
  return {
    metubeUrl: getAppSetting("metube_url"),
    publicUrl: getAppSetting("public_url")
  };
}

function getUsers() {
  return all("SELECT username, role, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY created_at");
}

function getUser(username) {
  return get("SELECT username, role, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE username = ?", [username]);
}

function upsertUser(user) {
  const now = new Date().toISOString();
  run(`INSERT INTO users (username, role, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET role = excluded.role, password_hash = excluded.password_hash, updated_at = excluded.updated_at`, [
    user.username,
    user.role || "viewer",
    user.passwordHash,
    user.createdAt || now,
    user.updatedAt || now
  ]);
}

function deleteUser(username) {
  run("DELETE FROM users WHERE username = ?", [username]);
}

function setupRequired() {
  return AUTH_ENABLED && getUsers().length === 0;
}

function getSubscriptions() {
  return all(`SELECT id, name, url, quality, interval_hours AS intervalHours, retention_days AS retentionDays,
    enabled, created_at AS createdAt, last_run_at AS lastRunAt, last_status AS lastStatus
    FROM subscriptions ORDER BY created_at DESC`).map((item) => ({
    ...item,
    enabled: Boolean(item.enabled)
  }));
}

function getSubscription(id) {
  const item = get(`SELECT id, name, url, quality, interval_hours AS intervalHours, retention_days AS retentionDays,
    enabled, created_at AS createdAt, last_run_at AS lastRunAt, last_status AS lastStatus
    FROM subscriptions WHERE id = ?`, [id]);
  return item ? { ...item, enabled: Boolean(item.enabled) } : null;
}

function insertSubscription(subscription) {
  run(`INSERT INTO subscriptions
    (id, name, url, quality, interval_hours, retention_days, enabled, created_at, last_run_at, last_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    subscription.id,
    subscription.name,
    subscription.url,
    subscription.quality || "best",
    Number(subscription.intervalHours || 24),
    Number(subscription.retentionDays || 0),
    subscription.enabled === false ? 0 : 1,
    subscription.createdAt,
    subscription.lastRunAt,
    subscription.lastStatus
  ]);
}

function updateSubscriptionRun(subscription) {
  run("UPDATE subscriptions SET last_run_at = ?, last_status = ? WHERE id = ?", [
    subscription.lastRunAt,
    subscription.lastStatus,
    subscription.id
  ]);
}

function deleteSubscription(id) {
  run("DELETE FROM subscriptions WHERE id = ?", [id]);
}

async function migrateLegacyJson() {
  const legacy = await readJson(legacyStorePath(), null);
  if (!legacy) return;

  for (const user of legacy.users || []) {
    if (!getUser(user.username)) upsertUser(user);
  }

  for (const subscription of legacy.subscriptions || []) {
    if (!getSubscription(subscription.id)) insertSubscription(subscription);
  }

  await fs.rename(legacyStorePath(), path.join(DATA_DIR, "private-tube.json.migrated")).catch(() => {});
}

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  db = await openDatabase();
  initSchema();
  await migrateLegacyJson();

  if (BOOTSTRAP_METUBE_URL && !getAppSetting("metube_url")) setAppSetting("metube_url", BOOTSTRAP_METUBE_URL);
  if (BOOTSTRAP_PUBLIC_URL && !getAppSetting("public_url")) setAppSetting("public_url", BOOTSTRAP_PUBLIC_URL);

  if (AUTH_ENABLED && ADMIN_USERNAME && ADMIN_PASSWORD) {
    const adminUser = getUser(ADMIN_USERNAME);
    if (!adminUser) {
      upsertUser({
        username: ADMIN_USERNAME,
        role: "admin",
        passwordHash: hashPassword(ADMIN_PASSWORD),
        createdAt: new Date().toISOString()
      });
    } else if (RESET_ADMIN_PASSWORD) {
      upsertUser({
        ...adminUser,
        role: "admin",
        passwordHash: hashPassword(ADMIN_PASSWORD),
        updatedAt: new Date().toISOString()
      });
    }
  }

  castSecret = getSecret("cast_secret");
  if (!castSecret || process.env.RESET_CAST_SECRET === "true") {
    castSecret = process.env.CAST_SECRET || crypto.randomBytes(32).toString("hex");
    setSecret("cast_secret", castSecret);
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 256) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
    req.on("error", reject);
  });
}

function redirect(res, location) {
  res.writeHead(303, {
    location,
    "cache-control": "no-store"
  });
  res.end();
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (session) return session;
  sendJson(res, 401, { error: "Authentication required" });
  return null;
}

function requireAdmin(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role === "admin") return session;
  sendJson(res, 403, { error: "Admin access required" });
  return null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "video";
}

function titleFromFile(filePath) {
  const parsed = path.parse(filePath);
  return parsed.name
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\d{4}-\d{2}-\d{2}\s*[- ]\s*/, "")
    .trim();
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findThumbnail(filePath, relativePath) {
  const parsed = path.parse(filePath);
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(parsed.dir, `${parsed.name}${ext}`);
    if (await exists(candidate)) {
      const relativeThumb = path.relative(MEDIA_DIR, candidate).split(path.sep).join("/");
      return `/media/${encodeURIComponent(relativeThumb)}`;
    }
  }

  const folderThumb = path.join(parsed.dir, "folder.jpg");
  if (await exists(folderThumb)) {
    const relativeThumb = path.relative(MEDIA_DIR, folderThumb).split(path.sep).join("/");
    return `/media/${encodeURIComponent(relativeThumb)}`;
  }

  return null;
}

async function walk(dir, files = []) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function scanLibrary() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const files = await walk(MEDIA_DIR);
  const videos = [];
  const channelMap = new Map();

  for (const filePath of files) {
    const stats = await fs.stat(filePath);
    const relativePath = path.relative(MEDIA_DIR, filePath).split(path.sep).join("/");
    const pathParts = relativePath.split("/");
    const channelName = pathParts.length > 1 ? pathParts[0] : "Uploads";
    const id = Buffer.from(relativePath).toString("base64url");
    const thumbnail = await findThumbnail(filePath, relativePath);

    const video = {
      id,
      title: titleFromFile(filePath),
      channel: channelName,
      channelId: slugify(channelName),
      path: relativePath,
      url: `/media/${encodeURIComponent(relativePath)}`,
      watchUrl: `/watch.html?v=${encodeURIComponent(id)}`,
      thumbnail,
      contentType: mediaContentType(filePath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };

    videos.push(video);

    const channel = channelMap.get(video.channelId) || {
      id: video.channelId,
      name: channelName,
      count: 0,
      latestAt: video.modifiedAt,
      thumbnail
    };
    channel.count += 1;
    if (video.modifiedAt > channel.latestAt) channel.latestAt = video.modifiedAt;
    if (!channel.thumbnail && thumbnail) channel.thumbnail = thumbnail;
    channelMap.set(video.channelId, channel);
  }

  videos.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  library = {
    generatedAt: new Date().toISOString(),
    videos,
    channels: [...channelMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
}

function qualityPayload(quality) {
  if (quality === "audio") return { quality: "audio" };
  if (quality && quality !== "best") return { quality };
  return { quality: "best" };
}

async function addToMetube(url, quality = "best") {
  const metubeUrl = getAppSetting("metube_url");
  if (!metubeUrl) throw new Error("MeTube URL is not configured");
  const response = await fetch(`${metubeUrl}/add`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, ...qualityPayload(quality) })
  });
  return { ok: response.ok, status: response.status };
}

async function runSubscription(subscription, force = false) {
  if (!getAppSetting("metube_url")) return;
  const now = Date.now();
  const intervalMs = Math.max(1, Number(subscription.intervalHours || 24)) * 60 * 60 * 1000;
  if (!force && subscription.lastRunAt && now - new Date(subscription.lastRunAt).getTime() < intervalMs) {
    return;
  }

  const result = await addToMetube(subscription.url, subscription.quality || "best");
  subscription.lastRunAt = new Date().toISOString();
  subscription.lastStatus = result.ok ? "queued" : `failed ${result.status}`;
  updateSubscriptionRun(subscription);
}

async function runSubscriptions() {
  for (const subscription of getSubscriptions()) {
    if (subscription.enabled === false) continue;
    try {
      await runSubscription(subscription);
    } catch (error) {
      subscription.lastRunAt = new Date().toISOString();
      subscription.lastStatus = error.message;
      updateSubscriptionRun(subscription);
    }
  }
}

async function applyRetention() {
  if (!ALLOW_DELETE) return { deleted: 0, enabled: false };
  let deleted = 0;
  const now = Date.now();

  for (const subscription of getSubscriptions()) {
    const retentionDays = Number(subscription.retentionDays || 0);
    if (!retentionDays) continue;
    const channelSlug = slugify(subscription.name || "");
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    for (const video of library.videos) {
      if (channelSlug && video.channelId !== channelSlug) continue;
      if (now - new Date(video.modifiedAt).getTime() < maxAgeMs) continue;
      const fullPath = resolveMediaPath(video.path);
      if (!fullPath) continue;
      await fs.unlink(fullPath);
      deleted += 1;
    }
  }

  if (deleted) await scanLibrary();
  return { deleted, enabled: true };
}

function resolveMediaPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const fullPath = path.resolve(MEDIA_DIR, normalized);
  if (!fullPath.startsWith(MEDIA_DIR + path.sep) && fullPath !== MEDIA_DIR) {
    return null;
  }
  return fullPath;
}

async function streamMedia(req, res, relativePath) {
  const filePath = resolveMediaPath(relativePath);
  if (!filePath) return sendText(res, 400, "Invalid media path");

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    return sendText(res, 404, "Media not found");
  }

  const contentType = mediaContentType(filePath);

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "content-length": stats.size,
      "content-type": contentType,
      "accept-ranges": "bytes"
    });
    createReadStream(filePath).pipe(res);
    return;
  }

  const [startRaw, endRaw] = range.replace("bytes=", "").split("-");
  const start = Number.parseInt(startRaw, 10);
  const end = endRaw ? Number.parseInt(endRaw, 10) : stats.size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start >= stats.size || end >= stats.size) {
    res.writeHead(416, { "content-range": `bytes */${stats.size}` });
    res.end();
    return;
  }

  res.writeHead(206, {
    "content-range": `bytes ${start}-${end}/${stats.size}`,
    "accept-ranges": "bytes",
    "content-length": end - start + 1,
    "content-type": contentType
  });
  createReadStream(filePath, { start, end }).pipe(res);
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(__dirname, "public", requested);
  const publicRoot = path.resolve(__dirname, "public");
  if (!filePath.startsWith(publicRoot + path.sep) && filePath !== publicRoot) {
    return sendText(res, 400, "Invalid path");
  }

  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return sendText(res, 404, "Not found");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";

  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(data);
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/session") {
    const session = getSession(req);
    return sendJson(res, 200, {
      authenticated: Boolean(session),
      authEnabled: AUTH_ENABLED,
      setupRequired: setupRequired(),
      user: session
    });
  }

  if (url.pathname === "/api/setup" && req.method === "POST") {
    try {
      if (!setupRequired()) return sendJson(res, 409, { error: "Setup is already complete" });
      const payload = await readBody(req);
      if (!payload.username || !payload.password) {
        return sendJson(res, 400, { error: "Username and password are required" });
      }
      console.log(`Creating initial admin user '${payload.username}'`);
      upsertUser({
        username: payload.username,
        role: "admin",
        passwordHash: hashPassword(payload.password),
        createdAt: new Date().toISOString()
      });
      if (payload.metubeUrl) setAppSetting("metube_url", String(payload.metubeUrl).replace(/\/$/, ""));
      if (payload.publicUrl) setAppSetting("public_url", String(payload.publicUrl).replace(/\/$/, ""));
      const token = crypto.randomBytes(32).toString("base64url");
      const session = { username: payload.username, role: "admin" };
      sessions.set(token, session);
      setSessionCookie(res, token);
      return sendJson(res, 201, { ok: true, user: session });
    } catch (error) {
      console.error("Initial setup failed:", error);
      return sendJson(res, 500, { error: `Initial setup failed: ${error.message}` });
    }
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    if (!AUTH_ENABLED) return sendJson(res, 200, { ok: true });
    const payload = await readBody(req);
    const user = getUser(payload.username);
    if (!user || !verifyPassword(payload.password || "", user.passwordHash)) {
      return sendJson(res, 401, { error: "Invalid username or password" });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const session = { username: user.username, role: user.role || "viewer" };
    sessions.set(token, session);
    setSessionCookie(res, token);
    return sendJson(res, 200, { ok: true, user: session });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const token = parseCookies(req).pt_session;
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  const session = requireAuth(req, res);
  if (!session) return;

  if (url.pathname === "/api/config") {
    const settings = appSettings();
    return sendJson(res, 200, {
      authEnabled: AUTH_ENABLED,
      setupRequired: setupRequired(),
      metubeEnabled: Boolean(settings.metubeUrl),
      metubeUrl: settings.metubeUrl,
      publicUrl: settings.publicUrl,
      allowDelete: ALLOW_DELETE,
      database: "sqlite",
      qualityPresets: QUALITY_PRESETS,
      user: session
    });
  }

  if (url.pathname === "/api/settings") {
    if (!requireAdmin(req, res)) return;

    if (req.method === "GET") return sendJson(res, 200, appSettings());

    if (req.method === "POST") {
      const payload = await readBody(req);
      setAppSetting("metube_url", String(payload.metubeUrl || "").replace(/\/$/, ""));
      setAppSetting("public_url", String(payload.publicUrl || "").replace(/\/$/, ""));
      return sendJson(res, 200, appSettings());
    }
  }

  if (url.pathname === "/api/library") return sendJson(res, 200, library);

  if (url.pathname.startsWith("/api/cast/")) {
    const id = safeDecode(url.pathname.slice("/api/cast/".length));
    const video = library.videos.find((item) => item.id === id);
    if (!video) return sendJson(res, 404, { error: "Video not found" });

    const expires = Date.now() + 6 * 60 * 60 * 1000;
    const sig = signCastUrl(video.id, expires);
    const relativeMediaUrl = `/cast-media/${encodeURIComponent(video.id)}?expires=${expires}&sig=${sig}`;
    return sendJson(res, 200, {
      mediaUrl: absoluteUrl(req, relativeMediaUrl),
      title: video.title,
      channel: video.channel,
      contentType: video.contentType,
      thumbnail: video.thumbnail ? absoluteUrl(req, video.thumbnail) : null
    });
  }

  if (url.pathname === "/api/users") {
    if (!requireAdmin(req, res)) return;

    if (req.method === "GET") {
      return sendJson(res, 200, { users: getUsers().map(publicUser) });
    }

    if (req.method === "POST") {
      const payload = await readBody(req);
      if (!payload.username || !payload.password) {
        return sendJson(res, 400, { error: "Username and password are required" });
      }
      if (getUser(payload.username)) {
        return sendJson(res, 409, { error: "User already exists" });
      }
      upsertUser({
        username: payload.username,
        role: payload.role === "admin" ? "admin" : "viewer",
        passwordHash: hashPassword(payload.password),
        createdAt: new Date().toISOString()
      });
      return sendJson(res, 201, { users: getUsers().map(publicUser) });
    }
  }

  if (url.pathname.startsWith("/api/users/") && req.method === "DELETE") {
    if (!requireAdmin(req, res)) return;
    const username = safeDecode(url.pathname.slice("/api/users/".length));
    if (username === session.username) return sendJson(res, 400, { error: "You cannot delete yourself" });
    deleteUser(username);
    return sendJson(res, 200, { users: getUsers().map(publicUser) });
  }

  if (url.pathname === "/api/subscriptions") {
    if (req.method === "GET") return sendJson(res, 200, { subscriptions: getSubscriptions() });
    if (!requireAdmin(req, res)) return;

    if (req.method === "POST") {
      const payload = await readBody(req);
      if (!payload.url || !payload.name) {
        return sendJson(res, 400, { error: "Channel name and URL are required" });
      }
      const subscription = {
        id: crypto.randomUUID(),
        name: payload.name,
        url: payload.url,
        quality: payload.quality || "best",
        intervalHours: Number(payload.intervalHours || 24),
        retentionDays: Number(payload.retentionDays || 0),
        enabled: payload.enabled !== false,
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        lastStatus: "new"
      };
      insertSubscription(subscription);
      return sendJson(res, 201, { subscriptions: getSubscriptions() });
    }
  }

  if (url.pathname.startsWith("/api/subscriptions/")) {
    if (!requireAdmin(req, res)) return;
    const parts = url.pathname.slice("/api/subscriptions/".length).split("/");
    const id = parts[0];
    const action = parts[1];
    const subscription = getSubscription(id);
    if (!subscription) return sendJson(res, 404, { error: "Subscription not found" });

    if (req.method === "DELETE") {
      deleteSubscription(id);
      return sendJson(res, 200, { subscriptions: getSubscriptions() });
    }

    if (req.method === "POST" && action === "run") {
      await runSubscription(subscription, true);
      return sendJson(res, 200, { subscription });
    }
  }

  if (url.pathname === "/api/retention/run" && req.method === "POST") {
    if (!requireAdmin(req, res)) return;
    const result = await applyRetention();
    return sendJson(res, 200, result);
  }

  if (url.pathname === "/api/rescan" && req.method === "POST") {
    await scanLibrary();
    return sendJson(res, 200, library);
  }

  if (url.pathname === "/api/add" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      if (!payload.url) return sendJson(res, 400, { error: "Missing url" });
      const result = await addToMetube(payload.url, payload.quality || "best");
      return sendJson(res, result.ok ? 200 : 502, result);
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  sendJson(res, 404, { error: "API endpoint not found" });
}

async function handleFormLogin(req, res) {
  try {
    const payload = await readFormBody(req);
    const user = getUser(payload.username);
    if (!user || !verifyPassword(payload.password || "", user.passwordHash)) {
      return redirect(res, "/login.html?error=1");
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const session = { username: user.username, role: user.role || "viewer" };
    sessions.set(token, session);
    setSessionCookie(res, token);
    return redirect(res, "/");
  } catch (error) {
    console.error("Form login failed:", error);
    return redirect(res, "/login.html?error=1");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/form-login" && req.method === "POST") return await handleFormLogin(req, res);

    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);

    if (url.pathname.startsWith("/media/")) {
      if (!getSession(req)) return sendText(res, 401, "Authentication required");
      return await streamMedia(req, res, safeDecode(url.pathname.slice("/media/".length)));
    }

    if (url.pathname.startsWith("/cast-media/")) {
      const id = safeDecode(url.pathname.slice("/cast-media/".length));
      const video = library.videos.find((item) => item.id === id);
      if (!video || !verifyCastUrl(id, url.searchParams.get("expires"), url.searchParams.get("sig"))) {
        return sendText(res, 403, "Cast URL expired");
      }
      return await streamMedia(req, res, video.path);
    }

    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendText(res, 500, "Internal server error");
  }
});

await loadStore();
await scanLibrary();
setInterval(scanLibrary, SCAN_INTERVAL_MS).unref();
setInterval(runSubscriptions, CHANNEL_CHECK_INTERVAL_MS).unref();

server.listen(PORT, () => {
  console.log(`PrivateTube listening on http://0.0.0.0:${PORT}`);
  console.log(`Media directory: ${MEDIA_DIR}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
