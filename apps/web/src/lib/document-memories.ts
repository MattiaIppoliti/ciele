import type { KnowledgeMemory } from "@agent-hub/core";

/**
 * Pure derivations for the Memories tab (#932). In `lib/` because vitest here
 * only picks up `.ts`, and because "which rows are shown" and "what a row's
 * pill says" are rules worth holding in a test rather than in a component.
 */

/** What the toolbar's filter shows. Forgotten rows are opt-in. */
export function visibleMemories(
  memories: KnowledgeMemory[],
  showForgotten: boolean
): KnowledgeMemory[] {
  const shown = showForgotten
    ? memories
    : memories.filter((memory) => memory.forgottenAt === null);
  // Updated first: the tab's own sort, and the order a reader expects after
  // forgetting something.
  return [...shown].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** The live count: the tab label's number and the Documents table's column. */
export function liveMemoryCount(memories: KnowledgeMemory[]): number {
  return memories.filter((memory) => memory.forgottenAt === null).length;
}

/**
 * The dialog's actor pill.
 *
 * The reference shows `v1` / `Latest`, which is its version chain; ours has
 * none (ADR-0024), so the pill says who wrote the sentence instead, which is
 * the fact a reader actually needs when deciding whether to trust it.
 */
export function memoryActorLabel(generatedBy: string): string {
  if (generatedBy.startsWith("human:")) return "Written by a person";
  if (generatedBy.startsWith("process:")) return "Extracted";
  // `<producer>/<version>`: an extractor, and the version is noise in a pill.
  const producer = generatedBy.split("/")[0] ?? generatedBy;
  return producer.includes("extractor") ? "Extracted" : producer;
}

/** A row's State cell: a dash for live, so the eye goes to the exceptions. */
export function memoryStateLabel(memory: Pick<KnowledgeMemory, "forgottenAt">): string {
  return memory.forgottenAt === null ? "—" : "Forgotten";
}

/** Which memories a bulk action may touch: the live ones a Member selected. */
export function forgettableIds(
  memories: KnowledgeMemory[],
  selected: Set<string>
): string[] {
  return memories
    .filter((memory) => selected.has(memory.id) && memory.forgottenAt === null)
    .map((memory) => memory.id);
}
