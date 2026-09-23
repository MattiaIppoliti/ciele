import type { KnowledgeMemoryExtraction } from "./types";

/**
 * Why a Document has no memories (#933).
 *
 * Every Source crawled before this layer existed opens on an empty tab, and
 * "No memories yet." is true but useless: it reads as a broken feature when
 * the honest answer is that nothing has run, or that nobody connected a model.
 * The extraction record (#930) already knows which, so the tab says it.
 */
export type MemoriesEmptyState =
  /** No Provider Connection: nothing can extract, and nothing is wrong. */
  | { kind: "no_provider" }
  /** Nothing has tried yet. The next crawl will, or a Member can ask now. */
  | { kind: "not_extracted"; nextCrawlAt: string | null }
  /**
   * A job is queued or running for this page; the list fills as they finish.
   * `remaining` is how many of the Source's Documents are still queued, the
   * count the tab keeps live while it waits.
   */
  | { kind: "extracting"; remaining: number }
  /** The attempts ran out. The Source's Alert has the reason. */
  | { kind: "failed"; lastError: string | null };

export function memoriesEmptyState(input: {
  extraction: Pick<KnowledgeMemoryExtraction, "status" | "lastError"> | null;
  /** When this Source is next due to crawl, if it has a cadence at all. */
  nextCrawlAt?: string | null;
  /**
   * The ledger's view (#933): whether a job for this page is queued or
   * running, and how many of the Source's are. The record is written when a
   * job *finishes*, so while one is waiting the record is silent and only the
   * ledger knows; without this the "Extracting…" state could never be shown.
   */
  queued?: { thisPage: boolean; source: number };
}): MemoriesEmptyState {
  const status = input.extraction?.status;
  const queued = input.queued;
  // A queued job outranks the last outcome: the page is about to be re-read,
  // whatever the previous attempt concluded.
  if (queued?.thisPage || status === "pending") {
    return { kind: "extracting", remaining: Math.max(1, queued?.source ?? 0) };
  }
  if (status === "skipped_no_provider") return { kind: "no_provider" };
  if (status === "failed") {
    return { kind: "failed", lastError: input.extraction?.lastError ?? null };
  }
  // `done` with nothing to show is the same sentence as never having run: the
  // page held no durable facts, which is a correct answer for an index or a
  // login page, and the reader does not need the difference explained.
  return { kind: "not_extracted", nextCrawlAt: input.nextCrawlAt ?? null };
}
