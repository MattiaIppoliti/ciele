import { z } from "zod";
import type {
  Conversation,
  StoredMessage,
  Teammate,
  TeammatePatch,
} from "@agent-hub/core";
import { visibleTeammates } from "@agent-hub/core";
import {
  raiseAlertsForAddedScope,
  raiseAlertsForAddedSourceScope,
  resolveDanglingCollectionAlerts,
  resolveDanglingSourceAlerts,
} from "@agent-hub/db";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import {
  findTeammate,
  requireEditableTeammate,
  requireReadableTeammate,
} from "./teammate-access";

/**
 * The Teammates domain (#768): the AI Teammate as an org resource.
 *
 * Two access rules run on every operation and they are deliberately different.
 * The **capability** (Editor and up to write) is the surface's job, declared
 * here and enforced by the caller. The **ownership** rule (who owns this
 * Teammate, who was named on it, who administers the Organization) is this
 * layer's job, because it depends on the row: `canViewTeammate` /
 * `canEditTeammate` in the domain package decide, the guards in
 * `teammate-access.ts` refuse, and every Teammate-shaped module shares them.
 *
 * A refusal is always `not_found`, never "forbidden": telling a colleague that
 * a private Teammate exists but is not theirs is itself the leak.
 *
 * Roster hiding (story 10) is the one part of this domain that deliberately
 * does not reach `/api/v1`, the CLI or the MCP server, unlike list/get/create/
 * update/delete. Those callers authenticate as an organization API key, and a
 * key has no roster: hiding is a fact about one person's console, so exposing
 * it would mean inventing a Member for a machine to be.
 */

const idSchema = z.object({ id: z.string().min(1) });

const visibilitySchema = z.enum(["org", "private"]);
const collectionIdsSchema = z.array(z.string().min(1)).max(50);
/**
 * Individual Library items, capped higher than Collections because that is the
 * point of them: picking six files and two FAQs out of a Library is the case a
 * Collection cap of 50 would make awkward for no reason. Still capped, because
 * an unbounded list is an unbounded `in (...)` on every search.
 */
const sourceIdsSchema = z.array(z.string().min(1)).max(200);

export const teammatePatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    title: z.string().max(120),
    roleDescription: z.string().max(10000),
    avatarSeed: z.string().max(120),
    visibility: visibilitySchema,
    collectionIds: collectionIdsSchema,
    sourceIds: sourceIdsSchema,
    editorIds: z.array(z.string().min(1)).max(100),
    // The attached Project (#771). Editor-writable like the rest of the
    // persona, unlike the grants, which are admin work on their own surface.
    projectId: z.string().min(1).nullable(),
  })
  .partial() satisfies z.ZodType<TeammatePatch, TeammatePatch>;

/** The roster read every operation shares: this org's rows, tombstones out. */
async function orgTeammates(ctx: OperationContext): Promise<Teammate[]> {
  return ctx.db
    .table("teammates")
    .list({ organizationId: ctx.organizationId, deletedAt: null });
}

/**
 * Every Teammate this caller may see. Permission only, deliberately **not** the
 * Member's roster.
 *
 * Roster hiding (story 10) is applied by the console page over this list, not
 * here, and the reason is that this operation is also `GET /api/v1/teammates`,
 * `ciele teammates list` and an MCP tool. An API key carries its creator's user
 * id (`actorUserId: key.createdBy`), so filtering here would silently drop
 * Teammates from a machine contract because one person tidied their sidebar.
 * A preference about a list belongs to the surface that draws the list.
 */
export const listTeammatesOp = defineOperation({
  name: "teammates.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<Teammate[]> =>
    visibleTeammates(await orgTeammates(ctx), {
      userId: ctx.userId,
      role: ctx.role,
    }),
});

/**
 * Hide a Teammate from this Member's roster, and only theirs (#767, story 10).
 *
 * `member`, not `edit`: this changes nothing about the Teammate, so requiring
 * the capability that renames one would be asking for a permission to tidy your
 * own list. The Teammate must still be one this Member may see, which is what
 * stops an id from anywhere becoming a row.
 */
/**
 * The Member whose roster this is, or a refusal.
 *
 * Without it an absent `userId` would put `''` into a `uuid` column and fail as
 * a database error where an answer belongs. Note this cannot tell a session
 * from an API key, because a key carries its creator's user id: what keeps
 * these two off the machine surface is that neither has an /api/v1 route, a CLI
 * command or an MCP tool, on purpose.
 */
function requireRosterOwner(ctx: OperationContext): string {
  if (!ctx.userId) {
    throw new OperationError(
      "invalid_input",
      "Hiding a teammate is a preference on a member's own roster, so it needs a signed-in member rather than an API key."
    );
  }
  return ctx.userId;
}

export const hideTeammateOp = defineOperation({
  name: "teammates.hide",
  capability: "member",
  input: idSchema,
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx, { id }): Promise<void> => {
    const userId = requireRosterOwner(ctx);
    await requireReadableTeammate(ctx, id);
    const held = await ctx.db
      .table("teammateRosterHidden")
      .list({ teammateId: id, userId });
    // Hiding twice is hiding. The unique constraint would refuse the second
    // row, and there is nothing to tell the Member about that.
    if (held.length > 0) return;
    await ctx.db.table("teammateRosterHidden").insert({
      organizationId: ctx.organizationId,
      teammateId: id,
      userId,
    });
  },
});

/** Put it back on this Member's roster. Unhiding is deleting the row. */
export const unhideTeammateOp = defineOperation({
  name: "teammates.unhide",
  capability: "member",
  input: idSchema,
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx, { id }): Promise<void> => {
    const userId = requireRosterOwner(ctx);
    const held = await ctx.db
      .table("teammateRosterHidden")
      .list({ teammateId: id, userId });
    await Promise.all(
      held.map((row) => ctx.db.table("teammateRosterHidden").delete(row.id))
    );
  },
});

export const getTeammateOp = defineOperation({
  name: "teammates.get",
  capability: "member",
  input: idSchema,
  entities: () => [],
  run: (ctx, { id }) => requireReadableTeammate(ctx, id),
});

/** What creating a Teammate accepts. Named so the API contract can render it. */
export const teammateInputSchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().max(120).optional(),
  roleDescription: z.string().max(10000).optional(),
  avatarSeed: z.string().max(120).optional(),
  visibility: visibilitySchema.optional(),
  collectionIds: collectionIdsSchema.optional(),
  sourceIds: sourceIdsSchema.optional(),
});

export const createTeammateOp = defineOperation({
  name: "teammates.create",
  capability: "edit",
  input: teammateInputSchema,
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx, input) => {
    const teammate = await ctx.db.table("teammates").insert({
      organizationId: ctx.organizationId,
      // The creator owns it. Ownership is not a role, it is who answers for
      // this Teammate when nobody else was named.
      ownerId: ctx.userId,
      ...input,
    });
    // A scope can name a Collection, or a Library item, that is already gone
    // (#769).
    await raiseAlertsForAddedScope(
      ctx.db,
      ctx.organizationId,
      teammate.collectionIds
    );
    await raiseAlertsForAddedSourceScope(
      ctx.db,
      ctx.organizationId,
      teammate.sourceIds
    );
    return teammate;
  },
});

export const updateTeammateOp = defineOperation({
  name: "teammates.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: teammatePatchSchema }),
  entities: ({ id }) => [
    { kind: "teammate" as const, id },
    // The roster card shows the name, the title and the scope size.
    { kind: "teammateList" as const },
  ],
  run: async (ctx, { id, patch }) => {
    const before = await requireEditableTeammate(ctx, id);
    const updated = await ctx.db.table("teammates").update(id, patch);
    // Cleaning a scope is how a dangling-Collection Alert clears (#769). Every
    // id that left the scope is re-asked, because another Teammate may still
    // name the same missing Collection.
    const dropped = before.collectionIds.filter(
      (collectionId) => !updated.collectionIds.includes(collectionId)
    );
    if (dropped.length > 0) {
      await resolveDanglingCollectionAlerts(ctx.db, ctx.organizationId, dropped);
    }
    // And the other direction: an edit can name a Collection that is gone.
    const added = updated.collectionIds.filter(
      (collectionId) => !before.collectionIds.includes(collectionId)
    );
    await raiseAlertsForAddedScope(ctx.db, ctx.organizationId, added);

    // The individual-Library-item half of the scope, same two directions.
    const droppedSources = before.sourceIds.filter(
      (sourceId) => !updated.sourceIds.includes(sourceId)
    );
    if (droppedSources.length > 0) {
      await resolveDanglingSourceAlerts(
        ctx.db,
        ctx.organizationId,
        droppedSources
      );
    }
    await raiseAlertsForAddedSourceScope(
      ctx.db,
      ctx.organizationId,
      updated.sourceIds.filter(
        (sourceId) => !before.sourceIds.includes(sourceId)
      )
    );
    return updated;
  },
});

export const deleteTeammateOp = defineOperation({
  name: "teammates.delete",
  capability: "edit",
  input: idSchema,
  entities: ({ id }) => [
    { kind: "teammate" as const, id },
    { kind: "teammateList" as const },
  ],
  run: async (ctx, { id }): Promise<void> => {
    const teammate = await requireEditableTeammate(ctx, id);
    // A tombstone, not a delete: the Conversations this Teammate had are the
    // record of work that happened, and they stay readable (#767).
    await ctx.db
      .table("teammates")
      .update(id, { deletedAt: new Date().toISOString() });
    // A retired Teammate searches nothing, so it stops holding a dangling-scope
    // Alert open on its own, in either half of the scope (#769).
    if (teammate.collectionIds.length > 0) {
      await resolveDanglingCollectionAlerts(
        ctx.db,
        ctx.organizationId,
        teammate.collectionIds
      );
    }
    if (teammate.sourceIds.length > 0) {
      await resolveDanglingSourceAlerts(
        ctx.db,
        ctx.organizationId,
        teammate.sourceIds
      );
    }
  },
});

export const listTeammateThreadOp = defineOperation({
  name: "teammates.thread",
  capability: "member",
  input: idSchema,
  entities: () => [],
  run: async (ctx, { id }): Promise<Conversation[]> => {
    await requireReadableTeammate(ctx, id);
    // One Member's own history with this Teammate. Nobody reads a colleague's
    // internal chat from here; the Inbox is for customer conversations and
    // never held these anyway.
    return ctx.db.listTeammateConversations(id, ctx.userId);
  },
});

export const readTeammateConversationOp = defineOperation({
  name: "teammates.conversation",
  capability: "member",
  input: z.object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
  }),
  entities: () => [],
  run: async (
    ctx,
    { id, conversationId }
  ): Promise<{ conversation: Conversation; messages: StoredMessage[] }> => {
    await requireReadableTeammate(ctx, id);
    const conversation = await ctx.db.getConversation(conversationId);
    // Three things have to line up: the Conversation belongs to this Teammate,
    // and to this Member. A Teammate thread is one colleague's, and the Inbox
    // (which is the org-wide view) deliberately does not hold these at all.
    if (
      !conversation ||
      conversation.teammateId !== id ||
      conversation.subjectId !== ctx.userId
    ) {
      throw new OperationError("not_found", "Conversation not found");
    }
    return {
      conversation,
      messages: await ctx.db.listMessages(conversationId),
    };
  },
});


/**
 * Accepting a referral (#773): open a conversation with the colleague another
 * Teammate suggested.
 *
 * Everything here is re-derived rather than trusted, because the input comes
 * from a card the model wrote:
 *
 * - The **target** is resolved through `canViewTeammate` against this Member,
 *   so a card naming a private Teammate (or one from another Organization)
 *   opens nothing. The tool already filtered to org-visible candidates; this
 *   is the check that holds if that filter ever slips.
 * - The **origin** must be this Member's own conversation with a Teammate. A
 *   forged id would otherwise write a `referredTo` entry onto somebody else's
 *   transcript.
 * - The **summary** is carried, not re-read, and it is stored as metadata
 *   rather than appended as a message: it is neither the Member's words nor
 *   the target's, and faking it into the transcript would be a lie the target
 *   then quotes back.
 */
export const startReferralOp = defineOperation({
  name: "teammates.referral.start",
  capability: "member",
  input: z.object({
    originConversationId: z.string().min(1),
    teammateId: z.string().min(1),
    summary: z.string().max(4000),
  }),
  entities: ({ teammateId }) => [{ kind: "teammate" as const, id: teammateId }],
  run: async (ctx, input): Promise<{ conversationId: string }> => {
    const target = await requireReadableTeammate(ctx, input.teammateId);
    if (target.deletedAt) {
      throw new OperationError(
        "conflict",
        `${target.name} was deleted, so this handoff cannot be opened.`
      );
    }

    const origin = await ctx.db.getConversation(input.originConversationId);
    if (!origin || origin.subjectId !== ctx.userId || !origin.teammateId) {
      throw new OperationError("not_found", "Conversation not found");
    }
    const referrer = await findTeammate(ctx, origin.teammateId);

    const conversation = await ctx.db.createConversation({
      teammateId: target.id,
      subjectType: "member",
      subjectId: ctx.userId,
      title: `Referred by ${referrer?.name ?? "a teammate"}`,
      metadata: {
        referredFromConversationId: origin.id,
        referredFromTeammateName: referrer?.name,
        referralSummary: input.summary,
      },
    });

    // The origin points forward too, so the handoff is a link in the data and
    // not just two threads that happen to be adjacent in time.
    await ctx.db.appendConversationReferral(origin.id, {
      conversationId: conversation.id,
      teammateId: target.id,
      teammateName: target.name,
    });
    return { conversationId: conversation.id };
  },
});
