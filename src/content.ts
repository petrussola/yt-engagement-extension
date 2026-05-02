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

let removeEngageGuardListeners: (() => void) | undefined;
let commentsObserver: MutationObserver | undefined;
let previousPlayerContainerPosition: string | undefined;
let commentsRerenderTimeout: number | undefined;
let forceWarningInterval: number | undefined;

const FORCE_WARNING_STORAGE_KEY = "engageguard:forceWarning";
const METHODOLOGY_URL =
  "https://github.com/petrussola/engageguard#classification";

function getElementTextOrLabel(element: Element | null): string | undefined {
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

function extractVisibleEngagementMetrics(): VisibleEngagementMetrics {
  const likeButton = Array.from(document.querySelectorAll("button")).find(
    (button) => {
      const label = button.getAttribute("aria-label") ?? "";

      return /like this video/i.test(label);
    },
  );
  const commentCountElement = document.querySelector(
    "#comments #count yt-formatted-string, #comments #count",
  );
  const viewCountText = getFirstElementTextOrLabel([
    "ytd-watch-metadata #info-container #view-count",
    "ytd-watch-metadata #info-container",
    "ytd-watch-metadata ytd-watch-info-text",
    "ytd-watch-metadata #bottom-row",
  ]);
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

function getFallbackAnalysisForBypass(): EngagementAnalysis {
  return {
    views: 100_000,
    likes: 800,
    likeRate: 0.008,
    engagementRate: 0.008,
    classification: "suspiciously-low",
    commentsUnavailable: true,
  };
}

function renderEngagementWarning(): boolean {
  const player = document.querySelector<HTMLElement>("#movie_player");
  const playerContainer = document.querySelector<HTMLElement>("#player");
  const metadata = document.querySelector<HTMLElement>(
    "#below ytd-watch-metadata",
  );

  if (!player || !playerContainer || !metadata) {
    return false;
  }

  removeEngageGuardListeners?.();
  document.querySelector("#engageguard-warning")?.remove();
  document.querySelector("#engageguard-player-border")?.remove();
  if (previousPlayerContainerPosition !== undefined) {
    playerContainer.style.position = previousPlayerContainerPosition;
    previousPlayerContainerPosition = undefined;
  }

  const metrics = extractVisibleEngagementMetrics();
  const forceWarning = isForceWarningEnabled();
  const analysis =
    calculateEngagement(metrics) ??
    (forceWarning ? getFallbackAnalysisForBypass() : undefined);
  console.debug("EngageGuard visible engagement metrics", metrics);
  console.debug("EngageGuard engagement analysis", analysis);

  if (!analysis) {
    return false;
  }

  const severity =
    getWarningSeverity(analysis.classification) ??
    (forceWarning ? "suspiciously-low" : undefined);

  if (!severity) {
    return true;
  }

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

  return true;
}

function waitForWatchDomAndInject(attempt = 1): void {
  if (renderEngagementWarning()) {
    return;
  }

  if (attempt >= 40) {
    return;
  }

  window.setTimeout(() => waitForWatchDomAndInject(attempt + 1), 250);
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
  }, 500);
}

function watchCommentsCount(): void {
  commentsObserver?.disconnect();

  const commentsCountElement = document.querySelector("#comments #count");

  if (!commentsCountElement) {
    window.setTimeout(watchCommentsCount, 1_000);
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
    }, 250);
  });

  commentsObserver.observe(commentsCountElement, {
    characterData: true,
    childList: true,
    subtree: true,
  });
}

if (isYouTubeWatchPage()) {
  console.log("EngageGuard active on YouTube video", {
    forceWarning: isForceWarningEnabled(),
    videoId: new URL(window.location.href).searchParams.get("v"),
  });
  waitForWatchDomAndInject();
  watchForceWarningBypass();
  watchCommentsCount();
}
