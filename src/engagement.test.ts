import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateEngagement,
  classifyEngagement,
  formatPercent,
  getWarningSeverity,
  getWarningText,
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
    assert.equal(analysis.commentsUnavailable, false);
    assert.equal(analysis.likeRate, 37_093 / 2_000_000);
    assert.equal(analysis.commentRate, 1_727 / 2_000_000);
    assert.equal(analysis.engagementRate, (37_093 + 1_727) / 2_000_000);
    assert.equal(analysis.classification, "low");
  });

  it("falls back to likes over views when comments are unavailable", () => {
    const analysis = calculateEngagement({
      views: 2_000_000,
      likes: 37_093,
    });

    assert.ok(analysis);
    assert.equal(analysis.commentsUnavailable, true);
    assert.equal(analysis.commentRate, undefined);
    assert.equal(analysis.engagementRate, 37_093 / 2_000_000);
    assert.equal(analysis.classification, "low");
  });

  it("does not score videos without enough visible data", () => {
    assert.equal(calculateEngagement({ likes: 100, comments: 5 }), undefined);
    assert.equal(
      calculateEngagement({ views: 10_000, comments: 5 }),
      undefined,
    );
    assert.equal(calculateEngagement({ views: 999, likes: 100 }), undefined);
  });
});

describe("warning helpers", () => {
  it("only returns a severity for warning-level classifications", () => {
    assert.equal(getWarningSeverity("very-strong"), undefined);
    assert.equal(getWarningSeverity("strong"), undefined);
    assert.equal(getWarningSeverity("normal"), undefined);
    assert.equal(getWarningSeverity("low"), "low");
    assert.equal(getWarningSeverity("suspiciously-low"), "suspiciously-low");
    assert.equal(getWarningSeverity("highly-unusual"), "highly-unusual");
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
});
