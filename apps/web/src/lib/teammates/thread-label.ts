import { isRoutineConversation, routineTitle } from "@agent-hub/core";
import type { ConversationMetadata } from "@agent-hub/core";

/**
 * What one row of a Teammate's thread is called (#772, story 26).
 *
 * A Routine run lands in its author's thread like any other Conversation, and
 * without a label it reads as something they said this morning. That is the
 * opposite of an audit trail: the whole point of persisting the run is that a
 * person can tell unattended work apart from their own.
 */
export function threadEntryLabel(entry: {
  title: string;
  metadata?: ConversationMetadata | null;
}): string {
  if (isRoutineConversation(entry.metadata)) {
    const name = entry.metadata?.routineName?.trim();
    return `Routine: ${name || routineTitle(entry.title)}`;
  }
  return entry.title || "Untitled conversation";
}
