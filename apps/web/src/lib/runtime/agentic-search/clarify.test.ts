import { describe, expect, it } from "vitest";
import type { KnowledgeSearchResult } from "@agent-hub/db";
import { decideClarify } from "./clarify";
import { scoreCoverage, type SearchPass } from "./search-pass";
import type { SearchIntent } from "./query-understanding";

/**
 * The pure clarify decision (Agentic Search #156). Three cases the spec calls
 * out — pre-search unresolved, post-search empty/conflicting, and the
 * already-clarified anti-loop guardrail — plus the "don't clarify" negatives.
 * No model, no I/O: a decision over an intent + recorded passes.
 */

function intentOf(overrides: Partial<SearchIntent> = {}): SearchIntent {
  return { query: "q", resolvedFromReference: false, unresolved: false, ...overrides };
}

function result(similarity: number, title = "Concept"): KnowledgeSearchResult {
  return {
    conceptId: `k-${title}-${similarity}`,
    conceptTitle: title,
    conceptPath: "x.md",
    collectionId: "col",
    collectionName: "Col",
    sourceName: "Src",
    resourceUrl: null,
    content: "…",
    similarity,
  };
}

function pass(results: KnowledgeSearchResult[]): SearchPass {
  return { query: "q", results, verdict: scoreCoverage(results) };
}

describe("decideClarify — pre-search (unresolved reference)", () => {
  it("clarifies an unresolvable deictic message on a first ask", () => {
    const d = decideClarify({
      phase: "pre-search",
      intent: intentOf({ unresolved: true }),
      passes: [],
      alreadyClarified: false,
    });
    expect(d.kind).toBe("clarify");
    if (d.kind !== "clarify") throw new Error("unreachable");
    expect(d.part).toMatchObject({ type: "clarify", action: "search_knowledge" });
    expect(d.part.question.length).toBeGreaterThan(0);
    // Nothing surfaced yet pre-search.
    expect(d.part.found).toBeUndefined();
  });

  it("proceeds (does not clarify) when the intent resolved into a searchable query", () => {
    const d = decideClarify({
      phase: "pre-search",
      intent: intentOf({ unresolved: false, resolvedFromReference: true }),
      passes: [],
      alreadyClarified: false,
    });
    expect(d.kind).toBe("proceed");
  });

  it("guardrail: never re-clarifies an already-clarified conversation pre-search", () => {
    const d = decideClarify({
      phase: "pre-search",
      intent: intentOf({ unresolved: true }),
      passes: [],
      alreadyClarified: true,
    });
    expect(d.kind).toBe("guardrail");
  });
});

describe("decideClarify — post-search (empty/conflicting coverage)", () => {
  it("clarifies and lists what it surfaced when every pass was empty/conflicting", () => {
    // A weak hit (below the relevance floor) — surfaced but not answerable.
    const d = decideClarify({
      phase: "post-search",
      intent: intentOf(),
      passes: [pass([result(0.2, "Reading week (partial)")])],
      alreadyClarified: false,
    });
    expect(d.kind).toBe("clarify");
    if (d.kind !== "clarify") throw new Error("unreachable");
    expect(d.part.found).toEqual(["Reading week (partial)"]);
  });

  it("clarifies with no `found` when nothing at all came back", () => {
    const d = decideClarify({
      phase: "post-search",
      intent: intentOf(),
      passes: [pass([])],
      alreadyClarified: false,
    });
    expect(d.kind).toBe("clarify");
    if (d.kind !== "clarify") throw new Error("unreachable");
    expect(d.part.found).toBeUndefined();
  });

  it("proceeds when a pass grounded the answer (sufficient coverage)", () => {
    const d = decideClarify({
      phase: "post-search",
      intent: intentOf(),
      passes: [pass([result(0.92, "Enrollment deadline")])],
      alreadyClarified: false,
    });
    expect(d.kind).toBe("proceed");
  });

  it("guardrail: falls back rather than re-clarifying post-search", () => {
    const d = decideClarify({
      phase: "post-search",
      intent: intentOf(),
      passes: [pass([])],
      alreadyClarified: true,
    });
    expect(d.kind).toBe("guardrail");
  });

  it("dedupes and caps `found` at three concepts across passes", () => {
    const d = decideClarify({
      phase: "post-search",
      intent: intentOf(),
      passes: [
        pass([result(0.2, "A"), result(0.2, "B")]),
        pass([result(0.2, "B"), result(0.2, "C"), result(0.2, "D")]),
      ],
      alreadyClarified: false,
    });
    if (d.kind !== "clarify") throw new Error("expected clarify");
    expect(d.part.found).toEqual(["A", "B", "C"]);
  });
});
