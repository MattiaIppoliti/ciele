import { agUiThreadKey, streamConversationTurn } from "@agent-hub/agent";
import type { Db } from "@agent-hub/db";
import { isCieleAi, type Role, type Teammate } from "@agent-hub/core";
import { resolveTeammateActions } from "./actions";
import { cieleAiKnowledgeScope } from "./ciele-ai";

/** One member's persisted external thread, separate from their console conversations. */
export async function streamTransportTeammateTurn(options: {
  db: Db;
  systemDb: Db;
  teammate: Teammate;
  memberId: string;
  role: Role;
  threadId: string;
  turnId: string;
  message: string;
  signal: AbortSignal;
}) {
  const {
    db,
    systemDb,
    teammate,
    memberId,
    role,
    threadId,
    turnId,
    message,
    signal,
  } = options;
  const id = agUiThreadKey(
    teammate.organizationId,
    teammate.id,
    memberId,
    threadId,
  );
  let conversation = await db.getConversation(id);
  if (!conversation) {
    try {
      conversation = await db.createConversation({
        id,
        teammateId: teammate.id,
        subjectType: "member",
        subjectId: memberId,
        title: message.slice(0, 80),
        metadata: {},
      });
    } catch (error) {
      conversation = await db.getConversation(id);
      if (!conversation) throw error;
    }
  }
  if (
    conversation.teammateId !== teammate.id ||
    conversation.subjectType !== "member" ||
    conversation.subjectId !== memberId
  ) {
    throw new Error("External conversation identity mismatch");
  }
  const [connections, teammateActions] = await Promise.all([
    db.listProviderConnections(teammate.organizationId),
    resolveTeammateActions({
      teammate,
      organizationId: teammate.organizationId,
      userId: memberId,
      role,
    }),
  ]);
  return streamConversationTurn({
    db,
    systemDb,
    teammate: isCieleAi(teammate) ? { ...teammate, ...await cieleAiKnowledgeScope(db, teammate.organizationId) } : teammate,
    teammateActions,
    connections,
    organizationId: teammate.organizationId,
    subjectType: "member",
    subjectId: memberId,
    conversationId: conversation.id,
    message,
    turnId,
    signal,
    // API and channel transports never borrow a person's attended CLI subscription.
    keyResolution: { surface: "teammate", memberId },
  });
}
