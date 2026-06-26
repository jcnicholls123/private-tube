(function () {
  const storageKey = "privatetube-url";
  const input = document.querySelector("#serverUrl");
  const openButton = document.querySelector("#openButton");
  const saveButton = document.querySelector("#saveButton");
  const clearButton = document.querySelector("#clearButton");
  const status = document.querySelector("#status");

  function normalizeUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    try {
      const url = new URL(trimmed);
      const pathname = url.pathname.replace(/\/$/, "");
      return url.origin + (pathname && pathname !== "/tv.html" ? pathname : "");
    } catch {
      return "";
    }
  }

  function tvUrl(baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/tv.html`;
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
    const focusables = [...document.querySelectorAll("input, button")];
    const index = focusables.indexOf(document.activeElement);
    const next = focusables[Math.max(0, Math.min(focusables.length - 1, index + direction))];
    next?.focus();
  }

  input.value = localStorage.getItem(storageKey) || "";
  if (input.value) setStatus("Saved URL loaded. Press Open.");

  openButton.addEventListener("click", openPrivateTube);
  saveButton.addEventListener("click", saveUrl);
  clearButton.addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    input.value = "";
    input.focus();
    setStatus("Cleared.");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && document.activeElement !== input) {
      document.activeElement.click();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") moveFocus(1);
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") moveFocus(-1);
  });
}());
