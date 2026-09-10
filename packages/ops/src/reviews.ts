import { z } from "zod";
import type { Flow, ReviewRequest } from "@agent-hub/core";
import {
  REVIEW_MAIL_SCOPE,
  REVIEW_SLACK_SCOPE,
  decideReview,
  humanReviewSettingsIssue,
  normalizeAssignees,
} from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Reviews domain (spec #836, #841): the Human review gate's requests as
 * the console, the versioned API, the CLI and the MCP server see them.
 *
 * Listing is a Member read (a request is part of a Conversation's transcript).
 * Deciding is restricted to an assignee or an Owner/Admin, and the state
 * machine in `@agent-hub/core` decides everything else: first decision wins,
 * an overdue request cannot be approved, required Inputs must be filled. The
 * runtime creates rows; no operation does.
 */

const REVIEW_STATUSES = ["pending", "approved", "rejected", "expired"] as const;

export const listReviewsOp = defineOperation({
  name: "reviews.list",
  capability: "member",
  input: z.object({
    status: z.enum(REVIEW_STATUSES).optional(),
    conversationId: z.string().min(1).optional(),
    assistantId: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  entities: () => [],
  run: async (ctx, input): Promise<ReviewRequest[]> => {
    const rows = await ctx.db.table("reviewRequests").list(
      {
        organizationId: ctx.organizationId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.assistantId ? { assistantId: input.assistantId } : {}),
      },
      { limit: input.limit ?? 100 }
    );
    return rows;
  },
});

async function requireReview(ctx: OperationContext, id: string): Promise<ReviewRequest> {
  const review = await ctx.db.table("reviewRequests").get(id);
  if (!review || review.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Review request not found");
  }
  return review;
}

export const getReviewOp = defineOperation({
  name: "reviews.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }) => requireReview(ctx, id),
});

/**
 * Close a request. Capability `member` on purpose: any Role may be assigned
 * (the Editor chooses), so the gate is the assignee list plus the Owner/Admin
 * override, not the Role ladder. An API key decides only when its Role is
 * Owner/Admin, because a key has no email to match an assignee with.
 */
export const decideReviewOp = defineOperation({
  name: "reviews.decide",
  capability: "member",
  input: z.object({
    id: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
    inputs: z.record(z.string().max(100), z.string().max(20000)).default({}),
  }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id, decision, inputs }) => {
    const review = await requireReview(ctx, id);
    const now = new Date();
    const transition = decideReview(review, {
      decision,
      inputs,
      decider: {
        userId: ctx.userId,
        email: ctx.actorEmail ?? "",
        displayName: ctx.actorName ?? null,
        role: ctx.role,
      },
      now,
    });
    if (!transition.ok) {
      switch (transition.reason) {
        case "already_decided":
          throw new OperationError(
            "conflict",
            `Already decided${transition.decidedByName ? ` by ${transition.decidedByName}` : ""}`
          );
        case "expired":
          throw new OperationError("conflict", "This request has expired");
        case "not_assignee":
          // The ops error vocabulary has no "forbidden": a refusal on who is
          // asking reads as a conflict with the request's assignee list.
          throw new OperationError("conflict", "Only an assignee or an admin can decide this request");
        case "missing_input":
          throw new OperationError("invalid_input", `Fill in "${transition.fieldId}" before approving`);
      }
    }
    const decided = transition.review;
    // First wins is a property of the store: the write lands only while the
    // row is still pending, so two colleagues deciding at once cannot both
    // succeed, and the loser is told who got there first.
    const write = ctx.ports?.decideReviewRequest ?? ctx.db.decideReviewRequest.bind(ctx.db);
    const stored = await write(id, {
      status: decided.status,
      decision: decided.decision,
      decidedBy: decided.decidedBy,
      decidedByName: decided.decidedByName,
      decidedAt: decided.decidedAt,
    });
    if (!stored) {
      const current = await ctx.db.table("reviewRequests").get(id);
      throw new OperationError(
        "conflict",
        `Already decided${current?.decidedByName ? ` by ${current.decidedByName}` : ""}`
      );
    }
    // The continuation (approved → run the rest of the Flow; otherwise the halt
    // message) is the host's: a job in production, inline for a simulated
    // Preview request so the transcript can show the next message at once.
    const resumed = (await ctx.ports?.afterReviewDecided?.(stored)) ?? null;
    return { review: stored, resumed };
  },
});

/**
 * Publish validation (#841): every enabled Flow with a Human review must name
 * a title, at least one assignee who is a Member, and an eligible sender: a
 * connected Microsoft 365 mailbox for email, or a connected Organization Slack
 * bot for Slack. The runtime would refuse the same request later; refusing at
 * Publish is what keeps a Visitor from being told a colleague was asked when
 * nobody could be.
 */
export async function assertHumanReviewFlowsPublishable(
  ctx: OperationContext,
  flows: readonly Flow[]
): Promise<void> {
  const gated = flows.filter((flow) => flow.enabled && flow.actions.includes("human_review"));
  if (gated.length === 0) return;
  const members = await ctx.db.listMembers(ctx.organizationId);
  const memberEmails = new Set(members.map((member) => member.email.trim().toLowerCase()));
  for (const flow of gated) {
    const settings = flow.actionSettings?.human_review;
    const issue = humanReviewSettingsIssue(settings);
    if (issue || !settings) {
      throw new OperationError(
        "invalid_input",
        `Flow "${flow.name}": ${(issue ?? "configure the Human review step").replace(/\.$/, "").toLowerCase()} before publishing`
      );
    }
    const strangers = normalizeAssignees(settings.assignees).filter((email) => !memberEmails.has(email));
    if (strangers.length > 0) {
      throw new OperationError(
        "invalid_input",
        `Flow "${flow.name}": ${strangers.join(", ")} ${strangers.length === 1 ? "is not a member" : "are not members"} of this organization`
      );
    }
    if ((settings.channel ?? "email") === "email") {
      const sender = await ctx.db.getSafeApplicationConnection(settings.senderConnectionId!);
      if (
        !sender ||
        sender.organizationId !== ctx.organizationId ||
        sender.provider !== "microsoft_mail" ||
        sender.status !== "connected"
      ) {
        throw new OperationError(
          "invalid_input",
          `Flow "${flow.name}": the review's sender mailbox is not connected`
        );
      }
      if (!sender.scopes.includes(REVIEW_MAIL_SCOPE)) {
        throw new OperationError(
          "invalid_input",
          `Flow "${flow.name}": the sender mailbox was connected without the ${REVIEW_MAIL_SCOPE} scope; reconnect it`
        );
      }
    } else {
      const connections = await ctx.db.listApplicationConnections(ctx.organizationId);
      const slack = connections.find(
        (connection) =>
          connection.provider === "slack" &&
          connection.ownerType === "organization" &&
          connection.status === "connected" &&
          connection.scopes.includes(REVIEW_SLACK_SCOPE)
      );
      if (!slack) {
        throw new OperationError(
          "invalid_input",
          `Flow "${flow.name}": connect the organization's Slack with the ${REVIEW_SLACK_SCOPE} scope before publishing`
        );
      }
    }
  }
}
