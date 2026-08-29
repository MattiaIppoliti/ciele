import { cache } from "react";
import { createDb, getMockDb, isSupabaseConfigured, type Db } from "@agent-hub/db";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * Request-scoped Db: Supabase (with the caller's session, RLS enforced)
 * when configured, otherwise the in-memory demo store.
 *
 * Memoized with React cache(): layout, page and server actions in the same
 * request share one client instead of each constructing their own. Never
 * persisted across requests, the client is bound to the caller's cookies.
 */
export const getDb = cache(async (): Promise<Db> => {
  if (!isSupabaseConfigured()) return getMockDb();
  return createDb(await createSupabaseServerClient());
});
