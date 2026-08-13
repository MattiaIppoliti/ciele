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
 * Slice 1 (#153) — the multi-pass backbone: a per-turn search-iteration
 * budget (`MAX_SEARCH_PASSES`), counting `searchKnowledge` calls
 * specifically — not all agent steps.
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

/** One recorded `searchKnowledge` pass — the loop's iteration log for the gate. */
export interface SearchPass {
  query: string;
  results: KnowledgeSearchResult[];
  /**
   * The scope tier this pass targeted (Agentic Search #155). Absent is read as
   * `collection` (the anchored default): the reformulation policy uses it to
   * tell whether the loop has already widened to assistant-wide knowledge.
   */
  scope?: SearchScope;
}

// The deterministic reformulation policy (`nextReformulation`, `rephraseQuery`,
// the Collection → assistant-wide scope ladder) and the `bestEffortCaveat` used
// to live here; they are gone (#558): the model reformulates by batching queries
// within an iteration budget it is told about, and it declares its own dead ends
// through the terminal tool. The coverage gate (`scoreCoverage` + its verdict
// recorded per pass) followed them out — its consumers were the same removed
// policies, so it had been written into the ledger and read by nothing. What
// is left is the ledger, the budget gate, and the primitive.

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
  ctx.passes.push({ query, scope, results });
  ctx.usedSources.push(...results);
  end(
    !swallowed,
    results.length > 0
      ? `Found ${results.length} relevant concept${results.length > 1 ? "s" : ""}`
      : "No matching knowledge found"
  );
  return { kind: "searched", results };
}
