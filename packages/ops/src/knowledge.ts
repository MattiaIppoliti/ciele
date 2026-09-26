import { z } from "zod";
import type {
  Assistant,
  Concept,
  KnowledgeCollection,
  KnowledgeMemory,
  Source,
} from "@agent-hub/core";
import {
  DOCUMENT_CHUNKS_PAGE_SIZE,
  SOURCE_DOCUMENTS_PAGE_SIZE,
} from "@agent-hub/core";
import { raiseDanglingSourceAlerts } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { writingActor } from "./actor";
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
 *   crawl restart), each wired over the surface's own Db.
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

/**
 * The Assistant scope of the drill-down (#927, #928, #932). With an
 * `assistantId`, the Source must be linked to that Assistant of this
 * Organization, or it is `not_found` here even though the Library shows it:
 * the editor does not confirm that a sibling Assistant's knowledge exists.
 * Without one, the Organization's ownership (already checked) is the scope.
 */
async function requireLinkedSource(
  ctx: OperationContext,
  source: Source,
  assistantId: string | undefined,
  message = "Source not found"
): Promise<void> {
  if (!assistantId) return;
  await requireAssistant(ctx, assistantId);
  const linked = await ctx.db.listAssistantSourceIds(assistantId);
  if (!linked.includes(source.id)) {
    throw new OperationError("not_found", message);
  }
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

/** The persisted triage verdict for a file upload (#801, CYB-09). */
const triageSchema = z.object({
  scanner: z.literal("document-triage"),
  version: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  verdict: z.literal("clean"),
  at: z.string(),
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
    /** The persisted triage verdict for a file upload (#801, CYB-09). */
    triage: triageSchema.optional(),
  }),
  entities: (_input, result: { source: Source; assistantId: string }) => [
    { kind: "assistantEditor" as const, assistantId: result.assistantId },
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, input) => {
    await requireCollection(ctx, input.collectionId, input.assistantId);
    const linkTargets = await requireLinkTargets(ctx, input);
    const config = {
      ...(input.sourceUrl ? { url: input.sourceUrl } : {}),
      // "This file was checked" becomes a row, not a claim (#801, CYB-09).
      ...(input.triage ? { triage: input.triage } : {}),
    };
    const source = await ctx.db.createSource({
      collectionId: input.collectionId,
      name: input.name,
      kind: input.kind,
      originalObjectPath: input.originalObjectPath ?? null,
      ...(Object.keys(config).length ? { config } : {}),
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
      .array(z.enum(["website", "url", "file", "text", "application", "faq"]))
      .min(1)
      .max(6),
    status: z.enum(["processing", "ready", "error"]).optional(),
    assistantId: z.string().optional(),
    query: z.string().max(200).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    /** Which column header was clicked; the default is newest first. */
    sort: z.enum(["createdAt", "name", "status", "updatedAt"]).optional(),
    ascending: z.boolean().optional(),
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
    return { assistantIds: await removeSource(ctx, id) };
  },
});

/**
 * The same delete over a selection in the Library's table.
 *
 * Deleting is per-Source work with no batch shortcut, so this is the loop the
 * console would have run anyway, moved behind one authorization and one
 * revalidation. It stops at the first Source it cannot reach, which is the
 * safe end of the trade: a partial delete that reported success would leave
 * the reader guessing which half went.
 */
export const deleteSourcesOp = defineOperation({
  name: "knowledge.sources.deleteMany",
  capability: "edit",
  input: z.object({
    ids: z.array(z.string().min(1)).min(1).max(100),
  }),
  entities: (_input, result: { assistantIds: string[] }) => [
    ...result.assistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, { ids }) => {
    const assistantIds = new Set<string>();
    for (const id of ids) {
      for (const assistantId of await removeSource(ctx, id)) {
        assistantIds.add(assistantId);
      }
    }
    return { assistantIds: [...assistantIds] };
  },
});

/** Deletes one Source and returns the Assistants whose editors it touched. */
async function removeSource(
  ctx: OperationContext,
  id: string
): Promise<string[]> {
  const { source } = await requireSource(ctx, id);
  // Every linked Assistant's editor needs revalidating, capture the links
  // before the delete cascades them away.
  const links = await ctx.db.listSourceAssistantLinks(id);
  await ctx.db.deleteSource(id);
  // A Teammate can name this Source directly in its Knowledge Scope, and that
  // is not a foreign key: the delete leaves it pointed at nothing, so the
  // operational surface says so rather than letting the scope go quiet (#769).
  await raiseDanglingSourceAlerts(ctx.db, ctx.organizationId, id, source.name);
  return links.map((l) => l.assistantId);
}

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
    await requireAssistant(ctx, input.assistantId);
    return removeSourceLink(ctx, input.assistantId, input.sourceId);
  },
});

/**
 * The same removal over a selection in an Assistant's Knowledge table.
 *
 * The bulk bar there offers this and `deleteSourcesOp` as two labelled
 * buttons rather than inferring one from whether a row happens to be shared,
 * which is what the per-row menu does: with twenty rows ticked, half of them
 * shared, an inferred choice would do two different things at once.
 */
export const unlinkSourcesOp = defineOperation({
  name: "knowledge.sources.unlinkMany",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1).max(100),
  }),
  entities: (_input, result: { assistantIds: string[] }) => [
    ...result.assistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
    { kind: "knowledgeHub" as const },
  ],
  run: async (ctx, input) => {
    await requireAssistant(ctx, input.assistantId);
    const touched = new Set<string>();
    for (const sourceId of input.sourceIds) {
      const { assistantIds } = await removeSourceLink(
        ctx,
        input.assistantId,
        sourceId
      );
      for (const id of assistantIds) touched.add(id);
    }
    return { assistantIds: [...touched] };
  },
});

/** Drops one Assistant from one Source's link set. Caller checks the Assistant. */
async function removeSourceLink(
  ctx: OperationContext,
  assistantId: string,
  sourceId: string
): Promise<{ assistantIds: string[]; remaining: number }> {
  await requireSource(ctx, sourceId);
  const links = await ctx.db.listSourceAssistantLinks(sourceId);
  const affected = links.map((link) => link.assistantId);
  const remaining = affected.filter((id) => id !== assistantId);
  // Not linked in the first place: nothing to do, and no write that would
  // rewrite the other links' Direct access flags.
  if (remaining.length === affected.length) {
    return { assistantIds: affected, remaining: remaining.length };
  }
  await ctx.db.setSourceAssistantLinks(sourceId, remaining);
  return { assistantIds: affected, remaining: remaining.length };
}

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
          by: writingActor(ctx),
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
          generated: { by: writingActor(ctx), at },
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

/**
 * Add a Source without naming a Collection (PRD #726).
 *
 * Collections stopped belonging to an Assistant at the contract migration and
 * nothing in the product creates a named one: every console door resolves the
 * per-org Knowledge Library and links explicitly. `/api/v1` never got that
 * door, so a key could only add to a Collection it had already found through
 * `GET /assistants/{id}/collections`, which is derived from the Sources
 * already linked there and is therefore empty for a new Assistant. An API
 * caller could add an org FAQ and nothing else.
 *
 * This is the same delegation `createOrgFaqOp` does, over `addSourceOp`
 * instead: resolve the Library, then run the operation that owns the guards,
 * the Source row and the ingestion enqueue. Extraction still happens at the
 * surface, so `rawText` arrives already extracted.
 */
export const addOrgSourceOp = defineOperation({
  name: "knowledge.org.sources.add",
  capability: "edit",
  input: z.object({
    name: z.string().min(1).max(500),
    kind: z.enum(["text", "url", "file"]),
    rawText: z.string().min(1),
    sourceUrl: z.string().url().max(2000).optional(),
    originalObjectPath: z.string().max(1000).optional(),
    /**
     * The Library has no owning Assistant, so the links are the only reach and
     * there is no owner to fall back on. Required here, not merely refused
     * downstream, so a caller that forgets does not spend a round trip.
     */
    assistantIds: z.array(z.string().min(1)).min(1).max(50),
    triage: triageSchema.optional(),
  }),
  entities: (_input, result: { source: Source; assistantId: string }) =>
    addSourceOp.entities(
      { collectionId: "", name: "", kind: "text", rawText: "" },
      result
    ),
  run: async (ctx, input) => {
    const library = await ctx.db.getOrCreateOrgLibraryCollection(
      ctx.organizationId
    );
    return addSourceOp.run(ctx, { collectionId: library.id, ...input });
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

/**
 * One page of a Source's Documents, for the drill-down route (#927).
 *
 * The route replaced two dialogs that each listed a Source's pages with their
 * own read; this is the one read behind both entry points. `assistantId`
 * scopes it to an Assistant's Knowledge section, where a Source the Assistant
 * is not linked to is not found rather than forbidden: the editor has no
 * business confirming that a sibling's Source exists.
 *
 * The seam it calls is still named for Concepts: `Document` is the domain
 * noun, `Concept` is what OKF and the `concepts` table call the same row, and
 * renaming a live table to make a variable agree with a label is not a trade
 * worth making. See ADR-0002's 2026-09-20 amendment.
 */
export const listSourceDocumentsOp = defineOperation({
  name: "knowledge.sources.documents.list",
  capability: "member",
  input: z.object({
    sourceId: z.string().min(1),
    /** Scopes the read to one Assistant's Knowledge section. */
    assistantId: z.string().min(1).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    /** Oldest first. The table's Updated column sorts newest first by default. */
    ascending: z.boolean().optional(),
    /** Which column header was clicked; the default is when it was stored. */
    sort: z.enum(["createdAt", "title"]).optional(),
    /** The Status header's filter, the same three states the badge shows. */
    status: z.enum(["ready", "pending", "excluded"]).optional(),
  }),
  entities: () => [],
  run: async (ctx, input) => {
    const { source } = await requireSource(ctx, input.sourceId);
    await requireLinkedSource(ctx, source, input.assistantId);
    const pageSize = input.pageSize ?? SOURCE_DOCUMENTS_PAGE_SIZE;
    const page = input.page ?? 1;
    const { items, total } = await ctx.db.listSourceDocuments(source.id, {
      page,
      pageSize,
      ascending: input.ascending,
      sort: input.sort,
      status: input.status,
    });
    // The Memories column (#932), counted for this page's Documents only, so
    // a 10k-page Source costs one bounded read rather than a scan.
    const memoryCounts = await ctx.db.countLiveMemoriesByPath(
      source.id,
      items.map((document) => document.path)
    );
    return { source, items, total, page, pageSize, memoryCounts };
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
  // The FAQ renders in the Library and in the Knowledge tab of every
  // Assistant it is linked to, so the edit touches all of them.
  entities: (_input, result: Concept & { linkedAssistantIds: string[] }) => [
    { kind: "knowledgeHub" as const },
    ...result.linkedAssistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
  ],
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
          by: writingActor(ctx),
          at: new Date().toISOString(),
        },
      },
      body: input.answer,
    });
    await ctx.db.updateSource(input.sourceId, { name: trimmed.slice(0, 500) });
    await ctx.db.deleteChunksByConcept(concept.id);
    const links = await ctx.db.listSourceAssistantLinks(input.sourceId);
    if (links[0]) {
      // The Assistant only attributes the embedding's usage, so the first
      // link is as good as any.
      await ctx.ports?.reembedConcept?.({
        assistantId: links[0].assistantId,
        collectionId: concept.collectionId,
        conceptId: concept.id,
        title: trimmed,
        body: input.answer,
      });
    }
    return { ...concept, linkedAssistantIds: links.map((link) => link.assistantId) };
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

/**
 * One Document, for level 3 of the drill-down (#928): its body, the counts the
 * three tabs show, and the Source it belongs to.
 *
 * Reading a Document's body is the same right as reading its row, so this is a
 * `member` read. The per-Assistant **Direct access** flag is deliberately not
 * consulted: that flag decides whether a chat Visitor may be handed an
 * original file, and a Member of the Organization reading their own knowledge
 * in the console is not that question.
 */
export const getSourceDocumentOp = defineOperation({
  name: "knowledge.documents.get",
  capability: "member",
  input: z.object({
    sourceId: z.string().min(1),
    documentId: z.string().min(1),
    assistantId: z.string().min(1).optional(),
  }),
  entities: () => [],
  run: async (ctx, input) => {
    const { source, collection } = await requireSource(ctx, input.sourceId);
    await requireLinkedSource(ctx, source, input.assistantId, "Document not found");
    const document = await ctx.db.getConcept(input.documentId);
    // A Document of a *different* Source is as absent as one that never
    // existed: the id alone is not a capability.
    if (!document || document.sourceId !== source.id) {
      throw new OperationError("not_found", "Document not found");
    }
    const [chunkCount, memories, extraction, extractionJobs] = await Promise.all([
      ctx.db.countConceptChunks(document.id),
      // The live rows, not the extraction record's count: the tab counts what
      // is there, and a memory a Member forgot is not.
      ctx.db.table("knowledgeMemories").list({
        sourceId: source.id,
        documentPath: document.path,
        forgottenAt: null,
      }),
      // Why the Memories tab is empty, when it is (#933): the record knows
      // whether nothing has run, nothing can run, or something failed.
      ctx.db.getMemoryExtraction(source.id, document.path),
      // The record says how the last attempt ended; only the ledger says one
      // is waiting, because the job writes the record when it finishes.
      ctx.db.listBackgroundJobsForSource(source.id, "extract_document_memories"),
    ]);
    const waiting = extractionJobs.filter(
      (job) => job.status === "queued" || job.status === "running"
    );
    return {
      source,
      collection,
      document,
      chunkCount,
      memoryCount: memories.length,
      extraction,
      queuedExtractions: {
        thisPage: waiting.some(
          (job) =>
            (job.payload as { documentPath?: string }).documentPath === document.path
        ),
        source: waiting.length,
      },
    };
  },
});

/**
 * One page of a Document's chunks (#929), for the Chunks tab.
 *
 * `member`, like the Document itself: a chunk is the same text as the body cut
 * into pieces, so it discloses nothing new, and a separate right would be one
 * more thing to explain. The read carries no embedding.
 */
export const listDocumentChunksOp = defineOperation({
  name: "knowledge.documents.chunks.list",
  capability: "member",
  input: z.object({
    sourceId: z.string().min(1),
    documentId: z.string().min(1),
    assistantId: z.string().min(1).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
  }),
  entities: () => [],
  run: async (ctx, input) => {
    // The same guard chain the Document route walks, so a chunk id is never a
    // way around the Source and Assistant checks above it.
    const view = await getSourceDocumentOp.run(ctx, {
      sourceId: input.sourceId,
      documentId: input.documentId,
      assistantId: input.assistantId,
    });
    const pageSize = input.pageSize ?? DOCUMENT_CHUNKS_PAGE_SIZE;
    const page = input.page ?? 1;
    const { items, total } = await ctx.db.listDocumentChunks(view.document.id, {
      page,
      pageSize,
    });
    return { items, total, page, pageSize };
  },
});

/**
 * A Document's Summary (#931): read the cache, or make one and cache it.
 *
 * `member`, and deliberately so. Any Member's open may pay for the call,
 * Viewers included, because the cost is bounded to one per Document generation
 * and a summary is a reading aid rather than an edit. The cache lives on the
 * Document row, so a re-crawl that changed the page takes the summary with it
 * and the next opener pays once for the new text.
 *
 * Three answers, and the card renders each differently: a summary, `null`
 * because nothing can generate one (no Provider Connection), or `null` after a
 * failed attempt, which the card says out loud and retries on the next open.
 */
export const getDocumentSummaryOp = defineOperation({
  name: "knowledge.documents.summary.get",
  capability: "member",
  input: z.object({
    sourceId: z.string().min(1),
    documentId: z.string().min(1),
    assistantId: z.string().min(1).optional(),
  }),
  entities: () => [],
  run: async (ctx, input): Promise<{ summary: string | null; generatedBy: string | null }> => {
    const view = await getSourceDocumentOp.run(ctx, input);
    const cached = view.document.summary;
    if (cached) {
      return {
        summary: cached,
        generatedBy: view.document.summaryGenerated?.by ?? null,
      };
    }
    const generated = await ctx.ports?.summariseDocument?.({
      title: view.document.frontmatter.title ?? view.document.path,
      body: view.document.body,
    });
    if (!generated) return { summary: null, generatedBy: null };

    // The write is conditional, so two openers racing produce one stored
    // summary and the loser answers with the winner's.
    const stored = await ctx.db.setConceptSummary(view.document.id, {
      text: generated.text,
      by: generated.by,
      at: new Date().toISOString(),
    });
    return {
      summary: stored?.summary ?? generated.text,
      generatedBy: stored?.summaryGenerated?.by ?? generated.by,
    };
  },
});

/**
 * Exclusion from retrieval, from the Document's Details column (#928). The
 * write itself is `applyDocumentExclusion` below, shared with the bulk twin.
 */
export const setDocumentExcludedOp = defineOperation({
  name: "knowledge.documents.excluded.set",
  capability: "edit",
  input: z.object({
    sourceId: z.string().min(1),
    documentId: z.string().min(1),
    excluded: z.boolean(),
  }),
  entities: (_input, result: { excluded: boolean; assistantIds: string[] }) => [
    { kind: "knowledgeHub" as const },
    ...result.assistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
  ],
  run: async (ctx, input) => {
    const { source } = await requireSource(ctx, input.sourceId);
    const document = await ctx.db.getConcept(input.documentId);
    if (!document || document.sourceId !== source.id) {
      throw new OperationError("not_found", "Document not found");
    }
    const { assistantIds } = await applyDocumentExclusion(
      ctx,
      source.id,
      [document],
      input.excluded
    );
    return { excluded: input.excluded, assistantIds };
  },
});

/**
 * The same write over the rows a reader ticked in the Documents table.
 *
 * It exists rather than the console calling the single op in a loop because
 * the loop would re-read the Source and its Assistant links once per row and
 * revalidate the tree once per row. Ids that do not belong to the Source are
 * dropped rather than refused: the table's selection is what produced them,
 * and a stale tick should not cost the reader the other nineteen rows.
 */
export const setDocumentsExcludedOp = defineOperation({
  name: "knowledge.documents.excluded.setMany",
  capability: "edit",
  input: z.object({
    sourceId: z.string().min(1),
    documentIds: z.array(z.string().min(1)).min(1).max(200),
    excluded: z.boolean(),
  }),
  entities: (_input, result: { changed: number; assistantIds: string[] }) => [
    { kind: "knowledgeHub" as const },
    ...result.assistantIds.map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
  ],
  run: async (ctx, input) => {
    const { source } = await requireSource(ctx, input.sourceId);
    const documents: Concept[] = [];
    for (const id of input.documentIds) {
      const document = await ctx.db.getConcept(id);
      if (document && document.sourceId === source.id) documents.push(document);
    }
    const { assistantIds } = await applyDocumentExclusion(
      ctx,
      source.id,
      documents,
      input.excluded
    );
    return {
      excluded: input.excluded,
      changed: documents.length,
      assistantIds,
    };
  },
});

/**
 * Excluding drops a Document's chunks, which is what takes it out of search;
 * restoring re-embeds it through the port, against the Source's first linked
 * Assistant, the same choice `updateOrgFaqOp` makes. An unlinked Source has
 * nobody to embed for, so the restore clears the flag and leaves the indexing
 * to the next crawl rather than pretending it happened.
 */
async function applyDocumentExclusion(
  ctx: OperationContext,
  sourceId: string,
  documents: Concept[],
  excluded: boolean
): Promise<{ assistantIds: string[] }> {
  const links = await ctx.db.listSourceAssistantLinks(sourceId);
  for (const document of documents) {
    await ctx.db.setConceptExcluded(document.id, excluded);
    if (excluded) {
      await ctx.db.deleteChunksByConcept(document.id);
    } else if (links[0]) {
      await ctx.ports?.reembedConcept?.({
        assistantId: links[0].assistantId,
        collectionId: document.collectionId,
        conceptId: document.id,
        title: document.frontmatter.title ?? document.path,
        body: document.body,
      });
    }
  }
  return { assistantIds: links.map((link) => link.assistantId) };
}

/**
 * "Extract memories" (#933): the by-hand backfill for knowledge that predates
 * this layer.
 *
 * `edit`, because it spends the Organization's model budget. Nothing runs it
 * automatically and no migration queues it: one call per existing Document for
 * every tenant at once is a bill nobody asked for, so the console offers the
 * lever and the re-crawl cadence does the rest over the following weeks.
 */
export const extractSourceMemoriesOp = defineOperation({
  name: "knowledge.sources.memories.extract",
  capability: "edit",
  input: z.object({ sourceId: z.string().min(1) }),
  entities: () => [{ kind: "knowledgeHub" as const }],
  run: async (ctx, input): Promise<{ queued: number }> => {
    const { source, collection } = await requireSource(ctx, input.sourceId);
    const queued = await ctx.ports?.enqueueMemoryExtractions?.({
      collectionId: collection.id,
      sourceId: source.id,
    });
    // No port wired (a surface with no runtime) queues nothing and says so,
    // rather than claiming work that nobody will do.
    return { queued: queued ?? 0 };
  },
});

/**
 * Knowledge memories (#926): what a Document said, kept beside it.
 *
 * Three operations, and the middle one is the point. A **forget** is a state a
 * Member sets and can unset, not a delete: the row keeps its text, its quote
 * and its provenance, and stops being live. The destructive verb in this
 * product belongs to subject memories, where it is called Erase (#925), so one
 * product never has two meanings under one word.
 *
 * The rows come from the extraction job (#930, `extractDocumentMemories` in
 * the agent package) and are rendered by the Memories tab (#932).
 */

/** A page's memories, live by default. `includeForgotten` is the opt-in. */
export const listDocumentMemoriesOp = defineOperation({
  name: "knowledge.documents.memories.list",
  capability: "member",
  input: z.object({
    sourceId: z.string().min(1),
    documentPath: z.string().min(1),
    /** Scopes the read to one Assistant's Knowledge, as the other two do. */
    assistantId: z.string().min(1).optional(),
    includeForgotten: z.boolean().optional(),
  }),
  entities: () => [],
  run: async (ctx, input): Promise<KnowledgeMemory[]> => {
    const { source } = await requireSource(ctx, input.sourceId);
    await requireLinkedSource(ctx, source, input.assistantId);
    // `forgottenAt: null` *is* the liveness rule, the filter form of
    // `isKnowledgeMemoryLive`. Nothing here re-checks the column by hand.
    return ctx.db.table("knowledgeMemories").list({
      sourceId: input.sourceId,
      documentPath: input.documentPath,
      ...(input.includeForgotten ? {} : { forgottenAt: null }),
    });
  },
});

/**
 * Forget one memory. Editor rank, because it is an editorial decision about
 * the Organization's knowledge, the same rank as editing the Document it came
 * from. Forgetting twice is not an error: the first reason stands, so a second
 * click cannot quietly rewrite why.
 */
export const forgetKnowledgeMemoryOp = defineOperation({
  name: "knowledge.memories.forget",
  capability: "edit",
  input: z.object({
    id: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
  entities: () => [{ kind: "knowledgeHub" as const }],
  run: async (ctx, input): Promise<KnowledgeMemory> => {
    const memory = await requireKnowledgeMemory(ctx, input.id);
    if (memory.forgottenAt) return memory;
    return ctx.db.table("knowledgeMemories").update(memory.id, {
      forgottenAt: new Date().toISOString(),
      forgetReason: input.reason ?? null,
      forgottenBy: ctx.userId ?? null,
    });
  },
});

/** Restore one. Clears the whole forget state, so nothing is left half-set. */
export const restoreKnowledgeMemoryOp = defineOperation({
  name: "knowledge.memories.restore",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [{ kind: "knowledgeHub" as const }],
  run: async (ctx, input): Promise<KnowledgeMemory> => {
    const memory = await requireKnowledgeMemory(ctx, input.id);
    if (!memory.forgottenAt) return memory;
    return ctx.db.table("knowledgeMemories").update(memory.id, {
      forgottenAt: null,
      forgetReason: null,
      forgottenBy: null,
    });
  },
});

/**
 * id → a memory this Organization owns, or not_found. The row carries its own
 * `organizationId`, and the Source check is what keeps a memory whose Source
 * has been deleted out of reach of a stale id.
 */
async function requireKnowledgeMemory(
  ctx: OperationContext,
  id: string
): Promise<KnowledgeMemory> {
  const memory = await ctx.db.table("knowledgeMemories").get(id);
  if (!memory || memory.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Memory not found");
  }
  await requireSource(ctx, memory.sourceId);
  return memory;
}
