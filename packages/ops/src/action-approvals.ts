import { z } from "zod";
import type { ActionApproval } from "@agent-hub/core";

import { defineOperation, OperationError, type OperationContext } from "./operation";

/**
 * Deciding an action the approval gate stopped (#958).
 *
 * The action a Member approves is the action that runs: the operation name and
 * the arguments come off the row, never from the caller and never re-derived
 * from a fresh model call. A Member who reads a card and says yes has agreed
 * to that action with those arguments, and nothing else may take its place.
 */

async function requireApproval(
  ctx: OperationContext,
  id: string
): Promise<ActionApproval> {
  const approval = await ctx.db.table("actionApprovals").get(id);
  if (!approval || approval.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "That approval request does not exist");
  }
  return approval;
}

export const decideActionApprovalOp = defineOperation({
  name: "approvals.decide",
  // A Member's call to *reach*; who may actually decide is narrower and is
  // checked in `run`. Whether the action may run at all stays the grant's
  // business, one layer down: approving does not widen what a Teammate was
  // allowed to do, it only un-pauses it.
  capability: "member",
  input: z.object({
    id: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
  }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id, decision }) => {
    const approval = await requireApproval(ctx, id);

    // Who may say yes. The same rule as the Human review gate this sits
    // beside: an Owner or an Admin, or the Member the action was taken on
    // behalf of. A safety gate whose approval any Viewer in the organization
    // can give does not raise the bar it exists to raise.
    const isAdmin = ctx.role === "owner" || ctx.role === "admin";
    const isRequester = Boolean(ctx.userId) && ctx.userId === approval.requestedBy;
    if (!isAdmin && !isRequester) {
      // The ops error vocabulary has no "forbidden"; a refusal on who is
      // asking reads as a conflict, the same reading `decideReviewOp` takes.
      throw new OperationError(
        "conflict",
        "Only an owner, an admin, or the person who asked for this action can decide it"
      );
    }

    const now = new Date().toISOString();

    // The compare-and-set is the whole first-wins rule: of two Members
    // clicking, or a Member racing the expiry sweep, exactly one transition
    // lands and the other reads null.
    const closed = await ctx.db.decideActionApproval(approval.id, {
      status: decision,
      decidedBy: ctx.userId || null,
      decidedByName: ctx.actorName ?? null,
      decidedAt: now,
    });
    if (!closed) {
      throw new OperationError("conflict", "That request was already decided");
    }
    if (decision === "rejected") {
      return { status: closed.status, ran: false };
    }

    // Through the port, on the org-pinned service-role Db, never on the
    // approving Member's RLS session. Running it here on `ctx.db` would refuse
    // every action whose grant is wider than the approver's own Role, which is
    // precisely the case the gate exists to put in front of somebody.
    const run = ctx.ports?.runApprovedTeammateAction;
    if (!run) {
      throw new OperationError(
        "invalid_input",
        "This surface cannot run an approved action"
      );
    }
    if (!closed.teammateId) {
      throw new OperationError(
        "invalid_input",
        "That request has no colleague to run as"
      );
    }
    // `executedAt` is stamped after the action returns, so a crash between the
    // two leaves the row approved-but-unrun, which a retry can finish. The
    // other order would lose the action while claiming it ran.
    await run({
      teammateId: closed.teammateId,
      operation: closed.operation,
      input: closed.input,
      // Attribution stays the Member the Teammate acted for, which is not the
      // Member who approved it; an Owner clicking yes does not become the
      // author of somebody else's request.
      requestedBy: closed.requestedBy,
    });
    await ctx.db.table("actionApprovals").update(closed.id, { executedAt: new Date().toISOString() });
    return { status: closed.status, ran: true };
  },
});
