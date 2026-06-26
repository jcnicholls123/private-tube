(function () {
  var storageKey = "privatetube-url";
  var defaultServerUrl = "http://10.69.24.3:3020";
  var input = document.querySelector("#serverUrl");
  var openButton = document.querySelector("#openButton");
  var saveButton = document.querySelector("#saveButton");
  var changeButton = document.querySelector("#changeButton");
  var clearButton = document.querySelector("#clearButton");
  var status = document.querySelector("#status");
  var introText = document.querySelector("#introText");
  var headline = document.querySelector("#headline");
  var countdownRing = document.querySelector("#countdownRing");
  var countdownText = document.querySelector("#countdownText");
  var autoOpenTimer = null;
  var countdownTimer = null;
  var countdownSeconds = 3;

  function normalizeUrl(value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) return "";
    try {
      var url = new URL(trimmed);
      var pathname = url.pathname.replace(/\/$/, "");
      return url.origin + (pathname && pathname !== "/tv.html" ? pathname : "");
    } catch (error) {
      return "";
    }
  }

  function tvUrl(baseUrl) {
    return baseUrl.replace(/\/$/, "") + "/tv.html";
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function stopAutoOpen() {
    window.clearTimeout(autoOpenTimer);
    window.clearInterval(countdownTimer);
    autoOpenTimer = null;
    countdownTimer = null;
    countdownRing.style.setProperty("--progress", "0%");
  }

  function setCountdown(seconds) {
    countdownSeconds = Math.max(0, seconds);
    countdownText.textContent = String(countdownSeconds);
    countdownRing.style.setProperty("--progress", countdownSeconds / 3 * 100 + "%");
  }

  function saveUrl() {
    var url = normalizeUrl(input.value);
    if (!url) {
      setStatus("Enter a valid internal PrivateTube URL.");
      return "";
    }
    localStorage.setItem(storageKey, url);
    input.value = url;
    setStatus("Saved.");
    return url;
  }

  function openPrivateTube(skipSave) {
    stopAutoOpen();
    var url = skipSave === true ? normalizeUrl(input.value) : saveUrl();
    if (!url) return;
    setStatus("Opening TV mode...");
    document.body.classList.add("launching");
    window.location.href = tvUrl(url);
  }

  function editUrl() {
    stopAutoOpen();
    headline.textContent = "Server settings";
    introText.textContent = "Edit the server URL, save it, then open TV mode.";
    input.disabled = false;
    input.focus();
    input.select();
    setStatus("Edit the internal URL, then Save or Open.");
  }

  function clearUrl() {
    stopAutoOpen();
    localStorage.removeItem(storageKey);
    input.disabled = false;
    input.value = "";
    headline.textContent = "Server settings";
    introText.textContent = "Enter your internal PrivateTube server address.";
    setStatus("Saved URL cleared.");
    input.focus();
  }

  function startAutoOpen() {
    stopAutoOpen();
    input.disabled = true;
    headline.textContent = "Opening TV mode";
    introText.textContent = "Saved server loaded. Use Open now, or change the address before launch.";
    setStatus("Auto-opening in 3 seconds.");
    setCountdown(3);
    countdownTimer = window.setInterval(function () {
      setCountdown(countdownSeconds - 1);
      if (countdownSeconds <= 0) {
        openPrivateTube(true);
      } else {
        setStatus("Auto-opening in " + countdownSeconds + " seconds.");
      }
    }, 1000);
    autoOpenTimer = window.setTimeout(function () {
      openPrivateTube(true);
    }, 3200);
  }

  function moveFocus(direction) {
    var focusables = Array.prototype.slice.call(document.querySelectorAll("input, button")).filter(function (item) {
      return !item.disabled;
    });
    var index = focusables.indexOf(document.activeElement);
    var next = focusables[Math.max(0, Math.min(focusables.length - 1, index + direction))];
    if (next) next.focus();
  }

  var savedUrl = localStorage.getItem(storageKey);
  input.value = savedUrl || defaultServerUrl;
  if (savedUrl) {
    startAutoOpen();
  } else {
    headline.textContent = "Server settings";
    introText.textContent = "Enter your internal PrivateTube server address.";
    setCountdown(0);
    input.focus();
  }

  openButton.addEventListener("click", openPrivateTube);
  saveButton.addEventListener("click", saveUrl);
  changeButton.addEventListener("click", editUrl);
  clearButton.addEventListener("click", clearUrl);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && document.activeElement !== input) {
      document.activeElement.click();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") moveFocus(1);
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") moveFocus(-1);
    if (event.key === "Escape" || event.key === "Backspace" || event.key === "BrowserBack") editUrl();
  });
}());
