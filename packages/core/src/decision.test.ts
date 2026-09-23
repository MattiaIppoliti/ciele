import { describe, expect, it } from "vitest";
import {
  answeredByFallback,
  clearsThreshold,
  compositeScore,
  scoreLevel,
} from "./decision";

/**
 * The generic derivations over a decision's answers (#951). Pure; the rules
 * they pin come from #942 and #943: confidence is read from the provider, a
 * missing confidence fails closed, and an uncalibrated backend accepts the
 * choice with 0.5 as the only defensible Boolean cut.
 */

describe("answeredByFallback", () => {
  it("reads an absent distribution as the adapter having answered", () => {
    expect(answeredByFallback({ type: "choice", choice: "a" })).toBe(true);
    expect(answeredByFallback({ type: "score", score: 1 })).toBe(true);
    expect(answeredByFallback({ type: "choice", choice: "a", probabilities: { a: 1 } })).toBe(false);
  });

  it("cannot tell for a Boolean, which carries no distribution either way", () => {
    expect(answeredByFallback({ type: "boolean", probability: 0.9 })).toBe(false);
  });
});

describe("clearsThreshold", () => {
  const choice = { type: "choice" as const, choice: "a", probabilities: { a: 0.99, b: 0.01 } };

  it("calibrated: a Choice clears on the provider's confidence, never on its own probability", () => {
    expect(clearsThreshold({ answer: choice, confidence: 0.8, threshold: 0.8, calibrated: true })).toBe(true);
    expect(clearsThreshold({ answer: choice, confidence: 0.79, threshold: 0.8, calibrated: true })).toBe(false);
    // The option's own 0.99 must not rescue a missing confidence.
    expect(clearsThreshold({ answer: choice, confidence: undefined, threshold: 0.8, calibrated: true })).toBe(false);
  });

  it("uncalibrated: a Choice or Score is accepted as-is", () => {
    expect(clearsThreshold({ answer: choice, confidence: undefined, threshold: 0.99, calibrated: false })).toBe(true);
    expect(clearsThreshold({ answer: { type: "score", score: 1 }, confidence: undefined, threshold: 0.99, calibrated: false })).toBe(true);
  });

  it("a Boolean clears on P(true), at the threshold when calibrated and at 0.5 otherwise", () => {
    const yes = { type: "boolean" as const, probability: 0.7 };
    expect(clearsThreshold({ answer: yes, confidence: undefined, threshold: 0.85, calibrated: true })).toBe(false);
    expect(clearsThreshold({ answer: yes, confidence: undefined, threshold: 0.85, calibrated: false })).toBe(true);
    expect(clearsThreshold({ answer: { type: "boolean", probability: 0.49 }, confidence: undefined, threshold: 0.85, calibrated: false })).toBe(false);
  });
});

describe("scoreLevel", () => {
  it("rounds the weighted mean to the nearest level and clamps to the range", () => {
    expect(scoreLevel({ type: "score", score: 1.49 }, 4)).toBe(1);
    expect(scoreLevel({ type: "score", score: 1.5 }, 4)).toBe(2);
    expect(scoreLevel({ type: "score", score: 9 }, 4)).toBe(3);
    expect(scoreLevel({ type: "score", score: -1 }, 4)).toBe(0);
  });
});

describe("compositeScore", () => {
  it("is the weighted mean of normalised positions, in [0, 1]", () => {
    expect(
      compositeScore([
        { score: 3, levels: 4, weight: 2 }, // 1.0 × 2
        { score: 0, levels: 3, weight: 1 }, // 0.0 × 1
        { score: 1, levels: 3, weight: 1 }, // 0.5 × 1
      ])
    ).toBeCloseTo(2.5 / 4, 10);
  });

  it("scores zero with no weight rather than dividing by it", () => {
    expect(compositeScore([])).toBe(0);
    expect(compositeScore([{ score: 2, levels: 3, weight: 0 }])).toBe(0);
  });
});
