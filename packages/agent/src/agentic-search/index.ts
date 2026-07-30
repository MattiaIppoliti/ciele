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
export {
  buildSystemPrompt,
  dedupSources,
  resolveAnsweringStyle,
  runAgenticSearch,
} from "./run";
export type {
  AgenticSearchOutcome,
  AgenticSearchTurnInput,
  FlowStyleContext,
} from "./run";

// The search-pass ledger, budget, coverage, and the primitive.
export {
  DEFAULT_COVERAGE_THRESHOLDS,
  MAX_SEARCH_PASSES,
  runSearchPass,
  scoreCoverage,
  searchBudgetExhausted,
} from "./search-pass";
export type {
  CoverageThresholds,
  CoverageVerdict,
  SearchPass,
  SearchPassOutcome,
  SearchPassRuntime,
} from "./search-pass";

// The turn's context frame — the live retrieval signals, stated for the model.
export { buildContextFrame, describeContextFrame } from "./query-understanding";
export type { ContextFrame } from "./query-understanding";

// The terminal declaration: the model says it is done, and in what state (#558).
export {
  createTerminalState,
  readyToAnswerTool,
  resolveTerminalStatus,
  writeTimeInstructions,
} from "./ready-to-answer";
export type {
  TerminalState,
  TerminalStatus,
  WriteTimeStyle,
} from "./ready-to-answer";

// The agent loop's iteration budget — and the note that tells the model about
// it, carried on every tool result (#558).
export {
  MAX_AGENT_ITERATIONS,
  createLoopBudget,
  iterationNote,
  withBudgetNote,
} from "./loop-budget";
export type { LoopBudget } from "./loop-budget";
