import { describe, expect, it } from "vitest";
import {
  DEFAULT_COVERAGE_THRESHOLDS,
  MAX_SEARCH_PASSES,
  bestEffortCaveat,
  nextReformulation,
  rephraseQuery,
  scoreCoverage,
  type SearchPass,
} from "./search-pass";

/**
 * Pure Agentic Search helpers (slice 1) — no model. The loop behavior these feed is
 * exercised at the search_knowledge seam in actions.test.ts.
 */

const sims = (...values: number[]) => values.map((similarity) => ({ similarity }));

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
});

describe("bestEffortCaveat", () => {
  const pass = (query: string, verdict: SearchPass["verdict"]): SearchPass => ({
    query,
    results: [],
    verdict,
  });

  it("names the queries it tried and never reads as a bare empty answer", () => {
    const text = bestEffortCaveat([
      pass("library opening hours", "empty-conflicting"),
      pass("when is the library open", "empty-conflicting"),
    ]);
    expect(text).toContain("library opening hours");
    expect(text).toContain("when is the library open");
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toBe("no sources found");
  });

  it("dedupes and caps the listed queries at three", () => {
    const text = bestEffortCaveat([
      pass("a", "empty-conflicting"),
      pass("a", "empty-conflicting"),
      pass("b", "empty-conflicting"),
      pass("c", "empty-conflicting"),
      pass("d", "empty-conflicting"),
    ]);
    expect(text).not.toContain("“d”");
    expect(text).toContain("“a”");
    expect(text).toContain("“b”");
    expect(text).toContain("“c”");
  });

  it("still produces an honest caveat when no queries were recorded", () => {
    const text = bestEffortCaveat([]);
    expect(text).toContain("searched the knowledge base");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("MAX_SEARCH_PASSES", () => {
  it("caps the per-turn search-iteration budget at 6", () => {
    expect(MAX_SEARCH_PASSES).toBe(6);
  });
});

describe("rephraseQuery", () => {
  it("reduces a conversational question to its salient keyword core", () => {
    expect(rephraseQuery("what is the reading week schedule?")).toBe(
      "reading week schedule"
    );
    expect(rephraseQuery("How do I get my transcript?")).toBe("transcript");
  });

  it("keeps an already-keyword query (and its hyphens) intact", () => {
    expect(rephraseQuery("cost-push inflation")).toBe("cost-push inflation");
  });

  it("falls back to the original when stripping leaves too little", () => {
    expect(rephraseQuery("how do you")).toBe("how do you");
  });
});

describe("nextReformulation", () => {
  const pass = (
    verdict: SearchPass["verdict"],
    scope?: SearchPass["scope"],
    query = "reading week schedule"
  ): SearchPass => ({ query, results: [], verdict, scope });

  it("stops when there are no passes yet", () => {
    expect(nextReformulation({ passes: [], collectionAnchored: true })).toBeNull();
  });

  it("stops once the last pass is sufficient", () => {
    expect(
      nextReformulation({ passes: [pass("sufficient", "collection")], collectionAnchored: true })
    ).toBeNull();
  });

  it("stops when the budget is spent", () => {
    const passes = Array.from({ length: MAX_SEARCH_PASSES }, () =>
      pass("insufficient", "collection")
    );
    expect(nextReformulation({ passes, collectionAnchored: true })).toBeNull();
  });

  it("widens Collection → assistant-wide and rephrases after a thin scoped pass", () => {
    const next = nextReformulation({
      passes: [pass("insufficient", "collection", "what is the reading week schedule?")],
      collectionAnchored: true,
    });
    expect(next).toEqual({ query: "reading week schedule", scope: "assistant" });
  });

  it("widens after an empty scoped pass too (any non-sufficient verdict)", () => {
    const next = nextReformulation({
      passes: [pass("empty-conflicting", "collection")],
      collectionAnchored: true,
    });
    expect(next?.scope).toBe("assistant");
  });

  it("stops once it has already widened (one scope tier to give on flat retrieval)", () => {
    const next = nextReformulation({
      passes: [pass("insufficient", "collection"), pass("insufficient", "assistant")],
      collectionAnchored: true,
    });
    expect(next).toBeNull();
  });

  it("does not widen when nothing was anchored to widen from", () => {
    const next = nextReformulation({
      passes: [pass("insufficient", "collection")],
      collectionAnchored: false,
    });
    expect(next).toBeNull();
  });
});
