import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { withTransientRetry } from "./transient-retry";

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Every read a page render makes goes through here, which is the one
      // place that can absorb the transient 401 (see transient-retry.ts).
      global: { fetch: withTransientRetry(fetch) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component: session refresh is
            // handled by the middleware, safe to ignore.
          }
        },
      },
    }
  );
}

/**
 * Cookie-independent Supabase client that still executes as the authenticated
 * Member, so Postgres RLS remains authoritative inside cross-request caches.
 */
export function createSupabaseRlsClient(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: withTransientRetry(fetch),
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    },
  );
}

/**
 * Read the already-authorized request's access token for an RLS cache reader.
 * Callers still authorize through getSession/requirePageMember first; this
 * function supplies database identity, it is not an authorization decision.
 */
export async function getSupabaseSessionRlsContext(): Promise<{
  accessToken: string;
  memberId: string;
} | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  const session = data.session;
  if (!session) return null;
  return { accessToken: session.access_token, memberId: session.user.id };
}
