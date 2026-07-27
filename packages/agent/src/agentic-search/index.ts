/**
 * Agentic Search — the module home for the `search_knowledge` retrieval turn
 * (spec #61; architecture spec #203). This index is the module's surface: the
 * rest of the runtime (the Flow Action registry, the tool registry) imports
 * from here and never from the files inside. File organization within the
 * module is free — reorganizing internals must not touch this surface.
 *
 * What lives here:
 *  - the entrypoint ({@link runAgenticSearch}) — the whole generative
 *    retrieval turn behind one call (#206);
 *  - the search-pass primitive ({@link runSearchPass}) — the ONLY writer of
 *    the per-turn search-pass ledger (#204) — with the one budget gate;
 *  - the pure, model-free policies the loop consults: coverage scoring,
 *    reformulation, the best-effort caveat, query understanding over the
 *    turn's context frame, and the clarify decision.
 */

// The retrieval turn: one entrypoint, plus the Sources projection the
// no-model fallback shares and the prompt composer (exported for its tests).
export { buildSystemPrompt, dedupSources, runAgenticSearch } from "./run";
export type {
  AgenticSearchOutcome,
  AgenticSearchTurnInput,
  FlowStyleContext,
} from "./run";

// The search-pass ledger, budget, coverage, reformulation, and the primitive.
export {
  DEFAULT_COVERAGE_THRESHOLDS,
  MAX_SEARCH_PASSES,
  bestEffortCaveat,
  nextReformulation,
  rephraseQuery,
  runSearchPass,
  scoreCoverage,
  searchBudgetExhausted,
} from "./search-pass";
export type {
  CoverageThresholds,
  CoverageVerdict,
  Reformulation,
  SearchPass,
  SearchPassOutcome,
  SearchPassRuntime,
} from "./search-pass";

// Query understanding — the context frame and the resolved search intent.
export {
  buildContextFrame,
  describeSearchIntent,
  understandQuery,
} from "./query-understanding";
export type { ContextFrame, SearchIntent } from "./query-understanding";

// The terminal clarify decision (pre-search and post-search).
export { decideClarify } from "./clarify";
export type {
  ClarifyDecision,
  ClarifyInput,
  ClarifyPhase,
} from "./clarify";
