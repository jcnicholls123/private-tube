(function () {
  var state = {
    filter: "all",
    channelId: "",
    library: { videos: [], channels: [] },
    progress: [],
    watchedVideoIds: [],
    profiles: [],
    selectedProfile: localStorage.getItem("pt-tv-profile") || "",
    brandName: "PrivateTube",
    autoplay: localStorage.getItem("pt-tv-autoplay") || "channel",
    theme: localStorage.getItem("pt-tv-theme") || "dark",
    currentVideo: null,
    nextVideo: null,
    pendingStartAt: 0,
    autoplayCountdown: 0,
    lastProgressSave: 0,
    lastLibraryFocus: null,
    suppressNextPop: false,
    autoplayTimer: null,
    overlayTimer: null
  };

  var loginPanel = document.querySelector("#loginPanel");
  var startupPanel = document.querySelector("#startupPanel");
  var offlinePanel = document.querySelector("#offlinePanel");
  var offlineStatus = document.querySelector("#offlineStatus");
  var retryButton = document.querySelector("#retryButton");
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
  var playerQuality = document.querySelector("#playerQuality");
  var upNextOverlay = document.querySelector("#upNextOverlay");
  var upNextCount = document.querySelector("#upNextCount");
  var upNextTitle = document.querySelector("#upNextTitle");
  var upNextMeta = document.querySelector("#upNextMeta");
  var upNextThumb = document.querySelector("#upNextThumb");
  var playNextButton = document.querySelector("#playNextButton");
  var cancelNextButton = document.querySelector("#cancelNextButton");
  var previousVideoButton = document.querySelector("#previousVideoButton");
  var nextVideoButton = document.querySelector("#nextVideoButton");
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
        if (!response.ok) {
          var httpError = new Error(result.error || "Request failed");
          httpError.httpStatus = response.status;
          throw httpError;
        }
        return result;
      });
    }).catch(function (error) {
      if (!error.httpStatus) showOffline(error.message || "PrivateTube is not reachable from this TV.");
      throw error;
    });
  }

  function show(panel) {
    if (panel !== startupPanel) document.body.classList.add("app-opened");
    startupPanel.hidden = true;
    offlinePanel.hidden = true;
    loginPanel.hidden = panel !== loginPanel;
    profilePanel.hidden = panel !== profilePanel;
    libraryPanel.hidden = panel !== libraryPanel;
    playerPanel.hidden = panel !== playerPanel;
  }

  function showOffline(message) {
    document.body.classList.add("app-opened");
    startupPanel.hidden = true;
    offlinePanel.hidden = false;
    loginPanel.hidden = true;
    profilePanel.hidden = true;
    libraryPanel.hidden = true;
    playerPanel.hidden = true;
    offlineStatus.textContent = message || "PrivateTube is not reachable from this TV.";
    retryButton.focus();
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

  function applyTheme(theme) {
    state.theme = theme || state.theme || "dark";
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem("pt-tv-theme", state.theme);
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

  function qualityLabel(video) {
    if (video.resolutionLabel) return video.resolutionLabel;
    if (video.height) return video.height >= 2000 ? "4K" : video.height + "p";
    var text = [video.title, video.path, video.contentType].join(" ").toLowerCase();
    if (/webm/.test(text)) return "WEBM";
    if (/mp4|m4v/.test(text)) return "MP4";
    if (/mkv/.test(text)) return "MKV";
    return "VIDEO";
  }

  function goHome() {
    state.filter = "all";
    state.channelId = "";
    state.lastLibraryFocus = null;
    render();
  }

  function thumbnail(video) {
    var media = video.thumbnail ? '<img src="' + video.thumbnail + '" alt="">' : '<span class="thumb-fallback"></span>';
    return media + '<span class="quality-badge">' + qualityLabel(video) + '</span>';
  }

  function thumbnailImage(video) {
    return video.thumbnail ? '<img src="' + video.thumbnail + '" alt="">' : '<span class="thumb-fallback"></span>';
  }

  function channelThumb(channel) {
    if (channel.thumbnail) return '<img src="' + channel.thumbnail + '" alt="">';
    return '<span class="channel-avatar">' + channel.name.slice(0, 1).toUpperCase() + "</span>";
  }

  function tvVideos() {
    return state.library.videos.filter(function (video) {
      return !video.isShort;
    });
  }

  function tvChannels() {
    var videos = tvVideos();
    return state.library.channels.map(function (channel) {
      var channelVideos = videos.filter(function (video) {
        return video.channelId === channel.id;
      });
      return Object.assign({}, channel, {
        count: channelVideos.length,
        thumbnail: channel.thumbnail || (channelVideos.find(function (video) { return video.thumbnail; }) || {}).thumbnail || null
      });
    }).filter(function (channel) {
      return channel.count > 0;
    });
  }

  function videosForView() {
    var videos = tvVideos();
    if (state.filter === "recent") videos = videos.slice(0, 30);
    if (state.filter === "channel") {
      videos = videos.filter(function (video) {
        return video.channelId === state.channelId;
      });
    }
    return videos;
  }

  function continueItems() {
    return state.progress.filter(function (item) {
      return item.video && !item.video.isShort && item.position > 5 && (!item.duration || item.position < item.duration - 8);
    }).slice(0, 8);
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
    var current = document.activeElement && items.indexOf(document.activeElement) >= 0
      ? document.activeElement
      : items[0];
    if (!current) return;

    var currentRect = current.getBoundingClientRect();
    var currentX = currentRect.left + currentRect.width / 2;
    var currentY = currentRect.top + currentRect.height / 2;
    var best = null;
    var bestScore = Infinity;

    items.forEach(function (item) {
      if (item === current) return;
      var rect = item.getBoundingClientRect();
      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      var dx = x - currentX;
      var dy = y - currentY;
      var primary = direction === "left" || direction === "right" ? dx : dy;
      var secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);

      if (direction === "left" && primary >= -8) return;
      if (direction === "right" && primary <= 8) return;
      if (direction === "up" && primary >= -8) return;
      if (direction === "down" && primary <= 8) return;

      var score = Math.abs(primary) + secondary * 2.4;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    });

    if (best) best.focus();
  }

  function restoreLibraryFocus() {
    window.setTimeout(function () {
      var target = state.lastLibraryFocus ? document.querySelector('[data-focus-id="' + state.lastLibraryFocus + '"]') : null;
      (target || document.querySelector(".focus-card") || document.querySelector(".tabs button")).focus();
    }, 30);
  }

  function renderProfiles() {
    profileGrid.innerHTML = state.profiles.map(function (profile) {
      var profileKey = profile.key || profile.username;
      var profileName = profile.name || profile.username;
      var initial = profileName.slice(0, 1).toUpperCase();
      return '<button class="profile-card focus-card" type="button" data-profile="' + escapeHtml(profileKey) + '" data-focus-id="profile-' + escapeHtml(profileKey) + '">' +
        '<span class="profile-avatar">' + initial + '</span>' +
        '<strong>' + escapeHtml(profileName) + '</strong>' +
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
        '<div class="preset-row">' +
          '<button class="focus-card preset-action" type="button" data-brand-preset="NichTube"><span class="option-icon option-icon-brand"></span><span>NichTube</span></button>' +
          '<button class="focus-card preset-action" type="button" data-brand-preset="BryTube"><span class="option-icon option-icon-brand"></span><span>BryTube</span></button>' +
          '<button class="focus-card preset-action" type="button" data-brand-preset="PrivateTube"><span class="option-icon option-icon-brand"></span><span>PrivateTube</span></button>' +
        '</div>' +
        '<button class="focus-card settings-action" type="button" id="saveBrandButton"><span class="option-icon option-icon-save"></span><span>Save name</span></button>' +
        '<h2>Autoplay</h2>' +
        '<div class="preset-row">' +
          '<button class="focus-card preset-action" type="button" data-autoplay="off"><span class="option-icon option-icon-off"></span><span>Off</span></button>' +
          '<button class="focus-card preset-action" type="button" data-autoplay="channel"><span class="option-icon option-icon-channel"></span><span>Same channel</span></button>' +
          '<button class="focus-card preset-action" type="button" data-autoplay="view"><span class="option-icon option-icon-view"></span><span>Current view</span></button>' +
        '</div>' +
        '<h2>Theme</h2>' +
        '<div class="preset-row">' +
          '<button class="focus-card preset-action" type="button" data-theme="dark"><span class="option-icon option-icon-night"></span><span>Night</span></button>' +
          '<button class="focus-card preset-action" type="button" data-theme="light"><span class="option-icon option-icon-day"></span><span>Day</span></button>' +
        '</div>' +
        '<button class="focus-card settings-action" type="button" id="profileButton"><span class="option-icon option-icon-profile"></span><span>Switch profile</span></button>' +
      "</section>";
      document.querySelector("#saveBrandButton").addEventListener("click", function () {
        saveBrandName(document.querySelector("#brandNameInput").value);
      });
      grid.querySelectorAll("[data-brand-preset]").forEach(function (button) {
        button.addEventListener("click", function () {
          document.querySelector("#brandNameInput").value = button.dataset.brandPreset;
          saveBrandName(button.dataset.brandPreset);
        });
      });
      grid.querySelectorAll("[data-autoplay]").forEach(function (button) {
        button.classList.toggle("active", button.dataset.autoplay === state.autoplay);
        button.addEventListener("click", function () {
          state.autoplay = button.dataset.autoplay;
          localStorage.setItem("pt-tv-autoplay", state.autoplay);
          render();
        });
      });
      grid.querySelectorAll("[data-theme]").forEach(function (button) {
        button.classList.toggle("active", button.dataset.theme === state.theme);
        button.addEventListener("click", function () {
          applyTheme(button.dataset.theme);
          render();
        });
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
      var channels = tvChannels();
      viewMeta.textContent = channels.length + " channel" + (channels.length === 1 ? "" : "s");
      grid.className = "tv-grid channel-grid";
      grid.innerHTML = channels.map(function (channel) {
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
          history.pushState({ tvView: "channel", channelId: state.channelId }, "", "#channel-" + encodeURIComponent(state.channelId));
          render();
        });
      });
      restoreLibraryFocus();
      return;
    }

    var videos = videosForView();
    var channel = tvChannels().find(function (item) {
      return item.id === state.channelId;
    });
    var resumeItems = state.filter === "all" ? continueItems() : [];
    var watched = new Set(state.watchedVideoIds || []);
    viewTitle.textContent = state.filter === "channel" ? (channel && channel.name ? channel.name : "Channel") : state.filter === "recent" ? "Latest" : "Home";
    viewMeta.textContent = videos.length + " video" + (videos.length === 1 ? "" : "s");
    grid.className = "tv-grid";
    grid.innerHTML = (resumeItems.length ? '<section class="continue-row">' +
      '<div class="continue-heading"><h2>Continue watching</h2><span>' + resumeItems.length + ' video' + (resumeItems.length === 1 ? "" : "s") + '</span></div>' +
      '<div class="continue-tv-grid">' + resumeItems.map(function (item) {
        var percent = item.duration ? Math.max(2, Math.min(100, item.position / item.duration * 100)) : 0;
        return '<button class="focus-card continue-tv-card" type="button" data-video="' + item.video.id + '" data-resume="' + Math.floor(item.position) + '" data-focus-id="continue-' + item.video.id + '">' +
          '<span class="thumb">' + thumbnail(item.video) + '<span class="watch-progress"><span style="width: ' + percent + '%"></span></span></span>' +
          '<strong>' + item.video.title + '</strong>' +
          '<span>' + formatTime(item.position) + ' watched</span>' +
        "</button>";
      }).join("") + '</div>' +
    '</section>' : "") + videos.map(function (video) {
      return '<button class="focus-card video-card' + (watched.has(video.id) ? " watched" : "") + '" type="button" data-video="' + video.id + '" data-focus-id="video-' + video.id + '">' +
        '<span class="thumb">' + thumbnail(video) + (watched.has(video.id) ? '<span class="watched-tick" aria-label="Watched"></span>' : "") + "</span>" +
        "<strong>" + video.title + "</strong>" +
        "<span>" + video.channel + "</span>" +
      "</button>";
    }).join("");
    grid.querySelectorAll("[data-video]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.lastLibraryFocus = button.dataset.focusId;
        openVideo(button.dataset.video, Number(button.dataset.resume) || 0);
      });
    });
    restoreLibraryFocus();
  }

  function showPlayerOverlay() {
    if (!upNextOverlay.hidden) return;
    playerOverlay.classList.remove("hidden");
    window.clearTimeout(state.overlayTimer);
    state.overlayTimer = window.setTimeout(function () {
      if (playerControlFocused()) return;
      playerOverlay.classList.add("hidden");
    }, 3500);
  }

  function playerControlFocused() {
    return playerOverlay.contains(document.activeElement) && document.activeElement !== playerOverlay;
  }

  function focusPlayerControls() {
    showPlayerOverlay();
    if (!playerControlFocused()) playerAction.focus();
  }

  function clearAutoplayCountdown() {
    window.clearInterval(state.autoplayTimer);
    state.autoplayTimer = null;
    state.nextVideo = null;
    state.autoplayCountdown = 0;
    upNextOverlay.hidden = true;
  }

  function updatePlayerControls() {
    var duration = player.duration || 0;
    var position = player.currentTime || 0;
    var percent = duration ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
    progressFill.style.width = percent + "%";
    currentTime.textContent = formatTime(position);
    durationTime.textContent = duration ? formatTime(duration) : "0:00";
    playerAction.classList.toggle("paused", player.paused);
    playerAction.setAttribute("aria-label", player.paused ? "Play" : "Pause");
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

  function nextAutoplayVideo() {
    if (state.autoplay === "off" || !state.currentVideo) return null;
    var queue = state.autoplay === "channel"
      ? tvVideos().filter(function (video) { return video.channelId === state.currentVideo.channelId; })
      : videosForView();
    var index = queue.findIndex(function (video) { return video.id === state.currentVideo.id; });
    if (index >= 0 && index + 1 < queue.length) return queue[index + 1];

    var sameChannel = tvVideos().find(function (video) {
      return video.id !== state.currentVideo.id && video.channelId === state.currentVideo.channelId;
    });
    if (sameChannel) return sameChannel;

    return tvVideos().find(function (video) {
      return video.id !== state.currentVideo.id;
    }) || state.currentVideo;
  }

  function playerQueue() {
    if (!state.currentVideo) return [];
    var queue = state.filter === "channel"
      ? tvVideos().filter(function (video) { return video.channelId === state.currentVideo.channelId; })
      : videosForView();
    if (!queue.some(function (video) { return video.id === state.currentVideo.id; })) {
      queue = tvVideos();
    }
    return queue;
  }

  function adjacentVideo(direction) {
    var queue = playerQueue();
    var index = queue.findIndex(function (video) { return state.currentVideo && video.id === state.currentVideo.id; });
    if (index < 0) return null;
    var nextIndex = direction === "previous" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= queue.length) return null;
    return queue[nextIndex];
  }

  function updateAdjacentButtons() {
    var previous = adjacentVideo("previous");
    var next = adjacentVideo("next") || nextAutoplayVideo();
    previousVideoButton.disabled = !previous;
    nextVideoButton.disabled = !next || next.id === state.currentVideo.id;
  }

  function renderUpNext() {
    if (!state.nextVideo) return;
    upNextCount.textContent = String(state.autoplayCountdown);
    upNextCount.parentElement.style.setProperty("--next-progress", Math.max(0, state.autoplayCountdown / 5 * 100) + "%");
    upNextTitle.textContent = state.nextVideo.title;
    upNextMeta.textContent = state.nextVideo.channel + " - " + qualityLabel(state.nextVideo);
    upNextThumb.innerHTML = thumbnailImage(state.nextVideo) + '<span class="quality-badge">' + qualityLabel(state.nextVideo) + '</span>';
  }

  function playNextVideo() {
    if (!state.nextVideo) return;
    var next = state.nextVideo;
    clearAutoplayCountdown();
    openVideo(next.id);
  }

  function markCurrentWatched() {
    if (!state.currentVideo || !player.duration) return Promise.resolve();
    state.watchedVideoIds = Array.from(new Set([].concat(state.watchedVideoIds || [], [state.currentVideo.id])));
    return fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId: state.currentVideo.id,
        position: Math.max(0, player.duration - 1),
        duration: player.duration
      }),
      keepalive: true
    }).catch(function () {});
  }

  function playAdjacent(direction, markWatched) {
    var target = adjacentVideo(direction);
    if (!target && direction === "next") target = nextAutoplayVideo();
    if (!target || target.id === state.currentVideo.id) return;
    clearAutoplayCountdown();
    var beforeOpen = markWatched ? markCurrentWatched() : saveProgress(true);
    beforeOpen.then(function () {
      return loadProgress();
    }).then(function () {
      openVideo(target.id);
    });
  }

  function cancelAutoplay() {
    clearAutoplayCountdown();
    playerOverlay.classList.remove("hidden");
    playerAction.classList.add("paused");
    playerAction.setAttribute("aria-label", "Replay");
    player.focus();
  }

  function showUpNext(next) {
    state.nextVideo = next;
    state.autoplayCountdown = 5;
    window.clearTimeout(state.overlayTimer);
    playerOverlay.classList.add("hidden");
    upNextOverlay.hidden = false;
    renderUpNext();
    playNextButton.focus();
    state.autoplayTimer = window.setInterval(function () {
      state.autoplayCountdown -= 1;
      renderUpNext();
      if (state.autoplayCountdown <= 0) playNextVideo();
    }, 1000);
  }

  function openVideo(videoId, startAt) {
    var video = tvVideos().find(function (item) {
      return item.id === videoId;
    });
    if (!video) return;
    clearAutoplayCountdown();
    state.currentVideo = video;
    state.pendingStartAt = Number(startAt) || 0;
    player.src = video.url;
    playerTitle.textContent = video.title;
    playerMeta.textContent = video.channel;
    playerQuality.textContent = qualityLabel(video);
    show(playerPanel);
    history.pushState({ tvPlayer: true }, "", "#player");
    player.focus();
    player.play().catch(function () {});
    updatePlayerControls();
    updateAdjacentButtons();
    showPlayerOverlay();
  }

  function closePlayer() {
    if (playerPanel.hidden) return;
    clearAutoplayCountdown();
    player.pause();
    var progressSave = saveProgress(true);
    player.removeAttribute("src");
    player.load();
    progressSave.then(loadProgress).then(function () {
      show(libraryPanel);
      render();
      restoreLibraryFocus();
    });
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

  function loadProgress() {
    return api("/api/progress").then(function (result) {
      state.progress = result.progress || [];
      state.watchedVideoIds = result.watchedVideoIds || [];
    }).catch(function () {
      state.progress = [];
      state.watchedVideoIds = [];
    });
  }

  function loadProfiles() {
    return api("/api/tv/profiles").then(function (result) {
      state.profiles = result.profiles || [];
      state.selectedProfile = localStorage.getItem("pt-tv-profile") || result.selectedProfile || "";
      renderProfiles();
      if (state.selectedProfile && state.profiles.some(function (profile) { return (profile.key || profile.username) === state.selectedProfile; })) {
        return selectProfile(state.selectedProfile, true);
      }
      show(profilePanel);
      focusFirst(".profile-card");
    });
  }

  function selectProfile(profileKey, quiet) {
    return api("/api/tv/profile", {
      method: "POST",
      body: JSON.stringify({ profileKey: profileKey })
    }).then(function () {
      state.selectedProfile = profileKey;
      localStorage.setItem("pt-tv-profile", profileKey);
      loadBrandName();
      return loadLibrary();
    }).catch(function (error) {
      if (!quiet) loginStatus.textContent = error.message;
    });
  }

  function loadLibrary() {
    return Promise.all([
      api("/api/library"),
      loadProgress()
    ]).then(function (results) {
      state.library = results[0];
      show(libraryPanel);
      render();
    });
  }

  function boot() {
    applyTheme();
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
        password: document.querySelector("#passwordInput").value,
        remember: true
      })
    }).then(loadProfiles).catch(function (error) {
      loginStatus.textContent = error.message;
    });
  });

  retryButton.addEventListener("click", function () {
    startupPanel.hidden = false;
    boot();
  });

  window.addEventListener("online", function () {
    if (!offlinePanel.hidden) boot();
  });
  window.addEventListener("offline", function () {
    showOffline("The TV network connection is offline.");
  });

  tabs.querySelectorAll("[data-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      state.lastLibraryFocus = null;
      state.filter = button.dataset.filter;
      state.channelId = "";
      render();
    });
  });

  tabs.querySelector("[data-action='refresh']").addEventListener("click", function () {
    api("/api/rescan", { method: "POST" }).then(loadLibrary).catch(function (error) {
      showOffline(error.message || "Refresh failed.");
    });
  });

  player.addEventListener("timeupdate", function () {
    updatePlayerControls();
    saveProgress(false);
  });
  player.addEventListener("loadedmetadata", function () {
    if (state.pendingStartAt > 5 && player.duration && state.pendingStartAt < player.duration - 5) {
      player.currentTime = state.pendingStartAt;
    }
    state.pendingStartAt = 0;
    updatePlayerControls();
  });
  player.addEventListener("play", updatePlayerControls);
  player.addEventListener("pause", function () {
    updatePlayerControls();
    saveProgress(true);
  });
  player.addEventListener("ended", function () {
    updatePlayerControls();
    if (state.currentVideo) state.watchedVideoIds = Array.from(new Set([].concat(state.watchedVideoIds || [], [state.currentVideo.id])));
    saveProgress(true);
    var next = nextAutoplayVideo();
    if (next) showUpNext(next);
  });
  player.addEventListener("error", function () {
    showOffline("The video stream disconnected or could not be played.");
  });
  player.addEventListener("mousemove", showPlayerOverlay);
  player.addEventListener("click", showPlayerOverlay);
  playerAction.addEventListener("click", togglePlayback);
  playNextButton.addEventListener("click", playNextVideo);
  cancelNextButton.addEventListener("click", cancelAutoplay);
  previousVideoButton.addEventListener("click", function () {
    playAdjacent("previous", false);
  });
  nextVideoButton.addEventListener("click", function () {
    playAdjacent("next", true);
  });
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
      if (!upNextOverlay.hidden) {
        if (isOk && document.activeElement && document.activeElement.click) {
          document.activeElement.click();
          event.preventDefault();
          return;
        }
        if (arrows[key]) {
          moveFocus(arrows[key]);
          event.preventDefault();
          return;
        }
        if (isBack) {
          cancelAutoplay();
          event.preventDefault();
          return;
        }
      }
      if (isOk) {
        if (document.activeElement && document.activeElement !== player && document.activeElement.click) {
          document.activeElement.click();
          event.preventDefault();
          return;
        }
        togglePlayback();
        event.preventDefault();
        return;
      }
      if ((key === "ArrowLeft" || key === "ArrowRight") && playerControlFocused()) {
        showPlayerOverlay();
        moveFocus(arrows[key]);
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
        if (playerControlFocused()) moveFocus(arrows[key]);
        else focusPlayerControls();
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

    if (!libraryPanel.hidden && isBack && (state.filter === "channel" || state.filter === "channels")) {
      state.suppressNextPop = true;
      if (history.state && history.state.tvView === "channel") history.back();
      goHome();
      event.preventDefault();
    } else if (!profilePanel.hidden && isBack) {
      show(libraryPanel);
      restoreLibraryFocus();
      event.preventDefault();
    }
  });

  window.addEventListener("popstate", function () {
    if (state.suppressNextPop) {
      state.suppressNextPop = false;
      return;
    }
    if (!playerPanel.hidden) {
      closePlayer();
      return;
    }
    if (!libraryPanel.hidden && (state.filter === "channel" || state.filter === "channels")) {
      goHome();
    }
  });

  boot();
}());
