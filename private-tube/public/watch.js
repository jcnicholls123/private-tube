const params = new URLSearchParams(location.search);
const videoId = params.get("v");
const player = document.querySelector("#player");
const videoTitle = document.querySelector("#videoTitle");
const channelLink = document.querySelector("#channelLink");
const relatedGrid = document.querySelector("#relatedGrid");
const searchInput = document.querySelector("#searchInput");
const castButton = document.querySelector("#castButton");
const airplayButton = document.querySelector("#airplayButton");
const castStatus = document.querySelector("#castStatus");

let currentVideo = null;
let castReady = false;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function thumbnail(video) {
  if (video.thumbnail) return `<img src="${video.thumbnail}" alt="">`;
  return `<div class="thumb-fallback"><span>Play</span></div>`;
}

function setCastStatus(message) {
  castStatus.textContent = message;
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

async function api(path) {
  const response = await fetch(path);
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
}

window.__onGCastApiAvailable = (isAvailable) => {
  if (isAvailable) initializeCastApi();
  else setCastStatus(isIOS() ? "Chromecast is not supported in iPhone Safari" : "Cast unavailable");
};

function loadCastSdk() {
  if (isIOS()) {
    setCastStatus("Chromecast is not available on iPhone Safari. Use AirPlay.");
    return;
  }

  setCastStatus("Looking for Cast support...");
  const script = document.createElement("script");
  script.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
  script.async = true;
  script.onerror = () => setCastStatus("Could not load Cast SDK");
  document.head.appendChild(script);

  window.setTimeout(() => {
    if (!castReady) setCastStatus("Use Google Chrome with a Chromecast on this network");
  }, 5000);
}

async function castCurrentVideo() {
  if (!castReady || !currentVideo) return;

  try {
    setCastStatus("Connecting...");
    const castInfo = await api(`/api/cast/${encodeURIComponent(currentVideo.id)}`);
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
  const library = await api("/api/library");
  const video = library.videos.find((item) => item.id === videoId);

  if (!video) {
    videoTitle.textContent = "Video not found";
    return;
  }

  currentVideo = video;
  document.title = `${video.title} - PrivateTube`;
  player.src = video.url;
  videoTitle.textContent = video.title;
  channelLink.textContent = video.channel;
  channelLink.href = `/?channel=${encodeURIComponent(video.channelId)}`;
  renderRelated(library.videos, video);
  castButton.disabled = !castReady;

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      location.href = `/?q=${encodeURIComponent(searchInput.value)}`;
    }
  });
}

castButton.addEventListener("click", castCurrentVideo);
setupAirPlay();
loadCastSdk();
load();
