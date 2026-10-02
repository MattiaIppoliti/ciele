import type { MessageReaction } from "@agent-hub/core";

/** A transcript record: the emoji and author carry no inferred sentiment. */
export function ReactionRecord({ reactions }: { reactions: MessageReaction[] }) {
  if (!reactions.length) return null;
  return (
    <ul aria-label="Reactions" className="my-2 flex flex-wrap gap-1.5">
      {reactions.map((reaction) => (
        <li key={`${reaction.actorId}:${reaction.emoji}`} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs">
          <span>{reaction.emoji}</span>
          <span className="text-muted-foreground">{reaction.actorName}</span>
        </li>
      ))}
    </ul>
  );
}
