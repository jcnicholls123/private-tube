const params = new URLSearchParams(location.search);
const videoId = params.get("v");
const startAt = Number(params.get("t") || 0);
const player = document.querySelector("#player");
const videoTitle = document.querySelector("#videoTitle");
const channelLink = document.querySelector("#channelLink");
const relatedGrid = document.querySelector("#relatedGrid");
const searchInput = document.querySelector("#searchInput");
const castButton = document.querySelector("#castButton");
const airplayButton = document.querySelector("#airplayButton");
const castStatus = document.querySelector("#castStatus");
const castDiagnostics = document.querySelector("#castDiagnostics");
const videoDescription = document.querySelector("#videoDescription");
const metadataButton = document.querySelector("#metadataButton");

let currentVideo = null;
let castReady = false;
let lastProgressSave = 0;
let watchedVideoIds = [];

document.documentElement.dataset.theme = localStorage.getItem("pt-theme") || "dark";
const appBrandName = localStorage.getItem("pt-brand-name") || "PrivateTube";
document.querySelectorAll("[data-brand-name]").forEach((item) => {
  item.textContent = appBrandName;
});

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function thumbnail(video) {
  const media = video.thumbnail ? `<img src="${video.thumbnail}" alt="">` : `<div class="thumb-fallback"><span></span></div>`;
  const watched = watchedVideoIds.includes(video.id) ? `<span class="watched-badge"><span></span>WATCHED</span>` : "";
  return `${media}${watched}`;
}

function setCastStatus(message) {
  castStatus.textContent = message;
}

function setCastDiagnostics(message) {
  castDiagnostics.textContent = message || "";
}

function isLocalCastHost(hostname = location.hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function castAvailabilityHint() {
  if (!window.isSecureContext && !isLocalCastHost()) {
    return "Chrome can still cast this tab, but PrivateTube's in-page Cast button needs Chrome to expose the Web Sender API. On plain HTTP LAN URLs that is often blocked; HTTPS or localhost is the reliable path.";
  }
  return "Chrome can cast tabs separately from website Cast buttons. If tab-cast works but this button does not, Chrome has not exposed the Web Sender API to this page.";
}

function renderDescription(video) {
  const lines = [];
  if (video.resolutionLabel) lines.push(`<strong>${video.resolutionLabel}${video.codec ? ` &middot; ${video.codec.toUpperCase()}` : ""}</strong>`);
  if (video.uploadedAt) lines.push(`<strong>Uploaded ${video.uploadedAt}</strong>`);
  if (video.sourceUrl) lines.push(`<a href="${video.sourceUrl}" target="_blank" rel="noreferrer">Original YouTube page</a>`);
  if (video.description) lines.push(`<p>${video.description.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/\n/g, "<br>")}</p>`);

  metadataButton.hidden = Boolean(video.description);
  videoDescription.hidden = false;
  videoDescription.innerHTML = lines.length ? lines.join("") : `
    <strong>No description saved yet</strong>
    <p>PrivateTube can read MeTube .info.json/.description sidecars, or try searching YouTube by this video's title and channel.</p>
  `;
}

async function fetchDescription({ automatic = false } = {}) {
  if (!currentVideo) return;
  metadataButton.disabled = true;
  metadataButton.textContent = automatic ? "Fetching description..." : "Fetching...";
  if (automatic) {
    videoDescription.hidden = false;
    videoDescription.innerHTML = "<strong>Fetching description...</strong><p>PrivateTube is looking up the saved YouTube metadata.</p>";
  }

  try {
    const result = await api(`/api/metadata/${encodeURIComponent(currentVideo.id)}`, { method: "POST" });
    currentVideo = result.video || currentVideo;
    renderDescription(currentVideo);
  } catch (error) {
    videoDescription.hidden = false;
    videoDescription.innerHTML = `<strong>Could not fetch description</strong><p>${error.message}</p>`;
    metadataButton.hidden = false;
  } finally {
    metadataButton.disabled = false;
    metadataButton.textContent = "Fetch description";
  }
}

async function saveProgress(force = false) {
  if (!currentVideo || !player.duration) return;
  if (!force && Date.now() - lastProgressSave < 10000) return;
  lastProgressSave = Date.now();

  await fetch("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      videoId: currentVideo.id,
      position: player.currentTime,
      duration: player.duration
    }),
    keepalive: force
  }).catch(() => {});
}

function setupProgressSaving() {
  player.addEventListener("timeupdate", () => saveProgress());
  player.addEventListener("pause", () => saveProgress(true));
  player.addEventListener("ended", () => saveProgress(true));
  window.addEventListener("pagehide", () => saveProgress(true));
}

function setupAirPlay() {
  if (!airplayButton || typeof player.webkitShowPlaybackTargetPicker !== "function") return;
  airplayButton.hidden = false;
  airplayButton.addEventListener("click", () => {
    player.webkitShowPlaybackTargetPicker();
  });

  player.addEventListener("webkitplaybacktargetavailabilitychanged", (event) => {
    airplayButton.disabled = event.availability !== "available";
  });
}

function renderRelated(videos, current) {
  const related = videos
    .filter((video) => video.id !== current.id && video.channelId === current.channelId)
    .slice(0, 12);

  relatedGrid.innerHTML = related.map((video) => `
    <article class="related-card">
      <a class="thumb" href="${video.watchUrl}">${thumbnail(video)}</a>
      <div>
        <a class="video-title" href="${video.watchUrl}">${video.title}</a>
        <p>${video.channel}</p>
      </div>
    </article>
  `).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  if (response.status === 401) {
    location.href = "/";
    throw new Error("Authentication required");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

function initializeCastApi() {
  if (!window.cast?.framework || !window.chrome?.cast) {
    setCastStatus(isIOS() ? "Chromecast is not supported in iPhone Safari" : "Cast unavailable");
    setCastDiagnostics(castAvailabilityHint());
    return;
  }

  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });

  castReady = true;
  castButton.disabled = !currentVideo;
  setCastStatus("Ready to cast");
  setCastDiagnostics(isLocalCastHost() ? "You opened PrivateTube on localhost. Chromecast needs the TrueNAS LAN URL in Settings > Chromecast public URL." : "Cast SDK loaded. If the receiver still fails, check the Chromecast public URL in Settings.");
}

window.__onGCastApiAvailable = (isAvailable) => {
  if (isAvailable) initializeCastApi();
  else {
    setCastStatus(isIOS() ? "Chromecast is not supported in iPhone Safari" : "Cast unavailable");
    setCastDiagnostics("Chrome loaded the Cast script, but the sender API reported unavailable.");
  }
};

function loadCastSdk() {
  if (isIOS()) {
    setCastStatus("Chromecast is not available on iPhone Safari. Use AirPlay.");
    setCastDiagnostics("");
    return;
  }

  setCastStatus("Looking for Cast support...");
  setCastDiagnostics(isLocalCastHost() ? "Open PrivateTube using your TrueNAS IP for Chromecast media URLs. Localhost only works from this PC." : "Loading the Google Cast sender SDK...");
  const script = document.createElement("script");
  script.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
  script.async = true;
  script.onerror = () => {
    setCastStatus("Could not load Cast SDK");
    setCastDiagnostics("Chrome must be able to reach www.gstatic.com to load the Google Cast sender SDK.");
  };
  document.head.appendChild(script);

  window.setTimeout(() => {
    if (!castReady) {
      setCastStatus("Cast sender not available");
      setCastDiagnostics(castAvailabilityHint());
    }
  }, 5000);
}

async function castCurrentVideo() {
  if (!castReady || !currentVideo) return;

  try {
    setCastStatus("Connecting...");
    const castInfo = await api(`/api/cast/${encodeURIComponent(currentVideo.id)}`);
    const mediaHost = new URL(castInfo.mediaUrl).hostname;
    setCastDiagnostics(`Cast media URL: ${castInfo.mediaUrl}`);
    if (isLocalCastHost(mediaHost)) {
      setCastStatus("Cast URL is not reachable by Chromecast");
      setCastDiagnostics("Set Settings > Chromecast public URL to your TrueNAS address, e.g. http://10.69.24.3:3020, then try again.");
      return;
    }
    const context = cast.framework.CastContext.getInstance();
    const session = context.getCurrentSession() || await context.requestSession();
    const mediaInfo = new chrome.cast.media.MediaInfo(castInfo.mediaUrl, castInfo.contentType || "video/webm");
    const metadata = new chrome.cast.media.GenericMediaMetadata();
    metadata.title = castInfo.title;
    metadata.subtitle = castInfo.channel;
    if (castInfo.thumbnail) metadata.images = [new chrome.cast.Image(castInfo.thumbnail)];
    mediaInfo.metadata = metadata;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    await session.loadMedia(request);
    player.pause();
    setCastStatus("Casting");
  } catch (error) {
    setCastStatus(error.message || "Could not cast");
  }
}

async function load() {
  const [library, progressResult] = await Promise.all([
    api("/api/library"),
    api("/api/progress").catch(() => ({ progress: [], watchedVideoIds: [] }))
  ]);
  const video = library.videos.find((item) => item.id === videoId);
  watchedVideoIds = progressResult.watchedVideoIds || [];

  if (!video) {
    videoTitle.textContent = "Video not found";
    return;
  }

  const saved = progressResult.progress?.find((item) => item.videoId === video.id);
  const resumeAt = startAt || saved?.position || 0;

  currentVideo = video;
  document.title = `${video.title} - ${appBrandName}`;
  player.src = video.url;
  player.addEventListener("loadedmetadata", () => {
    if (resumeAt > 5 && resumeAt < player.duration - 5) player.currentTime = resumeAt;
  }, { once: true });
  videoTitle.textContent = video.title;
  channelLink.textContent = video.channel;
  channelLink.href = `/?channel=${encodeURIComponent(video.channelId)}`;
  renderDescription(video);
  if (!video.description) fetchDescription({ automatic: true });
  renderRelated(library.videos, video);
  setupProgressSaving();
  castButton.disabled = !castReady;

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      location.href = `/?q=${encodeURIComponent(searchInput.value)}`;
    }
  });
}

castButton.addEventListener("click", castCurrentVideo);
metadataButton.addEventListener("click", () => fetchDescription());
setupAirPlay();
loadCastSdk();
load();
