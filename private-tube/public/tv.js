(function () {
  var state = {
    filter: "all",
    channelId: "",
    library: { videos: [], channels: [] },
    profiles: [],
    selectedProfile: localStorage.getItem("pt-tv-profile") || "",
    brandName: "PrivateTube",
    currentVideo: null,
    lastProgressSave: 0,
    lastLibraryFocus: null,
    overlayTimer: null
  };

  var loginPanel = document.querySelector("#loginPanel");
  var profilePanel = document.querySelector("#profilePanel");
  var libraryPanel = document.querySelector("#libraryPanel");
  var playerPanel = document.querySelector("#playerPanel");
  var profileGrid = document.querySelector("#profileGrid");
  var grid = document.querySelector("#grid");
  var tabs = document.querySelector("#tabs");
  var viewTitle = document.querySelector("#viewTitle");
  var viewMeta = document.querySelector("#viewMeta");
  var player = document.querySelector("#player");
  var playerOverlay = document.querySelector("#playerOverlay");
  var playerAction = document.querySelector("#playerAction");
  var playerTitle = document.querySelector("#playerTitle");
  var playerMeta = document.querySelector("#playerMeta");
  var currentTime = document.querySelector("#currentTime");
  var durationTime = document.querySelector("#durationTime");
  var progressFill = document.querySelector("#progressFill");
  var loginStatus = document.querySelector("#loginStatus");

  function api(path, options) {
    options = options || {};
    return fetch(path, {
      method: options.method || "GET",
      headers: Object.assign({ "content-type": "application/json" }, options.headers || {}),
      body: options.body
    }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (result) {
        if (!response.ok) throw new Error(result.error || "Request failed");
        return result;
      });
    });
  }

  function show(panel) {
    loginPanel.hidden = panel !== loginPanel;
    profilePanel.hidden = panel !== profilePanel;
    libraryPanel.hidden = panel !== libraryPanel;
    playerPanel.hidden = panel !== playerPanel;
  }

  function brandStorageKey() {
    return "pt-brand-name-" + (state.selectedProfile || "default");
  }

  function applyBrandName() {
    var name = String(state.brandName || "PrivateTube").trim() || "PrivateTube";
    document.querySelectorAll("[data-brand-name]").forEach(function (item) {
      item.textContent = name;
    });
    document.title = name + " TV";
  }

  function loadBrandName() {
    state.brandName = localStorage.getItem(brandStorageKey()) || localStorage.getItem("pt-brand-name") || "PrivateTube";
    applyBrandName();
  }

  function saveBrandName(name) {
    state.brandName = String(name || "").trim() || "PrivateTube";
    localStorage.setItem(brandStorageKey(), state.brandName);
    applyBrandName();
    render();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = seconds % 60;
    if (hours) return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    return minutes + ":" + String(secs).padStart(2, "0");
  }

  function thumbnail(video) {
    if (video.thumbnail) return '<img src="' + video.thumbnail + '" alt="">';
    return '<span class="thumb-fallback"></span>';
  }

  function channelThumb(channel) {
    if (channel.thumbnail) return '<img src="' + channel.thumbnail + '" alt="">';
    return '<span class="channel-avatar">' + channel.name.slice(0, 1).toUpperCase() + "</span>";
  }

  function videosForView() {
    var videos = state.library.videos.slice();
    if (state.filter === "recent") videos = videos.slice(0, 30);
    if (state.filter === "channel") {
      videos = videos.filter(function (video) {
        return video.channelId === state.channelId;
      });
    }
    return videos;
  }

  function focusFirst(selector) {
    window.setTimeout(function () {
      var target = document.querySelector(selector || ".focus-card");
      if (target) target.focus();
    }, 30);
  }

  function visibleFocusables() {
    return Array.prototype.slice.call(document.querySelectorAll("button, input, video")).filter(function (item) {
      return !item.disabled && item.offsetParent !== null;
    });
  }

  function moveFocus(direction) {
    var items = visibleFocusables();
    var index = items.indexOf(document.activeElement);
    if (index < 0) index = 0;
    var columns = 1;

    if (!libraryPanel.hidden && grid.contains(document.activeElement)) {
      columns = state.filter === "channels" ? 5 : 4;
    } else if (!profilePanel.hidden) {
      columns = 4;
    } else if (!libraryPanel.hidden && tabs.contains(document.activeElement)) {
      columns = 1;
    }

    var delta = direction;
    if (direction === "up") delta = -columns;
    if (direction === "down") delta = columns;
    if (direction === "left") delta = -1;
    if (direction === "right") delta = 1;

    var nextIndex = Math.max(0, Math.min(items.length - 1, index + delta));
    if (items[nextIndex]) items[nextIndex].focus();
  }

  function restoreLibraryFocus() {
    window.setTimeout(function () {
      var target = state.lastLibraryFocus ? document.querySelector('[data-focus-id="' + state.lastLibraryFocus + '"]') : null;
      (target || document.querySelector(".focus-card") || document.querySelector(".tabs button")).focus();
    }, 30);
  }

  function renderProfiles() {
    profileGrid.innerHTML = state.profiles.map(function (profile) {
      var initial = profile.username.slice(0, 1).toUpperCase();
      return '<button class="profile-card focus-card" type="button" data-profile="' + profile.username + '" data-focus-id="profile-' + profile.username + '">' +
        '<span class="profile-avatar">' + initial + '</span>' +
        '<strong>' + profile.username + '</strong>' +
      "</button>";
    }).join("");

    profileGrid.querySelectorAll("[data-profile]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectProfile(button.dataset.profile);
      });
    });
  }

  function render() {
    tabs.querySelectorAll("button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.filter === state.filter || (state.filter === "channel" && button.dataset.filter === "channels"));
    });

    if (state.filter === "settings") {
      viewTitle.textContent = "Settings";
      viewMeta.textContent = "Personalise this TV profile";
      grid.className = "tv-grid settings-grid";
      grid.innerHTML = '<section class="settings-card">' +
        '<label><span>App name</span><input id="brandNameInput" value="' + escapeHtml(state.brandName) + '" placeholder="PrivateTube"></label>' +
        '<button class="focus-card settings-action" type="button" id="saveBrandButton">Save name</button>' +
        '<button class="focus-card settings-action" type="button" id="profileButton">Switch profile</button>' +
      "</section>";
      document.querySelector("#saveBrandButton").addEventListener("click", function () {
        saveBrandName(document.querySelector("#brandNameInput").value);
      });
      document.querySelector("#profileButton").addEventListener("click", function () {
        state.selectedProfile = "";
        localStorage.removeItem("pt-tv-profile");
        show(profilePanel);
        focusFirst(".profile-card");
      });
      focusFirst("#brandNameInput");
      return;
    }

    if (state.filter === "channels") {
      viewTitle.textContent = "Channels";
      viewMeta.textContent = state.library.channels.length + " channel" + (state.library.channels.length === 1 ? "" : "s");
      grid.className = "tv-grid channel-grid";
      grid.innerHTML = state.library.channels.map(function (channel) {
        return '<button class="focus-card channel-card" type="button" data-channel="' + channel.id + '" data-focus-id="channel-' + channel.id + '">' +
          '<span class="channel-thumb">' + channelThumb(channel) + "</span>" +
          "<strong>" + channel.name + "</strong>" +
          "<span>" + channel.count + " video" + (channel.count === 1 ? "" : "s") + "</span>" +
        "</button>";
      }).join("");
      grid.querySelectorAll("[data-channel]").forEach(function (button) {
        button.addEventListener("click", function () {
          state.filter = "channel";
          state.channelId = button.dataset.channel;
          render();
        });
      });
      restoreLibraryFocus();
      return;
    }

    var videos = videosForView();
    var channel = state.library.channels.find(function (item) {
      return item.id === state.channelId;
    });
    viewTitle.textContent = state.filter === "channel" ? (channel && channel.name ? channel.name : "Channel") : state.filter === "recent" ? "Latest" : "Home";
    viewMeta.textContent = videos.length + " video" + (videos.length === 1 ? "" : "s");
    grid.className = "tv-grid";
    grid.innerHTML = videos.map(function (video) {
      return '<button class="focus-card video-card" type="button" data-video="' + video.id + '" data-focus-id="video-' + video.id + '">' +
        '<span class="thumb">' + thumbnail(video) + "</span>" +
        "<strong>" + video.title + "</strong>" +
        "<span>" + video.channel + "</span>" +
      "</button>";
    }).join("");
    grid.querySelectorAll("[data-video]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.lastLibraryFocus = button.dataset.focusId;
        openVideo(button.dataset.video);
      });
    });
    restoreLibraryFocus();
  }

  function showPlayerOverlay() {
    playerOverlay.classList.remove("hidden");
    window.clearTimeout(state.overlayTimer);
    state.overlayTimer = window.setTimeout(function () {
      playerOverlay.classList.add("hidden");
    }, 3500);
  }

  function updatePlayerControls() {
    var duration = player.duration || 0;
    var position = player.currentTime || 0;
    var percent = duration ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
    progressFill.style.width = percent + "%";
    currentTime.textContent = formatTime(position);
    durationTime.textContent = duration ? formatTime(duration) : "0:00";
    playerAction.textContent = player.paused ? "Play" : "Pause";
  }

  function togglePlayback() {
    if (player.paused) player.play().catch(function () {});
    else player.pause();
    updatePlayerControls();
    showPlayerOverlay();
  }

  function seekBy(seconds) {
    if (!player.duration) return;
    player.currentTime = Math.max(0, Math.min(player.duration - 1, player.currentTime + seconds));
    updatePlayerControls();
    showPlayerOverlay();
  }

  function openVideo(videoId) {
    var video = state.library.videos.find(function (item) {
      return item.id === videoId;
    });
    if (!video) return;
    state.currentVideo = video;
    player.src = video.url;
    playerTitle.textContent = video.title;
    playerMeta.textContent = video.channel;
    show(playerPanel);
    history.pushState({ tvPlayer: true }, "", "#player");
    player.focus();
    player.play().catch(function () {});
    updatePlayerControls();
    showPlayerOverlay();
  }

  function closePlayer() {
    if (playerPanel.hidden) return;
    player.pause();
    saveProgress(true);
    player.removeAttribute("src");
    player.load();
    show(libraryPanel);
    restoreLibraryFocus();
  }

  function saveProgress(force) {
    if (!state.currentVideo || !player.duration) return Promise.resolve();
    if (!force && Date.now() - state.lastProgressSave < 10000) return Promise.resolve();
    state.lastProgressSave = Date.now();
    return fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId: state.currentVideo.id,
        position: player.currentTime,
        duration: player.duration
      }),
      keepalive: force
    }).catch(function () {});
  }

  function loadProfiles() {
    return api("/api/tv/profiles").then(function (result) {
      state.profiles = result.profiles || [];
      state.selectedProfile = localStorage.getItem("pt-tv-profile") || result.selectedProfile || "";
      renderProfiles();
      if (state.selectedProfile && state.profiles.some(function (profile) { return profile.username === state.selectedProfile; })) {
        return selectProfile(state.selectedProfile, true);
      }
      show(profilePanel);
      focusFirst(".profile-card");
    });
  }

  function selectProfile(username, quiet) {
    return api("/api/tv/profile", {
      method: "POST",
      body: JSON.stringify({ username: username })
    }).then(function () {
      state.selectedProfile = username;
      localStorage.setItem("pt-tv-profile", username);
      loadBrandName();
      return loadLibrary();
    }).catch(function (error) {
      if (!quiet) loginStatus.textContent = error.message;
    });
  }

  function loadLibrary() {
    return api("/api/library").then(function (library) {
      state.library = library;
      show(libraryPanel);
      render();
    });
  }

  function boot() {
    return api("/api/session").then(function (session) {
      if (session.setupRequired) {
        location.href = "/setup.html";
        return;
      }
      if (session.authEnabled && !session.authenticated) {
        show(loginPanel);
        document.querySelector("#usernameInput").focus();
        return;
      }
      return loadProfiles();
    }).catch(function () {
      show(loginPanel);
      document.querySelector("#usernameInput").focus();
    });
  }

  document.querySelector("#loginButton").addEventListener("click", function () {
    api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.querySelector("#usernameInput").value,
        password: document.querySelector("#passwordInput").value
      })
    }).then(loadProfiles).catch(function (error) {
      loginStatus.textContent = error.message;
    });
  });

  tabs.querySelectorAll("button").forEach(function (button) {
    button.addEventListener("click", function () {
      state.lastLibraryFocus = null;
      state.filter = button.dataset.filter;
      state.channelId = "";
      render();
    });
  });

  player.addEventListener("timeupdate", function () {
    updatePlayerControls();
    saveProgress(false);
  });
  player.addEventListener("loadedmetadata", updatePlayerControls);
  player.addEventListener("play", updatePlayerControls);
  player.addEventListener("pause", function () {
    updatePlayerControls();
    saveProgress(true);
  });
  player.addEventListener("ended", function () {
    updatePlayerControls();
    saveProgress(true);
  });
  player.addEventListener("mousemove", showPlayerOverlay);
  player.addEventListener("click", showPlayerOverlay);
  loadBrandName();

  document.addEventListener("focusin", function (event) {
    if (libraryPanel.hidden) return;
    if (event.target.dataset && event.target.dataset.focusId) {
      state.lastLibraryFocus = event.target.dataset.focusId;
    }
  });

  document.addEventListener("keydown", function (event) {
    var key = event.key || "";
    var code = event.keyCode || event.which;
    var isOk = key === "Enter" || key === "OK" || code === 13;
    var isBack = key === "Escape" || key === "Backspace" || key === "BrowserBack" || code === 461 || code === 10009;
    var arrows = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right"
    };

    if (!playerPanel.hidden) {
      if (isOk) {
        togglePlayback();
        event.preventDefault();
        return;
      }
      if (key === "ArrowLeft") {
        seekBy(-10);
        event.preventDefault();
        return;
      }
      if (key === "ArrowRight") {
        seekBy(10);
        event.preventDefault();
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        showPlayerOverlay();
        event.preventDefault();
        return;
      }
      if (isBack) {
        closePlayer();
        event.preventDefault();
        return;
      }
    }

    if (isOk && document.activeElement && document.activeElement.click && document.activeElement !== player) {
      document.activeElement.click();
      event.preventDefault();
      return;
    }

    if (arrows[key] && playerPanel.hidden) {
      moveFocus(arrows[key]);
      event.preventDefault();
      return;
    }

    if (!libraryPanel.hidden && isBack && state.filter === "channel") {
      state.filter = "channels";
      state.channelId = "";
      state.lastLibraryFocus = null;
      render();
      event.preventDefault();
    } else if (!profilePanel.hidden && isBack) {
      show(libraryPanel);
      restoreLibraryFocus();
      event.preventDefault();
    }
  });

  window.addEventListener("popstate", function () {
    if (!playerPanel.hidden) closePlayer();
  });

  boot();
}());
