import type { StoredMessage } from "@agent-hub/core";
import { EMPTY_TURN_TRACE, type ChatReplyPart } from "@agent-hub/agent/client";
import type { ChatUserMsg, ChatBotMsg } from "./chat-thread";
import { visibleTraceSteps } from "./stored-trace";

type StoredReply = Pick<StoredMessage, "id" | "content" | "trace" | "createdAt"> &
  Partial<Pick<StoredMessage, "flowName" | "feedback" | "feedbackReaction">>;

/** The stored reply contract is written by the runtime; projection owns its view shape. */
export function storedBotMessage(message: StoredReply, options = { canViewReasoning: false }): ChatBotMsg {
  const trace = visibleTraceSteps(message.trace, options);
  return {
    role: "bot",
    id: message.id,
    sentAt: message.createdAt,
    ...EMPTY_TURN_TRACE,
    flowName: message.flowName ?? null,
    steps: trace?.steps ?? [],
    searchCount: trace?.searchCount ?? 0,
    iteration: trace?.iteration ?? null,
    iterationLimit: trace?.iterationLimit ?? null,
    terminal: trace?.terminal ?? null,
    phase: "done",
    parts: message.content as ChatReplyPart[],
    streamingText: null,
    feedback: message.feedback ?? 0,
    feedbackReaction: message.feedbackReaction ?? null,
  };
}

export function chatMessagesFromStored(messages: readonly StoredMessage[], options = { canViewReasoning: false }): Array<ChatUserMsg | ChatBotMsg> {
  return messages.map((message) => {
    return message.role === "user"
      ? {
          role: "user",
          text: message.content.flatMap((part) => part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join(""),
          sentAt: message.createdAt ?? null,
        }
      : storedBotMessage(message, options);
  });
}
