import type { Conversation, ReviewRequest, WebhookSubscription } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { opaqueRequestDigest, restoreContinuationCredentials } from "./flow-continuation";

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
  const admitted = await db.readFlowContinuation(`${gate.kind}:${request.id}`);
  const checkpoint = admitted.continuation;
  if (checkpoint && admitted.originStatus === "running") throw new Error("The original Conversation Turn is still running");
  const [assistant, flows, connections] = await Promise.all([
    db.getAssistant(request.assistantId),
    db.listFlows(request.assistantId),
    db.listProviderConnections(request.organizationId),
  ]);
  const liveFlow = flows.find(flow => flow.id === request.flowId);
  const reason = !checkpoint ? "This pending request predates saved Flow continuations. Start a new request to continue."
    : checkpoint.stopReason ?? (!assistant || !liveFlow?.enabled ? "This Flow was stopped." : null)
      ?? ((assistant?.continuationEpoch ?? 0) !== checkpoint.snapshot.assistantEpoch || (liveFlow?.continuationEpoch ?? 0) !== checkpoint.snapshot.flowEpoch ? "This execution was stopped." : null)
      ?? (checkpoint.snapshot.opaqueRequestDigest && liveFlow && opaqueRequestDigest(checkpoint.snapshot.flow, liveFlow, checkpoint.gateId) !== checkpoint.snapshot.opaqueRequestDigest ? "Request headers or query parameters changed while this Flow was waiting. Start a new request to continue safely." : null)
      ?? (admitted.originStatus !== "completed" ? "The original Conversation Turn did not complete." : null);
  if (reason || !assistant || !checkpoint) {
    await db.appendMessage({ conversationId: conversation.id, requestId: `${gate.kind}-${request.id}-stopped`, role: "assistant", flowId: request.flowId, content: [{ type: "text", action: gate.kind === "review" ? "human_review" : "http_webhook", text: reason ?? "This Flow was stopped." }] });
    return true;
  }
  const flow = restoreContinuationCredentials(checkpoint.snapshot.flow, liveFlow!);
  const { streamConversationTurn } = await import("./turn");
  const stream = await streamConversationTurn({
    db,
    assistant: checkpoint.snapshot.assistant,
    flows: [flow],
    skills: checkpoint.snapshot.skills,
    publicationId: checkpoint.snapshot.publicationId ?? undefined,
    continuation: checkpoint,
    connections,
    organizationId: request.organizationId,
    subjectType: conversation.subjectType,
    subjectId: conversation.subjectId,
    conversationId: conversation.id,
    message: checkpoint.snapshot.message,
    turnId: `${gate.kind}-${request.id}`,
    ...(gate.kind === "review" ? { resumeReview: gate.request } : { resumeWebhook: gate.request }),
    metadata: conversation.metadata,
    // Simulated gates retain the operator surface's diagnostics and connectors.
    keyResolution: request.simulated ? { surface: "preview" } : undefined,
    signal: new AbortController().signal,
  });
  // Drive the turn for its side effects; nobody reads the stream.
  const output = await new Response(stream).text();
  const events = output.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type: string });
  if (!events.some(event => event.type === "done")) throw new Error("Flow continuation did not commit");
  return true;
}
