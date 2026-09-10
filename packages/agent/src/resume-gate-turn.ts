import type { Conversation, ReviewRequest, WebhookSubscription } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { drain } from "./drain";

/** Continue a settled gate; return false when its Assistant no longer exists. */
export async function resumeGateTurn({
  db, conversation, gate,
}: {
  db: Db;
  conversation: Conversation;
  gate:
    | { kind: "review"; request: ReviewRequest }
    | { kind: "webhook"; request: WebhookSubscription };
}): Promise<boolean> {
  const { request } = gate;
  const [assistant, flows, connections] = await Promise.all([
    db.getAssistant(request.assistantId),
    db.listFlows(request.assistantId),
    db.listProviderConnections(request.organizationId),
  ]);
  if (!assistant) return false;
  const { streamConversationTurn } = await import("./turn");
  const stream = await streamConversationTurn({
    db,
    assistant,
    flows,
    connections,
    organizationId: request.organizationId,
    subjectType: conversation.subjectType,
    subjectId: conversation.subjectId,
    conversationId: conversation.id,
    message: "",
    turnId: `${gate.kind}-${request.id}`,
    ...(gate.kind === "review" ? { resumeReview: gate.request } : { resumeWebhook: gate.request }),
    metadata: conversation.metadata,
    // Simulated gates retain the operator surface's diagnostics and connectors.
    keyResolution: request.simulated ? { surface: "preview" } : undefined,
    signal: new AbortController().signal,
  });
  await drain(stream);
  return true;
}
