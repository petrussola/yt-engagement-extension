import {
  calculateEngagement,
  getWarningSeverity,
  getWarningText,
  parseFirstYouTubeCount,
  parseFirstYouTubeCountWithLabel,
  parseYouTubeCount,
  parseYouTubeAgeDays,
  parseYouTubeCountWithLabel,
  type EngagementAnalysis,
  type VisibleEngagementMetrics,
  type WarningSeverity,
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
const DEBUG_DETAILS_STORAGE_KEY = "engageguard:debugDetails";
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
type PageEngagementAnalysis = {
  metrics: VisibleEngagementMetrics;
  debugSources: EngagementDebugSources;
  analysis?: EngagementAnalysis;
};
type EngagementDebugSources = {
  age: string[];
  views: string[];
  likes: string[];
  comments: string[];
};
type BannerSeverity = WarningSeverity | "passing";

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

function getElementCountCandidateTexts(
  element: Element | null | undefined,
): Array<string | null | undefined> {
  if (!element) {
    return [];
  }

  return [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.textContent,
  ];
}

function compactDebugSources(
  texts: Array<string | null | undefined>,
): string[] {
  return texts
    .map((text) => text?.replace(/\s+/g, " ").trim())
    .filter((text): text is string => text !== undefined && text.length > 0);
}

function getFirstElementTextOrLabel(selectors: string[]): string | undefined {
  return selectors
    .map((selector) =>
      getElementTextOrLabel(document.querySelector(selector))?.trim(),
    )
    .find((text) => text !== undefined && text.length > 0);
}

function findLikeButton(): HTMLButtonElement | undefined {
  const buttons = Array.from(document.querySelectorAll("button"));
  const likeButton = buttons.find((button) => {
    const label = button.getAttribute("aria-label") ?? "";

    return /like/i.test(label) && !/dislike/i.test(label);
  });

  if (likeButton) {
    return likeButton;
  }

  const segmentedLikeButton = document.querySelector<HTMLButtonElement>(
    "segmented-like-dislike-button-view-model button",
  );

  if (segmentedLikeButton) {
    return segmentedLikeButton;
  }

  return document.querySelector<HTMLButtonElement>(
    "like-button-view-model button",
  );
}

function extractVisibleEngagementMetrics(): {
  debugSources: EngagementDebugSources;
  metrics: VisibleEngagementMetrics;
} {
  const likeButton = findLikeButton();
  const commentCountElement = document.querySelector(
    "#comments #count yt-formatted-string, #comments #count",
  );
  const viewCountText = getFirstElementTextOrLabel(VIEW_COUNT_SELECTORS);
  const likeCountTexts = getElementCountCandidateTexts(likeButton);
  const commentCountTexts = getElementCountCandidateTexts(commentCountElement);

  return {
    debugSources: {
      age: compactDebugSources([viewCountText]),
      views: compactDebugSources([viewCountText]),
      likes: compactDebugSources(likeCountTexts),
      comments: compactDebugSources(commentCountTexts),
    },
    metrics: {
      views:
        parseYouTubeCountWithLabel(viewCountText, "views") ??
        parseYouTubeCount(viewCountText),
      likes: parseFirstYouTubeCount(likeCountTexts),
      comments: parseFirstYouTubeCountWithLabel(commentCountTexts, "comments"),
      ageDays: parseYouTubeAgeDays(viewCountText),
    },
  };
}

function isForceWarningEnabled(): boolean {
  return window.localStorage.getItem(FORCE_WARNING_STORAGE_KEY) === "true";
}

function isDebugDetailsEnabled(): boolean {
  return window.localStorage.getItem(DEBUG_DETAILS_STORAGE_KEY) === "true";
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
    ageGateActive: false,
    likesUnavailable: false,
    commentsUnavailable: true,
    signalConfidence: "limited",
  };
}

function getAnalysisForCurrentPage(): PageEngagementAnalysis {
  const { metrics, debugSources } = extractVisibleEngagementMetrics();
  const forceWarning = isForceWarningEnabled();
  const analysis =
    calculateEngagement(metrics) ??
    (forceWarning ? getFallbackAnalysisForBypass() : undefined);

  console.debug("EngageGuard visible engagement metrics", metrics);
  console.debug("EngageGuard engagement analysis", analysis);

  return { metrics, debugSources, analysis };
}

function formatDebugCount(count: number | undefined): string {
  return count === undefined ? "missing" : count.toLocaleString("en-US");
}

function getDebugCalculationText(analysis: EngagementAnalysis): string {
  const engagementPercent = (analysis.engagementRate * 100).toFixed(4);

  if (analysis.commentsUnavailable) {
    return `${formatDebugCount(analysis.likes)} / ${formatDebugCount(analysis.views)} = ${analysis.engagementRate} (${engagementPercent}%)`;
  }

  if (analysis.likesUnavailable) {
    return `${formatDebugCount(analysis.comments)} / ${formatDebugCount(analysis.views)} = ${analysis.engagementRate} (${engagementPercent}%)`;
  }

  return `(${formatDebugCount(analysis.likes)} + ${formatDebugCount(analysis.comments)}) / ${formatDebugCount(analysis.views)} = ${analysis.engagementRate} (${engagementPercent}%)`;
}

function getDebugText(
  metrics: VisibleEngagementMetrics,
  debugSources: EngagementDebugSources,
  analysis: EngagementAnalysis | undefined,
): string {
  const comments = formatDebugCount(metrics.comments);
  const sourceDetails = [
    `Sources: views=[${debugSources.views.join(" | ")}]`,
    `age=[${debugSources.age.join(" | ")}]`,
    `likes=[${debugSources.likes.join(" | ")}]`,
    `comments=[${debugSources.comments.join(" | ")}]`,
  ].join("; ");
  const formula =
    metrics.likes === undefined && metrics.comments !== undefined
      ? "comments / views"
      : metrics.comments === undefined
        ? "likes / views"
        : "(likes + comments) / views";

  if (!analysis) {
    return [
      "EngageGuard debug",
      `Parsed: views=${formatDebugCount(metrics.views)}, likes=${formatDebugCount(metrics.likes)}, comments=${comments}`,
      sourceDetails,
      "Result: not enough parsed data to calculate engagement",
    ].join("\n");
  }

  return [
    "EngageGuard debug",
    `Parsed: views=${formatDebugCount(analysis.views)}, likes=${formatDebugCount(analysis.likes)}, comments=${comments}`,
    sourceDetails,
    `Formula: ${formula}`,
    `Calculation: ${getDebugCalculationText(analysis)}`,
    `Age: ${analysis.ageDays === undefined ? "missing" : `${analysis.ageDays} days`}; ageGate=${analysis.ageGateActive ? "active" : "inactive"}`,
    `Classification: ${analysis.classification}; confidence=${analysis.signalConfidence}`,
  ].join("\n");
}

function getBannerColor(severity: BannerSeverity): string {
  if (severity === "passing") {
    return "#16a34a";
  }

  if (severity === "highly-unusual") {
    return "#dc2626";
  }

  if (severity === "suspiciously-low") {
    return "#ea580c";
  }

  return "#f59e0b";
}

function getBannerTextColor(severity: BannerSeverity): string {
  return severity === "low" ? "#431407" : "#ffffff";
}

function getDebugBannerMessage(
  analysis: EngagementAnalysis | undefined,
): string {
  if (!analysis) {
    return "EngageGuard debug · no engagement score available";
  }

  if (getWarningSeverity(analysis)) {
    return getWarningText(analysis);
  }

  return `EngageGuard debug · engagement passes threshold · Engagement: ${(analysis.engagementRate * 100).toFixed(1)}%`;
}

function renderWarningBanner(
  metadata: HTMLElement,
  metrics: VisibleEngagementMetrics,
  debugSources: EngagementDebugSources,
  analysis: EngagementAnalysis | undefined,
  severity: BannerSeverity,
): void {
  const debugDetails = isDebugDetailsEnabled();
  const severityColor = getBannerColor(severity);
  const severityTextColor = getBannerTextColor(severity);
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
  warningMessage.textContent = debugDetails
    ? getDebugBannerMessage(analysis)
    : analysis
      ? getWarningText(analysis)
      : "EngageGuard debug · no engagement score available";
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

  const textContainer = document.createElement("span");
  textContainer.style.cssText = [
    "min-width: 0",
    "flex: 1",
    "display: flex",
    "flex-direction: column",
    "gap: 4px",
  ].join(";");
  textContainer.append(warningMessage);

  if (debugDetails) {
    const debugDetailsText = document.createElement("code");
    debugDetailsText.textContent = getDebugText(
      metrics,
      debugSources,
      analysis,
    );
    debugDetailsText.style.cssText = [
      "display: block",
      "font: 500 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      "white-space: pre-wrap",
      "opacity: 0.95",
    ].join(";");
    textContainer.append(debugDetailsText);
  }

  warning.append(textContainer, methodologyLink);
  metadata.before(warning);
}

function renderPlayerBorder(
  playerContainer: HTMLElement,
  severity: BannerSeverity,
): void {
  const severityColor = getBannerColor(severity);

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

  const { metrics, debugSources, analysis } = getAnalysisForCurrentPage();

  if (!analysis && !isDebugDetailsEnabled()) {
    return false;
  }

  const severity =
    (analysis ? getWarningSeverity(analysis) : undefined) ??
    (isForceWarningEnabled() || isDebugDetailsEnabled()
      ? "passing"
      : undefined);

  if (!severity) {
    return true;
  }

  renderWarningBanner(metadata, metrics, debugSources, analysis, severity);
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
  let wasDebugDetailsEnabled = isDebugDetailsEnabled();

  forceWarningInterval = window.setInterval(() => {
    const forceWarningEnabled = isForceWarningEnabled();
    const debugDetailsEnabled = isDebugDetailsEnabled();

    if (
      (forceWarningEnabled && !wasForceWarningEnabled) ||
      debugDetailsEnabled !== wasDebugDetailsEnabled
    ) {
      waitForWatchDomAndInject();
    }

    wasForceWarningEnabled = forceWarningEnabled;
    wasDebugDetailsEnabled = debugDetailsEnabled;
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
      const commentCountTexts =
        getElementCountCandidateTexts(commentsCountElement);

      if (
        parseFirstYouTubeCountWithLabel(commentCountTexts, "comments") !==
        undefined
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
