/**
 * Test-only harnesses, published as `@agent-hub/db/testing`.
 *
 * Deliberately a separate subpath from the package's runtime surface: importing
 * this pulls in PGlite and the migration chain, which no shipped code should
 * ever do. A consumer takes it as a **devDependency**.
 *
 * The staff console uses it that way. That is not a violation of its "do not
 * depend on `packages/db`" rule (stated in its own CLAUDE.md): the rule is about
 * programming against the org-scoped `Db` contract, which is false under the
 * service role. Borrowing a schema-loaded Postgres so that console's own SQL can
 * be tested against the real migrations is the opposite problem, see ADR-0020.
 * A consumer whose schema extends the open-source chain passes its own
 * migration directories via `extraMigrationDirs`.
 */
export { createSchemaLoadedPglite } from "./supabase-contract-harness";
