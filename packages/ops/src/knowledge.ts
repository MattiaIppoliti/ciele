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

/**
 * collectionId → Collection the caller may touch, or not_found. Two ownership
 * shapes (PRD #726): org-owned Collections (e.g. the per-org "Knowledge
 * Library", `assistantId === ""`) check the org stamp directly; legacy
 * assistant-owned ones check through the owning Assistant.
 */
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
  if (collection.assistantId) {
    await requireAssistant(ctx, collection.assistantId);
  } else if (collection.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Collection not found");
  }
  return collection;
}

/**
 * Resolves the assistant that stamps ingestion for a Source in this
 * Collection: the legacy owner, or (org-owned Collections) the first of the
 * explicitly linked Assistants — which the input must then provide.
 */
async function requireIngestAssistant(
  ctx: OperationContext,
  collection: KnowledgeCollection,
  assistantIds: string[] | undefined
): Promise<string> {
  for (const id of assistantIds ?? []) await requireAssistant(ctx, id);
  const effective = collection.assistantId || assistantIds?.[0];
  if (!effective) {
    throw new OperationError(
      "invalid_input",
      "Pick at least one assistant to link this knowledge to"
    );
  }
  return effective;
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
    /**
     * Hub add flows (PRD #726): the full linked-assistant set for the new
     * Source, replacing the owner auto-link. Required (≥1) when the
     * Collection is org-owned.
     */
    assistantIds: z.array(z.string().min(1)).max(50).optional(),
  }),
  entities: (_input, result: { source: Source; assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, input) => {
    const collection = await requireCollection(
      ctx,
      input.collectionId,
      input.assistantId
    );
    const ingestAssistantId = await requireIngestAssistant(
      ctx,
      collection,
      input.assistantIds
    );
    const source = await ctx.db.createSource({
      collectionId: input.collectionId,
      name: input.name,
      kind: input.kind,
      originalObjectPath: input.originalObjectPath ?? null,
      ...(input.sourceUrl ? { config: { url: input.sourceUrl } } : {}),
    });
    if (input.assistantIds) {
      await ctx.db.setSourceAssistantLinks(source.id, [
        ...new Set(input.assistantIds),
      ]);
    }
    await ctx.ports?.enqueueIngest?.({
      assistantId: ingestAssistantId,
      collectionId: input.collectionId,
      sourceId: source.id,
      rawText: input.rawText,
    });
    return { source, assistantId: ingestAssistantId };
  },
});

/** One hub-table page of the Organization's knowledge items (PRD #726). */
export const listOrgKnowledgeSourcesOp = defineOperation({
  name: "knowledge.org.list",
  capability: "member",
  input: z.object({
    kinds: z
      .array(z.enum(["website", "url", "file", "text", "faq"]))
      .min(1)
      .max(5),
    status: z.enum(["processing", "ready", "error"]).optional(),
    assistantId: z.string().optional(),
    query: z.string().max(200).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }),
  entities: () => [],
  run: (ctx, input) => ctx.db.listOrgKnowledgeSources(ctx.organizationId, input),
});

/** Every FAQ with its full answer — the org-wide CSV export (PRD #726). */
export const listOrgFaqsOp = defineOperation({
  name: "knowledge.org.faqs.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listOrgFaqs(ctx.organizationId),
});

/**
 * Replaces a Source's full linked-assistant set ("Manage linked assistants",
 * PRD #726). Links kept across the call preserve their Direct access flag.
 * Takes effect immediately in retrieval — knowledge is live, not snapshotted.
 */
export const setSourceLinksOp = defineOperation({
  name: "knowledge.sources.links.set",
  capability: "edit",
  input: z.object({
    sourceId: z.string().min(1),
    assistantIds: z.array(z.string().min(1)).max(50),
  }),
  entities: () => [{ kind: "knowledgeHub" as const }],
  run: async (ctx, input) => {
    await requireSource(ctx, input.sourceId);
    for (const id of input.assistantIds) await requireAssistant(ctx, id);
    await ctx.db.setSourceAssistantLinks(input.sourceId, [
      ...new Set(input.assistantIds),
    ]);
    return ctx.db.listSourceAssistantLinks(input.sourceId);
  },
});

/**
 * Flips Direct access on one (assistant, source) link (PRD #726): whether
 * chat users of that assistant may open the cited file itself. File Sources
 * with a retained original only — the flag can never silently expose
 * anything else.
 */
export const setDirectAccessOp = defineOperation({
  name: "knowledge.sources.direct_access.set",
  capability: "edit",
  input: z.object({
    sourceId: z.string().min(1),
    assistantId: z.string().min(1),
    directAccess: z.boolean(),
  }),
  entities: () => [{ kind: "knowledgeHub" as const }],
  run: async (ctx, input) => {
    const { source } = await requireSource(ctx, input.sourceId);
    if (source.kind !== "file") {
      throw new OperationError(
        "invalid_input",
        "Direct access applies to file Sources only"
      );
    }
    if (!source.originalObjectPath) {
      throw new OperationError(
        "invalid_input",
        "This file has no stored original to hand out"
      );
    }
    await requireAssistant(ctx, input.assistantId);
    await ctx.db.setSourceDirectAccess(
      input.sourceId,
      input.assistantId,
      input.directAccess
    );
    return ctx.db.listSourceAssistantLinks(input.sourceId);
  },
});

export const deleteSourceOp = defineOperation({
  name: "knowledge.sources.delete",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: (_input, result: { assistantId: string }) => [
    ...(result.assistantId
      ? [{ kind: "assistantEditor" as const, assistantId: result.assistantId }]
      : []),
    { kind: "knowledgeHub" as const },
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
    /** Hub create (PRD #726): the linked-assistant set for the new FAQ. */
    assistantIds: z.array(z.string().min(1)).max(50).optional(),
  }),
  entities: (_input, result: { concept: Concept; assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, input) => {
    const collection = await requireCollection(
      ctx,
      input.collectionId,
      input.assistantId
    );
    const ingestAssistantId = await requireIngestAssistant(
      ctx,
      collection,
      input.assistantIds
    );
    if (!ctx.ports?.persistFaq) {
      throw new OperationError(
        "invalid_input",
        "FAQ persistence is not available on this surface"
      );
    }
    const concept = await ctx.ports.persistFaq({
      assistantId: ingestAssistantId,
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
    if (input.assistantIds && concept.sourceId) {
      await ctx.db.setSourceAssistantLinks(concept.sourceId, [
        ...new Set(input.assistantIds),
      ]);
    }
    return { concept, assistantId: ingestAssistantId };
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
    /** Hub import (PRD #726): the linked-assistant set for every new FAQ. */
    assistantIds: z.array(z.string().min(1)).max(50).optional(),
  }),
  entities: (_input, result: { imported: number; assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, input) => {
    const collection = await requireCollection(
      ctx,
      input.collectionId,
      input.assistantId
    );
    const ingestAssistantId = await requireIngestAssistant(
      ctx,
      collection,
      input.assistantIds
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
      const concept = await ctx.ports.persistFaq({
        assistantId: ingestAssistantId,
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
      if (input.assistantIds && concept.sourceId) {
        await ctx.db.setSourceAssistantLinks(concept.sourceId, [
          ...new Set(input.assistantIds),
        ]);
      }
      imported += 1;
    }
    return { imported, assistantId: ingestAssistantId };
  },
});

/**
 * Org-level FAQ create (PRD #726): lands in the per-org Knowledge Library and
 * links the chosen Assistants. Thin wrapper over createFaqOp so the guard and
 * persist path stay single-sourced.
 */
export const createOrgFaqOp = defineOperation({
  name: "knowledge.org.faqs.create",
  capability: "edit",
  input: z.object({
    question: z.string().min(1).max(1000),
    answer: z.string().min(1).max(20000),
    assistantIds: z.array(z.string().min(1)).min(1).max(50),
  }),
  entities: (_input, result: { concept: Concept; assistantId: string }) =>
    createFaqOp.entities(
      { collectionId: "", question: "", answer: "" },
      result
    ),
  run: async (ctx, input) => {
    const library = await ctx.db.getOrCreateOrgLibraryCollection(
      ctx.organizationId
    );
    return createFaqOp.run(ctx, { collectionId: library.id, ...input });
  },
});

/** Org-level bulk FAQ import (PRD #726) — the Library + explicit links. */
export const importOrgFaqsOp = defineOperation({
  name: "knowledge.org.faqs.import",
  capability: "edit",
  input: z.object({
    fileName: z.string().max(300).optional(),
    rows: z
      .array(
        z.object({
          question: z.string().min(1).max(1000),
          answer: z.string().min(1).max(20000),
        })
      )
      .max(2000),
    assistantIds: z.array(z.string().min(1)).min(1).max(50),
  }),
  entities: (_input, result: { imported: number; assistantId: string }) =>
    importFaqsOp.entities({ collectionId: "", rows: [] }, result),
  run: async (ctx, input) => {
    const library = await ctx.db.getOrCreateOrgLibraryCollection(
      ctx.organizationId
    );
    return importFaqsOp.run(ctx, { collectionId: library.id, ...input });
  },
});

export const recrawlSourceOp = defineOperation({
  name: "knowledge.sources.recrawl",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: (_input, result: { assistantId: string }) => [
    ...(result.assistantId
      ? [{ kind: "assistantEditor" as const, assistantId: result.assistantId }]
      : []),
    { kind: "knowledgeHub" as const },
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
