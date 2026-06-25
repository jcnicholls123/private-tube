const state = {
  session: { authenticated: false, authEnabled: false, user: null },
  library: { videos: [], channels: [] },
  config: { metubeEnabled: false, qualityPresets: [] },
  subscriptions: [],
  users: [],
  settings: { metubeUrl: "", publicUrl: "" },
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
const initialParams = new URLSearchParams(location.search);

state.query = initialParams.get("q") || "";
state.channelId = initialParams.get("channel") || "";
if (state.channelId) state.filter = "channel";
searchInput.value = state.query;

function isAdmin() {
  return state.session.user?.role === "admin";
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

function thumbnail(video) {
  if (video.thumbnail) return `<img src="${video.thumbnail}" alt="">`;
  return `<div class="thumb-fallback"><span>Play</span></div>`;
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

function renderChannels() {
  channelStrip.hidden = state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings";
  channelStrip.innerHTML = state.library.channels
    .map((channel) => `
      <button class="channel-pill ${state.channelId === channel.id ? "active" : ""}" type="button" data-channel="${channel.id}">
        <span>${channel.name}</span>
        <small>${channel.count}</small>
      </button>
    `)
    .join("");

  channelStrip.querySelectorAll("[data-channel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.channelId = button.dataset.channel;
      state.filter = "channel";
      history.replaceState(null, "", `/?channel=${encodeURIComponent(state.channelId)}`);
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      render();
    });
  });
}

function filteredVideos() {
  let videos = [...state.library.videos];

  if (state.filter === "channel" && state.channelId) {
    videos = videos.filter((video) => video.channelId === state.channelId);
  }

  if (state.filter === "recent") videos = videos.slice(0, 24);

  if (state.query.trim()) {
    const query = state.query.toLowerCase();
    videos = videos.filter((video) =>
      `${video.title} ${video.channel}`.toLowerCase().includes(query)
    );
  }

  return videos;
}

function renderVideos(videos) {
  grid.hidden = state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings";
  grid.innerHTML = videos.map((video) => `
    <article class="video-card">
      <a class="thumb" href="${video.watchUrl}">${thumbnail(video)}</a>
      <div class="video-copy">
        <a class="video-title" href="${video.watchUrl}">${video.title}</a>
        <button class="channel-name" type="button" data-channel="${video.channelId}">${video.channel}</button>
        <p>${formatDate(video.modifiedAt)} · ${formatSize(video.size)}</p>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("[data-channel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.channelId = button.dataset.channel;
      state.filter = "channel";
      history.replaceState(null, "", `/?channel=${encodeURIComponent(state.channelId)}`);
      render();
    });
  });
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
    const channel = state.library.channels.find((item) => item.id === state.channelId);
    viewTitle.textContent = channel ? channel.name : "Channel";
    viewMeta.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"}`;
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
            <p>Quality: ${qualityLabel(item.quality || "auto")} · Every ${item.intervalHours || 24}h · Retention: ${item.retentionDays || 0} days · Last: ${formatDate(item.lastRunAt)} · ${item.lastStatus || "new"}</p>
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
            <p>${user.role} · Created ${formatDate(user.createdAt)}</p>
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
    <form id="settingsForm" class="settings-form settings-form-wide">
      <input name="metubeUrl" type="url" placeholder="MeTube URL" value="${state.settings.metubeUrl || ""}">
      <input name="publicUrl" type="url" placeholder="Chromecast public URL, blank for auto" value="${state.settings.publicUrl || ""}">
      <button type="submit">Save settings</button>
    </form>
    <div class="settings-list">
      <article class="settings-row">
        <div>
          <strong>Chromecast</strong>
          <p>Blank public URL uses the address you opened PrivateTube with. Set it only if Chromecast needs a different LAN URL.</p>
        </div>
      </article>
      <article class="settings-row">
        <div>
          <strong>Secrets</strong>
          <p>Cast signing secrets and user password hashes are stored in SQLite under /data/private-tube.sqlite.</p>
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

  document.querySelector("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    state.settings = await api("/api/settings", { method: "POST", body: JSON.stringify(data) });
    state.config = await api("/api/config");
    renderAddPanel();
    render();
  });

  document.querySelector("#regenerateThumbsButton").addEventListener("click", async () => {
    await api("/api/thumbnails/regenerate", { method: "POST", timeoutMs: 120000 });
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
  adminPanel.hidden = !(state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings");
  if (adminPanel.hidden) adminPanel.innerHTML = "";
  renderChannels();
  renderTitle(videos);
  renderVideos(videos);
  renderSubscriptions();
  renderUsers();
  renderSettings();
  emptyState.hidden = videos.length > 0 || state.filter === "subscriptions" || state.filter === "users" || state.filter === "settings";
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

async function loadLibrary() {
  state.config = await api("/api/config");
  renderQualityOptions();
  state.library = await api("/api/library");
  await loadAdminData();
  renderAddPanel();
  render();
}

async function boot() {
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
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    state.channelId = "";
    history.replaceState(null, "", "/");
    render();
  });
});

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
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addStatus.textContent = "Sending...";
  try {
    const result = await api("/api/add", {
      method: "POST",
      body: JSON.stringify({ url: urlInput.value, quality: qualitySelect.value })
    });
    addStatus.textContent = result.ok ? "Added to MeTube" : "Could not add video";
    if (result.ok) urlInput.value = "";
  } catch (error) {
    addStatus.textContent = error.message;
  }
});

logoutButton?.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

boot();
