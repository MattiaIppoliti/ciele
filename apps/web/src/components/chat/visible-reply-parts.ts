import type { ChatReplyPart } from "@agent-hub/agent/client";

/**
 * Inline help-desk actions duplicate the widget's persistent support button,
 * so they remain part of the runtime record but are not rendered in replies.
 */
export function visibleReplyParts(
  parts: ChatReplyPart[],
  hasPersistentSupport: boolean
): ChatReplyPart[] {
  if (!hasPersistentSupport) return parts;
  return parts.filter(
    (part) => !(part.type === "help_desk" && part.action === "suggest_help_desk")
  );
}

/**
 * Whether the composer should be closed: the newest assistant reply is a one-way
 * Notification (#544).
 *
 * Only the last reply decides. A one-way announcement earlier in the conversation
 * must not lock a chat the Visitor has since been invited back into, and an
 * ordinary answer after it means the conversation is live again.
 */
export function repliesClosed(
  replies: readonly (readonly ChatReplyPart[])[]
): boolean {
  const last = replies.at(-1);
  if (!last || last.length === 0) return false;
  const notifications = last.filter((part) => part.type === "notification");
  if (notifications.length === 0) return false;
  return notifications.every(
    (part) => part.type === "notification" && part.allowReplies === false
  );
}

/** Find the most recent desk recommendation without rendering its inline action. */
export function latestHelpDeskId(
  replies: readonly (readonly ChatReplyPart[])[]
): string | undefined {
  for (let replyIndex = replies.length - 1; replyIndex >= 0; replyIndex -= 1) {
    const parts = replies[replyIndex];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (
        part.type === "help_desk" &&
        part.action === "suggest_help_desk" &&
        part.helpDeskId
      ) {
        return part.helpDeskId;
      }
    }
  }
  return undefined;
}
