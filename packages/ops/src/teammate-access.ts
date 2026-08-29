import type { Role, Teammate } from "@agent-hub/core";
import { canEditTeammate, canViewTeammate } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { OperationError, type OperationContext } from "./operation";

/**
 * One place that turns a Teammate id into a Teammate this caller may have.
 *
 * Every Teammate-shaped operation needs the same two steps, the org check and
 * then the ownership rule, and the four modules that need them (#768 personas,
 * #770 grants, #771 memory, #772 routines) each wrote their own. They had
 * already drifted: the grants read checked the organization and forgot
 * `canViewTeammate`, which handed any Member holding an id the configuration of
 * a private Teammate they cannot see. That is the whole reason this module
 * exists rather than four private helpers that look alike.
 *
 * The refusal is always `not_found`, never "forbidden". "You may not see this
 * Teammate" tells the asker it exists, and for a private Teammate that is the
 * leak itself, so the three guards below are deliberately indistinguishable
 * from the outside.
 */

/** The viewer these rules decide against: the calling Member and their Role. */
function viewerOf(ctx: OperationContext): { userId: string; role: OperationContext["role"] } {
  return { userId: ctx.userId, role: ctx.role };
}

/** id → this org's Teammate, or null. No ownership rule, no tombstone rule. */
export async function findTeammate(
  ctx: OperationContext,
  id: string
): Promise<Teammate | null> {
  const teammate = await ctx.db.table("teammates").get(id);
  return teammate && teammate.organizationId === ctx.organizationId
    ? teammate
    : null;
}

/**
 * id → this org's Teammate, or `not_found`.
 *
 * The org check alone, for the two callers that have their own reason to skip
 * the ownership rule: a Teammate appending to its own memory mid-turn, and
 * anything already reached through a row that was itself guarded.
 */
export async function requireTeammate(
  ctx: OperationContext,
  id: string
): Promise<Teammate> {
  const teammate = await findTeammate(ctx, id);
  if (!teammate) throw new OperationError("not_found", "Teammate not found");
  return teammate;
}

/**
 * id → a Teammate this viewer may look at, or null.
 *
 * Takes a bare `Db` rather than an `OperationContext` because the web pages
 * resolve Teammates too, from a session with no operation in flight; both
 * surfaces answering through this one function is what keeps the org check and
 * the ownership rule from drifting apart again (see the module header).
 */
export async function readableTeammate(
  db: Db,
  organizationId: string,
  id: string,
  viewer: { userId: string; role: Role }
): Promise<Teammate | null> {
  const teammate = await db.table("teammates").get(id);
  if (!teammate || teammate.organizationId !== organizationId) return null;
  return canViewTeammate(teammate, viewer) ? teammate : null;
}

/**
 * id → a Teammate this caller may look at, or `not_found`.
 *
 * Deliberately blind to the tombstone: a soft delete has to leave past
 * Conversations readable, and the only surface holding them is the Teammate's
 * own thread (#767, story 33).
 */
export async function requireReadableTeammate(
  ctx: OperationContext,
  id: string
): Promise<Teammate> {
  const teammate = await readableTeammate(
    ctx.db,
    ctx.organizationId,
    id,
    viewerOf(ctx)
  );
  if (!teammate) {
    throw new OperationError("not_found", "Teammate not found");
  }
  return teammate;
}

/**
 * id → a Teammate this caller may change, or `not_found`.
 *
 * Two steps above readable: the ownership rule, and a Teammate that has not
 * been retired. `canEditTeammate` already implies `canViewTeammate` (both end
 * at owner, named editor, or org admin), so this is one check and not two.
 */
export async function requireEditableTeammate(
  ctx: OperationContext,
  id: string
): Promise<Teammate> {
  const teammate = await findTeammate(ctx, id);
  if (!teammate || !canEditTeammate(teammate, viewerOf(ctx))) {
    throw new OperationError("not_found", "Teammate not found");
  }
  return teammate;
}
