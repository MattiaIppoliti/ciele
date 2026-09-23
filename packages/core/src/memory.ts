/**
 * What "live" means for a memory, written once.
 *
 * Both `Db` implementations filter with the same rule, one in SQL and one in
 * memory, so the rule itself lives here: the prompt layer, the demo store and
 * `match_memories` cannot disagree about what a live memory is.
 *
 * This file is the shape the temporal memory graph (ADR-0023, ciele-org#882)
 * gives it, written here ahead of that branch's merge so the merge is a no-op
 * for these two exports. If that branch lands first, its copy wins: it is the
 * same predicate with the rest of its module around it.
 */

/**
 * The fields liveness and eviction read. Stated structurally rather than as
 * `Memory` so a `Db` implementation can answer from a narrow row select
 * without inventing the columns it did not fetch.
 */
export interface MemoryLifecycleFields {
  id: string;
  createdAt: string;
  isLatest: boolean;
  forgottenAt: string | null;
  forgetAfter: string | null;
}

/**
 * What recall and the profile may return: latest, not forgotten, not expired.
 * The SQL twin of this predicate is the `where` clause of `match_memories`.
 */
export function isMemoryLive(
  memory: Pick<MemoryLifecycleFields, "isLatest" | "forgottenAt" | "forgetAfter">,
  now: Date = new Date()
): boolean {
  if (!memory.isLatest) return false;
  if (memory.forgottenAt) return false;
  if (memory.forgetAfter && new Date(memory.forgetAfter) <= now) return false;
  return true;
}

/**
 * The same rule for a knowledge memory (#926), which has neither of the other
 * two halves: no version chain, so every row is the latest one there is, and
 * no `forget_after`, because the page decides whether its memory still holds
 * and a page is not a clock. Both constants are named here, once, instead of
 * at every call site, and the predicate itself is still the one above.
 *
 * The SQL twin is `forgotten_at is null`, the partial index
 * `knowledge_memories_live_collection_idx` and the `forgottenAt: null` filter
 * the list operation passes.
 */
export function isKnowledgeMemoryLive(memory: {
  forgottenAt: string | null;
}): boolean {
  return isMemoryLive({
    isLatest: true,
    forgottenAt: memory.forgottenAt,
    forgetAfter: null,
  });
}
