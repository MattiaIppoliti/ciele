import type { MessageReaction } from "@agent-hub/core";

export const QUICK_REACTIONS = ["👍", "❤️", "🙌", "😂", "😢", "😮"];
export function groupMessageReactions(reactions: readonly MessageReaction[]) {
  const groups = new Map<string, MessageReaction[]>();
  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) ?? [];
    group.push(reaction);
    groups.set(reaction.emoji, group);
  }
  return [...groups].map(([emoji, actors]) => ({ emoji, actors }));
}
