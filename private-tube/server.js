import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
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
const THUMBNAILS_ENABLED = process.env.THUMBNAILS_ENABLED !== "false";
const THUMBNAIL_TIME = process.env.THUMBNAIL_TIME || "00:00:05";
const METADATA_FETCH_ENABLED = process.env.METADATA_FETCH_ENABLED !== "false";
const AUTO_METADATA_FETCH = process.env.AUTO_METADATA_FETCH !== "false";
const AUTO_METADATA_FETCH_LIMIT = Number(process.env.AUTO_METADATA_FETCH_LIMIT || 12);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi"]);
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const QUALITY_PRESETS = [
  {
    id: "auto",
    label: "Auto (recommended)",
    description: "Lets MeTube/yt-dlp choose the best available quality. Use this for most videos."
  },
  {
    id: "best",
    label: "Best available",
    description: "Requests the highest quality MeTube can find. This can create larger files."
  },
  {
    id: "2160",
    label: "Up to 2160p",
    description: "Caps downloads at 4K when available, falling back to lower quality when needed."
  },
  {
    id: "1440",
    label: "Up to 1440p",
    description: "Caps downloads at 1440p, with automatic fallback if the source is lower."
  },
  {
    id: "1080",
    label: "Up to 1080p",
    description: "Good quality without the storage hit of 4K downloads."
  },
  {
    id: "720",
    label: "Up to 720p",
    description: "Smaller files that still look decent on phones, tablets, and smaller TVs."
  },
  {
    id: "480",
    label: "Up to 480p",
    description: "Low storage use for videos where quality matters less."
  },
  {
    id: "audio",
    label: "Audio only",
    description: "Downloads audio without video."
  }
];

let library = {
  generatedAt: null,
  videos: [],
  channels: []
};
let db;
let castSecret = "";
let autoMetadataFetchRunning = false;
const metadataFetchFailures = new Set();
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

function progressUsername(session) {
  return session?.profile || session?.username;
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
  run(`CREATE TABLE IF NOT EXISTS download_events (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    quality TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  run(`CREATE TABLE IF NOT EXISTS watch_progress (
    username TEXT NOT NULL,
    video_id TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (username, video_id)
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

function getSubscriptionByUrl(url) {
  const item = get(`SELECT id, name, url, quality, interval_hours AS intervalHours, retention_days AS retentionDays,
    enabled, created_at AS createdAt, last_run_at AS lastRunAt, last_status AS lastStatus
    FROM subscriptions WHERE url = ?`, [url]);
  return item ? { ...item, enabled: Boolean(item.enabled) } : null;
}

function insertSubscription(subscription) {
  run(`INSERT INTO subscriptions
    (id, name, url, quality, interval_hours, retention_days, enabled, created_at, last_run_at, last_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    subscription.id,
    subscription.name,
    subscription.url,
    subscription.quality || "auto",
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

function recordDownloadEvent(event) {
  const now = new Date().toISOString();
  run(`INSERT INTO download_events (id, url, quality, source, status, message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, message = excluded.message, updated_at = excluded.updated_at`, [
    event.id,
    event.url,
    event.quality || "auto",
    event.source || "manual",
    event.status,
    event.message || "",
    event.createdAt || now,
    now
  ]);
}

function recentDownloadEvents() {
  return all(`SELECT id, url, quality, source, status, message, created_at AS createdAt, updated_at AS updatedAt
    FROM download_events ORDER BY updated_at DESC LIMIT 12`);
}

function channelFromSubscription(subscription) {
  return {
    id: slugify(subscription.name),
    name: subscription.name,
    count: 0,
    latestAt: subscription.lastRunAt || subscription.createdAt,
    thumbnail: null,
    subscribed: true,
    lastStatus: subscription.lastStatus || "new"
  };
}

function saveWatchProgress(username, videoId, position, duration) {
  const now = new Date().toISOString();
  if (!username || !videoId) return;
  const safePosition = Math.max(0, Number(position) || 0);
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (safeDuration && safeDuration - safePosition < 20) {
    run("DELETE FROM watch_progress WHERE username = ? AND video_id = ?", [username, videoId]);
    return;
  }

  run(`INSERT INTO watch_progress (username, video_id, position, duration, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username, video_id) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      updated_at = excluded.updated_at`, [username, videoId, safePosition, safeDuration, now]);
}

function getWatchProgress(username) {
  return all(`SELECT video_id AS videoId, position, duration, updated_at AS updatedAt
    FROM watch_progress WHERE username = ? ORDER BY updated_at DESC LIMIT 24`, [username]);
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

function wantsAppShell(pathname) {
  return pathname === "/" || pathname === "/index.html";
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

function youtubeChannelNameFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    const first = parts[0] || "";
    if (first.startsWith("@")) return decodeURIComponent(first.slice(1));
    if (["c", "user"].includes(first) && parts[1]) return decodeURIComponent(parts[1]);
    if (first === "channel" && parts[1]) return decodeURIComponent(parts[1]);
    if (first === "playlist" && url.searchParams.has("list")) return `Playlist ${url.searchParams.get("list")}`;
  } catch {}
  return "";
}

function isYouTubeCollectionUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com"].includes(host)) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0]?.startsWith("@") || ["channel", "c", "user", "playlist"].includes(parts[0]);
  } catch {
    return false;
  }
}

function ensureSubscriptionForUrl(rawUrl, quality = "auto") {
  const url = String(rawUrl || "").trim();
  if (!url || !isYouTubeCollectionUrl(url) || getSubscriptionByUrl(url)) return null;
  const name = youtubeChannelNameFromUrl(url) || "YouTube channel";
  const subscription = {
    id: crypto.randomUUID(),
    name,
    url,
    quality,
    intervalHours: 24,
    retentionDays: 0,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    lastStatus: "added from URL"
  };
  insertSubscription(subscription);
  return subscription;
}

function normalizeUploadDate(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readSidecarText(candidates) {
  for (const candidate of candidates) {
    try {
      const text = (await fs.readFile(candidate, "utf8")).trim();
      if (text) return text;
    } catch {}
  }
  return "";
}

function metadataCachePath(videoId) {
  return path.join(metadataDir(), `${videoId}.json`);
}

function extractYouTubeId(...values) {
  const joined = values.filter(Boolean).join(" ");
  const urlMatch = joined.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (urlMatch) return urlMatch[1];
  const bracketMatch = joined.match(/[\[(_\s-]([A-Za-z0-9_-]{11})[\])_\s.-]/);
  return bracketMatch?.[1] || "";
}

function metadataFromInfo(info = {}) {
  return {
    title: info.title || "",
    description: info.description || "",
    uploader: info.channel || info.uploader || "",
    sourceUrl: info.webpage_url || info.original_url || "",
    uploadedAt: normalizeUploadDate(info.upload_date || info.release_date || ""),
    duration: info.duration_string || "",
    youtubeId: info.id || extractYouTubeId(info.webpage_url, info.original_url)
  };
}

async function readCachedMetadata(videoId) {
  try {
    return metadataFromInfo(JSON.parse(await fs.readFile(metadataCachePath(videoId), "utf8")));
  } catch {
    return {};
  }
}

async function writeCachedMetadata(videoId, info) {
  await fs.mkdir(metadataDir(), { recursive: true });
  await fs.writeFile(metadataCachePath(videoId), JSON.stringify(info, null, 2));
}

async function fetchYouTubeMetadata(video) {
  if (!METADATA_FETCH_ENABLED) throw new Error("Metadata fetching is disabled");
  const youtubeId = video.youtubeId || extractYouTubeId(video.sourceUrl, video.path, video.title);
  const searchQuery = `${video.title || ""} ${video.channel || ""}`.trim();
  if (!youtubeId && !video.sourceUrl && !searchQuery) {
    throw new Error("Could not identify this video. Enable MeTube info.json sidecars or keep the YouTube ID in filenames.");
  }

  const target = video.sourceUrl || (youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : `ytsearch1:${searchQuery}`);
  const { stdout } = await execFileAsync("yt-dlp", [
    "--dump-json",
    "--skip-download",
    "--no-playlist",
    target
  ], { timeout: 45000, maxBuffer: 1024 * 1024 * 8 });
  const info = JSON.parse(stdout);
  await writeCachedMetadata(video.id, info);
  return metadataFromInfo(info);
}

async function readVideoMetadata(filePath, videoId, relativePath) {
  const parsed = path.parse(filePath);
  const infoJson = path.join(parsed.dir, `${parsed.name}.info.json`);
  const description = await readSidecarText([
    path.join(parsed.dir, `${parsed.name}.description`),
    path.join(parsed.dir, `${parsed.name}.description.txt`),
    path.join(parsed.dir, `${parsed.name}.txt`)
  ]);

  const metadata = {
    title: "",
    description,
    uploader: "",
    sourceUrl: "",
    uploadedAt: "",
    duration: ""
  };

  try {
    const info = JSON.parse(await fs.readFile(infoJson, "utf8"));
    Object.assign(metadata, metadataFromInfo(info));
  } catch {}

  const cached = await readCachedMetadata(videoId);
  Object.assign(metadata, Object.fromEntries(Object.entries(cached).filter(([, value]) => value)));
  if (!metadata.description) metadata.description = description;
  metadata.youtubeId = metadata.youtubeId || extractYouTubeId(metadata.sourceUrl, relativePath, parsed.name);

  return metadata;
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

function thumbnailDir() {
  return path.join(DATA_DIR, "thumbnails");
}

function metadataDir() {
  return path.join(DATA_DIR, "metadata");
}

function generatedThumbnailPath(videoId) {
  return path.join(thumbnailDir(), `${videoId}.jpg`);
}

function generatedThumbnailUrl(videoId) {
  return `/thumbnails/${encodeURIComponent(`${videoId}.jpg`)}`;
}

async function generateThumbnail(filePath, videoId) {
  if (!THUMBNAILS_ENABLED) return null;
  const outputPath = generatedThumbnailPath(videoId);
  if (await exists(outputPath)) return generatedThumbnailUrl(videoId);

  await fs.mkdir(thumbnailDir(), { recursive: true });
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      THUMBNAIL_TIME,
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-1",
      "-q:v",
      "3",
      outputPath
    ], { timeout: 30000 });
    return generatedThumbnailUrl(videoId);
  } catch (error) {
    console.warn(`Could not generate thumbnail for ${filePath}: ${error.message}`);
    return null;
  }
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

async function scanLibrary(options = {}) {
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
    const thumbnail = await findThumbnail(filePath, relativePath) || await generateThumbnail(filePath, id);
    const metadata = await readVideoMetadata(filePath, id, relativePath);

    const video = {
      id,
      title: metadata.title || titleFromFile(filePath),
      channel: metadata.uploader || channelName,
      channelId: slugify(metadata.uploader || channelName),
      path: relativePath,
      url: `/media/${encodeURIComponent(relativePath)}`,
      watchUrl: `/watch.html?v=${encodeURIComponent(id)}`,
      thumbnail,
      contentType: mediaContentType(filePath),
      description: metadata.description,
      sourceUrl: metadata.sourceUrl,
      uploadedAt: metadata.uploadedAt,
      duration: metadata.duration,
      youtubeId: metadata.youtubeId,
      hasDescription: Boolean(metadata.description),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };

    videos.push(video);

    const channel = channelMap.get(video.channelId) || {
      id: video.channelId,
      name: video.channel,
      count: 0,
      latestAt: video.modifiedAt,
      thumbnail,
      subscribed: false
    };
    if (channel.name === "Uploads" && video.channel !== "Uploads") channel.name = video.channel;
    channel.count += 1;
    if (video.modifiedAt > channel.latestAt) channel.latestAt = video.modifiedAt;
    if (!channel.thumbnail && thumbnail) channel.thumbnail = thumbnail;
    channelMap.set(video.channelId, channel);
  }

  for (const subscription of getSubscriptions()) {
    const subscriptionChannel = channelFromSubscription(subscription);
    const existing = channelMap.get(subscriptionChannel.id);
    if (existing) {
      existing.name = subscriptionChannel.name;
      existing.subscribed = true;
      existing.lastStatus = subscriptionChannel.lastStatus;
      if (!existing.latestAt && subscriptionChannel.latestAt) existing.latestAt = subscriptionChannel.latestAt;
    } else {
      channelMap.set(subscriptionChannel.id, subscriptionChannel);
    }
  }

  for (const channel of channelMap.values()) {
    if (channel.name !== "Uploads") continue;
    const namedVideo = videos.find((video) => video.channelId === channel.id && video.channel && video.channel !== "Uploads");
    if (namedVideo) channel.name = namedVideo.channel;
  }

  videos.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  library = {
    generatedAt: new Date().toISOString(),
    videos,
    channels: [...channelMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  };

  if (!options.skipAutoMetadata) scheduleAutoMetadataFetch();
}

function shouldAutoFetchMetadata(video) {
  if (!AUTO_METADATA_FETCH || !METADATA_FETCH_ENABLED) return false;
  if (metadataFetchFailures.has(video.id)) return false;
  return !video.description || !video.sourceUrl || !video.uploadedAt || video.channel === "Uploads";
}

function scheduleAutoMetadataFetch() {
  if (autoMetadataFetchRunning) return;
  const candidates = library.videos.filter(shouldAutoFetchMetadata).slice(0, AUTO_METADATA_FETCH_LIMIT);
  if (!candidates.length) return;
  setTimeout(() => autoPopulateMetadata(candidates), 1500).unref();
}

async function autoPopulateMetadata(candidates) {
  if (autoMetadataFetchRunning) return;
  autoMetadataFetchRunning = true;
  let updated = false;

  for (const video of candidates) {
    try {
      await fetchYouTubeMetadata(video);
      updated = true;
      metadataFetchFailures.delete(video.id);
    } catch (error) {
      metadataFetchFailures.add(video.id);
      console.warn(`Could not auto-fetch metadata for ${video.title}: ${error.message}`);
    }
  }

  autoMetadataFetchRunning = false;
  if (updated) await scanLibrary({ skipAutoMetadata: true });
}

async function clearGeneratedThumbnails() {
  await fs.rm(thumbnailDir(), { recursive: true, force: true });
}

function qualityPayload(quality) {
  if (quality === "audio") return { quality: "audio" };
  if (quality && quality !== "auto" && quality !== "best") return { quality };
  return { quality: "best" };
}

async function addToMetube(url, quality = "auto", source = "manual") {
  const metubeUrl = getAppSetting("metube_url");
  if (!metubeUrl) throw new Error("MeTube URL is not configured");
  const eventId = crypto.randomBytes(12).toString("base64url");
  const response = await fetch(`${metubeUrl}/add`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, ...qualityPayload(quality) })
  });
  recordDownloadEvent({
    id: eventId,
    url,
    quality,
    source,
    status: response.ok ? "queued" : "failed",
    message: response.ok ? "Sent to MeTube" : `MeTube returned ${response.status}`
  });
  return { ok: response.ok, status: response.status, eventId };
}

async function runSubscription(subscription, force = false) {
  if (!getAppSetting("metube_url")) return;
  const now = Date.now();
  const intervalMs = Math.max(1, Number(subscription.intervalHours || 24)) * 60 * 60 * 1000;
  if (!force && subscription.lastRunAt && now - new Date(subscription.lastRunAt).getTime() < intervalMs) {
    return;
  }

  const result = await addToMetube(subscription.url, subscription.quality || "auto", "subscription");
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

function resolveThumbnailPath(filename) {
  const fullPath = path.resolve(thumbnailDir(), filename);
  const root = path.resolve(thumbnailDir());
  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
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

async function streamThumbnail(res, filename) {
  const filePath = resolveThumbnailPath(filename);
  if (!filePath) return sendText(res, 400, "Invalid thumbnail path");

  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return sendText(res, 404, "Thumbnail not found");
  }

  res.writeHead(200, {
    "content-type": mediaContentType(filePath),
    "cache-control": "public, max-age=86400",
    "content-length": data.length
  });
  res.end(data);
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
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
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

  if (url.pathname === "/api/downloads") return sendJson(res, 200, { downloads: recentDownloadEvents() });

  if (url.pathname === "/api/progress") {
    if (req.method === "GET") {
      const progress = getWatchProgress(progressUsername(session)).map((item) => ({
        ...item,
        video: library.videos.find((video) => video.id === item.videoId) || null
      })).filter((item) => item.video);
      return sendJson(res, 200, { progress });
    }

    if (req.method === "POST") {
      const payload = await readBody(req);
      saveWatchProgress(progressUsername(session), payload.videoId, payload.position, payload.duration);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (url.pathname === "/api/tv/profiles" && req.method === "GET") {
    return sendJson(res, 200, {
      profiles: getUsers().map(publicUser),
      selectedProfile: progressUsername(session)
    });
  }

  if (url.pathname === "/api/tv/profile" && req.method === "POST") {
    const payload = await readBody(req);
    const profile = getUser(payload.username);
    if (!profile) return sendJson(res, 404, { error: "Profile not found" });
    const token = parseCookies(req).pt_session;
    if (token && sessions.has(token)) {
      sessions.set(token, { ...sessions.get(token), profile: profile.username });
    }
    return sendJson(res, 200, { selectedProfile: profile.username });
  }

  if (url.pathname.startsWith("/api/metadata/") && req.method === "POST") {
    const id = safeDecode(url.pathname.slice("/api/metadata/".length));
    const video = library.videos.find((item) => item.id === id);
    if (!video) return sendJson(res, 404, { error: "Video not found" });

    try {
      await fetchYouTubeMetadata(video);
      await scanLibrary();
      const updated = library.videos.find((item) => item.id === id);
      return sendJson(res, 200, { video: updated });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

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

  if (url.pathname === "/api/thumbnails/regenerate" && req.method === "POST") {
    if (!requireAdmin(req, res)) return;
    await clearGeneratedThumbnails();
    await scanLibrary();
    return sendJson(res, 200, library);
  }

  if (url.pathname === "/api/add" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      if (!payload.url) return sendJson(res, 400, { error: "Missing url" });
      const subscription = ensureSubscriptionForUrl(payload.url, payload.quality || "auto");
      const result = await addToMetube(payload.url, payload.quality || "auto", "manual");
      if (subscription) await scanLibrary();
      return sendJson(res, result.ok ? 200 : 502, { ...result, subscription });
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

async function handleFormSetup(req, res) {
  try {
    if (!setupRequired()) return redirect(res, "/login.html");
    const payload = await readFormBody(req);
    if (!payload.username || !payload.password) {
      return redirect(res, "/setup.html?error=missing");
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
    return redirect(res, "/");
  } catch (error) {
    console.error("Form setup failed:", error);
    return redirect(res, "/setup.html?error=failed");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/form-login" && req.method === "POST") return await handleFormLogin(req, res);
    if (url.pathname === "/form-setup" && req.method === "POST") return await handleFormSetup(req, res);

    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);

    if (url.pathname.startsWith("/media/")) {
      if (!getSession(req)) return sendText(res, 401, "Authentication required");
      return await streamMedia(req, res, safeDecode(url.pathname.slice("/media/".length)));
    }

    if (url.pathname.startsWith("/thumbnails/")) {
      if (!getSession(req)) return sendText(res, 401, "Authentication required");
      return await streamThumbnail(res, safeDecode(url.pathname.slice("/thumbnails/".length)));
    }

    if (url.pathname.startsWith("/cast-media/")) {
      const id = safeDecode(url.pathname.slice("/cast-media/".length));
      const video = library.videos.find((item) => item.id === id);
      if (!video || !verifyCastUrl(id, url.searchParams.get("expires"), url.searchParams.get("sig"))) {
        return sendText(res, 403, "Cast URL expired");
      }
      return await streamMedia(req, res, video.path);
    }

    if (wantsAppShell(url.pathname) && AUTH_ENABLED) {
      if (setupRequired()) return redirect(res, "/setup.html");
      if (!getSession(req)) return redirect(res, "/login.html");
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
