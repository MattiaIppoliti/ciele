import { createDb, type Db } from "@agent-hub/db";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";

let runtimeDb: Db | null = null;

/** Trusted coordination client; local/demo deployments keep their existing DB. */
export function getRuntimeDb(fallback: Db): Db {
  if (!isSupabaseServiceConfigured()) return fallback;
  runtimeDb ??= createDb(createSupabaseServiceClient());
  return runtimeDb;
}
