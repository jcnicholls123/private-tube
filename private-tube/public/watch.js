const params = new URLSearchParams(location.search);
const videoId = params.get("v");
const player = document.querySelector("#player");
const videoTitle = document.querySelector("#videoTitle");
const channelLink = document.querySelector("#channelLink");
const relatedGrid = document.querySelector("#relatedGrid");
const searchInput = document.querySelector("#searchInput");

function thumbnail(video) {
  if (video.thumbnail) return `<img src="${video.thumbnail}" alt="">`;
  return `<div class="thumb-fallback"><span>▶</span></div>`;
}

function renderRelated(videos, current) {
  const related = videos
    .filter((video) => video.id !== current.id && video.channelId === current.channelId)
    .slice(0, 12);

  relatedGrid.innerHTML = related.map((video) => `
    <article class="related-card">
      <a class="thumb" href="${video.watchUrl}">${thumbnail(video)}</a>
      <div>
        <a class="video-title" href="${video.watchUrl}">${video.title}</a>
        <p>${video.channel}</p>
      </div>
    </article>
  `).join("");
}

async function load() {
  const response = await fetch("/api/library");
  const library = await response.json();
  const video = library.videos.find((item) => item.id === videoId);

  if (!video) {
    videoTitle.textContent = "Video not found";
    return;
  }

  document.title = `${video.title} - PrivateTube`;
  player.src = video.url;
  videoTitle.textContent = video.title;
  channelLink.textContent = video.channel;
  channelLink.href = `/?channel=${encodeURIComponent(video.channelId)}`;
  renderRelated(library.videos, video);

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      location.href = `/?q=${encodeURIComponent(searchInput.value)}`;
    }
  });
}

load();
