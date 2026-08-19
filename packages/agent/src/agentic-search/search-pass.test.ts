import { describe, expect, it } from "vitest";
import { MAX_SEARCH_PASSES } from "./search-pass";
import { MAX_AGENT_ITERATIONS } from "./loop-budget";

/**
 * The pure search-pass policy that survives the terminal-tool swap (#558): the
 * per-turn budget. The reformulation policy, the best-effort caveat and the
 * coverage verdict that used to be tested here are gone, the model
 * reformulates by batching queries within a budget it is told about and
 * declares its own dead ends, and the verdict's only consumers were those
 * removed policies. The loop behavior the budget feeds is exercised at the
 * search_knowledge seam in actions.test.ts; the pass primitive has its own
 * suite in search-pass.primitive.test.ts.
 */

describe("MAX_SEARCH_PASSES", () => {
  it("sits ABOVE the loop budget, so the two never bind together", () => {
    // The loop gate is MAX_AGENT_ITERATIONS, the number the model is told and
    // plans against. This is a retrieval cost ceiling underneath it: one call
    // may batch several queries, so six iterations can legitimately ask for more
    // than six passes. Equal values made both bind at once and left a turn that
    // searched six times with no iteration left to do anything else.
    expect(MAX_SEARCH_PASSES).toBeGreaterThan(MAX_AGENT_ITERATIONS);
  });
});
