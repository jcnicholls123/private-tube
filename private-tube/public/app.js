const state = {
  library: { videos: [], channels: [] },
  config: { metubeEnabled: false },
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
const addStatus = document.querySelector("#addStatus");
const initialParams = new URLSearchParams(location.search);

state.query = initialParams.get("q") || "";
state.channelId = initialParams.get("channel") || "";
if (state.channelId) state.filter = "channel";
if (searchInput) searchInput.value = state.query;

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
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
  if (video.thumbnail) {
    return `<img src="${video.thumbnail}" alt="">`;
  }
  return `<div class="thumb-fallback"><span>▶</span></div>`;
}

function renderChannels() {
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

  if (state.filter === "recent") {
    videos = videos.slice(0, 24);
  }

  if (state.query.trim()) {
    const query = state.query.toLowerCase();
    videos = videos.filter((video) =>
      `${video.title} ${video.channel}`.toLowerCase().includes(query)
    );
  }

  return videos;
}

function renderVideos(videos) {
  grid.innerHTML = videos.map((video) => `
    <article class="video-card">
      <a class="thumb" href="${video.watchUrl}">
        ${thumbnail(video)}
      </a>
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
  if (state.filter === "channel" && state.channelId) {
    const channel = state.library.channels.find((item) => item.id === state.channelId);
    viewTitle.textContent = channel ? channel.name : "Channel";
  } else if (state.filter === "recent") {
    viewTitle.textContent = "Latest";
  } else if (state.filter === "channels") {
    viewTitle.textContent = "Channels";
  } else {
    viewTitle.textContent = state.query ? "Search" : "Home";
  }
  viewMeta.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"}`;
}

function render() {
  renderChannels();
  const videos = filteredVideos();
  renderTitle(videos);
  renderVideos(videos);
  emptyState.hidden = videos.length > 0;
}

async function loadLibrary() {
  const [configResponse, libraryResponse] = await Promise.all([
    fetch("/api/config"),
    fetch("/api/library")
  ]);
  state.config = await configResponse.json();
  state.library = await libraryResponse.json();
  renderAddPanel();
  render();
}

function renderAddPanel() {
  if (state.config.metubeEnabled) {
    addForm.hidden = false;
    urlInput.disabled = false;
    addForm.querySelector("button").disabled = false;
    addStatus.textContent = "";
    return;
  }

  urlInput.disabled = true;
  addForm.querySelector("button").disabled = true;
  addStatus.textContent = "Set METUBE_URL to enable downloads";
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

rescanButton.addEventListener("click", async () => {
  rescanButton.disabled = true;
  await fetch("/api/rescan", { method: "POST" });
  await loadLibrary();
  rescanButton.disabled = false;
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addStatus.textContent = "Sending...";
  const response = await fetch("/api/add", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: urlInput.value })
  });
  const result = await response.json();
  addStatus.textContent = result.ok ? "Added to MeTube" : result.error || "Could not add video";
  if (result.ok) urlInput.value = "";
});

loadLibrary();
