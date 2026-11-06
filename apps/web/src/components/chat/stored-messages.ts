import type { StoredMessage } from "@agent-hub/core";
import { EMPTY_TURN_TRACE, type ChatReplyPart } from "@agent-hub/agent/client";
import type { ChatUserMsg, ChatBotMsg, ChatNoticeMsg } from "./chat-thread";
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

function plainText(message: StoredMessage): string {
  return message.content.flatMap((part) => part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("");
}

/**
 * Stored messages as chat rows. An `operator` message is a person's reply
 * (#1082), drawn as a bubble with their name; a `system` message is a line
 * about the Conversation, drawn as a centred notice.
 */
export function chatMessagesFromStored(messages: readonly StoredMessage[], options = { canViewReasoning: false }): Array<ChatUserMsg | ChatBotMsg | ChatNoticeMsg> {
  return messages.map((message): ChatUserMsg | ChatBotMsg | ChatNoticeMsg => {
    if (message.role === "user") {
      return { role: "user", id: message.id, text: plainText(message), sentAt: message.createdAt ?? null };
    }
    if (message.role === "system") {
      return { role: "notice", id: message.id, text: plainText(message), sentAt: message.createdAt };
    }
    if (message.role === "operator") {
      const name = message.authorName ?? "Support";
      return {
        ...storedBotMessage(message, options),
        author: { name, title: "Support team", avatarSeed: name },
      };
    }
    return storedBotMessage(message, options);
  });
}
