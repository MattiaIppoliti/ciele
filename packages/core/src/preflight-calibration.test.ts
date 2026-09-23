import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLD_CANDIDATES,
  cohenKappa,
  suggestThreshold,
  thresholdSweep,
  type CalibrationObservation,
} from "./preflight-calibration";

const obs = (pairs: readonly [number, boolean][]): CalibrationObservation[] =>
  pairs.map(([confidence, correct]) => ({ confidence, correct }));

describe("thresholdSweep", () => {
  it("counts what clears each cut and how often it was right", () => {
    const points = thresholdSweep(
      obs([
        [0.95, true],
        [0.9, true],
        [0.85, false],
        [0.6, true],
        [0.4, false],
      ]),
      [0.5, 0.9]
    );
    expect(points).toEqual([
      { threshold: 0.5, asked: 4, correct: 3, precision: 0.75, coverage: 0.8 },
      { threshold: 0.9, asked: 2, correct: 2, precision: 1, coverage: 0.4 },
    ]);
  });

  it("reads at-threshold as clearing, the same rule as clearsThreshold", () => {
    const [point] = thresholdSweep(obs([[0.8, true]]), [0.8]);
    expect(point.asked).toBe(1);
  });

  it("reports null precision and zero coverage when nothing clears", () => {
    expect(thresholdSweep(obs([[0.3, true]]), [0.9])[0]).toEqual({
      threshold: 0.9,
      asked: 0,
      correct: 0,
      precision: null,
      coverage: 0,
    });
    expect(thresholdSweep([], [0.9])[0].coverage).toBe(0);
  });

  it("defaults to ten cuts from 0.50 to 0.95", () => {
    expect(DEFAULT_THRESHOLD_CANDIDATES).toEqual([0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]);
  });
});

describe("suggestThreshold", () => {
  const sample = obs([
    [0.95, true],
    [0.92, true],
    [0.9, true],
    [0.88, true],
    [0.82, false],
    [0.8, true],
    [0.7, false],
    [0.55, true],
  ]);

  it("picks the lowest cut that meets the target on enough cases", () => {
    // ≥0.85: 4 asked, 4 right. ≥0.75: 6 asked, 5 right (0.83); ≥0.7 adds a miss (0.71).
    expect(suggestThreshold(sample, { targetPrecision: 0.95, minAsked: 3 })?.threshold).toBe(0.85);
    expect(suggestThreshold(sample, { targetPrecision: 0.8, minAsked: 3 })?.threshold).toBe(0.75);
  });

  it("refuses a cut that clears too few cases to mean anything", () => {
    expect(suggestThreshold(sample, { targetPrecision: 0.95, minAsked: 5 })).toBeNull();
  });

  it("returns null when no cut reaches the target", () => {
    expect(suggestThreshold(obs([[0.9, false], [0.9, false]]), { targetPrecision: 0.5, minAsked: 1 })).toBeNull();
  });
});

describe("cohenKappa", () => {
  it("is 1 on perfect agreement and 0 on chance agreement", () => {
    expect(cohenKappa(["a", "b", "a", "b"], ["a", "b", "a", "b"]).kappa).toBe(1);
    // Labeller B says "a" regardless: observed 0.5, expected 0.5.
    expect(cohenKappa(["a", "b", "a", "b"], ["a", "a", "a", "a"]).kappa).toBe(0);
  });

  it("matches the textbook worked example", () => {
    // 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no: po = 0.7, pe = 0.5, kappa = 0.4.
    const a = [...Array(25).fill("yes"), ...Array(25).fill("no")];
    const b = [...Array(20).fill("yes"), ...Array(5).fill("no"), ...Array(10).fill("yes"), ...Array(15).fill("no")];
    const figures = cohenKappa(a, b);
    expect(figures.items).toBe(50);
    expect(figures.observed).toBeCloseTo(0.7);
    expect(figures.kappa).toBeCloseTo(0.4);
  });

  it("leaves skipped items out instead of counting them as disagreement", () => {
    const figures = cohenKappa(["a", null, "b"], ["a", "b", "b"]);
    expect(figures.items).toBe(2);
    expect(figures.agreed).toBe(2);
    expect(figures.kappa).toBe(1);
  });

  it("is 1, not NaN, when both labellers used one identical label throughout", () => {
    expect(cohenKappa(["a", "a"], ["a", "a"]).kappa).toBe(1);
  });

  it("is null with nothing to compare and throws on mismatched lengths", () => {
    expect(cohenKappa([], []).kappa).toBeNull();
    expect(() => cohenKappa(["a"], [])).toThrow(RangeError);
  });
});
