import { z } from "zod";
import type {
  Assistant,
  Concept,
  KnowledgeCollection,
  Source,
} from "@agent-hub/core";
import { okfActor } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Knowledge domain (#622) — Sources, FAQs, re-crawl.
 *
 * Split of responsibilities, on purpose:
 * - **Surfaces** (web action / API route) do extraction (`extractSourceText`)
 *   and original-binary storage — stateless work with no tenancy dimension.
 * - **Operations** own the guards (assistant → collection → source chains)
 *   and the Db writes.
 * - **Ports** carry the pipeline effects (ingestion job, OKF FAQ persist,
 *   graph retirement, crawl restart), each wired over the surface's own Db.
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

/** collectionId → Collection whose Assistant is the caller's, or not_found. */
async function requireCollection(
  ctx: OperationContext,
  collectionId: string,
  assistantId?: string
): Promise<KnowledgeCollection> {
  const collection = await ctx.db.getCollection(collectionId);
  if (!collection) throw new OperationError("not_found", "Collection not found");
  if (assistantId && collection.assistantId !== assistantId) {
    throw new OperationError("not_found", "Collection not found");
  }
  await requireAssistant(ctx, collection.assistantId);
  return collection;
}

async function requireSource(
  ctx: OperationContext,
  sourceId: string
): Promise<{ source: Source; collection: KnowledgeCollection }> {
  const source = await ctx.db.getSource(sourceId);
  if (!source) throw new OperationError("not_found", "Source not found");
  const collection = await requireCollection(ctx, source.collectionId);
  return { source, collection };
}

export const listCollectionsOp = defineOperation({
  name: "knowledge.collections.list",
  capability: "member",
  input: z.object({ assistantId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    return ctx.db.listCollections(assistantId);
  },
});

export const listSourcesOp = defineOperation({
  name: "knowledge.sources.list",
  capability: "member",
  input: z.object({ collectionId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { collectionId }) => {
    await requireCollection(ctx, collectionId);
    return ctx.db.listSources(collectionId);
  },
});

export const getSourceOp = defineOperation({
  name: "knowledge.sources.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }) => (await requireSource(ctx, id)).source,
});

/**
 * Creates the Source row (`processing`) and defers the OKF pipeline to an
 * Ingestion Job through the port; callers poll the Source status until it
 * settles. `rawText` is the already-extracted text — extraction happens at
 * the surface. `originalObjectPath` is set when the surface persisted the
 * uploaded binary (file Sources only).
 */
export const addSourceOp = defineOperation({
  name: "knowledge.sources.add",
  capability: "edit",
  input: z.object({
    /** Optional cross-check; the Collection is the authority on ownership. */
    assistantId: z.string().min(1).optional(),
    collectionId: z.string().min(1),
    name: z.string().min(1).max(500),
    kind: z.enum(["text", "url", "file"]),
    rawText: z.string().min(1),
    sourceUrl: z.string().url().max(2000).optional(),
    originalObjectPath: z.string().max(1000).optional(),
  }),
  entities: (_input, result: { source: Source; assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
  ],
  run: async (ctx, input) => {
    const collection = await requireCollection(
      ctx,
      input.collectionId,
      input.assistantId
    );
    const source = await ctx.db.createSource({
      collectionId: input.collectionId,
      name: input.name,
      kind: input.kind,
      originalObjectPath: input.originalObjectPath ?? null,
      ...(input.sourceUrl ? { config: { url: input.sourceUrl } } : {}),
    });
    await ctx.ports?.enqueueIngest?.({
      assistantId: collection.assistantId,
      collectionId: input.collectionId,
      sourceId: source.id,
      rawText: input.rawText,
    });
    return { source, assistantId: collection.assistantId };
  },
});

export const deleteSourceOp = defineOperation({
  name: "knowledge.sources.delete",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: (_input, result: { assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
  ],
  run: async (ctx, { id }) => {
    const { source, collection } = await requireSource(ctx, id);
    // Deleting a Source cascade-deletes its Concepts; capture their ids first
    // and retire their graph documents — the Collection survives, so orphaned
    // docs would otherwise pollute its live retrieval (ADR-0017).
    const conceptIds = (await ctx.db.listConcepts(source.collectionId))
      .filter((c) => c.sourceId === id)
      .map((c) => c.id);
    await ctx.db.deleteSource(id);
    for (const conceptId of conceptIds) {
      await ctx.ports?.removeConceptGraph?.(source.collectionId, conceptId);
    }
    return { assistantId: collection.assistantId };
  },
});

export const createFaqOp = defineOperation({
  name: "knowledge.faqs.create",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1).optional(),
    collectionId: z.string().min(1),
    question: z.string().min(1).max(1000),
    answer: z.string().min(1).max(20000),
  }),
  entities: (_input, result: { concept: Concept; assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
  ],
  run: async (ctx, input) => {
    const collection = await requireCollection(
      ctx,
      input.collectionId,
      input.assistantId
    );
    if (!ctx.ports?.persistFaq) {
      throw new OperationError(
        "invalid_input",
        "FAQ persistence is not available on this surface"
      );
    }
    const concept = await ctx.ports.persistFaq({
      assistantId: collection.assistantId,
      collectionId: input.collectionId,
      question: input.question,
      answer: input.answer,
      // Hand-authored: writing a FAQ is generation, not verification (§5.2).
      provenance: {
        generated: {
          by: okfActor.human(ctx.userId || "api-key"),
          at: new Date().toISOString(),
        },
      },
    });
    return { concept, assistantId: collection.assistantId };
  },
});

/** Bulk FAQ import — the parsed rows of a two-column CSV. */
export const importFaqsOp = defineOperation({
  name: "knowledge.faqs.import",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1).optional(),
    collectionId: z.string().min(1),
    /** Recorded as each Concept's OKF `sources` entry (what it derives from). */
    fileName: z.string().max(300).optional(),
    rows: z
      .array(
        z.object({
          question: z.string().min(1).max(1000),
          answer: z.string().min(1).max(20000),
        })
      )
      .max(2000),
  }),
  entities: (_input, result: { imported: number; assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
  ],
  run: async (ctx, input) => {
    const collection = await requireCollection(
      ctx,
      input.collectionId,
      input.assistantId
    );
    if (!ctx.ports?.persistFaq) {
      throw new OperationError(
        "invalid_input",
        "FAQ persistence is not available on this surface"
      );
    }
    const at = new Date().toISOString();
    let imported = 0;
    for (const [index, row] of input.rows.entries()) {
      await ctx.ports.persistFaq({
        assistantId: collection.assistantId,
        collectionId: input.collectionId,
        question: row.question,
        answer: row.answer,
        // The indexed suffix keeps same-slug rows from overwriting each other.
        pathSuffix: `-${index}`,
        provenance: {
          // Hand-authored content the member supplied in bulk — the person,
          // not the importer, is the author; the CSV is the derivation (§5.1).
          generated: { by: okfActor.human(ctx.userId || "api-key"), at },
          ...(input.fileName
            ? {
                sources: [
                  {
                    id: "faq-csv",
                    resource: `upload "${input.fileName}"`,
                    title: input.fileName,
                  },
                ],
              }
            : {}),
        },
      });
      imported += 1;
    }
    return { imported, assistantId: collection.assistantId };
  },
});

export const recrawlSourceOp = defineOperation({
  name: "knowledge.sources.recrawl",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: (_input, result: { assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
    { kind: "alerts" as const },
  ],
  run: async (ctx, { id }) => {
    const { source, collection } = await requireSource(ctx, id);
    if (source.kind !== "website") {
      throw new OperationError("invalid_input", "Only website Sources re-crawl");
    }
    if (!ctx.ports?.restartCrawl) {
      throw new OperationError(
        "invalid_input",
        "Crawling is not available on this surface"
      );
    }
    await ctx.ports.restartCrawl(id);
    return { assistantId: collection.assistantId };
  },
});
