import { cookies } from "next/headers";
import { cache } from "react";
import { capabilitiesForLadderRole, roleLabel, type Organization, type Profile, type Role } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
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
  /**
   * The ladder tier RLS sees for the caller's Role (ADR-0028). Display
   * {@link roleName} and check {@link capabilities}; this stays for the
   * comparisons that are tiers by design.
   */
  role: Role | null;
  /** The Role the caller holds (`org_roles.id`); null one migration behind. */
  roleId: string | null;
  roleName: string | null;
  /** What the caller may do in the active Organization. */
  capabilities: string[];
  demo: boolean;
  /** Every Organization the caller can switch into (a platform superuser
   * sees every Organization; everyone else sees just their own). */
  organizations: Organization[];
  /** The caller's own profile (username, name, avatar), Settings > Profile. */
  profile: Profile | null;
}

/**
 * Memoized with React cache(): deriving the session costs a JWT check plus
 * an org lookup, and layout + page + actions in one request all need it.
 * Per-request only, never cached across requests.
 *
 * Identity comes from auth.getClaims(), a local JWT verification (JWKS
 * cached), instead of the auth.getUser() network round trip, the same
 * trade the middleware makes and for the same reason: this runs on every
 * admin page render. The cost: a server-side revocation (or an email
 * change) isn't seen until the access token expires and refreshes.
 * Symmetric-secret projects fall back to a server-side check in supabase-js.
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
    const organization = current?.organization ?? DEMO_ORG;
    const role = current?.role ?? DEMO_MEMBER.role;
    return {
      userId: DEMO_MEMBER.userId,
      email: DEMO_MEMBER.email,
      organization,
      role,
      ...(await resolveGrant(db, organization.id, DEMO_MEMBER.userId, role)),
      demo: true,
      organizations,
      profile,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  if (!claims?.sub) return null;

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

  const role = resolved?.role ?? null;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    organization: resolved?.organization ?? null,
    role,
    ...(resolved ? await resolveGrant(db, resolved.organization.id, claims.sub, role) : NO_GRANT),
    demo: false,
    organizations,
    profile,
  };
});

const NO_GRANT = { roleId: null, roleName: null, capabilities: [] as string[] };

/**
 * The caller's Role and Capabilities in the active Organization. A platform
 * superuser browsing an Organization they are not a member of has no Role
 * row and stands for the ladder Role the org lookup gave them.
 */
async function resolveGrant(db: Db, organizationId: string, userId: string, role: Role | null) {
  const grant = await db.getMemberGrant(organizationId, userId).catch(() => null);
  if (grant) return { roleId: grant.roleId, roleName: grant.roleName, capabilities: grant.capabilities };
  return role
    ? { roleId: null, roleName: roleLabel(role), capabilities: capabilitiesForLadderRole(role) }
    : NO_GRANT;
}

/** The caller's display name: first + last name, else the username, else
 *  undefined (each caller picks its own last fallback). */
export function profileName(profile: Profile | null): string | undefined {
  return (
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    profile?.username ||
    undefined
  );
}

/* There was a `hasActiveSession()` here: a presence-only check for surfaces that
   needed "is anyone signed in?" without getSession's three Db reads. Its only
   callers were the marketing pages, and they no longer ask the server at all,
   the pages prerender and the header picks its CTA from the signed-in hint
   (lib/auth-hint.ts), so the question is answered in the browser, after the
   response. Deleted rather than left exported: it read cookies, so calling it
   from anything under (marketing) would silently make that route dynamic again.
   Restore it from history if a server-rendered surface ever needs it. */
