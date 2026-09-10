"use server";

import type { ReviewRequest } from "@agent-hub/core";
import { decideReviewOp, listReviewsOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";

/**
 * The Human review gate's console actions (#841). Every one is the same
 * operation the versioned API, the CLI and the MCP server run.
 */

export async function listConversationReviewsAction(
  conversationId: string
): Promise<ReviewRequest[]> {
  return runOperation(listReviewsOp, { conversationId });
}

/** The Inbox "Pending reviews" filter: which Conversations wait on a decision. */
export async function listPendingReviewConversationIdsAction(): Promise<string[]> {
  const pending = await runOperation(listReviewsOp, { status: "pending", limit: 200 });
  return [...new Set(pending.map((review) => review.conversationId))];
}

/**
 * Decide a request. Returns the assistant message the decision produced when
 * the continuation ran inline (a simulated Preview request), so the transcript
 * that asked can show it without a refresh.
 */
export async function decideReviewAction(
  id: string,
  decision: "approved" | "rejected",
  inputs: Record<string, string>
): Promise<{
  review: ReviewRequest;
  resumed: { messageId: string; content: unknown[] } | null;
}> {
  return runOperation(decideReviewOp, { id, decision, inputs });
}
