function isYouTubeWatchPage(): boolean {
  const url = new URL(window.location.href);

  return (
    url.hostname === "www.youtube.com" &&
    url.pathname === "/watch" &&
    url.searchParams.has("v")
  );
}

let removeEngageGuardListeners: (() => void) | undefined;

type VisibleEngagementMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
};

type EngagementClassification =
  | "very-strong"
  | "strong"
  | "normal"
  | "low"
  | "suspiciously-low"
  | "highly-unusual";

type EngagementAnalysis = {
  views: number;
  likes: number;
  comments?: number;
  likeRate: number;
  commentRate?: number;
  engagementRate: number;
  classification: EngagementClassification;
  commentsUnavailable: boolean;
};

const FORCE_WARNING_STORAGE_KEY = "engageguard:forceWarning";
const FORCE_WARNING_QUERY_PARAM = "engageguardForceWarning";

type WarningSeverity = Extract<
  EngagementClassification,
  "low" | "suspiciously-low" | "highly-unusual"
>;

function parseYouTubeCount(
  text: string | null | undefined,
): number | undefined {
  if (!text) {
    return undefined;
  }

  const normalizedText = text.replace(/,/g, "").trim();
  const countMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);

  if (!countMatch) {
    return undefined;
  }

  const value = Number.parseFloat(countMatch[1]);
  const suffix = countMatch[2]?.toLowerCase();
  const multiplier =
    suffix === "k"
      ? 1_000
      : suffix === "m"
        ? 1_000_000
        : suffix === "b"
          ? 1_000_000_000
          : 1;

  return Math.round(value * multiplier);
}

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

function extractVisibleEngagementMetrics(): VisibleEngagementMetrics {
  const viewCountElement = document.querySelector(
    "ytd-watch-metadata #info-container #view-count",
  );
  const likeButton = Array.from(document.querySelectorAll("button")).find(
    (button) => {
      const label = button.getAttribute("aria-label") ?? "";

      return /like this video/i.test(label);
    },
  );
  const commentCountElement = document.querySelector(
    "#comments #count yt-formatted-string, #comments #count",
  );

  return {
    views: parseYouTubeCount(getElementTextOrLabel(viewCountElement)),
    likes: parseYouTubeCount(getElementTextOrLabel(likeButton)),
    comments: parseYouTubeCount(getElementTextOrLabel(commentCountElement)),
  };
}

function classifyEngagement(engagementRate: number): EngagementClassification {
  if (engagementRate >= 0.045) {
    return "very-strong";
  }

  if (engagementRate >= 0.035) {
    return "strong";
  }

  if (engagementRate >= 0.025) {
    return "normal";
  }

  if (engagementRate >= 0.01) {
    return "low";
  }

  if (engagementRate >= 0.005) {
    return "suspiciously-low";
  }

  return "highly-unusual";
}

function calculateEngagement(
  metrics: VisibleEngagementMetrics,
): EngagementAnalysis | undefined {
  if (!metrics.views || !metrics.likes || metrics.views < 1_000) {
    return undefined;
  }

  const commentsUnavailable = metrics.comments === undefined;
  const likeRate = metrics.likes / metrics.views;
  const commentRate = commentsUnavailable
    ? undefined
    : metrics.comments / metrics.views;
  const engagementRate = commentsUnavailable
    ? likeRate
    : (metrics.likes + metrics.comments) / metrics.views;

  return {
    views: metrics.views,
    likes: metrics.likes,
    comments: metrics.comments,
    likeRate,
    commentRate,
    engagementRate,
    classification: classifyEngagement(engagementRate),
    commentsUnavailable,
  };
}

function isForceWarningEnabled(): boolean {
  const url = new URL(window.location.href);

  return (
    window.localStorage.getItem(FORCE_WARNING_STORAGE_KEY) === "true" ||
    url.searchParams.get(FORCE_WARNING_QUERY_PARAM) === "true" ||
    url.searchParams.get(FORCE_WARNING_QUERY_PARAM) === "1"
  );
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

function getWarningSeverity(
  classification: EngagementClassification,
): WarningSeverity | undefined {
  if (
    classification === "low" ||
    classification === "suspiciously-low" ||
    classification === "highly-unusual"
  ) {
    return classification;
  }

  return undefined;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function getSeverityColor(severity: WarningSeverity): string {
  if (severity === "highly-unusual") {
    return "#dc2626";
  }

  if (severity === "suspiciously-low") {
    return "#ea580c";
  }

  return "#f59e0b";
}

function getSeverityTextColor(severity: WarningSeverity): string {
  return severity === "low" ? "#431407" : "#ffffff";
}

function getWarningText(analysis: EngagementAnalysis): string {
  const engagementText = `Engagement: ${formatPercent(analysis.engagementRate)}`;

  if (analysis.commentsUnavailable) {
    return [
      `This video has unusually low visible engagement for its view count · ${engagementText}`,
      "Comments unavailable; using likes/views only.",
    ].join("\n");
  }

  return `This video has unusually low likes/comments for its view count · ${engagementText}`;
}

function renderEngagementWarning(): boolean {
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

  const metrics = extractVisibleEngagementMetrics();
  const forceWarning = isForceWarningEnabled();
  const analysis =
    calculateEngagement(metrics) ??
    (forceWarning ? getFallbackAnalysisForBypass() : undefined);
  console.log("EngageGuard visible engagement metrics", metrics);
  console.log("EngageGuard engagement analysis", analysis);

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
  warning.textContent = getWarningText(analysis);
  warning.style.cssText = [
    "box-sizing: border-box",
    "width: 100%",
    "margin: -12px 0 8px",
    "padding: 6px 10px",
    `background: ${severityColor}`,
    "border: 0",
    `color: ${severityTextColor}`,
    "font: 700 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "white-space: pre-line",
  ].join(";");

  metadata.before(warning);

  const playerBorder = document.createElement("div");
  playerBorder.id = "engageguard-player-border";
  playerBorder.style.cssText = [
    "position: fixed",
    "box-sizing: border-box",
    `border: 4px solid ${severityColor}`,
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
  if (renderEngagementWarning()) {
    return;
  }

  if (attempt >= 40) {
    return;
  }

  window.setTimeout(() => waitForWatchDomAndInject(attempt + 1), 250);
}

function watchForceWarningBypass(): void {
  let wasForceWarningEnabled = isForceWarningEnabled();

  window.setInterval(() => {
    const forceWarningEnabled = isForceWarningEnabled();

    if (forceWarningEnabled && !wasForceWarningEnabled) {
      waitForWatchDomAndInject();
    }

    wasForceWarningEnabled = forceWarningEnabled;
  }, 500);
}

if (isYouTubeWatchPage()) {
  console.log("EngageGuard active on YouTube video", {
    forceWarning: isForceWarningEnabled(),
    videoId: new URL(window.location.href).searchParams.get("v"),
  });
  waitForWatchDomAndInject();
  watchForceWarningBypass();
}
