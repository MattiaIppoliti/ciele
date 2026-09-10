import type { StoredMessage } from "@agent-hub/core";
import { EMPTY_TURN_TRACE, type ChatReplyPart } from "@agent-hub/agent/client";
import type { ChatMsg } from "./chat-thread";

export function chatMessagesFromStored(messages: StoredMessage[]): ChatMsg[] {
  return messages.map((message): ChatMsg => {
    const parts = message.content as ChatReplyPart[];
    return message.role === "user"
      ? {
          role: "user",
          text: parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
          sentAt: null,
        }
      : {
          role: "bot",
          id: message.id,
          ...EMPTY_TURN_TRACE,
          parts,
          streamingText: null,
          feedback: message.feedback,
        };
  });
}
