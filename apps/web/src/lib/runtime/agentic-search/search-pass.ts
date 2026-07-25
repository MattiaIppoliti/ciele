import type { KnowledgeSearchResult } from "@agent-hub/db";
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

/** How many `searchKnowledge` calls a single turn may make. */
export const MAX_SEARCH_PASSES = 6;

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
}

/** Tuned against the cosine similarities `match_chunks` returns (see 0005_knowledge.sql). */
export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds = {
  strongSimilarity: 0.7,
  minStrongResults: 1,
  relevanceFloor: 0.4,
};

/**
 * Classifies a single pass's retrieval from relevance score + result count.
 * Pure and deterministic — the coverage gate the search loop consults.
 */
export function scoreCoverage(
  results: readonly Pick<KnowledgeSearchResult, "similarity">[],
  thresholds: CoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS
): CoverageVerdict {
  if (results.length === 0) return "empty-conflicting";
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

/** A reformulated next pass the {@link nextReformulation} policy asks for. */
export interface Reformulation {
  /** The rephrased query to search with. */
  query: string;
  /** The scope tier to search at — widened when there was a Collection to widen from. */
  scope: SearchScope;
}

/**
 * Filler that carries no retrieval signal — stripped by {@link rephraseQuery}
 * so a reformulated pass hands flat retrieval a cleaner keyword core than the
 * conversational original ("what is the reading week schedule" → "reading week
 * schedule").
 */
const QUERY_FILLER = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are",
  "was", "were", "be", "do", "does", "did", "can", "could", "would", "should",
  "what", "why", "how", "when", "where", "who", "which", "about", "tell", "me",
  "explain", "please", "i", "im", "i'm", "you", "we", "my", "your", "there",
  "some", "any", "more", "again", "just", "really", "know", "get", "give",
]);

/**
 * Rephrases a query for a reformulated pass — deterministically reduces it to
 * its salient content words (drops question words + filler), preserving order
 * and original casing. Falls back to the original when stripping would leave
 * too little to search. Pure; the "rephrase" half of reformulation v1.
 */
export function rephraseQuery(query: string): string {
  const kept: string[] = [];
  for (const raw of query.split(/\s+/)) {
    const bare = raw.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (!bare) continue;
    if (QUERY_FILLER.has(bare.toLowerCase())) continue;
    kept.push(bare);
  }
  const rephrased = kept.join(" ").trim();
  return rephrased.length >= 2 ? rephrased : query.trim();
}

/**
 * The reformulation policy: given the passes run so far, decides the next
 * reformulated pass — or `null` to stop and answer/hand off. Pure and
 * deterministic (no model call), so the gnarly "when do we search again" logic
 * is unit-testable in isolation. Policy for v1 (flat retrieval):
 *
 *  - Stop when there are no passes yet, the last pass is `sufficient`, or the
 *    budget is spent.
 *  - Otherwise, when a Collection was anchored and we have not yet widened,
 *    reformulate: rephrase the query AND widen the scope tier to assistant-wide
 *    (Collection → assistant). This is the one scope-tier the flat retrieval
 *    has to offer.
 *  - Once widened (or when nothing was anchored to widen from), stop — the
 *    deterministic phase yields to the model loop rather than rephrasing
 *    endlessly over the same flat index (richer multi-hop reformulation is the
 *    flagged OKF-graph follow-up, out of scope for v1).
 */
export function nextReformulation(input: {
  passes: readonly SearchPass[];
  /** Whether the turn is anchored to a Knowledge Collection (a tier to widen from). */
  collectionAnchored: boolean;
  /** Total per-turn search budget (defaults to {@link MAX_SEARCH_PASSES}). */
  budget?: number;
}): Reformulation | null {
  const { passes, collectionAnchored, budget = MAX_SEARCH_PASSES } = input;
  const last = passes[passes.length - 1];
  if (!last) return null;
  if (last.verdict === "sufficient") return null;
  if (passes.length >= budget) return null;
  const alreadyWidened = passes.some((p) => p.scope === "assistant");
  if (collectionAnchored && !alreadyWidened) {
    return { query: rephraseQuery(last.query), scope: "assistant" };
  }
  return null;
}

/**
 * The caveated best-effort answer for a turn whose search loop ended without a
 * grounded answer (every pass empty, or the budget cut the loop before the
 * model synthesized). It names what was searched and what is missing, so a
 * dead-end is still honest and useful — never a bare "no sources found".
 */
export function bestEffortCaveat(passes: readonly SearchPass[]): string {
  const queries = Array.from(
    new Set(passes.map((p) => p.query.trim()).filter(Boolean))
  ).slice(0, 3);
  const searched =
    queries.length > 0
      ? ` I looked for ${queries.map((q) => `“${q}”`).join(", ")}, but`
      : " I searched the knowledge base, but";
  return (
    `I couldn't find anything about that in the knowledge base.${searched} nothing relevant came back. ` +
    "I don't want to guess, so this may be outside the material I have — try rephrasing or narrowing the question, or reach out to support."
  );
}

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
  } = {}
): Promise<SearchPassOutcome> {
  const callId = opts.callId ?? `search-${++passSeq}`;
  const startedAt = Date.now();
  ctx.emit({
    type: "tool-start",
    callId,
    tool: "searchKnowledge",
    label: `Searching knowledge for “${query}”`,
    input: { query, scope },
  });
  const end = (ok: boolean, summary: string) =>
    ctx.emit({
      type: "tool-end",
      callId,
      tool: "searchKnowledge",
      ok,
      summary,
      durationMs: Date.now() - startedAt,
    });

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
