import type { Role, Teammate } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { readableTeammate } from "@ciele/ops";

/**
 * The one place the web surfaces resolve a Teammate (#768): the page that
 * renders it and the chat route that answers for it ask the same question, so
 * a change to visibility is one edit rather than two that can disagree.
 *
 * A thin adapter over the operations layer's `readableTeammate`, which the
 * API surface answers through too, so the guard itself lives once. What this
 * wrapper adds is the session's shape: a Member whose Role has not resolved
 * yet is treated as a Viewer, the floor.
 *
 * Null covers "no such Teammate", "another Organization's", and "not yours to
 * see", on purpose. A colleague must not learn that someone's private Teammate
 * exists.
 */
export async function findVisibleTeammate(
  db: Db,
  organizationId: string,
  id: string,
  viewer: { userId: string; role: Role | null }
): Promise<Teammate | null> {
  return readableTeammate(db, organizationId, id, {
    userId: viewer.userId,
    role: viewer.role ?? "viewer",
  });
}
