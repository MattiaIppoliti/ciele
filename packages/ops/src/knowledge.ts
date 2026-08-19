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
 * The Knowledge domain (#622): Sources, FAQs, re-crawl.
 *
 * Split of responsibilities, on purpose:
 * - **Surfaces** (web action / API route) do extraction (`extractSourceText`)
 *   and original-binary storage, stateless work with no tenancy dimension.
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
 * collectionId → Collection the caller may touch, or not_found. Collections
 * are org-owned (PRD #726 contract): the org stamp is the whole check. The
 * optional assistantId still gates the assistant-scoped surfaces; it must
 * resolve to an Assistant of the same Organization.
 */
async function requireCollection(
  ctx: OperationContext,
  collectionId: string,
  assistantId?: string
): Promise<KnowledgeCollection> {
  const collection = await ctx.db.getCollection(collectionId);
  if (!collection) throw new OperationError("not_found", "Collection not found");
  if (collection.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Collection not found");
  }
  if (assistantId) await requireAssistant(ctx, assistantId);
  return collection;
}

/**
 * The Assistants a new knowledge item links to: the hub's explicit set, or,
 * assistant-editor add flows, the scoping assistant itself (PRD #726:
 * Collections have no owner, so the links are the only reach). The first
 * entry also stamps ingestion attribution.
 */
async function requireLinkTargets(
  ctx: OperationContext,
  input: { assistantId?: string; assistantIds?: string[] }
): Promise<string[]> {
  const targets = [
    ...new Set(
      input.assistantIds ?? (input.assistantId ? [input.assistantId] : [])
    ),
  ];
  for (const id of targets) await requireAssistant(ctx, id);
  if (targets.length === 0) {
    throw new OperationError(
      "invalid_input",
      "Pick at least one assistant to link this knowledge to"
    );
  }
  return targets;
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
 * settles. `rawText` is the already-extracted text, extraction happens at
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
    await requireCollection(ctx, input.collectionId, input.assistantId);
    const linkTargets = await requireLinkTargets(ctx, input);
    const source = await ctx.db.createSource({
      collectionId: input.collectionId,
      name: input.name,
      kind: input.kind,
      originalObjectPath: input.originalObjectPath ?? null,
      ...(input.sourceUrl ? { config: { url: input.sourceUrl } } : {}),
    });
    // Every create path links (#733): retrieval is purely link-based, so an
    // editor add links its own assistant.
    await ctx.db.setSourceAssistantLinks(source.id, linkTargets);
    await ctx.ports?.enqueueIngest?.({
      assistantId: linkTargets[0],
      collectionId: input.collectionId,
      sourceId: source.id,
      rawText: input.rawText,
    });
    return { source, assistantId: linkTargets[0] };
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

/** Every FAQ with its full answer, the org-wide CSV export (PRD #726). */
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
 * Takes effect immediately in retrieval, knowledge is live, not snapshotted.
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
 * with a retained original only, the flag can never silently expose
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
  entities: (_input, result: { assistantIds: string[] }) => [
    ...result.assistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, { id }) => {
    const { source } = await requireSource(ctx, id);
    // Every linked Assistant's editor needs revalidating, capture the links
    // before the delete cascades them away.
    const links = await ctx.db.listSourceAssistantLinks(id);
    // Deleting a Source cascade-deletes its Concepts; capture their ids first
    // and retire their graph documents, the Collection survives, so orphaned
    // docs would otherwise pollute its live retrieval (ADR-0017).
    const conceptIds = (await ctx.db.listConcepts(source.collectionId))
      .filter((c) => c.sourceId === id)
      .map((c) => c.id);
    await ctx.db.deleteSource(id);
    for (const conceptId of conceptIds) {
      await ctx.ports?.removeConceptGraph?.(source.collectionId, conceptId);
    }
    return { assistantIds: links.map((l) => l.assistantId) };
  },
});

/**
 * Removes one Assistant's link to a Source: the Source, its Concepts and every
 * other Assistant's link survive.
 *
 * The assistant editor's "remove" for a Source that answers for more than one
 * Assistant (PRD #726). Deleting the Source there would take knowledge away
 * from siblings the editor may not even be able to see, so removal and
 * deletion are two different operations rather than one button that sometimes
 * destroys more than it says.
 *
 * Stripping the last link is allowed: an unlinked Source is a legal state the
 * Library still lists and can re-link, the same state the Library's own link
 * manager can produce.
 */
export const unlinkSourceOp = defineOperation({
  name: "knowledge.sources.unlink",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1),
    sourceId: z.string().min(1),
  }),
  entities: (
    _input,
    result: { assistantIds: string[]; remaining: number }
  ) => [
    ...result.assistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, input) => {
    await requireSource(ctx, input.sourceId);
    await requireAssistant(ctx, input.assistantId);
    const links = await ctx.db.listSourceAssistantLinks(input.sourceId);
    const affected = links.map((link) => link.assistantId);
    const remaining = affected.filter((id) => id !== input.assistantId);
    // Not linked in the first place: nothing to do, and no write that would
    // rewrite the other links' Direct access flags.
    if (remaining.length === affected.length) {
      return { assistantIds: affected, remaining: remaining.length };
    }
    await ctx.db.setSourceAssistantLinks(input.sourceId, remaining);
    return { assistantIds: affected, remaining: remaining.length };
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
    await requireCollection(ctx, input.collectionId, input.assistantId);
    const linkTargets = await requireLinkTargets(ctx, input);
    if (!ctx.ports?.persistFaq) {
      throw new OperationError(
        "invalid_input",
        "FAQ persistence is not available on this surface"
      );
    }
    const concept = await ctx.ports.persistFaq({
      assistantId: linkTargets[0],
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
    if (concept.sourceId) {
      await ctx.db.setSourceAssistantLinks(concept.sourceId, linkTargets);
    }
    return { concept, assistantId: linkTargets[0] };
  },
});

/** Bulk FAQ import, the parsed rows of a two-column CSV. */
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
    await requireCollection(ctx, input.collectionId, input.assistantId);
    const linkTargets = await requireLinkTargets(ctx, input);
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
        assistantId: linkTargets[0],
        collectionId: input.collectionId,
        question: row.question,
        answer: row.answer,
        // The indexed suffix keeps same-slug rows from overwriting each other.
        pathSuffix: `-${index}`,
        provenance: {
          // Hand-authored content the member supplied in bulk, the person,
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
      if (concept.sourceId) {
        await ctx.db.setSourceAssistantLinks(concept.sourceId, linkTargets);
      }
      imported += 1;
    }
    return { imported, assistantId: linkTargets[0] };
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

/** Org-level bulk FAQ import (PRD #726), the Library + explicit links. */
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

/** The "View knowledge source" pages list (bounded server-side). */
export const listSourceConceptsOp = defineOperation({
  name: "knowledge.sources.concepts.list",
  capability: "member",
  input: z.object({ sourceId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { sourceId }) => {
    await requireSource(ctx, sourceId);
    const concepts = await ctx.db.listConceptsBySource(sourceId);
    return {
      items: concepts
        .filter((c) => !c.excluded)
        .map((c) => ({
          id: c.id,
          title: c.frontmatter.title ?? c.path,
          path: c.path,
          resourceUrl: c.frontmatter.resource ?? null,
        })),
    };
  },
});

/** One FAQ with its full answer, the hub's edit dialog. */
export const getOrgFaqOp = defineOperation({
  name: "knowledge.org.faqs.get",
  capability: "member",
  input: z.object({ sourceId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { sourceId }) => {
    const { source } = await requireSource(ctx, sourceId);
    const [concept] = await ctx.db.listConceptsBySource(sourceId, 1);
    return { question: source.name, answer: concept?.body ?? "" };
  },
});

/**
 * Hub FAQ edit, keyed by the FAQ's Source (question = Source name). Rewrites
 * the Concept (re-stamping `generated`, an edit is authorship, §5.2),
 * renames the Source, and re-embeds through the port. Chunks are stamped with
 * a linked Assistant; an unlinked FAQ is unreachable in retrieval anyway, so
 * skipping the re-embed loses nothing.
 */
export const updateOrgFaqOp = defineOperation({
  name: "knowledge.org.faqs.update",
  capability: "edit",
  input: z.object({
    sourceId: z.string().min(1),
    question: z.string().min(1).max(1000),
    answer: z.string().min(1).max(20000),
  }),
  entities: () => [{ kind: "knowledgeHub" as const }],
  run: async (ctx, input) => {
    const { source } = await requireSource(ctx, input.sourceId);
    if (source.kind !== "faq") {
      throw new OperationError("invalid_input", "Not a FAQ");
    }
    const [existing] = await ctx.db.listConceptsBySource(input.sourceId, 1);
    if (!existing) throw new OperationError("not_found", "FAQ content missing");
    const trimmed = input.question.trim();
    const concept = await ctx.db.updateConcept(existing.id, {
      frontmatter: {
        ...existing.frontmatter,
        type: "FAQ",
        title: trimmed,
        description: input.answer.slice(0, 140),
        generated: {
          by: okfActor.human(ctx.userId || "api-key"),
          at: new Date().toISOString(),
        },
      },
      body: input.answer,
    });
    await ctx.db.updateSource(input.sourceId, { name: trimmed.slice(0, 500) });
    await ctx.db.deleteChunksByConcept(concept.id);
    const links = await ctx.db.listSourceAssistantLinks(input.sourceId);
    if (links[0]) {
      await ctx.ports?.reembedConcept?.({
        assistantId: links[0].assistantId,
        collectionId: concept.collectionId,
        conceptId: concept.id,
        title: trimmed,
        body: input.answer,
      });
    }
    return concept;
  },
});

export const recrawlSourceOp = defineOperation({
  name: "knowledge.sources.recrawl",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: (_input, result: { assistantIds: string[] }) => [
    ...result.assistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
    { kind: "knowledgeHub" as const },
    { kind: "alerts" as const },
  ],
  run: async (ctx, { id }) => {
    const { source } = await requireSource(ctx, id);
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
    const links = await ctx.db.listSourceAssistantLinks(id);
    return { assistantIds: links.map((l) => l.assistantId) };
  },
});
