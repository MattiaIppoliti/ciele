import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  createAdminPageReads,
  type AdminPageReads,
} from "@/lib/admin-page-reads";
import { getSession, type Session } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  canChangeRoles,
  canEdit,
  canManageApiKeys,
  canManageMembers,
  canPublish,
} from "@/lib/rbac";

/** A session guaranteed to carry an active Organization. */
export type OrgSession = Session & {
  organization: NonNullable<Session["organization"]>;
};

/** Signed-in or redirected to /login. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * What a Member must be allowed to do for an action to proceed. Maps onto
 * the Role ladder in rbac.ts; "member" means any Role in the Organization.
 */
export type MemberCapability =
  | "member"
  | "edit"
  | "publish"
  | "manageMembers"
  | "manageApiKeys"
  | "changeRoles";

const CAPABILITY_GUARDS: Record<
  Exclude<MemberCapability, "member">,
  { allowed: (role: Role | null) => boolean; error: string }
> = {
  edit: { allowed: canEdit, error: "Not allowed" },
  publish: { allowed: canPublish, error: "Only admins/owners can publish" },
  manageMembers: { allowed: canManageMembers, error: "Not allowed" },
  manageApiKeys: {
    allowed: canManageApiKeys,
    error: "Only admins/owners can manage API keys",
  },
  changeRoles: { allowed: canChangeRoles, error: "Only owners can change roles" },
};

/** Everything an authorized server action starts from. */
export interface MemberContext {
  session: OrgSession;
  organizationId: string;
  db: Db;
}

/** Everything an admin page render starts from. */
export interface PageMemberContext {
  session: OrgSession;
  organizationId: string;
  role: Role | null;
  db: Db;
  reads: AdminPageReads;
}

/**
 * The read-side twin of requireMember, the one preamble every (admin) page
 * goes through instead of hand-repeating session → onboarding-redirect → db.
 * No /login redirect here: middleware already bounces signed-out visitors,
 * and pages have always sent a session-less render to /onboarding. The admin
 * shell and page tree share only request-local bootstrap reads; capability
 * checks stay presentational (canEdit(role)).
 */
export const requirePageMember = cache(async (): Promise<PageMemberContext> => {
  const [session, db] = await Promise.all([getSession(), getDb()]);
  if (!session?.organization) redirect("/onboarding");
  const orgSession = session as OrgSession;
  const organizationId = orgSession.organization.id;
  return {
    session: orgSession,
    organizationId,
    role: orgSession.role,
    db,
    reads: createAdminPageReads(db, organizationId),
  };
});

/**
 * The authorization seam every org-scoped server action goes through:
 * resolves the signed-in Member (redirecting to /login or /onboarding),
 * checks the required capability against their Role, and hands back the
 * request-scoped Db. RBAC policy lives here and in rbac.ts, nowhere else.
 */
export async function requireMember(
  capability: MemberCapability = "member"
): Promise<MemberContext> {
  const session = await requireSession();
  if (!session.organization) redirect("/onboarding");
  const orgSession = session as OrgSession;
  if (capability !== "member") {
    const guard = CAPABILITY_GUARDS[capability];
    if (!guard.allowed(orgSession.role)) throw new Error(guard.error);
  }
  return {
    session: orgSession,
    organizationId: orgSession.organization.id,
    db: await getDb(),
  };
}
