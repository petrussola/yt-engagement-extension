export type VisibleEngagementMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
};

export type EngagementClassification =
  | "very-strong"
  | "strong"
  | "normal"
  | "low"
  | "suspiciously-low"
  | "highly-unusual";

export type EngagementAnalysis = {
  views: number;
  likes: number;
  comments?: number;
  likeRate: number;
  commentRate?: number;
  engagementRate: number;
  classification: EngagementClassification;
  commentsUnavailable: boolean;
  signalConfidence: "standard" | "limited";
};

export type WarningSeverity = Extract<
  EngagementClassification,
  "low" | "suspiciously-low" | "highly-unusual"
>;

const MIN_ANALYZABLE_VIEWS = 1_000;

function getCountMultiplier(suffix: string | undefined): number {
  if (suffix === "k") {
    return 1_000;
  }

  if (suffix === "m") {
    return 1_000_000;
  }

  if (suffix === "b") {
    return 1_000_000_000;
  }

  return 1;
}

export function parseYouTubeCount(
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

  return Math.round(value * getCountMultiplier(suffix));
}

export function parseYouTubeCountWithLabel(
  text: string | null | undefined,
  label: "views" | "comments",
): number | undefined {
  if (!text) {
    return undefined;
  }

  const normalizedText = text.replace(/,/g, "").replace(/\s+/g, " ").trim();
  const countMatch = normalizedText.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*([kmb])?\\s+${label}`, "i"),
  );

  if (!countMatch) {
    return undefined;
  }

  const value = Number.parseFloat(countMatch[1]);
  const suffix = countMatch[2]?.toLowerCase();

  return Math.round(value * getCountMultiplier(suffix));
}

export function classifyEngagement(
  engagementRate: number,
): EngagementClassification {
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

export function calculateEngagement(
  metrics: VisibleEngagementMetrics,
): EngagementAnalysis | undefined {
  if (
    metrics.views === undefined ||
    metrics.likes === undefined ||
    metrics.views < MIN_ANALYZABLE_VIEWS
  ) {
    return undefined;
  }

  const comments = metrics.comments;
  const commentsUnavailable = comments === undefined;
  const likeRate = metrics.likes / metrics.views;
  const commentRate =
    comments === undefined ? undefined : comments / metrics.views;
  const engagementRate = commentsUnavailable
    ? likeRate
    : (metrics.likes + comments) / metrics.views;

  return {
    views: metrics.views,
    likes: metrics.likes,
    comments: metrics.comments,
    likeRate,
    commentRate,
    engagementRate,
    classification: classifyEngagement(engagementRate),
    commentsUnavailable,
    signalConfidence: commentsUnavailable ? "limited" : "standard",
  };
}

export function getWarningSeverity(
  analysis: Pick<EngagementAnalysis, "classification" | "commentsUnavailable">,
): WarningSeverity | undefined {
  const { classification, commentsUnavailable } = analysis;

  if (commentsUnavailable && classification === "low") {
    return undefined;
  }

  if (
    classification === "low" ||
    classification === "suspiciously-low" ||
    classification === "highly-unusual"
  ) {
    return classification;
  }

  return undefined;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function getSeverityColor(severity: WarningSeverity): string {
  if (severity === "highly-unusual") {
    return "#dc2626";
  }

  if (severity === "suspiciously-low") {
    return "#ea580c";
  }

  return "#f59e0b";
}

export function getSeverityTextColor(severity: WarningSeverity): string {
  return severity === "low" ? "#431407" : "#ffffff";
}

export function getWarningText(analysis: EngagementAnalysis): string {
  const engagementText = `Engagement: ${formatPercent(analysis.engagementRate)}`;

  if (analysis.commentsUnavailable) {
    return [
      `This video has unusually low visible engagement for its view count · ${engagementText}`,
      "Comments unavailable; using likes/views as a lower-bound signal.",
    ].join("\n");
  }

  return `This video has unusually low likes/comments for its view count · ${engagementText}`;
}
