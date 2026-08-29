import type { MemoryDocumentEntry } from "@agent-hub/core";

/**
 * What the memory surfaces say (#771).
 *
 * In a `.ts` module because this app's vitest ignores `.tsx`, and because the
 * history line is the whole of story 19's promise rendered as a sentence: a
 * Member should be able to read who changed what about them without decoding a
 * table. Worth a test.
 */

export interface HistoryLineInput {
  entry: Pick<MemoryDocumentEntry, "note" | "teammateId" | "authorId" | "createdAt">;
  /** Teammate id → name, for the ones still around. */
  teammateNames: Readonly<Record<string, string>>;
}

/**
 * One history row, in words. "Nora, while you were talking to it" rather than
 * a teammate id, because the Member's question is "who wrote this about me",
 * and an id is not an answer to it.
 *
 * A Teammate that has since been deleted still has to be nameable: the entry
 * outlives it, so an unknown id degrades to "a teammate" rather than to a
 * blank or to the id itself.
 */
export function historyAuthor(input: HistoryLineInput): string {
  const { entry, teammateNames } = input;
  if (!entry.teammateId) return "You";
  return teammateNames[entry.teammateId] ?? "A teammate";
}

/** The sentence under the author: what they said they were doing. */
export function historyNote(entry: Pick<MemoryDocumentEntry, "note">): string {
  const note = entry.note.trim();
  return note || "No note left";
}

/**
 * Whether an entry can be reverted to.
 *
 * The oldest entry is the document's creation, and its `bodyBefore` is the
 * empty document. Reverting to it is emptying the document, which is a real
 * thing to want and reads alarmingly as "Revert", so the surface says so
 * instead of hiding the option.
 */
export function revertLabel(
  entry: Pick<MemoryDocumentEntry, "bodyBefore">
): string {
  return entry.bodyBefore.trim() ? "Undo this change" : "Clear the document";
}

/** The empty state, which is the state every Member starts in. */
export const MEMORY_EMPTY_HINT =
  "Nothing yet. Your teammates add to this as they learn how you work, and you can write it yourself.";

/**
 * What a write did, as one line: "+42 characters", "-8 characters", or a
 * rewrite that came out the same length.
 *
 * Story 19 asks for who, when **and what**. Who and when were already here;
 * this is the "what" in the space a history row has, with the before and after
 * text behind a disclosure for when the number is not enough. A plain
 * character count rather than a line diff because these documents are prose a
 * person wrote about themselves, and "3 lines changed" is a worse answer than
 * "it got 42 characters longer" when the paragraph was rewritten in place.
 */
export function historyChangeSummary(change: {
  delta: number;
  before: string;
  after: string;
}): string {
  if (change.before === change.after) return "No change";
  if (change.delta > 0) return `+${change.delta} characters`;
  if (change.delta < 0) return `${change.delta} characters`;
  return "Rewritten, same length";
}
