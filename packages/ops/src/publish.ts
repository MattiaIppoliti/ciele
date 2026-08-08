import { z } from "zod";
import type { Assistant } from "@agent-hub/core";
import { buildPublicationConfig } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Publish domain (#623). Publications are immutable snapshots
 * (`buildPublicationConfig` decides what freezes); the widget cache learns
 * about a new latest version through the `invalidatePublication` port so
 * live widgets flip without a Postgres round-trip per request.
 */

async function requireAssistant(
  ctx: OperationContext,
  id: string
): Promise<Assistant> {
  const assistant = await ctx.db.getAssistant(id);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

const assistantIdSchema = z.object({ assistantId: z.string().min(1) });

export const publishAssistantOp = defineOperation({
  name: "publish.publish",
  capability: "publish",
  input: assistantIdSchema,
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId }) => {
    const assistant = await requireAssistant(ctx, assistantId);
    const selected = new Set(assistant.tools?.entities ?? []);
    const [flows, collections, skills, orgEntities] = await Promise.all([
      ctx.db.listFlows(assistantId),
      ctx.db.listCollections(assistantId),
      ctx.db.listAssistantSkills(assistantId),
      selected.size === 0
        ? Promise.resolve([])
        : ctx.ports?.listPublicationEntities
          ? ctx.ports.listPublicationEntities(assistant.organizationId)
          : ctx.db.table("entities").list({ organizationId: assistant.organizationId }),
    ]);
    const entities = orgEntities.filter((entity) => selected.has(entity.id));
    const publication = await ctx.db.createPublication(
      assistantId,
      buildPublicationConfig(assistant, flows, collections, skills, entities)
    );
    await ctx.ports?.invalidatePublication?.(assistantId);
    return { version: publication.version, publicationId: publication.id };
  },
});

export const unpublishAssistantOp = defineOperation({
  name: "publish.unpublish",
  capability: "publish",
  input: assistantIdSchema,
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    await ctx.db.deletePublications(assistantId);
    await ctx.ports?.invalidatePublication?.(assistantId);
  },
});

export const republishOp = defineOperation({
  name: "publish.republish",
  capability: "publish",
  input: z.object({
    assistantId: z.string().min(1),
    publicationId: z.string().min(1),
  }),
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId, publicationId }) => {
    await requireAssistant(ctx, assistantId);
    const old = await ctx.db.getPublication(publicationId);
    if (!old || old.assistantId !== assistantId) {
      throw new OperationError("not_found", "Publication not found");
    }
    const publication = await ctx.db.createPublication(assistantId, old.config);
    await ctx.ports?.invalidatePublication?.(assistantId);
    return { version: publication.version, publicationId: publication.id };
  },
});

/** Publication state a CI script needs: published?, version, when. */
export const publicationStatusOp = defineOperation({
  name: "publish.status",
  capability: "member",
  input: assistantIdSchema,
  entities: () => [],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    const latest = await ctx.db.getLatestPublication(assistantId);
    return latest
      ? {
          published: true as const,
          publicationId: latest.id,
          version: latest.version,
          publishedAt: latest.createdAt,
        }
      : { published: false as const };
  },
});
