import {
  calculateEngagement,
  getSeverityColor,
  getSeverityTextColor,
  getWarningSeverity,
  getWarningText,
  parseYouTubeCount,
  parseYouTubeCountWithLabel,
  type EngagementAnalysis,
  type VisibleEngagementMetrics,
} from "./engagement";

function isYouTubeWatchPage(): boolean {
  const url = new URL(window.location.href);

  return (
    url.hostname === "www.youtube.com" &&
    url.pathname === "/watch" &&
    url.searchParams.has("v")
  );
}

let commentsObserver: MutationObserver | undefined;
let previousPlayerContainerPosition: string | undefined;
let commentsRerenderTimeout: number | undefined;
let forceWarningInterval: number | undefined;
let watchDomRetryTimeout: number | undefined;
let commentsCountRetryTimeout: number | undefined;
let currentVideoId: string | undefined;

const FORCE_WARNING_STORAGE_KEY = "engageguard:forceWarning";
const METHODOLOGY_URL =
  "https://github.com/petrussola/engageguard#classification";
const WATCH_DOM_RETRY_LIMIT = 40;
const WATCH_DOM_RETRY_DELAY_MS = 250;
const COMMENT_COUNT_RETRY_DELAY_MS = 1_000;
const COMMENT_RERENDER_DELAY_MS = 250;
const FORCE_WARNING_POLL_DELAY_MS = 500;
const ROUTE_POLL_DELAY_MS = 500;
const VIEW_COUNT_SELECTORS = [
  "ytd-watch-metadata #info-container #view-count",
  "ytd-watch-metadata #info-container",
  "ytd-watch-metadata ytd-watch-info-text",
  "ytd-watch-metadata #bottom-row",
];

function getElementTextOrLabel(
  element: Element | null | undefined,
): string | undefined {
  if (!element) {
    return undefined;
  }

  return (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.textContent ??
    undefined
  );
}

function getFirstElementTextOrLabel(selectors: string[]): string | undefined {
  return selectors
    .map((selector) =>
      getElementTextOrLabel(document.querySelector(selector))?.trim(),
    )
    .find((text) => text !== undefined && text.length > 0);
}

function findLikeButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((button) => {
    const label = button.getAttribute("aria-label") ?? "";

    return /like this video/i.test(label);
  });
}

function extractVisibleEngagementMetrics(): VisibleEngagementMetrics {
  const likeButton = findLikeButton();
  const commentCountElement = document.querySelector(
    "#comments #count yt-formatted-string, #comments #count",
  );
  const viewCountText = getFirstElementTextOrLabel(VIEW_COUNT_SELECTORS);
  const commentCountText = getElementTextOrLabel(commentCountElement);

  return {
    views:
      parseYouTubeCountWithLabel(viewCountText, "views") ??
      parseYouTubeCount(viewCountText),
    likes: parseYouTubeCount(getElementTextOrLabel(likeButton)),
    comments: parseYouTubeCountWithLabel(commentCountText, "comments"),
  };
}

function isForceWarningEnabled(): boolean {
  return window.localStorage.getItem(FORCE_WARNING_STORAGE_KEY) === "true";
}

function getWatchVideoId(): string | undefined {
  const url = new URL(window.location.href);

  if (
    url.hostname !== "www.youtube.com" ||
    url.pathname !== "/watch" ||
    !url.searchParams.has("v")
  ) {
    return undefined;
  }

  return url.searchParams.get("v") ?? undefined;
}

function isWatchDomForVideo(videoId: string | undefined): boolean {
  if (!videoId) {
    return true;
  }

  const watchContainer = document.querySelector("ytd-watch-flexy");
  const renderedVideoId = watchContainer?.getAttribute("video-id");

  return !renderedVideoId || renderedVideoId === videoId;
}

function clearScheduledWork(): void {
  window.clearTimeout(watchDomRetryTimeout);
  window.clearTimeout(commentsCountRetryTimeout);
  window.clearTimeout(commentsRerenderTimeout);
}

function cleanupEngageGuardUi(): void {
  document.querySelector("#engageguard-warning")?.remove();
  document.querySelector("#engageguard-player-border")?.remove();

  if (previousPlayerContainerPosition !== undefined) {
    const playerContainer = document.querySelector<HTMLElement>("#player");

    if (playerContainer) {
      playerContainer.style.position = previousPlayerContainerPosition;
    }

    previousPlayerContainerPosition = undefined;
  }
}

function getFallbackAnalysisForBypass(): EngagementAnalysis {
  return {
    views: 100_000,
    likes: 800,
    likeRate: 0.008,
    engagementRate: 0.008,
    classification: "suspiciously-low",
    commentsUnavailable: true,
    signalConfidence: "limited",
  };
}

function getAnalysisForCurrentPage(): EngagementAnalysis | undefined {
  const metrics = extractVisibleEngagementMetrics();
  const forceWarning = isForceWarningEnabled();
  const analysis =
    calculateEngagement(metrics) ??
    (forceWarning ? getFallbackAnalysisForBypass() : undefined);

  console.debug("EngageGuard visible engagement metrics", metrics);
  console.debug("EngageGuard engagement analysis", analysis);

  return analysis;
}

function renderWarningBanner(
  metadata: HTMLElement,
  analysis: EngagementAnalysis,
  severity: NonNullable<ReturnType<typeof getWarningSeverity>>,
): void {
  const severityColor = getSeverityColor(severity);
  const severityTextColor = getSeverityTextColor(severity);
  const warning = document.createElement("div");
  warning.id = "engageguard-warning";
  warning.style.cssText = [
    "box-sizing: border-box",
    "width: 100%",
    "margin: -12px 0 8px",
    "padding: 6px 10px",
    "display: flex",
    "align-items: center",
    "gap: 12px",
    `background: ${severityColor}`,
    "border: 0",
    `color: ${severityTextColor}`,
    "font: 700 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "white-space: pre-line",
  ].join(";");

  const warningMessage = document.createElement("span");
  warningMessage.textContent = getWarningText(analysis);
  warningMessage.style.cssText = ["min-width: 0", "flex: 1"].join(";");

  const methodologyLink = document.createElement("a");
  methodologyLink.href = METHODOLOGY_URL;
  methodologyLink.target = "_blank";
  methodologyLink.rel = "noopener noreferrer";
  methodologyLink.textContent = "Methodology";
  methodologyLink.style.cssText = [
    "flex: 0 0 auto",
    `color: ${severityTextColor}`,
    "font: inherit",
    "text-decoration: underline",
    "text-underline-offset: 2px",
  ].join(";");

  warning.append(warningMessage, methodologyLink);
  metadata.before(warning);
}

function renderPlayerBorder(
  playerContainer: HTMLElement,
  severity: NonNullable<ReturnType<typeof getWarningSeverity>>,
): void {
  const severityColor = getSeverityColor(severity);

  previousPlayerContainerPosition = playerContainer.style.position;
  if (!playerContainer.style.position) {
    playerContainer.style.position = "relative";
  }

  const playerBorder = document.createElement("div");
  playerBorder.id = "engageguard-player-border";
  playerBorder.style.cssText = [
    "position: absolute",
    "inset: 0",
    "box-sizing: border-box",
    `border: 4px solid ${severityColor}`,
    "border-radius: 0",
    "pointer-events: none",
    "z-index: 1",
  ].join(";");
  playerContainer.append(playerBorder);
}

function renderEngagementWarning(videoId: string | undefined): boolean {
  const player = document.querySelector<HTMLElement>("#movie_player");
  const playerContainer = document.querySelector<HTMLElement>("#player");
  const metadata = document.querySelector<HTMLElement>(
    "#below ytd-watch-metadata",
  );

  if (
    !player ||
    !playerContainer ||
    !metadata ||
    !isWatchDomForVideo(videoId)
  ) {
    return false;
  }

  cleanupEngageGuardUi();

  const analysis = getAnalysisForCurrentPage();

  if (!analysis) {
    return false;
  }

  const severity =
    getWarningSeverity(analysis) ??
    (isForceWarningEnabled() ? "suspiciously-low" : undefined);

  if (!severity) {
    return true;
  }

  renderWarningBanner(metadata, analysis, severity);
  renderPlayerBorder(playerContainer, severity);

  return true;
}

function waitForWatchDomAndInject(videoId = currentVideoId, attempt = 1): void {
  window.clearTimeout(watchDomRetryTimeout);

  if (renderEngagementWarning(videoId)) {
    return;
  }

  if (attempt >= WATCH_DOM_RETRY_LIMIT) {
    return;
  }

  watchDomRetryTimeout = window.setTimeout(
    () => waitForWatchDomAndInject(videoId, attempt + 1),
    WATCH_DOM_RETRY_DELAY_MS,
  );
}

function watchForceWarningBypass(): void {
  window.clearInterval(forceWarningInterval);
  let wasForceWarningEnabled = isForceWarningEnabled();

  forceWarningInterval = window.setInterval(() => {
    const forceWarningEnabled = isForceWarningEnabled();

    if (forceWarningEnabled && !wasForceWarningEnabled) {
      waitForWatchDomAndInject();
    }

    wasForceWarningEnabled = forceWarningEnabled;
  }, FORCE_WARNING_POLL_DELAY_MS);
}

function watchCommentsCount(): void {
  commentsObserver?.disconnect();

  const commentsCountElement = document.querySelector("#comments #count");

  if (!commentsCountElement) {
    window.clearTimeout(commentsCountRetryTimeout);
    commentsCountRetryTimeout = window.setTimeout(
      watchCommentsCount,
      COMMENT_COUNT_RETRY_DELAY_MS,
    );
    return;
  }

  commentsObserver = new MutationObserver(() => {
    window.clearTimeout(commentsRerenderTimeout);

    commentsRerenderTimeout = window.setTimeout(() => {
      const commentCountText = getElementTextOrLabel(commentsCountElement);

      if (
        parseYouTubeCountWithLabel(commentCountText, "comments") !== undefined
      ) {
        waitForWatchDomAndInject();
        commentsObserver?.disconnect();
      }
    }, COMMENT_RERENDER_DELAY_MS);
  });

  commentsObserver.observe(commentsCountElement, {
    characterData: true,
    childList: true,
    subtree: true,
  });
}

function initializeCurrentWatchPage(): void {
  const videoId = currentVideoId;

  clearScheduledWork();
  commentsObserver?.disconnect();
  cleanupEngageGuardUi();

  if (!videoId || !isYouTubeWatchPage()) {
    return;
  }

  console.log("EngageGuard active on YouTube video", {
    forceWarning: isForceWarningEnabled(),
    videoId,
  });
  waitForWatchDomAndInject(videoId);
  watchCommentsCount();
}

function handleYouTubeRouteChange(): void {
  const nextVideoId = getWatchVideoId();

  if (nextVideoId === currentVideoId) {
    return;
  }

  currentVideoId = nextVideoId;
  initializeCurrentWatchPage();
}

watchForceWarningBypass();
handleYouTubeRouteChange();
document.addEventListener("yt-navigate-finish", handleYouTubeRouteChange);
window.addEventListener("popstate", handleYouTubeRouteChange);
window.setInterval(handleYouTubeRouteChange, ROUTE_POLL_DELAY_MS);
