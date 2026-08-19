import { cookies } from "next/headers";
import { cache } from "react";
import { type Organization, type Profile, type Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, isSupabaseConfigured } from "@agent-hub/db";
import { getDb } from "./data";
import { createSupabaseServerClient } from "./supabase/server";

/** Persists which Organization the caller is currently browsing, only
 * meaningful for a platform superuser or a multi-org member, since a
 * regular single-org member always resolves to their one Organization
 * regardless of this cookie. */
export const ACTIVE_ORG_COOKIE = "active_org_id";

export interface Session {
  userId: string;
  email: string;
  /** Null when the user is authenticated but hasn't joined an org yet. */
  organization: Organization | null;
  role: Role | null;
  demo: boolean;
  /** Every Organization the caller can switch into (a platform superuser
   * sees every Organization; everyone else sees just their own). */
  organizations: Organization[];
  /** The caller's own profile (username, name, avatar), Settings > Profile. */
  profile: Profile | null;
}

/**
 * Memoized with React cache(): deriving the session costs a network call
 * (auth.getUser) plus an org lookup, and layout + page + actions in one
 * request all need it. Per-request only, never cached across requests.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!isSupabaseConfigured()) {
    const db = await getDb();
    // Org branding and profile are editable even in demo mode (the mock Db
    // persists them in-memory for the session), read them back through the
    // Db rather than the frozen DEMO_ORG/DEMO_MEMBER constants, or edits
    // would appear to save but never actually show up anywhere.
    const [current, organizations, profile] = await Promise.all([
      db.getCurrentOrg(),
      db.listOrganizations(),
      db.getProfile(),
    ]);
    return {
      userId: DEMO_MEMBER.userId,
      email: DEMO_MEMBER.email,
      organization: current?.organization ?? DEMO_ORG,
      role: current?.role ?? DEMO_MEMBER.role,
      demo: true,
      organizations,
      profile,
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const db = await getDb();
  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const [current, organizations, profile] = await Promise.all([
    db.getCurrentOrg(preferredOrgId),
    db.listOrganizations(),
    db.getProfile(),
  ]);
  // The cookie may point at an org the caller can no longer see (e.g. a
  // superuser grant was revoked), fall back to their default org.
  const resolved = current ?? (preferredOrgId ? await db.getCurrentOrg() : null);

  return {
    userId: user.id,
    email: user.email ?? "",
    organization: resolved?.organization ?? null,
    role: resolved?.role ?? null,
    demo: false,
    organizations,
    profile,
  };
});

/* There was a `hasActiveSession()` here: a presence-only check for surfaces that
   needed "is anyone signed in?" without getSession's three Db reads. Its only
   callers were the marketing pages, and they no longer ask the server at all,
   the pages prerender and the header picks its CTA from the signed-in hint
   (lib/auth-hint.ts), so the question is answered in the browser, after the
   response. Deleted rather than left exported: it read cookies, so calling it
   from anything under (marketing) would silently make that route dynamic again.
   Restore it from history if a server-rendered surface ever needs it. */
