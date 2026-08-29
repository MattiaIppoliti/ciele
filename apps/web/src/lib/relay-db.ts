import { createDb, type Db } from "@agent-hub/db";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "./supabase/service";

let relayDb: Db | null = null;

/**
 * Db for the local-connector relay: strictly service-role. The relay tables
 * (`local_connector_*`, `local_inference_jobs`) carry no RLS policies,
 * connectors authenticate with hashed one-time/device tokens, never with
 * Supabase credentials: so only the service role can see them; there is
 * deliberately no anon-key or mock fallback (throws when unconfigured).
 * Module-level singleton: env-configured and stateless, like getWidgetDb.
 */
export function getRelayDb(): Db {
  relayDb ??= createDb(createSupabaseServiceClient());
  return relayDb;
}

export function isRelayDbConfigured(): boolean {
  return isSupabaseServiceConfigured();
}
