function isYouTubeWatchPage(): boolean {
  return (
    window.location.hostname === "www.youtube.com" &&
    window.location.pathname === "/watch"
  );
}

if (isYouTubeWatchPage()) {
  console.log("Engagement detector active");
}
