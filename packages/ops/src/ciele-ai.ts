import { z } from "zod";
import { CIELE_AI_DEFAULT_NAME, thrownMessage, type Teammate } from "@agent-hub/core";

import { defineOperation, OperationError, type OperationContext } from "./operation";

/**
 * Ciele AI's lifecycle: the Organization's default AI layer, one per
 * Organization, created the first time anybody opens the Chat surface.
 *
 * Lazy rather than a row the signup RPC writes, for the reason the Flows Agent
 * is lazy: an Organization created before this shipped needs one too, and a
 * create-on-read covers both without a backfill that would have to invent an
 * owner in SQL. Its actions come from the platform catalogue
 * (`platform-actions.ts`), run as the chatting Member, so no grant is written
 * here at all.
 */

async function findCieleAi(ctx: OperationContext): Promise<Teammate | null> {
  const rows = await ctx.db.table("teammates").list({
    organizationId: ctx.organizationId,
    systemKind: "ciele_ai",
  });
  return rows[0] ?? null;
}

/**
 * The Organization's Ciele AI, created on first use. Idempotent: a second call
 * returns the same row, and a renamed one keeps its name.
 *
 * `member` capability, because a Viewer opening Chat for the first time must
 * get one too. The caller therefore runs this on a Db that may insert the row
 * whatever the Member's Role (the web surface uses the org-pinned service
 * view, as the Teammate action path does); the operation is what bounds it to
 * exactly one row of exactly this shape.
 *
 * Owned by the Organization's owner rather than by whoever arrived first, so a
 * Viewer's first visit does not make a Viewer the owner of the org's AI layer.
 * Two first visits at once both miss the lookup; the unique index lets one
 * insert win, and the loser re-reads.
 */
export const ensureCieleAiOp = defineOperation({
  name: "cieleAi.ensure",
  capability: "member",
  effect: "write",
  input: z.object({}),
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx): Promise<Teammate> => {
    const existing = await findCieleAi(ctx);
    // Every Member's Chat opens on it, so it is always visible to all of them.
    // `teammates.update` now refuses a private one, but a row made private
    // before that guard would be refused on every Configure save, since the
    // form resends what is stored. Opening Chat puts it back.
    if (existing?.visibility === "private") {
      return ctx.db.table("teammates").update(existing.id, { visibility: "org" });
    }
    if (existing) return existing;
    const members = await ctx.db.listMembers(ctx.organizationId);
    const owner = members.find((member) => member.role === "owner")?.userId ?? ctx.userId;
    try {
      return await ctx.db.table("teammates").insert({
        organizationId: ctx.organizationId,
        ownerId: owner,
        name: CIELE_AI_DEFAULT_NAME,
        title: "",
        // No Standing Role: what it is for is stated by the product prompt,
        // and anything more is the Organization's to write.
        roleDescription: "",
        visibility: "org",
        systemKind: "ciele_ai",
      });
    } catch (error) {
      const raced = await findCieleAi(ctx);
      if (raced) return raced;
      throw new OperationError("conflict", thrownMessage(error, "Could not create Ciele AI"));
    }
  },
});
