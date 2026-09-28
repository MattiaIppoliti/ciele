import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@agent-hub/db";

let cached: SupabaseClient | null = null;

export function isSupabaseServiceConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required for server-side storage writes."
    );
  }
  cached ??= createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}

/**
 * The service-role client for object storage, or null when this deployment has
 * none (the demo build, a self-host without storage). Storage needs both the
 * project and the service key, and every writer asks the same question.
 */
export function objectStorageClient(): SupabaseClient | null {
  return isSupabaseConfigured() && isSupabaseServiceConfigured()
    ? createSupabaseServiceClient()
    : null;
}
