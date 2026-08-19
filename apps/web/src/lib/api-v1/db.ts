import { createClient } from "@supabase/supabase-js";
import { createDb, getMockDb, isSupabaseConfigured, type Db } from "@agent-hub/db";

let apiV1Db: Db | null = null;

/**
 * The raw Db behind /api/v1 key authentication (#619). Key requests carry no
 * Supabase session, so this is a service-role client (same construction as
 * the widget's, see `widget-db.ts`), which is exactly why route handlers
 * never touch it directly: they get the org-pinned wrapper from
 * `resolveApiKeyContext`, and only the auth seam reads this one (key lookup
 * + last-used stamp). Falls back to the in-memory demo store, so /api/v1
 * works in demo mode like the rest of the app.
 */
export function getApiV1Db(): Db {
  if (!isSupabaseConfigured()) return getMockDb();
  if (!apiV1Db) {
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false },
    });
    apiV1Db = createDb(client);
  }
  return apiV1Db;
}
