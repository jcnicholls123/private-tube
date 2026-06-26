(function () {
  var storageKey = "privatetube-url";
  var input = document.querySelector("#serverUrl");
  var openButton = document.querySelector("#openButton");
  var saveButton = document.querySelector("#saveButton");
  var clearButton = document.querySelector("#clearButton");
  var status = document.querySelector("#status");

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
    const url = normalizeUrl(input.value);
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
    const url = saveUrl();
    if (!url) return;
    setStatus("Opening PrivateTube TV mode...");
    window.location.href = tvUrl(url);
  }

  function moveFocus(direction) {
    var focusables = Array.prototype.slice.call(document.querySelectorAll("input, button"));
    var index = focusables.indexOf(document.activeElement);
    var next = focusables[Math.max(0, Math.min(focusables.length - 1, index + direction))];
    if (next) next.focus();
  }

  input.value = localStorage.getItem(storageKey) || "";
  if (input.value) setStatus("Saved URL loaded. Press Open.");

  openButton.addEventListener("click", openPrivateTube);
  saveButton.addEventListener("click", saveUrl);
  clearButton.addEventListener("click", function () {
    localStorage.removeItem(storageKey);
    input.value = "";
    input.focus();
    setStatus("Cleared.");
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && document.activeElement !== input) {
      document.activeElement.click();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") moveFocus(1);
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") moveFocus(-1);
  });
}());
