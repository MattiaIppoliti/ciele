import { capabilitiesForLadderRole, intersectCapabilities, type Role, type Teammate } from "@agent-hub/core";
import { remoteMcpActions } from "@agent-hub/agent";
import type { TeammateActionTool } from "@agent-hub/agent";
import { teammateToolset } from "@ciele/ops";
import { createOrgPinnedDb } from "@agent-hub/db";
import { webOperationPorts } from "@/lib/op-ports";
import { getServiceRoleDb } from "@/lib/service-db";
import { settleToolOutcome } from "@/lib/teammates/tool-outcome";

/**
 * A Teammate's tools on the web surface. Which tools, under whose authority and
 * which calls wait are all answered by `teammateToolset` in `@ciele/ops`; this
 * module only supplies what the web host knows and adapts the result.
 *
 * What it supplies:
 *
 * - **The Db the actions run on**, which is not the caller's. A turn runs on the
 *   invoking Member's RLS-scoped session, and RLS only ever sees that Member, so
 *   a Viewer asking a granted Teammate to move a board item would be refused
 *   however many grants an admin gave it (#770). The action path takes the shape
 *   of an /api/v1 key request instead: `createOrgPinnedDb` over the service
 *   client, fail-closed, so the catalogue and the pinned view's lists together
 *   are the complete statement of what an agent can touch.
 * - **The Member.** When the caller has no Role or email to hand (the approval
 *   replay), both are re-read here, so a Member demoted between the card and the
 *   click gets the current Role, not the old one.
 * - **Revalidation.** Every mutation revalidates the pages it declared it
 *   touched, so a board item moved in chat is already moved on Improvements.
 */
export async function resolveTeammateActions(args: {
  teammate: Teammate;
  organizationId: string;
  userId: string;
  role: Role | null;
  /**
   * The caller's Capabilities when the surface already resolved them: an API
   * key's are its Role's intersected with its creator's, narrower than the
   * creator's own. Absent, the Member's are read and capped at `role`'s tier.
   */
  capabilities?: readonly string[];
  actorEmail?: string | null;
  /** A channel bound to a Project passes it (#778, story 11). */
  projectId?: string | null;
}): Promise<TeammateActionTool[]> {
  const { teammate, organizationId, userId } = args;
  const serviceDb = getServiceRoleDb();
  const needsLookup = Boolean(userId) && (!args.role || !args.actorEmail);
  const row = needsLookup
    ? (await serviceDb.listMembers(organizationId)).find((member) => member.userId === userId)
    : undefined;
  const role = args.role ?? row?.role ?? null;
  const actorEmail = args.actorEmail || row?.email || "";
  // The Member's own Capabilities (ADR-0028): Ciele AI acts with exactly what
  // its Member may do, never with the defaults of the Role's tier, which for a
  // custom Role can be wider than the Role itself.
  const capabilities = args.capabilities
    ?? (userId
      ? intersectCapabilities(
          (await serviceDb.getMemberGrant(organizationId, userId))?.capabilities ?? [],
          capabilitiesForLadderRole(role)
        )
      : []);

  const tools = await teammateToolset({
    teammate,
    projectId: args.projectId,
    member: {
      organizationId,
      userId,
      role,
      capabilities,
      actorEmail: actorEmail || undefined,
      db: createOrgPinnedDb(serviceDb, organizationId, userId ? { memberId: userId } : undefined),
      // The unpinned client, the same way /api/v1 does: ports need more surface
      // than the pinned view exposes, and the operation, not the port, is the
      // guard.
      ports: webOperationPorts(serviceDb, { organizationId, actorEmail, memberId: userId || undefined }),
    },
  });

  const remote = await remoteMcpActions({ db: serviceDb, organizationId, teammateId: teammate.id, serverIds: teammate.runtimeConfig?.mcpServerIds });
  return [...tools.map<TeammateActionTool>((tool) => ({
    operation: tool.operation,
    domain: tool.domain,
    label: tool.label,
    description: tool.description,
    inputSchema: tool.inputSchema,
    alwaysConfirm: tool.alwaysConfirm,
    labelFor: tool.labelFor,
    run: async (input, options) => {
      const outcome = await tool.run(input, options);
      return { ...settleToolOutcome(outcome, organizationId), payload: outcome.payload };
    },
  })), ...remote];
}

/**
 * The Routine runner's action port (#772): what an unattended run may do.
 *
 * There is **no invoking Member**. `userId` is empty, so nothing the run
 * mutates records a person who did not ask for it, and the Teammate's grants
 * are the only authority, which is where #770's property is load-bearing
 * rather than merely true. Ciele AI has no tools here, having no Member to act
 * as.
 */
export async function routineTeammateActions(
  teammate: Teammate
): Promise<TeammateActionTool[]> {
  return resolveTeammateActions({
    teammate,
    organizationId: teammate.organizationId,
    userId: "",
    role: "viewer",
  });
}
