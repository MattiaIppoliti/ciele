"use server";

import {
  adoptFlowsAgentThreadOp,
  listFlowsAgentThreadOp,
  listHttpFlowRunsOp,
  readFlowsAgentConversationOp,
} from "@ciele/ops";
import { runOperation } from "@/lib/operations";

/**
 * The Flows Agent panel's history reads and thread adoption (#838).
 * The turn itself is the streaming route under `/api/assistants/[id]/flows-agent/chat`.
 */

/** This Member's past conversations with the agent about one canvas. */
export async function flowsAgentThreadAction(assistantId: string, flowId: string | null) {
  return runOperation(listFlowsAgentThreadOp, { assistantId, flowId });
}

/** One past conversation, reopened in the panel. */
export async function flowsAgentConversationAction(
  assistantId: string,
  conversationId: string
) {
  return runOperation(readFlowsAgentConversationOp, { assistantId, conversationId });
}

/**
 * Save on the new-Flow canvas: the thread the Editor held while the Flow was
 * unsaved follows it into the Flow's own panel.
 */
export async function adoptFlowsAgentThreadAction(assistantId: string, flowId: string) {
  return runOperation(adoptFlowsAgentThreadOp, { assistantId, flowId });
}

/** The latest inbound runs of an HTTP-triggered Flow (#843), for the trigger's panel. */
export async function httpFlowRunsAction(flowId: string) {
  return runOperation(listHttpFlowRunsOp, { flowId, limit: 20 });
}
