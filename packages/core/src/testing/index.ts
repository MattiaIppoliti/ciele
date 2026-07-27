/**
 * Test-only fixtures, published as `@agent-hub/core/testing`.
 *
 * Kept out of the main barrel on purpose: these are builders for tests, not part
 * of the domain vocabulary. They live here rather than in `@agent-hub/db` so the
 * pure Insights oracle tests (this package) and the SQL parity test (that one)
 * assert against the *same* fixtures — that shared spec is what makes the parity
 * claim mean anything.
 */
export * from "./insights-fixtures";
