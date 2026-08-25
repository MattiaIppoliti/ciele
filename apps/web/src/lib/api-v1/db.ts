import type { Db } from "@agent-hub/db";
import { getServiceRoleDb } from "@/lib/service-db";

/**
 * The raw Db behind /api/v1 key authentication (#619). Key requests carry no
 * Supabase session, so this is the service-role client, which is exactly why
 * route handlers never touch it directly: they get the org-pinned wrapper from
 * `resolveApiKeyContext`, and only the auth seam reads this one (key lookup +
 * last-used stamp).
 *
 * Kept as a named alias rather than inlined at the call sites: it is the
 * /api/v1 surface's own name for the shared client, and the Teammate action
 * path now needs the same client for a different reason (see `service-db.ts`).
 */
export function getApiV1Db(): Db {
  return getServiceRoleDb();
}
