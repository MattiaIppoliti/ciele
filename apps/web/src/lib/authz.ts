import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@agent-hub/core";
import {
  capabilitiesAllow,
  capabilityDefinition,
  effectiveAssistantCapabilities,
  isAssistantLevelCapability,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { OperationCapability } from "@ciele/ops";
import {
  createAdminPageReads,
  type AdminPageReads,
} from "@/lib/admin-page-reads";
import { getSession, type Session } from "@/lib/auth";
import { getDb } from "@/lib/data";

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
 * What a Member must be allowed to do for an action to proceed (ADR-0028):
 * a Capability their Role holds, or "member", any Member at all.
 */
export type MemberCapability = OperationCapability;

/**
 * The Role does not include the capability. A type of its own, so a caller
 * that turns refusals into copy asks what was thrown rather than what it said.
 * The copy names the Capability in the words the Roles page uses.
 */
export class CapabilityRefusedError extends Error {
  constructor(readonly capability: MemberCapability) {
    const label = capabilityDefinition(capability)?.label;
    super(label ? `Your role does not allow this (${label})` : "Not allowed");
    this.name = "CapabilityRefusedError";
  }
}

/** Everything an authorized server action starts from. */
export interface MemberContext {
  session: OrgSession;
  organizationId: string;
  db: Db;
  /**
   * What the check was made against: the session's Capabilities, or on one
   * Assistant the ones the Member's Role there gives (ADR-0028).
   */
  capabilities: readonly string[];
}

/** Everything an admin page render starts from. */
export interface PageMemberContext {
  session: OrgSession;
  organizationId: string;
  role: Role | null;
  /** The caller's Capabilities, for the pages that gate a control on one. */
  capabilities: readonly string[];
  db: Db;
  reads: AdminPageReads;
}

/**
 * The read-side twin of requireMember, the one preamble every (admin) page
 * goes through instead of hand-repeating session → onboarding-redirect → db.
 * No /login redirect here: middleware already bounces signed-out visitors,
 * and pages have always sent a session-less render to /onboarding. The admin
 * shell and page tree share only request-local bootstrap reads; capability
 * capability checks stay presentational (`can(access, "flows:edit")`).
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
    capabilities: orgSession.capabilities,
    db,
    reads: createAdminPageReads(db, organizationId),
  };
});

/**
 * The authorization seam every org-scoped server action goes through:
 * resolves the signed-in Member (redirecting to /login or /onboarding),
 * checks the required capability against their Role, and hands back the
 * request-scoped Db. The check is the session's Capability set against what
 * the action requires, nowhere else.
 */
export async function requireMember(
  capability: MemberCapability = "member",
  options: {
    /**
     * The Assistant the action is on, or how to find it. A Member's Role on
     * that Assistant replaces their Organization Role there for the
     * Assistant-level Capabilities, up or down.
     */
    assistantId?: string | null | ((db: Db) => Promise<string | null>);
  } = {}
): Promise<MemberContext> {
  const session = await requireSession();
  if (!session.organization) redirect("/onboarding");
  const orgSession = session as OrgSession;
  const db = await getDb();
  let capabilities: readonly string[] = orgSession.capabilities;
  if (options.assistantId && capability !== "member" && isAssistantLevelCapability(capability) && orgSession.role !== "owner") {
    const assistantId = typeof options.assistantId === "function" ? await options.assistantId(db) : options.assistantId;
    const grant = assistantId
      ? await db.getMemberAssistantGrant(orgSession.organization.id, orgSession.userId, assistantId)
      : null;
    if (grant) {
      capabilities = effectiveAssistantCapabilities({
        base: orgSession.capabilities,
        isOwner: grant.role === "owner",
        scope: grant.scope,
        override: grant.override,
      });
    }
  }
  if (!capabilitiesAllow(capabilities, capability)) {
    throw new CapabilityRefusedError(capability);
  }
  return {
    session: orgSession,
    organizationId: orgSession.organization.id,
    db,
    capabilities,
  };
}

/**
 * An Assistant page's view of the Member (ADR-0028): their Capabilities on
 * that Assistant, which their Role there can raise or lower, for the controls
 * the page shows. The server checks the same thing on every save.
 */
export const requireAssistantPageAccess = cache(async (assistantId: string) => {
  const page = await requirePageMember();
  if (page.role === "owner") return { ...page, access: { role: page.role, capabilities: page.capabilities } };
  const grant = await page.db
    .getMemberAssistantGrant(page.organizationId, page.session.userId, assistantId)
    .catch(() => null);
  const capabilities = grant
    ? effectiveAssistantCapabilities({
        base: page.capabilities,
        isOwner: grant.role === "owner",
        scope: grant.scope,
        override: grant.override,
      })
    : page.capabilities;
  return { ...page, access: { role: page.role, capabilities } };
});
