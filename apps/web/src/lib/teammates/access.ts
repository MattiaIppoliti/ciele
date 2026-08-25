import type { Role, Teammate } from "@agent-hub/core";
import { canViewTeammate } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/**
 * The one place the web surfaces resolve a Teammate (#768): the page that
 * renders it and the chat route that answers for it ask the same question, so
 * a change to visibility is one edit rather than two that can disagree.
 *
 * The operations layer keeps its own guard, deliberately: it is framework-free
 * and serves the API surface too. What must not drift is the rule, and that
 * lives once in `canViewTeammate`.
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
  const teammate = await db.table("teammates").get(id);
  if (!teammate || teammate.organizationId !== organizationId) return null;
  return canViewTeammate(teammate, {
    userId: viewer.userId,
    role: viewer.role ?? "viewer",
  })
    ? teammate
    : null;
}
