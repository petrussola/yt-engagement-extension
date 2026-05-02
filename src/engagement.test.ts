import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateEngagement,
  classifyEngagement,
  formatPercent,
  getWarningSeverity,
  getWarningText,
  parseFirstYouTubeCount,
  parseFirstYouTubeCountWithLabel,
  parseYouTubeAgeDays,
  parseYouTubeCount,
  parseYouTubeCountWithLabel,
} from "./engagement.js";

describe("parseYouTubeCount", () => {
  it("parses plain and abbreviated YouTube counts", () => {
    assert.equal(parseYouTubeCount("1,234"), 1234);
    assert.equal(parseYouTubeCount("1.8K"), 1800);
    assert.equal(parseYouTubeCount("2.4M"), 2_400_000);
    assert.equal(parseYouTubeCount("1.2B"), 1_200_000_000);
  });

  it("returns undefined when no number is visible", () => {
    assert.equal(parseYouTubeCount(undefined), undefined);
    assert.equal(parseYouTubeCount("Comments"), undefined);
  });
});

describe("parseFirstYouTubeCount", () => {
  it("uses the first candidate that contains a count", () => {
    assert.equal(parseFirstYouTubeCount(["Like this video", "1.8K"]), 1800);
    assert.equal(parseFirstYouTubeCount([undefined, "Likes", "42"]), 42);
  });

  it("returns undefined when no candidate contains a count", () => {
    assert.equal(
      parseFirstYouTubeCount([undefined, "Like this video", "Likes"]),
      undefined,
    );
  });
});

describe("parseYouTubeCountWithLabel", () => {
  it("parses labeled view counts without picking earlier numbers", () => {
    assert.equal(parseYouTubeCountWithLabel("565 views", "views"), 565);
    assert.equal(
      parseYouTubeCountWithLabel("531K subscribers · 119K views", "views"),
      119_000,
    );
    assert.equal(
      parseYouTubeCountWithLabel("2M views 1 month ago", "views"),
      2_000_000,
    );
  });

  it("parses labeled comment counts", () => {
    assert.equal(
      parseYouTubeCountWithLabel("1,727 Comments", "comments"),
      1727,
    );
    assert.equal(parseYouTubeCountWithLabel("5 comments", "comments"), 5);
  });

  it("returns undefined when the requested label is missing", () => {
    assert.equal(
      parseYouTubeCountWithLabel("1,727 Comments", "views"),
      undefined,
    );
    assert.equal(parseYouTubeCountWithLabel("Comments", "comments"), undefined);
  });
});

describe("parseFirstYouTubeCountWithLabel", () => {
  it("uses the first candidate that contains the requested labeled count", () => {
    assert.equal(
      parseFirstYouTubeCountWithLabel(
        ["Comments", "1,727 Comments"],
        "comments",
      ),
      1727,
    );
    assert.equal(
      parseFirstYouTubeCountWithLabel(
        ["531K subscribers", "531K subscribers · 119K views"],
        "views",
      ),
      119_000,
    );
  });

  it("returns undefined when no candidate contains the requested label", () => {
    assert.equal(
      parseFirstYouTubeCountWithLabel(["Comments", "1,727"], "comments"),
      undefined,
    );
  });
});

describe("parseYouTubeAgeDays", () => {
  it("parses relative YouTube ages into days", () => {
    assert.equal(parseYouTubeAgeDays("30K views 3 days ago"), 3);
    assert.equal(parseYouTubeAgeDays("30K views 2 weeks ago"), 14);
    assert.equal(parseYouTubeAgeDays("30K views 1 month ago"), 30);
    assert.equal(parseYouTubeAgeDays("30K views 1 year ago"), 365);
  });

  it("treats sub-day ages as zero days", () => {
    assert.equal(parseYouTubeAgeDays("30K views 12 hours ago"), 0);
    assert.equal(parseYouTubeAgeDays("30K views 45 minutes ago"), 0);
  });

  it("returns undefined when no age is visible", () => {
    assert.equal(parseYouTubeAgeDays("30K views"), undefined);
  });
});

describe("classifyEngagement", () => {
  it("classifies engagement by configured thresholds", () => {
    assert.equal(classifyEngagement(0.045), "very-strong");
    assert.equal(classifyEngagement(0.035), "strong");
    assert.equal(classifyEngagement(0.025), "normal");
    assert.equal(classifyEngagement(0.01), "low");
    assert.equal(classifyEngagement(0.005), "suspiciously-low");
    assert.equal(classifyEngagement(0.0049), "highly-unusual");
  });
});

describe("calculateEngagement", () => {
  it("uses likes plus comments when comments are available", () => {
    const analysis = calculateEngagement({
      views: 2_000_000,
      likes: 37_093,
      comments: 1_727,
    });

    assert.ok(analysis);
    assert.equal(analysis.views, 2_000_000);
    assert.equal(analysis.likes, 37_093);
    assert.equal(analysis.comments, 1_727);
    assert.equal(analysis.likesUnavailable, false);
    assert.equal(analysis.commentsUnavailable, false);
    assert.equal(analysis.likeRate, 37_093 / 2_000_000);
    assert.equal(analysis.commentRate, 1_727 / 2_000_000);
    assert.equal(analysis.engagementRate, (37_093 + 1_727) / 2_000_000);
    assert.equal(analysis.classification, "low");
    assert.equal(analysis.ageGateActive, false);
    assert.equal(analysis.signalConfidence, "standard");
  });

  it("falls back to likes over views when comments are unavailable", () => {
    const analysis = calculateEngagement({
      views: 2_000_000,
      likes: 37_093,
    });

    assert.ok(analysis);
    assert.equal(analysis.likesUnavailable, false);
    assert.equal(analysis.commentsUnavailable, true);
    assert.equal(analysis.commentRate, undefined);
    assert.equal(analysis.engagementRate, 37_093 / 2_000_000);
    assert.equal(analysis.classification, "low");
    assert.equal(analysis.signalConfidence, "limited");
  });

  it("scores visible zero likes as highly unusual instead of missing data", () => {
    const analysis = calculateEngagement({
      views: 10_000,
      likes: 0,
      comments: 0,
    });

    assert.ok(analysis);
    assert.equal(analysis.engagementRate, 0);
    assert.equal(analysis.classification, "highly-unusual");
  });

  it("marks videos under three days old as age-gated limited signals", () => {
    const analysis = calculateEngagement({
      views: 30_000,
      comments: 46,
      ageDays: 2,
    });

    assert.ok(analysis);
    assert.equal(analysis.ageDays, 2);
    assert.equal(analysis.ageGateActive, true);
    assert.equal(analysis.signalConfidence, "limited");
  });

  it("falls back to comments over views when likes are unavailable", () => {
    const analysis = calculateEngagement({
      views: 30_000,
      comments: 46,
    });

    assert.ok(analysis);
    assert.equal(analysis.likesUnavailable, true);
    assert.equal(analysis.commentsUnavailable, false);
    assert.equal(analysis.likeRate, undefined);
    assert.equal(analysis.commentRate, 46 / 30_000);
    assert.equal(analysis.engagementRate, 46 / 30_000);
    assert.equal(analysis.classification, "highly-unusual");
    assert.equal(analysis.signalConfidence, "limited");
  });

  it("does not score videos without enough visible data", () => {
    assert.equal(calculateEngagement({ likes: 100, comments: 5 }), undefined);
    assert.equal(calculateEngagement({ views: 10_000 }), undefined);
    assert.equal(calculateEngagement({ views: 999, likes: 100 }), undefined);
  });
});

describe("warning helpers", () => {
  it("only returns a severity for warning-level classifications", () => {
    assert.equal(
      getWarningSeverity({
        classification: "very-strong",
        ageGateActive: false,
      }),
      undefined,
    );
    assert.equal(
      getWarningSeverity({
        classification: "strong",
        ageGateActive: false,
      }),
      undefined,
    );
    assert.equal(
      getWarningSeverity({
        classification: "normal",
        ageGateActive: false,
      }),
      undefined,
    );
    assert.equal(
      getWarningSeverity({ classification: "low", ageGateActive: false }),
      "low",
    );
    assert.equal(
      getWarningSeverity({
        classification: "suspiciously-low",
        ageGateActive: false,
      }),
      "suspiciously-low",
    );
    assert.equal(
      getWarningSeverity({
        classification: "highly-unusual",
        ageGateActive: false,
      }),
      "highly-unusual",
    );
  });

  it("warns on low likes-only engagement while marking the signal as limited", () => {
    assert.equal(
      getWarningSeverity({ classification: "low", ageGateActive: false }),
      "low",
    );
    assert.equal(
      getWarningSeverity({
        classification: "suspiciously-low",
        ageGateActive: false,
      }),
      "suspiciously-low",
    );
  });

  it("does not warn while the age gate is active", () => {
    assert.equal(
      getWarningSeverity({
        classification: "highly-unusual",
        ageGateActive: true,
      }),
      undefined,
    );
  });

  it("formats warning text using the computed engagement rate", () => {
    const analysis = calculateEngagement({
      views: 2_000_000,
      likes: 37_093,
      comments: 1_727,
    });

    assert.ok(analysis);
    assert.equal(formatPercent(analysis.engagementRate), "1.9%");
    assert.equal(
      getWarningText(analysis),
      "This video has unusually low likes/comments for its view count · Engagement: 1.9%",
    );
  });

  it("formats warning text for comments-only lower-bound signals", () => {
    const analysis = calculateEngagement({
      views: 30_000,
      comments: 46,
    });

    assert.ok(analysis);
    assert.equal(
      getWarningText(analysis),
      [
        "This video has unusually low visible engagement for its view count · Engagement: 0.2%",
        "Likes unavailable; using comments/views as a lower-bound signal.",
      ].join("\n"),
    );
  });
});
