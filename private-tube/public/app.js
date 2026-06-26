const state = {
  session: { authenticated: false, authEnabled: false, user: null },
  library: { videos: [], channels: [] },
  config: { metubeEnabled: false, qualityPresets: [] },
  subscriptions: [],
  users: [],
  downloads: [],
  progress: [],
  settings: { metubeUrl: "", publicUrl: "" },
  preferences: { showShorts: true },
  shortsOrderKey: "",
  shortsOrder: [],
  filter: "all",
  query: "",
  channelId: ""
};

const grid = document.querySelector("#grid");
const emptyState = document.querySelector("#emptyState");
const viewTitle = document.querySelector("#viewTitle");
const viewMeta = document.querySelector("#viewMeta");
const channelStrip = document.querySelector("#channelStrip");
const searchInput = document.querySelector("#searchInput");
const rescanButton = document.querySelector("#rescanButton");
const addForm = document.querySelector("#addForm");
const urlInput = document.querySelector("#urlInput");
const qualitySelect = document.querySelector("#qualitySelect");
const qualityInfo = document.querySelector("#qualityInfo");
const addStatus = document.querySelector("#addStatus");
const adminPanel = document.querySelector("#adminPanel");
const logoutButton = document.querySelector("#logoutButton");
const menuButton = document.querySelector("#menuButton");
const menuCloseButton = document.querySelector("#menuCloseButton");
const appMenu = document.querySelector("#appMenu");
const menuBackdrop = document.querySelector("#menuBackdrop");
const downloadStatus = document.querySelector("#downloadStatus");
const downloadStatusText = document.querySelector("#downloadStatusText");
const downloadActivityList = document.querySelector("#downloadActivityList");
const continueSection = document.querySelector("#continueSection");
const continueGrid = document.querySelector("#continueGrid");
const continueMeta = document.querySelector("#continueMeta");
const toastStack = document.querySelector("#toastStack");
const initialParams = new URLSearchParams(location.search);

state.query = initialParams.get("q") || "";
state.channelId = initialParams.get("channel") || "";
if (state.channelId) state.filter = "channel";
searchInput.value = state.query;

function isAdmin() {
  return state.session.user?.role === "admin";
}

function applyTheme(theme = localStorage.getItem("pt-theme") || "dark") {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("pt-theme", theme);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === theme);
  });
}

function brandName() {
  return localStorage.getItem("pt-brand-name") || "PrivateTube";
}

function applyBrandName(name = brandName()) {
  const displayName = String(name || "").trim() || "PrivateTube";
  localStorage.setItem("pt-brand-name", displayName);
  document.querySelectorAll("[data-brand-name]").forEach((item) => {
    item.textContent = displayName;
  });
  document.title = displayName;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function closeMenu() {
  appMenu.setAttribute("hidden", "");
  menuBackdrop.setAttribute("hidden", "");
  menuButton.setAttribute("aria-expanded", "false");
}

function openMenu() {
  appMenu.removeAttribute("hidden");
  menuBackdrop.removeAttribute("hidden");
  menuButton.setAttribute("aria-expanded", "true");
}

function toggleMenu() {
  if (appMenu.hasAttribute("hidden")) openMenu();
  else closeMenu();
}

function notify(message, tone = "info") {
  if (!toastStack) return;
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);

  if (localStorage.getItem("pt-notifications") === "on" && "Notification" in window && Notification.permission === "granted") {
    new Notification("PrivateTube", { body: message });
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    notify("Browser notifications are not supported here", "warn");
    return;
  }
  if (!window.isSecureContext) {
    localStorage.setItem("pt-notifications", "off");
    notify("Browser notifications need HTTPS or localhost. In-app notifications are already on.", "warn");
    render();
    return;
  }
  const permission = await Notification.requestPermission();
  localStorage.setItem("pt-notifications", permission === "granted" ? "on" : "off");
  notify(permission === "granted" ? "Browser notifications enabled" : "Browser notifications blocked by Chrome", permission === "granted" ? "success" : "warn");
  render();
}

function notificationStatusText() {
  if (!("Notification" in window)) return "Browser notifications are not supported here. In-app notifications still work.";
  if (!window.isSecureContext) return "Browser notifications need HTTPS or localhost. In-app notifications still work on this HTTP TrueNAS URL.";
  if (Notification.permission === "granted") return "Browser notifications are enabled on this device.";
  if (Notification.permission === "denied") return "Browser notifications are blocked in this browser.";
  return "Browser notifications are optional. In-app notifications are already enabled.";
}

function canUseBrowserNotifications() {
  return "Notification" in window && window.isSecureContext && Notification.permission !== "denied";
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  let response;

  try {
    response = await fetch(path, {
      ...options,
      cache: "no-store",
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Request timed out. Check the container logs.");
    throw new Error("Could not reach PrivateTube. Check the container logs.");
  } finally {
    window.clearTimeout(timeout);
  }

  if (response.status === 401) {
    location.href = "/login.html";
    throw new Error("Authentication required");
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Never";
}

function formatSize(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size > 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatRelative(value) {
  if (!value) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(value);
}

function thumbnail(video) {
  const media = video.thumbnail ? `<img src="${video.thumbnail}" alt="">` : `<div class="thumb-fallback"><span></span></div>`;
  return `${media}<span class="quality-badge">${videoQualityLabel(video)}</span>`;
}

function qualityPreset(id) {
  return state.config.qualityPresets.find((quality) => quality.id === id);
}

function qualityLabel(id) {
  return qualityPreset(id)?.label || id || "Auto";
}

function qualityDescription(id) {
  return qualityPreset(id)?.description || "";
}

function videoQualityLabel(video) {
  if (video?.resolutionLabel) return video.resolutionLabel;
  if (video?.height) return video.height >= 2000 ? "4K" : `${video.height}p`;
  const text = [video?.title, video?.path, video?.contentType].join(" ").toLowerCase();
  if (text.includes("webm")) return "WEBM";
  if (text.includes("mp4") || text.includes("m4v")) return "MP4";
  if (text.includes("mkv")) return "MKV";
  return "VIDEO";
}

function visibleVideo(video) {
  return state.preferences.showShorts || !video.isShort || state.filter === "shorts";
}

function shuffledShorts() {
  const shorts = state.library.videos.filter((video) => video.isShort);
  const key = shorts.map((video) => video.id).join("|");
  if (state.shortsOrderKey !== key || state.shortsOrder.length !== shorts.length) {
    state.shortsOrderKey = key;
    state.shortsOrder = [...shorts].sort(() => Math.random() - 0.5).map((video) => video.id);
  }
  const byId = new Map(shorts.map((video) => [video.id, video]));
  return state.shortsOrder.map((id) => byId.get(id)).filter(Boolean);
}

function reshuffleShorts() {
  state.shortsOrder = [...state.shortsOrder].sort(() => Math.random() - 0.5);
}

function renderQualityInfo() {
  if (!qualityInfo) return;
  qualityInfo.textContent = qualityDescription(qualitySelect.value);
}

function renderQualityOptions() {
  qualitySelect.innerHTML = state.config.qualityPresets
    .map((quality) => `<option value="${quality.id}" title="${quality.description || ""}">${quality.label}</option>`)
    .join("");
  if (!qualitySelect.value && qualityPreset("auto")) qualitySelect.value = "auto";
  renderQualityInfo();
}

function selectFilter(filter, channelId = "") {
  state.filter = filter;
  state.channelId = channelId;
  state.query = filter === "channel" ? "" : state.query;
  searchInput.value = state.query;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.filter === filter || (filter === "channel" && item.dataset.filter === "channels"));
  });
  const nextUrl = channelId ? `/?channel=${encodeURIComponent(channelId)}` : "/";
  history.replaceState(null, "", nextUrl);
  closeMenu();
  render();
}

function channelDisplay(channel) {
  const videos = state.library.videos.filter((video) => visibleVideo(video) && video.channelId === channel.id);
  const namedVideo = videos.find((video) => video.channel && video.channel !== "Uploads");
  const name = channel.name === "Uploads" && namedVideo ? namedVideo.channel : channel.name;
  const thumbnail = channel.thumbnail || videos.find((video) => video.thumbnail)?.thumbnail || null;
  const count = Math.max(channel.count || 0, videos.length);
  return { ...channel, name, thumbnail, count };
}

function visibleChannels() {
  const byId = new Map();
  for (const channel of state.library.channels.map(channelDisplay).filter((channel) => channel.count > 0 || channel.subscribed)) {
    const key = channel.name === "Uploads" ? "uploads" : channel.id;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, channel);
      continue;
    }
    existing.count += channel.count;
    existing.subscribed = existing.subscribed || channel.subscribed;
    existing.thumbnail = existing.thumbnail || channel.thumbnail;
    existing.lastStatus = existing.lastStatus || channel.lastStatus;
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderChannels() {
  channelStrip.hidden = state.filter === "channels" || state.filter === "shorts" || state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings";
  if (channelStrip.hidden) {
    channelStrip.innerHTML = "";
    return;
  }

  channelStrip.innerHTML = visibleChannels()
    .map((channel) => `
      <button class="channel-pill ${state.channelId === channel.id ? "active" : ""}" type="button" data-channel="${channel.id}">
        <span>${channel.name}</span>
        <small>${channel.count}</small>
      </button>
    `)
    .join("");

  channelStrip.querySelectorAll("[data-channel]").forEach((button) => {
    button.addEventListener("click", () => selectFilter("channel", button.dataset.channel));
  });
}

function filteredVideos() {
  let videos = state.library.videos.filter(visibleVideo);

  if (state.filter === "channel" && state.channelId) {
    videos = videos.filter((video) => video.channelId === state.channelId);
  }

  if (state.filter === "recent") videos = videos.slice(0, 24);
  if (state.filter === "shorts") videos = shuffledShorts();

  if (state.query.trim()) {
    const query = state.query.toLowerCase();
    videos = videos.filter((video) =>
      `${video.title} ${video.channel} ${video.description || ""}`.toLowerCase().includes(query)
    );
  }

  return videos;
}

function videoMeta(video) {
  const date = video.uploadedAt || video.modifiedAt;
  const parts = [formatDate(date), video.resolutionLabel, formatSize(video.size)].filter(Boolean);
  return parts.join(" &middot; ");
}

function renderVideos(videos) {
  grid.hidden = state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings";
  if (state.filter === "channels") {
    renderChannelDirectory();
    return;
  }

  if (state.filter === "shorts") {
    renderShortsFeed(videos);
    return;
  }

  grid.classList.remove("channel-grid");
  grid.classList.remove("shorts-feed");
  grid.innerHTML = videos.map((video) => `
    <article class="video-card ${video.isShort ? "short-card" : ""}">
      <a class="thumb" href="${video.watchUrl}">${thumbnail(video)}</a>
      <div class="video-copy">
        <a class="video-title" href="${video.watchUrl}">${video.title}</a>
        <button class="channel-name" type="button" data-channel="${video.channelId}">${video.channel}</button>
        <p>${videoMeta(video)}</p>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("[data-channel]").forEach((button) => {
    button.addEventListener("click", () => selectFilter("channel", button.dataset.channel));
  });
}

function renderShortsFeed(videos) {
  grid.classList.remove("channel-grid");
  grid.classList.add("shorts-feed");
  grid.innerHTML = videos.map((video, index) => `
    <article class="shorts-reel" data-short-index="${index}">
      <video class="shorts-player" data-src="${video.url}" poster="${video.thumbnail || ""}" playsinline loop muted preload="none"></video>
      <div class="shorts-scrim"></div>
      <button class="shorts-exit" type="button" data-shorts-home aria-label="Back to home"><span class="shorts-action-icon back"></span></button>
      <div class="shorts-copy">
        <button class="shorts-channel" type="button" data-channel="${video.channelId}">${video.channel}</button>
        <h2>${escapeHtml(video.title)}</h2>
        <p>${videoMeta(video)}</p>
      </div>
      <div class="shorts-actions">
        <button type="button" data-shorts-toggle="${index}" aria-label="Play or pause short"><span class="shorts-action-icon play"></span></button>
        <button type="button" data-shorts-mute="${index}" aria-label="Mute or unmute short"><span class="shorts-action-icon mute"></span></button>
        <a href="${video.watchUrl}" aria-label="Open full watch page"><span class="shorts-action-icon open"></span></a>
        <button type="button" data-shorts-shuffle aria-label="Shuffle shorts"><span class="shorts-action-icon shuffle"></span></button>
      </div>
    </article>
  `).join("");

  const players = [...grid.querySelectorAll(".shorts-player")];
  const activate = (player) => {
    if (!player) return;
    if (!player.src) player.src = player.dataset.src;
    players.forEach((item) => {
      if (item !== player) item.pause();
    });
    player.play().catch(() => {});
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && entry.intersectionRatio > 0.62) {
        activate(entry.target.querySelector("video"));
      }
    });
  }, { threshold: [0.62] });

  grid.querySelectorAll(".shorts-reel").forEach((card) => observer.observe(card));
  if (players[0]) {
    players[0].src = players[0].dataset.src;
    players[0].play().catch(() => {});
  }

  grid.querySelectorAll("[data-channel]").forEach((button) => {
    button.addEventListener("click", () => selectFilter("channel", button.dataset.channel));
  });
  grid.querySelectorAll("[data-shorts-home]").forEach((button) => {
    button.addEventListener("click", () => selectFilter("all"));
  });
  grid.querySelectorAll("[data-shorts-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const player = players[Number(button.dataset.shortsToggle)];
      if (!player) return;
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    });
  });
  grid.querySelectorAll("[data-shorts-mute]").forEach((button) => {
    button.addEventListener("click", () => {
      const player = players[Number(button.dataset.shortsMute)];
      if (!player) return;
      player.muted = !player.muted;
      button.classList.toggle("active", !player.muted);
    });
  });
  grid.querySelectorAll("[data-shorts-shuffle]").forEach((button) => {
    button.addEventListener("click", () => {
      reshuffleShorts();
      render();
      grid.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function channelThumb(channel) {
  if (channel.thumbnail) return `<img src="${channel.thumbnail}" alt="">`;
  return `<span class="channel-avatar">${channel.name.slice(0, 1).toUpperCase()}</span>`;
}

function renderChannelDirectory() {
  grid.hidden = false;
  grid.classList.remove("shorts-grid");
  grid.classList.add("channel-grid");
  grid.innerHTML = visibleChannels().map((channel) => `
    <article class="channel-card">
      <button type="button" data-channel="${channel.id}" class="channel-card-button">
        <span class="channel-card-thumb">${channelThumb(channel)}</span>
        <span class="channel-card-copy">
          <strong>${channel.name}</strong>
          <span>${channel.count} video${channel.count === 1 ? "" : "s"}${channel.subscribed ? " · subscribed" : ""}</span>
          ${channel.lastStatus && channel.count === 0 ? `<small>${channel.lastStatus}</small>` : ""}
        </span>
      </button>
    </article>
  `).join("");

  grid.querySelectorAll("[data-channel]").forEach((button) => {
    button.addEventListener("click", () => selectFilter("channel", button.dataset.channel));
  });
}

function renderContinue() {
  const items = state.progress.filter((item) => item.video && visibleVideo(item.video) && item.position > 5);
  continueSection.hidden = items.length === 0 || state.filter !== "all" || Boolean(state.query);
  if (continueSection.hidden) {
    continueGrid.innerHTML = "";
    return;
  }

  continueMeta.textContent = `${items.length} video${items.length === 1 ? "" : "s"}`;
  continueGrid.innerHTML = items.slice(0, 8).map((item) => {
    const percent = item.duration ? Math.max(2, Math.min(98, (item.position / item.duration) * 100)) : 0;
    const href = `${item.video.watchUrl}&t=${Math.floor(item.position)}`;
    return `
      <article class="continue-card">
        <a class="thumb" href="${href}">
          ${thumbnail(item.video)}
          <span class="watch-progress"><span style="width: ${percent}%"></span></span>
        </a>
        <a class="video-title" href="${href}">${item.video.title}</a>
        <p>${formatTime(item.position)} watched &middot; ${item.video.channel}</p>
      </article>
    `;
  }).join("");
}

function renderDownloadStatus() {
  const items = state.downloads.slice(0, 4);
  downloadStatus.hidden = items.length === 0;
  if (!items.length) return;

  const failed = items.some((item) => item.status === "failed");
  downloadStatus.classList.toggle("failed", failed);
  downloadStatusText.textContent = `${items.length} recent MeTube request${items.length === 1 ? "" : "s"}`;
  downloadActivityList.innerHTML = items.map((item) => {
    const label = item.status === "queued" ? "Sent to MeTube" : item.status === "failed" ? "Failed" : item.status;
    return `
      <article class="download-activity ${item.status}">
        <strong>${label}</strong>
        <span>${qualityLabel(item.quality)} &middot; ${item.source} &middot; ${formatRelative(item.updatedAt)}</span>
      </article>
    `;
  }).join("");
}

function renderTitle(videos) {
  if (state.filter === "subscriptions") {
    viewTitle.textContent = "Subscriptions";
    viewMeta.textContent = `${state.subscriptions.length} channel${state.subscriptions.length === 1 ? "" : "s"}`;
  } else if (state.filter === "users") {
    viewTitle.textContent = "Users";
    viewMeta.textContent = `${state.users.length} account${state.users.length === 1 ? "" : "s"}`;
  } else if (state.filter === "settings") {
    viewTitle.textContent = "Settings";
    viewMeta.textContent = "Stored in SQLite";
  } else if (state.filter === "channel" && state.channelId) {
    const channel = visibleChannels().find((item) => item.id === state.channelId);
    viewTitle.textContent = channel ? channel.name : "Channel";
    viewMeta.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"}`;
  } else if (state.filter === "shorts") {
    const count = state.library.videos.filter((video) => video.isShort).length;
    viewTitle.textContent = "Shorts";
    viewMeta.textContent = `${count} vertical video${count === 1 ? "" : "s"}`;
  } else if (state.filter === "channels") {
    viewTitle.textContent = "Channels";
    const channels = visibleChannels();
    viewMeta.textContent = `${channels.length} channel${channels.length === 1 ? "" : "s"}`;
  } else if (state.filter === "recent") {
    viewTitle.textContent = "Latest";
    viewMeta.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"}`;
  } else {
    viewTitle.textContent = state.query ? "Search" : "Home";
    viewMeta.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"}`;
  }
}

function renderSubscriptions() {
  if (state.filter !== "subscriptions") return;
  adminPanel.hidden = false;

  const qualityOptions = state.config.qualityPresets
    .map((quality) => `<option value="${quality.id}" title="${quality.description || ""}">${quality.label}</option>`)
    .join("");

  adminPanel.innerHTML = `
    <form id="subscriptionForm" class="settings-form">
      <input name="name" placeholder="Channel name" required>
      <input name="url" type="url" placeholder="Channel or playlist URL" required>
      <select name="quality">${qualityOptions}</select>
      <input name="intervalHours" type="number" min="1" value="24" aria-label="Check every hours">
      <input name="retentionDays" type="number" min="0" value="0" aria-label="Retention days">
      <button type="submit">Add channel</button>
    </form>
    <p class="form-help">Auto lets MeTube/yt-dlp pick the best available quality. Pick a cap if you want smaller files.</p>
    <button id="retentionButton" class="secondary-button" type="button">Run retention cleanup</button>
    <div class="settings-list">
      ${state.subscriptions.map((item) => `
        <article class="settings-row">
          <div>
            <strong>${item.name}</strong>
            <p>${item.url}</p>
            <p>Quality: ${qualityLabel(item.quality || "auto")} &middot; Every ${item.intervalHours || 24}h &middot; Retention: ${item.retentionDays || 0} days &middot; Last: ${formatDate(item.lastRunAt)} &middot; ${item.lastStatus || "new"}</p>
          </div>
          <div class="row-actions">
            <button type="button" data-run="${item.id}">Run</button>
            <button type="button" data-delete="${item.id}">Delete</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;

  document.querySelector("#subscriptionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.intervalHours = Number(data.intervalHours);
    data.retentionDays = Number(data.retentionDays);
    await api("/api/subscriptions", { method: "POST", body: JSON.stringify(data) });
    await loadAdminData();
    await loadDownloads();
    render();
  });

  document.querySelector("#retentionButton").addEventListener("click", async () => {
    const result = await api("/api/retention/run", { method: "POST" });
    alert(result.enabled ? `Deleted ${result.deleted} old video(s).` : "Retention deletion is disabled.");
    await loadLibrary();
  });

  adminPanel.querySelectorAll("[data-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/subscriptions/${button.dataset.run}/run`, { method: "POST" });
      await loadAdminData();
      await loadDownloads();
      render();
    });
  });

  adminPanel.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/subscriptions/${button.dataset.delete}`, { method: "DELETE" });
      await loadAdminData();
      render();
    });
  });
}

function renderUsers() {
  if (state.filter === "settings") return;
  if (state.filter !== "users") return;
  adminPanel.hidden = false;

  adminPanel.innerHTML = `
    <form id="userForm" class="settings-form">
      <input name="username" placeholder="Username" required>
      <input name="password" type="password" placeholder="Password" required>
      <select name="role">
        <option value="viewer">Viewer</option>
        <option value="admin">Admin</option>
      </select>
      <button type="submit">Add user</button>
    </form>
    <div class="settings-list">
      ${state.users.map((user) => `
        <article class="settings-row">
          <div>
            <strong>${user.username}</strong>
            <p>${user.role} &middot; Created ${formatDate(user.createdAt)}</p>
          </div>
          <div class="row-actions">
            <button type="button" data-delete-user="${user.username}">Delete</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;

  document.querySelector("#userForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await api("/api/users", { method: "POST", body: JSON.stringify(data) });
    await loadAdminData();
    render();
  });

  adminPanel.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/users/${encodeURIComponent(button.dataset.deleteUser)}`, { method: "DELETE" });
      await loadAdminData();
      render();
    });
  });
}

function renderSettings() {
  if (state.filter !== "settings") return;
  adminPanel.hidden = false;

  adminPanel.innerHTML = `
    <div class="settings-grid">
      <section class="settings-card">
        <h2>Appearance</h2>
        <p>Choose how PrivateTube looks on this browser.</p>
        <div class="segmented">
          <button type="button" data-theme-choice="dark">Night</button>
          <button type="button" data-theme-choice="light">Day</button>
        </div>
      </section>
      <section class="settings-card">
        <h2>Branding</h2>
        <p>Name this app on this browser.</p>
        <label class="settings-inline-label">
          <span>Display name</span>
          <input id="brandNameInput" type="text" value="${escapeHtml(brandName())}" placeholder="PrivateTube">
        </label>
        <button id="brandNameButton" class="secondary-button" type="button">Save name</button>
      </section>
      <section class="settings-card">
        <h2>Notifications</h2>
        <p>${notificationStatusText()}</p>
        <button id="notificationButton" class="secondary-button" type="button" ${canUseBrowserNotifications() ? "" : "disabled"}>${canUseBrowserNotifications() ? "Enable browser notifications" : "Browser notifications unavailable"}</button>
      </section>
      <section class="settings-card">
        <h2>Shorts</h2>
        <p>Show portrait videos in Home and Latest for this user/profile.</p>
        <div class="segmented">
          <button type="button" data-shorts-choice="true">Show</button>
          <button type="button" data-shorts-choice="false">Hide</button>
        </div>
      </section>
    </div>
    <form id="settingsForm" class="settings-form settings-form-wide cast-settings-form">
      <label>
        <span>MeTube URL</span>
        <input name="metubeUrl" type="url" placeholder="http://10.69.24.3:30094" value="${state.settings.metubeUrl || ""}">
      </label>
      <label>
        <span>Chromecast public URL</span>
        <input name="publicUrl" type="url" placeholder="${location.origin}" value="${state.settings.publicUrl || ""}">
      </label>
      <button type="submit">Save settings</button>
    </form>
    <div class="settings-list">
      <article class="settings-row">
        <div>
          <strong>Cast settings</strong>
          <p>Detected app URL: ${location.origin}</p>
          <p>Chromecast URL in use: ${state.settings.publicUrl || location.origin}</p>
          <p>Use your TrueNAS LAN URL here, not localhost or 127.0.0.1. Example: http://10.69.24.3:3020</p>
        </div>
      </article>
      <article class="settings-row">
        <div>
          <strong>Descriptions</strong>
          <p>PrivateTube reads .info.json and .description files beside videos. Enable metadata sidecars in MeTube/yt-dlp for full YouTube descriptions.</p>
        </div>
      </article>
      <article class="settings-row">
        <div>
          <strong>Thumbnails</strong>
          <p>Generated previews are stored under /data/thumbnails. Existing sidecar images are preferred.</p>
        </div>
        <div class="row-actions">
          <button id="regenerateThumbsButton" type="button">Regenerate</button>
        </div>
      </article>
    </div>
  `;

  applyTheme();

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeChoice);
      notify(`${button.textContent} mode enabled`, "success");
    });
  });

  document.querySelector("#notificationButton").addEventListener("click", enableNotifications);
  document.querySelectorAll("[data-shorts-choice]").forEach((button) => {
    button.classList.toggle("active", String(state.preferences.showShorts) === button.dataset.shortsChoice);
    button.addEventListener("click", async () => {
      state.preferences = await api("/api/preferences", {
        method: "POST",
        body: JSON.stringify({ showShorts: button.dataset.shortsChoice === "true" })
      });
      notify(state.preferences.showShorts ? "Shorts enabled" : "Shorts hidden", "success");
      render();
    });
  });
  document.querySelector("#brandNameButton").addEventListener("click", () => {
    applyBrandName(document.querySelector("#brandNameInput").value);
    notify("Name saved", "success");
    render();
  });

  document.querySelector("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.settings = await api("/api/settings", { method: "POST", body: JSON.stringify(data) });
    state.config = await api("/api/config");
    renderAddPanel();
    notify("Settings saved", "success");
    render();
  });

  document.querySelector("#regenerateThumbsButton").addEventListener("click", async () => {
    await api("/api/thumbnails/regenerate", { method: "POST", timeoutMs: 120000 });
    notify("Thumbnail regeneration started", "success");
    await loadLibrary();
  });
}

function renderAddPanel() {
  document.querySelectorAll(".admin-only").forEach((item) => {
    item.hidden = !isAdmin();
  });

  if (state.config.metubeEnabled) {
    urlInput.disabled = false;
    qualitySelect.disabled = false;
    addForm.querySelector("button").disabled = false;
    addStatus.textContent = "";
    return;
  }

  urlInput.disabled = true;
  qualitySelect.disabled = true;
  addForm.querySelector("button").disabled = true;
  addStatus.textContent = "Set METUBE_URL to enable downloads";
}

function render() {
  const videos = filteredVideos();
  document.body.classList.toggle("shorts-mode", state.filter === "shorts");
  adminPanel.hidden = !(state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings");
  if (adminPanel.hidden) adminPanel.innerHTML = "";
  renderChannels();
  renderContinue();
  renderDownloadStatus();
  renderTitle(videos);
  renderVideos(videos);
  renderSubscriptions();
  renderUsers();
  renderSettings();
  emptyState.hidden = videos.length > 0 || (state.filter === "channels" && state.library.channels.length > 0) || state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings";
}

async function loadAdminData() {
  if (!isAdmin()) return;
  const [subscriptions, users, settings] = await Promise.all([
    api("/api/subscriptions"),
    api("/api/users"),
    api("/api/settings")
  ]);
  state.subscriptions = subscriptions.subscriptions;
  state.users = users.users;
  state.settings = settings;
}

async function loadDownloads() {
  const result = await api("/api/downloads");
  state.downloads = result.downloads || [];
}

async function loadProgress() {
  const result = await api("/api/progress");
  state.progress = result.progress || [];
}

async function loadLibrary() {
  state.config = await api("/api/config");
  renderQualityOptions();
  const [library, downloads, progress, preferences] = await Promise.all([
    api("/api/library"),
    api("/api/downloads"),
    api("/api/progress"),
    api("/api/preferences")
  ]);
  state.library = library;
  state.downloads = downloads.downloads || [];
  state.progress = progress.progress || [];
  state.preferences = preferences;
  await loadAdminData();
  renderAddPanel();
  render();
}

async function boot() {
  applyTheme();
  applyBrandName();
  state.session = await api("/api/session");
  if (state.session.setupRequired) {
    location.href = "/setup.html";
    return;
  }
  if (state.session.authEnabled && !state.session.authenticated) {
    location.href = "/login.html";
    return;
  }
  await loadLibrary();
  window.setInterval(async () => {
    try {
      await loadDownloads();
      renderDownloadStatus();
    } catch {}
  }, 10000);
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => selectFilter(button.dataset.filter));
});

document.querySelectorAll("[data-menu-filter]").forEach((button) => {
  button.addEventListener("click", () => selectFilter(button.dataset.menuFilter));
});

menuBackdrop.addEventListener("click", closeMenu);
menuButton.addEventListener("click", toggleMenu);
menuCloseButton.addEventListener("click", closeMenu);

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  const nextUrl = state.query ? `/?q=${encodeURIComponent(state.query)}` : "/";
  history.replaceState(null, "", nextUrl);
  render();
});

qualitySelect.addEventListener("change", renderQualityInfo);

rescanButton.addEventListener("click", async () => {
  rescanButton.disabled = true;
  await api("/api/rescan", { method: "POST" });
  await loadLibrary();
  rescanButton.disabled = false;
  closeMenu();
  notify("Library rescanned", "success");
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addStatus.textContent = "Sending...";
  try {
    const result = await api("/api/add", {
      method: "POST",
      body: JSON.stringify({ url: urlInput.value, quality: qualitySelect.value })
    });
    addStatus.textContent = result.ok ? "Queued in MeTube" : "Could not add video";
    if (result.ok) urlInput.value = "";
    notify(result.ok ? "Sent to MeTube" : "MeTube could not queue that", result.ok ? "success" : "warn");
    await loadDownloads();
    renderDownloadStatus();
  } catch (error) {
    addStatus.textContent = error.message;
    notify(error.message, "warn");
  }
});

logoutButton?.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

boot();
