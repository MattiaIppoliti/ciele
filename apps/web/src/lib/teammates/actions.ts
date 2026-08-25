import type { Role, Teammate } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { TeammateActionTool } from "@agent-hub/agent";
import {
  runTeammateAction,
  teammateActions,
  teammateMemoryActions,
  type OperationContext,
  type TeammateActor,
} from "@ciele/ops";
import { createOrgPinnedDb } from "@agent-hub/db";
import { webOperationPorts } from "@/lib/op-ports";
import { getServiceRoleDb } from "@/lib/service-db";
import { revalidateEntities } from "@/lib/org-mutation";

/**
 * Turning an AI Teammate's grant rows into the actions its turn may take
 * (#770), which is the seam between two packages that must not know each other.
 *
 * `@agent-hub/agent` is framework-free and has no idea operations exist; it
 * takes a list of `TeammateActionTool` and registers one tool each. `@ciele/ops`
 * knows the operations and the grant rules but nothing about turns. This module
 * is the only place that holds both, and it is thin on purpose: read the rows,
 * ask the catalogue what they buy, wrap each in something the runtime can call.
 *
 * Two things happen here that neither side could do alone. Every mutation
 * revalidates the pages it declared it touched, so a board item a Teammate
 * moved in chat is already moved when its colleague opens Improvements. And the
 * `OperationContext` carries the Teammate **and** the invoking Member: the
 * Teammate's grants decide what may run, the Member's id is what gets recorded.
 */
export async function resolveTeammateActions(args: {
  db: Db;
  teammate: Teammate;
  organizationId: string;
  userId: string;
  role: Role | null;
  actorEmail?: string | null;
  /**
   * Which Project the decision-writing tool targets, when it is not the one the
   * Teammate is attached to. A channel bound to a Project passes it, because the
   * decisions a shared thread settles belong to that thread's Project rather
   * than to whichever one each participant carries (#778, story 11).
   */
  projectId?: string | null;
}): Promise<TeammateActionTool[]> {
  const { db, teammate, organizationId, userId } = args;
  const grants = await db
    .table("teammateGrants")
    .list({ teammateId: teammate.id });
  const actor: TeammateActor = {
    id: teammate.id,
    name: teammate.name,
    ceiling: teammate.capabilityCeiling,
    grants: grants.map((grant) => grant.domain),
    approvalBypass: teammate.approvalBypass,
    projectId:
      args.projectId === undefined ? teammate.projectId : args.projectId,
  };
  // The two memory tools (#771) are not grant-gated: remembering what a
  // colleague told it is what makes a Teammate a colleague, so an ungranted
  // one still gets them. That is why there is no early return here any more.
  const specs = [...teammateActions(actor), ...teammateMemoryActions(actor)];
  if (specs.length === 0) return [];

  /**
   * **Not the caller's Db.** A turn runs on the invoking Member's RLS-scoped
   * session, and RLS only ever sees that Member: a Viewer asking a granted
   * Teammate to move a board item would be refused by
   * `editors update improvements`, however many grants an admin gave the
   * Teammate. That would make grants able only to narrow, never to widen, and
   * the whole point of #770 is that a Teammate's capability is its own.
   *
   * So the action path takes the same shape as an /api/v1 key request, for the
   * same reason: no usable session, so `createOrgPinnedDb` stands in for RLS.
   * It is fail-closed, only allow-listed methods are callable and every
   * id-addressed row is resolved to its owner first, which means the grant
   * catalogue and this wrapper's lists together are the complete statement of
   * what an agent can touch.
   */
  const actionDb = createOrgPinnedDb(getServiceRoleDb(), organizationId);
  const ctx: OperationContext = {
    organizationId,
    userId,
    // Carried for the operations that read it for their own reasons; it is
    // deliberately NOT what gates a Teammate action. A Viewer can ask a granted
    // Teammate to move a board item, and it moves, recorded as theirs.
    role: args.role ?? "viewer",
    teammate: actor,
    db: actionDb,
    // No `invalidatePublication`: publishing is not a grantable domain, so no
    // catalogued operation reaches for it. The ports get the unpinned client
    // the same way /api/v1 does: they need more surface than the pinned view
    // exposes, and the operation, not the port, is the guard.
    ports: webOperationPorts(getServiceRoleDb(), {
      organizationId,
      actorEmail: args.actorEmail ?? "",
    }),
  };

  return specs.map((spec) => ({
    operation: spec.operation.name,
    domain: spec.domain,
    label: spec.label,
    description: spec.description,
    inputSchema: spec.operation.input as TeammateActionTool["inputSchema"],
    run: async (input) => {
      const outcome = await runTeammateAction(ctx, spec.operation.name, input);
      // Best-effort. A turn is a streamed Route Handler, so the request store
      // `revalidatePath` needs may already be gone by the time a tool runs, and
      // the mutation has landed either way: the cost of failing here is a page
      // that is one refresh stale, which is not worth losing the turn over.
      try {
        revalidateEntities(outcome.entities);
      } catch {
        // Ignored on purpose, see above.
      }
      return {
        // The card names what the operation itself said it touched. `id` is
        // whichever identifier the kind carries, so an assistant-scoped entity
        // still names something a reader can look up.
        entities: outcome.entities.map((entity) => ({
          kind: entity.kind,
          id:
            "id" in entity
              ? entity.id
              : "assistantId" in entity
                ? entity.assistantId
                : undefined,
        })),
        result: outcome.result,
      };
    },
  }));
}

/**
 * The Routine runner's action port (#772): what an unattended run may do.
 *
 * The same resolution the chat route uses, with the one difference that
 * matters, there is **no invoking Member**. `userId` is empty, so nothing the
 * run mutates records a person who did not ask for it, and `role` is the
 * lowest rung because the Teammate's grants are the only authority here; that
 * is exactly the property #770 built and this is where it is load-bearing
 * rather than merely true.
 *
 * The memory tools come along: the profile one writes `ctx.userId`'s document,
 * which is nobody's on this path, so it writes nothing anyone owns. Left in
 * rather than filtered out because the operation already refuses without a
 * Member, and a second rule here could only disagree with that one.
 */
export async function routineTeammateActions(
  teammate: Teammate
): Promise<TeammateActionTool[]> {
  return resolveTeammateActions({
    db: getServiceRoleDb(),
    teammate,
    organizationId: teammate.organizationId,
    userId: "",
    role: "viewer",
  });
}
