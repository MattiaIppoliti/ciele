import { createTtlCache } from "@/lib/ttl-cache";
import type { FindPreviewData, FindRecordsResult } from "@/lib/find-index";

/**
 * How long the Find palette's answers are reused on this server instance.
 *
 * The three answers are derived state (the Db is the record of truth), so each
 * is held briefly. That is what keeps opening the palette, reopening it, and
 * looking at the same row twice from going back to the database every time.
 * It is a thinning of reads, never a promise of freshness beyond a few seconds,
 * and the client adds its own stale-while-revalidate on top.
 *
 * **Every key starts with the Organization, then the Member and their Role.**
 * What the palette shows depends on all three (a private Teammate is visible
 * to its owner alone, API key counts to admins alone), and a cache cannot know
 * that, so a key that dropped one would hand a Member someone else's view, or
 * their own view from before a role change.
 *
 * Its own module, not `app/find-actions.ts`, because a `"use server"` file may
 * export only actions, and the mutation path has to reach `expireFindCaches`.
 */

/** Who an answer was read for. What the palette shows depends on all three. */
export interface FindScope {
  organizationId: string;
  userId: string;
  role: string | null;
}

const recordsCache = createTtlCache<FindRecordsResult>({ ttlMs: 15_000, max: 100 });
// A record's detail and a page's numbers, under disjoint key shapes.
const previewsCache = createTtlCache<FindPreviewData | null>({ ttlMs: 30_000, max: 800 });

export const findScopeKey = (scope: FindScope) =>
  `${scope.organizationId}:${scope.userId}:${scope.role ?? "none"}`;

/**
 * A degraded answer (a kind whose read failed, a detail missing a piece) goes to
 * the person who asked and is never kept, so the next caller reads again
 * instead of being served the gap for the rest of the window.
 */
const complete = (value: { partial?: boolean } | null) => !value?.partial;

/** The palette's record list, reused for up to 15 s. */
export function cachedFindRecords(
  scope: FindScope,
  read: () => Promise<FindRecordsResult>
): Promise<FindRecordsResult> {
  return recordsCache.wrap(findScopeKey(scope), read, complete);
}

/** One record's detail, reused for up to 30 s. */
export function cachedFindDetail(
  scope: FindScope,
  kind: string,
  id: string,
  read: () => Promise<FindPreviewData | null>
): Promise<FindPreviewData | null> {
  return previewsCache.wrap(`${findScopeKey(scope)}:detail:${kind}:${id}`, read, complete);
}

/** One console page's live numbers, reused for up to 30 s. */
export function cachedFindPage(
  scope: FindScope,
  href: string,
  read: () => Promise<FindPreviewData | null>
): Promise<FindPreviewData | null> {
  return previewsCache.wrap(`${findScopeKey(scope)}:page:${href}`, read, complete);
}

/**
 * Forgets everything cached for one Organization. `revalidateEntities` calls
 * it on every mutation, whatever the entity, because nearly every page the
 * palette describes counts something a mutation can change, and a list that
 * disagrees with the page it opens for up to 30 s reads as a bug.
 *
 * On this server instance only: another instance keeps its answers until they
 * expire, which is why the windows are seconds long.
 */
export function expireFindCaches(organizationId: string) {
  const prefix = `${organizationId}:`;
  recordsCache.expire(prefix);
  previewsCache.expire(prefix);
}
