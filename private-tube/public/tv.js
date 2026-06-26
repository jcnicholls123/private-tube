(function () {
  const state = {
    filter: "all",
    channelId: "",
    library: { videos: [], channels: [] },
    currentVideo: null,
    lastProgressSave: 0
  };

  const loginPanel = document.querySelector("#loginPanel");
  const libraryPanel = document.querySelector("#libraryPanel");
  const playerPanel = document.querySelector("#playerPanel");
  const grid = document.querySelector("#grid");
  const tabs = document.querySelector("#tabs");
  const viewTitle = document.querySelector("#viewTitle");
  const viewMeta = document.querySelector("#viewMeta");
  const player = document.querySelector("#player");
  const playerTitle = document.querySelector("#playerTitle");
  const playerMeta = document.querySelector("#playerMeta");
  const loginStatus = document.querySelector("#loginStatus");

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Request failed");
    return result;
  }

  function show(panel) {
    loginPanel.hidden = panel !== loginPanel;
    libraryPanel.hidden = panel !== libraryPanel;
    playerPanel.hidden = panel !== playerPanel;
  }

  function thumbnail(video) {
    if (video.thumbnail) return `<img src="${video.thumbnail}" alt="">`;
    return `<span class="thumb-fallback"></span>`;
  }

  function channelThumb(channel) {
    if (channel.thumbnail) return `<img src="${channel.thumbnail}" alt="">`;
    return `<span class="channel-avatar">${channel.name.slice(0, 1).toUpperCase()}</span>`;
  }

  function videosForView() {
    let videos = [...state.library.videos];
    if (state.filter === "recent") videos = videos.slice(0, 30);
    if (state.filter === "channel") videos = videos.filter((video) => video.channelId === state.channelId);
    return videos;
  }

  function focusFirstCard() {
    window.setTimeout(() => document.querySelector(".focus-card")?.focus(), 20);
  }

  function render() {
    tabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === state.filter || (state.filter === "channel" && button.dataset.filter === "channels"));
    });

    if (state.filter === "channels") {
      viewTitle.textContent = "Channels";
      viewMeta.textContent = `${state.library.channels.length} channel${state.library.channels.length === 1 ? "" : "s"}`;
      grid.className = "tv-grid channel-grid";
      grid.innerHTML = state.library.channels.map((channel) => `
        <button class="focus-card channel-card" type="button" data-channel="${channel.id}">
          <span class="channel-thumb">${channelThumb(channel)}</span>
          <strong>${channel.name}</strong>
          <span>${channel.count} video${channel.count === 1 ? "" : "s"}</span>
        </button>
      `).join("");
      grid.querySelectorAll("[data-channel]").forEach((button) => {
        button.addEventListener("click", () => {
          state.filter = "channel";
          state.channelId = button.dataset.channel;
          render();
        });
      });
      focusFirstCard();
      return;
    }

    const videos = videosForView();
    const channel = state.library.channels.find((item) => item.id === state.channelId);
    viewTitle.textContent = state.filter === "channel" ? channel?.name || "Channel" : state.filter === "recent" ? "Latest" : "Home";
    viewMeta.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"}`;
    grid.className = "tv-grid";
    grid.innerHTML = videos.map((video) => `
      <button class="focus-card video-card" type="button" data-video="${video.id}">
        <span class="thumb">${thumbnail(video)}</span>
        <strong>${video.title}</strong>
        <span>${video.channel}</span>
      </button>
    `).join("");
    grid.querySelectorAll("[data-video]").forEach((button) => {
      button.addEventListener("click", () => openVideo(button.dataset.video));
    });
    focusFirstCard();
  }

  async function openVideo(videoId) {
    const video = state.library.videos.find((item) => item.id === videoId);
    if (!video) return;
    state.currentVideo = video;
    player.src = video.url;
    playerTitle.textContent = video.title;
    playerMeta.textContent = video.channel;
    show(playerPanel);
    player.focus();
  }

  async function saveProgress(force = false) {
    if (!state.currentVideo || !player.duration) return;
    if (!force && Date.now() - state.lastProgressSave < 10000) return;
    state.lastProgressSave = Date.now();
    await fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId: state.currentVideo.id,
        position: player.currentTime,
        duration: player.duration
      }),
      keepalive: force
    }).catch(() => {});
  }

  async function loadLibrary() {
    state.library = await api("/api/library");
    show(libraryPanel);
    render();
  }

  async function boot() {
    const session = await api("/api/session");
    if (session.setupRequired) {
      location.href = "/setup.html";
      return;
    }
    if (session.authEnabled && !session.authenticated) {
      show(loginPanel);
      document.querySelector("#usernameInput").focus();
      return;
    }
    await loadLibrary();
  }

  document.querySelector("#loginButton").addEventListener("click", async () => {
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: document.querySelector("#usernameInput").value,
          password: document.querySelector("#passwordInput").value
        })
      });
      await loadLibrary();
    } catch (error) {
      loginStatus.textContent = error.message;
    }
  });

  tabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.channelId = "";
      render();
    });
  });

  player.addEventListener("timeupdate", () => saveProgress());
  player.addEventListener("pause", () => saveProgress(true));
  player.addEventListener("ended", () => saveProgress(true));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Backspace" || event.key === "BrowserBack") {
      if (!playerPanel.hidden) {
        player.pause();
        show(libraryPanel);
        focusFirstCard();
        event.preventDefault();
      }
    }
  });

  boot();
}());
