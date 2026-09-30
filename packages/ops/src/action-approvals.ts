import { z } from "zod";
import type { ActionApproval } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

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
  effect: "consequential",
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

    const writes = ctx.ports?.actionApprovalWrites ?? ctx.db;

    // The compare-and-set is the whole first-wins rule: of two Members
    // clicking, or a Member racing the expiry sweep, exactly one transition
    // lands and the other reads null.
    const closed = await writes.decideActionApproval(approval.id, {
      status: decision,
      decidedBy: ctx.userId || null,
      decidedByName: ctx.actorName ?? null,
      decidedAt: new Date().toISOString(),
    });
    if (closed?.status === "rejected") {
      return { status: closed.status, ran: false };
    }
    // Approving a row that is already approved and never ran is the retry of a
    // run that failed: the Member said yes once, and the action still has not
    // happened. Anything else was decided by somebody else, or has run.
    const toRun =
      closed ??
      (decision === "approved" && approval.status === "approved" && !approval.executedAt
        ? approval
        : null);
    if (!toRun) {
      throw new OperationError("conflict", "That request was already decided");
    }
    await runApproved(ctx, writes, toRun);
    return { status: "approved" as const, ran: true };
  },
});

/**
 * Longer than any function's `maxDuration`: a claim this old belongs to a run
 * whose function was killed without settling, so it is taken over. A shorter
 * lease would let a slow run and its retry both land.
 */
export const APPROVAL_RUN_LEASE_MS = 15 * 60_000;

/**
 * Runs an approved action exactly once across retries. The claim is a
 * compare-and-set, so a second click while the first run is going is refused;
 * a run that throws releases it, so the Member can try again; one that returns
 * is stamped, so nothing runs it twice. A function killed mid-run leaves its
 * claim to expire rather than be retried at once, because the action may have
 * landed: at-most-once inside the lease is the safer failure for a delete.
 */
async function runApproved(
  ctx: OperationContext,
  writes: Pick<Db, "claimActionApprovalRun" | "settleActionApprovalRun">,
  approval: ActionApproval
): Promise<void> {
  // Through the port, on the org-pinned service-role Db, never on the
  // approving Member's RLS session. Running it here on `ctx.db` would refuse
  // every action whose grant is wider than the approver's own Role, which is
  // precisely the case the gate exists to put in front of somebody.
  const run = ctx.ports?.runApprovedTeammateAction;
  if (!run) {
    throw new OperationError("invalid_input", "This surface cannot run an approved action");
  }
  if (!approval.teammateId) {
    throw new OperationError("invalid_input", "That request has no colleague to run as");
  }
  const now = Date.now();
  const claimedAt = new Date(now).toISOString();
  const claimed = await writes.claimActionApprovalRun(approval.id, {
    now: claimedAt,
    staleBefore: new Date(now - APPROVAL_RUN_LEASE_MS).toISOString(),
  });
  if (!claimed) {
    throw new OperationError("conflict", "That action is already running, or has run");
  }
  try {
    await run({
      teammateId: approval.teammateId,
      operation: approval.operation,
      input: approval.input,
      // Attribution stays the Member the Teammate acted for, which is not the
      // Member who approved it; an Owner clicking yes does not become the
      // author of somebody else's request.
      requestedBy: approval.requestedBy,
    });
  } catch (error) {
    await writes.settleActionApprovalRun(approval.id, "failed", claimedAt);
    throw error;
  }
  await writes.settleActionApprovalRun(approval.id, "ran", claimedAt);
}
