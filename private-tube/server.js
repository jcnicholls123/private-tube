import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3020);
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, "media"));
const METUBE_URL = (process.env.METUBE_URL || "").replace(/\/$/, "");
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 5 * 60 * 1000);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi"]);
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

let library = {
  generatedAt: null,
  videos: [],
  channels: []
};

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json)
  });
  res.end(json);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
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

function getVideoById(id) {
  return library.videos.find((video) => video.id === id);
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

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
  }[ext] || "application/octet-stream";

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
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "content-type": contentType });
  res.end(data);
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/config") {
    return sendJson(res, 200, {
      metubeEnabled: Boolean(METUBE_URL),
      metubeUrl: METUBE_URL
    });
  }

  if (url.pathname === "/api/library") return sendJson(res, 200, library);

  if (url.pathname === "/api/rescan" && req.method === "POST") {
    await scanLibrary();
    return sendJson(res, 200, library);
  }

  if (url.pathname === "/api/add" && req.method === "POST") {
    if (!METUBE_URL) {
      return sendJson(res, 400, { error: "METUBE_URL is not configured" });
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        if (!payload.url) return sendJson(res, 400, { error: "Missing url" });
        const response = await fetch(`${METUBE_URL}/add`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: payload.url, quality: payload.quality || "best" })
        });
        return sendJson(res, response.ok ? 200 : 502, {
          ok: response.ok,
          status: response.status
        });
      } catch (error) {
        return sendJson(res, 500, { error: error.message });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "API endpoint not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);

    if (url.pathname.startsWith("/media/")) {
      return await streamMedia(req, res, safeDecode(url.pathname.slice("/media/".length)));
    }

    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendText(res, 500, "Internal server error");
  }
});

await scanLibrary();
setInterval(scanLibrary, SCAN_INTERVAL_MS).unref();

server.listen(PORT, () => {
  console.log(`PrivateTube listening on http://0.0.0.0:${PORT}`);
  console.log(`Media directory: ${MEDIA_DIR}`);
});
