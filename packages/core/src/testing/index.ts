/**
 * Test-only fixtures, published as `@agent-hub/core/testing`.
 *
 * Kept out of the main barrel on purpose: these are builders for tests, not part
 * of the domain vocabulary. They live here rather than in `@agent-hub/db` so the
 * pure Insights oracle tests (this package) and the SQL parity test (that one)
 * assert against the *same* fixtures, that shared spec is what makes the parity
 * claim mean anything.
 */
export * from "./insights-fixtures";
// Named on purpose (unlike the Insights fixtures above): the keyed replay script
// in `packages/agent` runs on tsx, which compiles this typeless package as
// CommonJS, and a `export *` barrel's names cannot be enumerated there.
export {
  PREFLIGHT_FIXTURE_CATALOGUE,
  PREFLIGHT_LABELLED_CASES,
} from "./preflight-fixtures";
export type { PreflightLabelledCase } from "./preflight-fixtures";
export {
  PREFLIGHT_SYNTHETIC_CASES,
  PREFLIGHT_SYNTHETIC_CATALOGUE,
  goldLanguage,
  goldRouting,
} from "./preflight-synthetic-cases";
export type {
  PreflightGoldCase,
  PreflightGoldLabels,
  PreflightGoldLanguage,
  PreflightGoldSource,
} from "./preflight-synthetic-cases";
export { PREFLIGHT_GOLD_SETS } from "./preflight-gold";
export type {
  PreflightDriftCase,
  PreflightGoldMessage,
  PreflightGoldSet,
  PreflightGoldSetName,
} from "./preflight-gold";
export { PREFLIGHT_DRIFT_BASELINE } from "./preflight-drift-baseline";
