import type { SupabaseClient } from "@supabase/supabase-js";
import { mockDb } from "./mock";
import { createSupabaseDb } from "./supabase";
import type { Db } from "./types";

/**
 * `@agent-hub/db` — the data-access seam, and only that.
 *
 * This package publishes the `Db` interface, its two adapters, and the few
 * operations that need a `Db` to mean anything. The **domain vocabulary** it
 * traffics in — Organization, Assistant, Flow, Concept, Publication, the OKF
 * derivations, the Insights oracle, the deterministic router — lives in
 * `@agent-hub/core`, which this package depends on (ADR-0019).
 *
 * So import a *type* from `@agent-hub/core` and an *operation* from here. There
 * is deliberately no compatibility re-export of the domain through this barrel:
 * the dependency arrow should be visible at every call site, otherwise the split
 * is bookkeeping rather than architecture.
 */

// The seam itself.
export type { Db } from "./types";

// The generic typed table accessor (ADR-0016 stage 1) — the escape hatch the
// ~125 plain-CRUD passthroughs migrate onto.
export type {
  DbTableAccessor,
  DbTableInsert,
  DbTableListOptions,
  DbTableMap,
  DbTableName,
  DbTableRow,
  DbTableUpdate,
} from "./table-access";

// Raising an Improvement is one policy over the seam, so it lives with the
// seam rather than in the domain package: it takes a `Db`.
export {
  IMPROVEMENT_TITLE_MAX,
  findOpenImprovementForConversation,
  raiseImprovement,
  raiseOrAttachImprovement,
} from "./improvements";

// The demo org the in-memory adapter seeds.
export { DEMO_MEMBER, DEMO_ORG } from "./mock";

// The tenancy boundary for API-key requests (#619): a fail-closed Db view
// pinned to one Organization, standing in for RLS on service-role clients.
export { OrgPinnedDbError, createOrgPinnedDb } from "./org-pinned";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Supabase-backed Db bound to the caller's auth context. Build a fresh one
 * per request with a cookie-scoped client — RLS enforces tenant isolation.
 */
export function createDb(client: SupabaseClient): Db {
  return createSupabaseDb(client);
}

/**
 * In-memory demo Db (single demo org, seeded data). Used when Supabase env
 * vars are missing so the app works out of the box.
 */
export function getMockDb(): Db {
  return mockDb;
}
