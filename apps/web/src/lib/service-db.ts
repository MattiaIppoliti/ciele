import { createClient } from "@supabase/supabase-js";
import { createDb, getMockDb, isSupabaseConfigured, type Db } from "@agent-hub/db";

let serviceDb: Db | null = null;

/**
 * The service-role Db, for the surfaces where the caller's Supabase session
 * cannot be the tenancy boundary.
 *
 * There are two such surfaces and they arrived for different reasons: an
 * /api/v1 key request has no session at all (#619), and an AI Teammate's
 * granted action runs *as the Teammate*, whose capability comes from its grant
 * rows rather than from the Role of the Member who asked (#770). A Viewer can
 * ask a granted Teammate to move a board item, and RLS, which only ever sees
 * the Viewer, would refuse it.
 *
 * **Nothing gets this client raw.** Both surfaces wrap it in
 * `createOrgPinnedDb`, which is fail-closed: only allow-listed methods are
 * callable, org-scoped calls are pinned, and id-addressed rows are resolved to
 * their owner and refused when they belong to another tenant. That wrapper is
 * what stands in for RLS, so extending a surface means extending its lists in
 * the same change, and forgetting throws rather than leaking.
 *
 * Falls back to the in-memory demo store, so both surfaces work in demo mode.
 */
export function getServiceRoleDb(): Db {
  if (!isSupabaseConfigured()) return getMockDb();
  if (!serviceDb) {
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false },
    });
    serviceDb = createDb(client);
  }
  return serviceDb;
}
