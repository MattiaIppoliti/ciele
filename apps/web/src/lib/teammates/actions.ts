import type { Role, Teammate } from "@agent-hub/core";
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

  const tools = await teammateToolset({
    teammate,
    projectId: args.projectId,
    member: {
      organizationId,
      userId,
      role,
      actorEmail: actorEmail || undefined,
      db: createOrgPinnedDb(serviceDb, organizationId),
      // The unpinned client, the same way /api/v1 does: ports need more surface
      // than the pinned view exposes, and the operation, not the port, is the
      // guard.
      ports: webOperationPorts(serviceDb, { organizationId, actorEmail }),
    },
  });

  return tools.map((tool) => ({
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
  }));
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
