function isYouTubeWatchPage(): boolean {
  const url = new URL(window.location.href);

  return (
    url.hostname === "www.youtube.com" &&
    url.pathname === "/watch" &&
    url.searchParams.has("v")
  );
}

if (isYouTubeWatchPage()) {
  console.log("EngageGuard active on YouTube video", {
    videoId: new URL(window.location.href).searchParams.get("v"),
  });
}
