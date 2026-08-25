import type { Teammate } from "@agent-hub/core";
import { danglingScopeAlertCopy } from "@agent-hub/core";
import type { Db } from "./types";

/**
 * Scope hygiene for AI Teammates (#769).
 *
 * A Teammate's Knowledge Scope is a list of Collection ids rather than a
 * foreign key, on purpose: an empty scope is a valid configuration, and a
 * cascade would let one person's delete silently rewrite another person's
 * Teammate. The price is that a deleted Collection leaves a Teammate pointed at
 * nothing, so the operational surface has to say so out loud.
 *
 * These two functions are that surface. They live here rather than in
 * `@agent-hub/core` because they take a `Db`, the same test that kept
 * `raiseImprovement` on this side of the seam.
 */

/** Dedup key for the Alert about one deleted Collection. */
export function danglingScopeAlertKey(collectionId: string): string {
  return `teammate-scope:${collectionId}`;
}

/**
 * Every Teammate in this Organization that still searches something. The
 * `deletedAt: null` filter is what excludes a retired one, in both adapters: a
 * tombstoned Teammate searches nothing, so it holds no Alert open.
 */
function liveTeammates(db: Db, organizationId: string): Promise<Teammate[]> {
  return db.table("teammates").list({ organizationId, deletedAt: null });
}

const searching = (teammates: readonly Teammate[], collectionId: string) =>
  teammates.filter((teammate) => teammate.collectionIds.includes(collectionId));

/**
 * Raise the Alert when a deleted Collection was still in someone's scope.
 *
 * One Alert per Collection, not per Teammate: the thing that broke is the
 * Collection, and an admin wants one row that names everyone affected rather
 * than a row each. Silent when nothing referenced it, which is the common case.
 */
export async function raiseDanglingCollectionAlert(
  db: Db,
  organizationId: string,
  collectionId: string,
  collectionName: string
): Promise<void> {
  const affected = searching(
    await liveTeammates(db, organizationId),
    collectionId
  );
  if (affected.length === 0) return;

  await db.raiseAlert(organizationId, {
    type: "knowledge",
    ...danglingScopeAlertCopy(
      collectionName,
      affected.map((teammate) => teammate.name)
    ),
    sourceKey: danglingScopeAlertKey(collectionId),
  });
}

/**
 * Resolve the Alert for any of these Collections that nobody searches any more.
 *
 * Called after a scope edit or a soft delete with the ids that changed hands.
 * It re-asks the question rather than trusting the caller's diff: two Teammates
 * can name the same missing Collection, and one of them cleaning up does not
 * fix the other. Resolving a key that was never raised is a no-op, so a caller
 * may hand over every id it touched, live ones included.
 */
export async function resolveDanglingCollectionAlerts(
  db: Db,
  organizationId: string,
  collectionIds: readonly string[]
): Promise<void> {
  const ids = new Set(collectionIds);
  if (ids.size === 0) return;
  // One listing for every id, not one per id: a scope edit can hand over a
  // dozen, and each would otherwise re-read the whole roster.
  const teammates = await liveTeammates(db, organizationId);
  for (const collectionId of ids) {
    if (searching(teammates, collectionId).length > 0) continue;
    await db.resolveAlertsByKey(organizationId, danglingScopeAlertKey(collectionId));
  }
}

/**
 * The other direction (#769 review): a scope can *acquire* an id whose
 * Collection is already gone, by naming it in a create or an edit. Deleting the
 * Collection is the common way a scope goes stale, but it is not the only one,
 * and an invariant that only holds on one path is not an invariant.
 *
 * Each added id is checked against the Collections that exist. A dangling one
 * raises the same Alert, under the same key, so the delete path and this one
 * cannot produce two rows for the same broken Collection.
 */
export async function raiseAlertsForAddedScope(
  db: Db,
  organizationId: string,
  addedCollectionIds: readonly string[]
): Promise<void> {
  const ids = new Set(addedCollectionIds);
  if (ids.size === 0) return;
  const teammates = await liveTeammates(db, organizationId);
  for (const collectionId of ids) {
    const collection = await db.getCollection(collectionId);
    // Still there, or belonging to another Organization: either way this
    // Organization has nothing to fix.
    if (collection && collection.organizationId === organizationId) continue;
    const affected = searching(teammates, collectionId);
    if (affected.length === 0) continue;
    await db.raiseAlert(organizationId, {
      type: "knowledge",
      ...danglingScopeAlertCopy(
        collectionId,
        affected.map((teammate) => teammate.name)
      ),
      sourceKey: danglingScopeAlertKey(collectionId),
    });
  }
}
