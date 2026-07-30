import type { KnowledgeSearchResult } from "@agent-hub/core";
import type { KnowledgeSearcher, RuntimeEvent, SearchScope } from "../types";

/**
 * Agentic Search discipline (spec #61) — the module home for the retrieval
 * turn's scaffolding. Mostly pure, model-free policy the `search_knowledge`
 * generative loop consults, plus the one effectful primitive
 * ({@link runSearchPass}) that is the ONLY writer of the per-turn search-pass
 * ledger (#204). Everything here is deterministic and unit-tested directly;
 * the LLM loop stays the generative core (runtime invariant: generation lives
 * inside `search_knowledge`).
 *
 * Slice 1 (#153) — the multi-pass backbone:
 *  1. a per-turn search-iteration budget (`MAX_SEARCH_PASSES`), counting
 *     `searchKnowledge` calls specifically — not all agent steps;
 *  2. a coverage gate (`scoreCoverage`) evaluated after each pass, plus the
 *     caveated best-effort answer used when the loop ends without a grounded
 *     answer — never a bare "no sources found" empty bubble.
 *
 * Slice 3 (#155) — reformulation over the current flat retrieval:
 *  3. a pure reformulation policy (`nextReformulation` + `rephraseQuery`) that,
 *     after a scoped pass comes up short, decides whether to search again —
 *     rephrasing the query and widening the scope tier (Collection →
 *     assistant-wide) — within the same budget. OKF-graph / Deep-Search
 *     multi-hop navigation is explicitly out of scope for v1 (see the #54
 *     retrieval-primitives audit); reformulation is rephrase + scope-tier only.
 *
 * The clarify part is deliberately NOT here — that is slice #156.
 */

/**
 * How many search PASSES (individual queries) a single turn may run.
 *
 * Not the loop gate — that is `MAX_AGENT_ITERATIONS`, the number the model is
 * told and plans against, exactly as the reference platform does with search as
 * one of its six tools. This is a retrieval COST ceiling underneath it: one tool
 * call may batch several queries (#558), so six iterations can legitimately ask
 * for more than six passes, and only a pathological batch should hit this.
 *
 * The two were briefly equal, which made them bind simultaneously and left a
 * turn that searched six times with no iteration to do anything else.
 */
export const MAX_SEARCH_PASSES = 12;

/**
 * The one budget gate: whether the turn's search-iteration budget is spent.
 * Every enforcement point (the pass primitive's refusal, the model loop's
 * stop condition, the reformulation policy) derives from this single check.
 */
export function searchBudgetExhausted(
  passes: readonly SearchPass[],
  budget: number = MAX_SEARCH_PASSES
): boolean {
  return passes.length >= budget;
}

/**
 * The coverage verdict for a single search pass's retrieval.
 * - `sufficient`   — enough strong hits to ground an answer.
 * - `insufficient` — some real hits but thin; a further pass may help.
 * - `empty-conflicting` — nothing usable: no results, or only weak noise.
 *   (True contradiction detection is out of scope for v1; empty and
 *   conflicting share a bucket because both mean "can't answer confidently".)
 */
export type CoverageVerdict = "sufficient" | "insufficient" | "empty-conflicting";

/** Tunable thresholds for {@link scoreCoverage}, over cosine similarities in [0,1]. */
export interface CoverageThresholds {
  /** Similarity at/above which a single result counts as a strong hit. */
  strongSimilarity: number;
  /** Minimum count of strong hits required to call a pass `sufficient`. */
  minStrongResults: number;
  /**
   * Best-result similarity floor: a pass whose best hit is below this is
   * treated as noise (`empty-conflicting`) even though rows came back.
   */
  relevanceFloor: number;
  /**
   * Graph-engine only: how many results a pass needs before it counts as
   * `sufficient`. The graph reports no relevance score (see
   * {@link KnowledgeSearchResult.engine}), so count is the only signal there
   * is — this separates sparse from plentiful, which is strictly weaker than
   * separating weak from strong, and is deliberately set so that a thin graph
   * result still yields to a widened vector pass.
   */
  graphMinResults: number;
}

/** Tuned against the cosine similarities `match_chunks` returns (see 0005_knowledge.sql). */
export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds = {
  strongSimilarity: 0.7,
  minStrongResults: 1,
  relevanceFloor: 0.4,
  graphMinResults: 3,
};

/**
 * Classifies a single pass's retrieval. Pure and deterministic — the coverage
 * gate the search loop consults.
 *
 * Two rules, because the two engines report different things. Vector results
 * carry a real cosine similarity and are judged on it. Graph results carry a
 * rank *placeholder* whose first entry is always exactly `1` — comparing that
 * against `strongSimilarity` scored every non-empty graph result `sufficient`,
 * which silently disabled reformulation and widening for assistants on the
 * default engine. Graph passes are therefore judged on count alone.
 *
 * A mixed list is judged as graph: the placeholder scores would dominate a
 * `Math.max`, so the weaker interpretation is the honest one.
 */
export function scoreCoverage(
  results: readonly Pick<KnowledgeSearchResult, "similarity" | "engine">[],
  thresholds: CoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS
): CoverageVerdict {
  if (results.length === 0) return "empty-conflicting";
  if (results.some((r) => r.engine === "graph")) {
    return results.length >= thresholds.graphMinResults
      ? "sufficient"
      : "insufficient";
  }
  const best = Math.max(...results.map((r) => r.similarity));
  if (best < thresholds.relevanceFloor) return "empty-conflicting";
  const strong = results.filter(
    (r) => r.similarity >= thresholds.strongSimilarity
  ).length;
  return strong >= thresholds.minStrongResults ? "sufficient" : "insufficient";
}

/** One recorded `searchKnowledge` pass — the loop's iteration log for the gate. */
export interface SearchPass {
  query: string;
  results: KnowledgeSearchResult[];
  verdict: CoverageVerdict;
  /**
   * The scope tier this pass targeted (Agentic Search #155). Absent is read as
   * `collection` (the anchored default): the reformulation policy uses it to
   * tell whether the loop has already widened to assistant-wide knowledge.
   */
  scope?: SearchScope;
}

// The deterministic reformulation policy (`nextReformulation`, `rephraseQuery`,
// the Collection → assistant-wide scope ladder) and the `bestEffortCaveat` used
// to live here. They are gone (#558): the model reformulates by batching queries
// within an iteration budget it is told about, and it declares its own dead ends
// through the terminal tool. What is left is the ledger, the budget gate, the
// coverage verdict recorded per pass for the transcript, and the primitive.

// ── The search-pass primitive (#204) ─────────────────────────────────────────

/**
 * The per-turn runtime a search pass executes against. `passes` is the single
 * search-pass ledger the budget gate, coverage gate, clarify decision and
 * best-effort caveat all read — {@link runSearchPass} is its only writer.
 */
export interface SearchPassRuntime {
  searchKnowledge: KnowledgeSearcher;
  /** The single per-turn search-pass ledger. */
  passes: SearchPass[];
  /** Collector the reply's Sources part is built from (see actions.ts). */
  usedSources: KnowledgeSearchResult[];
  emit: (event: RuntimeEvent) => void;
  /** Max `searchKnowledge` calls this turn (defaults to MAX_SEARCH_PASSES). */
  budget?: number;
}

/**
 * What one pass came to.
 * - `searched` — the pass ran and was recorded (results may be empty).
 * - `budget-exhausted` — refused before searching; nothing recorded.
 * - `failed` — the searcher threw under `onError: "report"`; nothing recorded,
 *   so a broken search does not consume budget.
 */
export type SearchPassOutcome =
  | { kind: "searched"; results: KnowledgeSearchResult[] }
  | { kind: "budget-exhausted" }
  | { kind: "failed"; message: string };

let passSeq = 0;

/**
 * Runs ONE search pass — the primitive both callers share (#204): the
 * deterministic seed/reformulation loop and the model's `searchKnowledge`
 * tool. One lifecycle for every pass, seeded or model-driven: emit
 * tool-start → check the budget → execute the search → score coverage →
 * append the record (query, scope, results, verdict) to the ledger → collect
 * Sources → emit tool-end. The Thinking panel renders both callers
 * identically because they literally are the same code.
 *
 * `onError` picks the failure semantics the caller needs: the seed loop
 * swallows a throwing searcher as an empty recorded pass (`record-empty`,
 * the default — a dead index still counts against the budget and feeds the
 * gates); the model tool reports it (`report`) so the model sees `{ error }`
 * and a failed search never consumes budget.
 */
export async function runSearchPass(
  query: string,
  scope: SearchScope,
  ctx: SearchPassRuntime,
  opts: {
    /** Pairs start/end (the model's toolCallId); generated when absent. */
    callId?: string;
    onError?: "record-empty" | "report";
    /**
     * Set false when the CALLER owns the panel row. One model tool call may run
     * several queries (#558); the batch is one row with a bulleted label, so the
     * per-pass lifecycle would turn one decision into N rows. The ledger,
     * coverage gate and Sources collection are unaffected — this is only about
     * who emits the events.
     */
    emitLifecycle?: boolean;
  } = {}
): Promise<SearchPassOutcome> {
  const callId = opts.callId ?? `search-${++passSeq}`;
  const startedAt = Date.now();
  const lifecycle = opts.emitLifecycle ?? true;
  if (lifecycle) {
    ctx.emit({
      type: "tool-start",
      callId,
      tool: "searchKnowledge",
      label: `Searching knowledge for “${query}”`,
      input: { query, scope },
    });
  }
  const end = (ok: boolean, summary: string) => {
    if (!lifecycle) return;
    ctx.emit({
      type: "tool-end",
      callId,
      tool: "searchKnowledge",
      ok,
      summary,
      durationMs: Date.now() - startedAt,
    });
  };

  if (searchBudgetExhausted(ctx.passes, ctx.budget)) {
    // Budget internals are never leaked to visitors: a refused pass reads in
    // the Thinking panel exactly like an empty one (only the model is told,
    // via the tool's budget note).
    end(true, "No matching knowledge found");
    return { kind: "budget-exhausted" };
  }

  let results: KnowledgeSearchResult[];
  let swallowed = false;
  try {
    results = await ctx.searchKnowledge(query, { scope });
  } catch (error) {
    if (opts.onError === "report") {
      const message =
        error instanceof Error ? error.message : "Tool call failed";
      end(false, message);
      return { kind: "failed", message };
    }
    // Visitors never see searcher internals — recorded as an empty pass.
    results = [];
    swallowed = true;
  }
  ctx.passes.push({ query, scope, results, verdict: scoreCoverage(results) });
  ctx.usedSources.push(...results);
  end(
    !swallowed,
    results.length > 0
      ? `Found ${results.length} relevant concept${results.length > 1 ? "s" : ""}`
      : "No matching knowledge found"
  );
  return { kind: "searched", results };
}
