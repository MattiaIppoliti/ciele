import type { ChatReplyPart } from "@/lib/runtime/client";

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
