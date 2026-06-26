(function () {
  var storageKey = "privatetube-url";
  var input = document.querySelector("#serverUrl");
  var openButton = document.querySelector("#openButton");
  var saveButton = document.querySelector("#saveButton");
  var changeButton = document.querySelector("#changeButton");
  var status = document.querySelector("#status");
  var introText = document.querySelector("#introText");
  var autoOpenTimer = null;

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

  function openPrivateTube() {
    var url = saveUrl();
    if (!url) return;
    setStatus("Opening PrivateTube TV mode...");
    window.location.href = tvUrl(url);
  }

  function editUrl() {
    window.clearTimeout(autoOpenTimer);
    input.disabled = false;
    input.focus();
    input.select();
    setStatus("Edit the internal URL, then Save or Open.");
  }

  function moveFocus(direction) {
    var focusables = Array.prototype.slice.call(document.querySelectorAll("input, button"));
    var index = focusables.indexOf(document.activeElement);
    var next = focusables[Math.max(0, Math.min(focusables.length - 1, index + direction))];
    if (next) next.focus();
  }

  input.value = localStorage.getItem(storageKey) || "";
  if (input.value) {
    input.disabled = true;
    introText.textContent = "Saved URL loaded. Opening TV mode automatically.";
    setStatus("Press Change now if you need to edit the server URL.");
    autoOpenTimer = window.setTimeout(openPrivateTube, 1600);
  }

  openButton.addEventListener("click", openPrivateTube);
  saveButton.addEventListener("click", saveUrl);
  changeButton.addEventListener("click", editUrl);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && document.activeElement !== input) {
      document.activeElement.click();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") moveFocus(1);
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") moveFocus(-1);
    if (event.key === "Escape" || event.key === "Backspace" || event.key === "BrowserBack") editUrl();
  });
}());
