function isYouTubeWatchPage(): boolean {
  const url = new URL(window.location.href);

  return (
    url.hostname === "www.youtube.com" &&
    url.pathname === "/watch" &&
    url.searchParams.has("v")
  );
}

let removeEngageGuardListeners: (() => void) | undefined;

function injectDummyWarning(): boolean {
  const player = document.querySelector<HTMLElement>("#movie_player");
  const metadata = document.querySelector<HTMLElement>(
    "#below ytd-watch-metadata",
  );

  if (!player || !metadata) {
    return false;
  }

  removeEngageGuardListeners?.();
  document.querySelector("#engageguard-warning")?.remove();
  document.querySelector("#engageguard-player-border")?.remove();

  const warning = document.createElement("div");
  warning.id = "engageguard-warning";
  warning.textContent =
    "This video has unusually low likes/comments for its view count · Engagement: 0.8%";
  warning.style.cssText = [
    "box-sizing: border-box",
    "width: 100%",
    "margin: -12px 0 8px",
    "padding: 6px 10px",
    "background: #fb923c",
    "border: 0",
    "color: #431407",
    "font: 700 14px/1.3 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  ].join(";");

  metadata.before(warning);

  const playerBorder = document.createElement("div");
  playerBorder.id = "engageguard-player-border";
  playerBorder.style.cssText = [
    "position: fixed",
    "box-sizing: border-box",
    "border: 4px solid #fb923c",
    "border-radius: 0",
    "pointer-events: none",
    "z-index: 2147483647",
  ].join(";");

  const positionEngageGuardUi = () => {
    const playerRect = player.getBoundingClientRect();

    playerBorder.style.top = `${playerRect.top}px`;
    playerBorder.style.left = `${playerRect.left}px`;
    playerBorder.style.width = `${playerRect.width}px`;
    playerBorder.style.height = `${playerRect.height}px`;
  };

  document.body.append(playerBorder);
  positionEngageGuardUi();
  window.addEventListener("resize", positionEngageGuardUi);
  window.addEventListener("scroll", positionEngageGuardUi, { passive: true });

  removeEngageGuardListeners = () => {
    window.removeEventListener("resize", positionEngageGuardUi);
    window.removeEventListener("scroll", positionEngageGuardUi);
  };

  return true;
}

function waitForWatchDomAndInject(attempt = 1): void {
  if (injectDummyWarning()) {
    return;
  }

  if (attempt >= 40) {
    return;
  }

  window.setTimeout(() => waitForWatchDomAndInject(attempt + 1), 250);
}

if (isYouTubeWatchPage()) {
  console.log("EngageGuard active on YouTube video", {
    videoId: new URL(window.location.href).searchParams.get("v"),
  });
  waitForWatchDomAndInject();
}
