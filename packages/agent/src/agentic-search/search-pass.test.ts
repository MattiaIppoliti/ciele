import { describe, expect, it } from "vitest";
import {
  DEFAULT_COVERAGE_THRESHOLDS,
  MAX_SEARCH_PASSES,
  scoreCoverage,
} from "./search-pass";
import { MAX_AGENT_ITERATIONS } from "./loop-budget";

/**
 * The pure search-pass policies that survive the terminal-tool swap (#558): the
 * coverage verdict recorded per pass, and the per-turn budget. The reformulation
 * policy and the best-effort caveat that used to be tested here are gone — the
 * model reformulates by batching queries within a budget it is told about, and
 * declares its own dead ends. The loop behavior these feed is exercised at the
 * search_knowledge seam in actions.test.ts.
 */

const sims = (...values: number[]) => values.map((similarity) => ({ similarity }));

/**
 * Graph results as `hydrateGraphProvenance` actually shapes them: a
 * rank-descending placeholder whose FIRST entry is always exactly 1, which is
 * what made the cosine thresholds misread every non-empty graph pass.
 */
const graphHits = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    similarity: 1 - i / (count + 1),
    engine: "graph" as const,
  }));

describe("scoreCoverage", () => {
  it("is empty-conflicting when nothing came back", () => {
    expect(scoreCoverage([])).toBe("empty-conflicting");
  });

  it("is sufficient when at least one strong hit is present", () => {
    expect(scoreCoverage(sims(0.9))).toBe("sufficient");
    expect(scoreCoverage(sims(0.72, 0.5, 0.3))).toBe("sufficient");
  });

  it("is insufficient when results are real but thin (none strong)", () => {
    expect(scoreCoverage(sims(0.55, 0.45))).toBe("insufficient");
    expect(scoreCoverage(sims(0.69))).toBe("insufficient");
  });

  it("is empty-conflicting when every hit is below the relevance floor (noise)", () => {
    expect(scoreCoverage(sims(0.3, 0.2, 0.1))).toBe("empty-conflicting");
    expect(scoreCoverage(sims(0.39))).toBe("empty-conflicting");
  });

  it("honors tunable thresholds", () => {
    // Raise the bar: a 0.72 hit is no longer strong.
    expect(
      scoreCoverage(sims(0.72), { ...DEFAULT_COVERAGE_THRESHOLDS, strongSimilarity: 0.8 })
    ).toBe("insufficient");
    // Require two strong hits: a lone strong hit is only insufficient.
    expect(
      scoreCoverage(sims(0.9), { ...DEFAULT_COVERAGE_THRESHOLDS, minStrongResults: 2 })
    ).toBe("insufficient");
  });

  describe("graph-engine results", () => {
    it("does not read the rank placeholder as a strong cosine hit", () => {
      // The regression: a single graph hit scores exactly 1.0, which sailed
      // past strongSimilarity and declared the pass sufficient — disabling
      // reformulation and widening for every assistant on the default engine.
      expect(scoreCoverage(graphHits(1))).toBe("insufficient");
      expect(scoreCoverage(graphHits(2))).toBe("insufficient");
    });

    it("is sufficient once the graph returns plentifully", () => {
      expect(scoreCoverage(graphHits(3))).toBe("sufficient");
      expect(scoreCoverage(graphHits(6))).toBe("sufficient");
    });

    it("still treats nothing as nothing", () => {
      expect(scoreCoverage(graphHits(0))).toBe("empty-conflicting");
    });

    it("honors the graph threshold", () => {
      expect(
        scoreCoverage(graphHits(3), { ...DEFAULT_COVERAGE_THRESHOLDS, graphMinResults: 5 })
      ).toBe("insufficient");
    });

    it("judges a mixed list by the weaker graph rule", () => {
      // Placeholder scores would dominate a Math.max over similarity, so the
      // presence of any graph result makes the cosine reading dishonest.
      expect(scoreCoverage([...sims(0.95), ...graphHits(1)])).toBe("insufficient");
    });

    it("leaves the vector path judged on real similarity", () => {
      // Same shape, no engine stamp: absent is read as vector (§ the pgvector
      // path never had to say so), so the cosine rules still apply.
      expect(scoreCoverage(sims(1))).toBe("sufficient");
    });
  });
});


describe("MAX_SEARCH_PASSES", () => {
  it("sits ABOVE the loop budget, so the two never bind together", () => {
    // The loop gate is MAX_AGENT_ITERATIONS — the number the model is told and
    // plans against. This is a retrieval cost ceiling underneath it: one call
    // may batch several queries, so six iterations can legitimately ask for more
    // than six passes. Equal values made both bind at once and left a turn that
    // searched six times with no iteration left to do anything else.
    expect(MAX_SEARCH_PASSES).toBeGreaterThan(MAX_AGENT_ITERATIONS);
  });
});

