import { describe, expect, it } from "vitest";
import type { Concept, Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import {
  createFlowOp,
  deleteFlowOp,
  listFlowsOp,
  reorderFlowsOp,
  updateFlowOp,
} from "./flows";
import {
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  getSourceOp,
  importFaqsOp,
  listCollectionsOp,
  listSourcesOp,
  recrawlSourceOp,
} from "./knowledge";
import {
  publicationStatusOp,
  publishAssistantOp,
  unpublishAssistantOp,
} from "./publish";
import {
  getConversationOp,
  listInboxConversationsOp,
  readConversationsForExportOp,
} from "./inbox";
import {
  getImprovementOp,
  listImprovementsOp,
  updateImprovementOp,
} from "./improvements";
import { OperationError, type OperationContext } from "./operation";

const ctx = (over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  db: getMockDb(),
  ...over,
});

const foreignCtx = () => ctx({ organizationId: "some-other-org" });

async function newAssistant(title: string) {
  return createAssistantOp.run(ctx(), { title });
}

describe("flows operations (#621)", () => {
  it("create/update/reorder/delete round-trip with router invariants", async () => {
    const assistant = await newAssistant("Flows fixture");
    const seeded = await listFlowsOp.run(ctx(), { assistantId: assistant.id });
    expect(seeded.length).toBeGreaterThan(0);
    const defaultFlow = seeded.find((f) => f.isDefault)!;

    const created = await createFlowOp.run(ctx(), {
      assistantId: assistant.id,
      input: { name: "Fees intent", description: "questions about fees" },
    });
    const toggled = await updateFlowOp.run(ctx(), {
      id: created.id,
      patch: { enabled: false },
    });
    expect(toggled.enabled).toBe(false);

    // Trigger/action pairing rule (#541) holds on this surface too.
    await expect(
      updateFlowOp.run(ctx(), {
        id: created.id,
        patch: { trigger: "page_load", actions: ["search_knowledge"] },
      })
    ).rejects.toMatchObject({ code: "invalid_input" });

    // Default behavior is locked: deleting it is a conflict, not a UI gap.
    await expect(
      deleteFlowOp.run(ctx(), { id: defaultFlow.id })
    ).rejects.toMatchObject({ code: "conflict" });

    const reordered = await reorderFlowsOp.run(ctx(), {
      assistantId: assistant.id,
      orderedIds: [created.id, ...seeded.filter((f) => !f.isDefault).map((f) => f.id)],
    });
    expect(reordered[reordered.length - 1].isDefault).toBe(true);

    const deleted = await deleteFlowOp.run(ctx(), { id: created.id });
    expect(deleted.id).toBe(created.id);

    // Cross-org: reads and writes both land not_found.
    await expect(
      listFlowsOp.run(foreignCtx(), { assistantId: assistant.id })
    ).rejects.toBeInstanceOf(OperationError);
  });
});

describe("knowledge operations (#622)", () => {
  it("adds a text Source through the ingest port and deletes with graph retirement", async () => {
    const assistant = await newAssistant("Knowledge fixture");
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "docs",
    });
    const enqueued: string[] = [];
    const removed: string[] = [];
    const withPorts = ctx({
      ports: {
        enqueueIngest: async (job) => void enqueued.push(job.sourceId),
        removeConceptGraph: async (_c, conceptId) => void removed.push(conceptId),
      },
    });

    const { source } = await addSourceOp.run(withPorts, {
      collectionId: collection.id,
      name: "Handbook",
      kind: "text",
      rawText: "Tuition is due in October.",
    });
    expect(enqueued).toEqual([source.id]);
    expect((await getSourceOp.run(ctx(), { id: source.id })).id).toBe(source.id);
    expect(
      (await listSourcesOp.run(ctx(), { collectionId: collection.id })).map(
        (s) => s.id
      )
    ).toContain(source.id);
    expect(
      (await listCollectionsOp.run(ctx(), { assistantId: assistant.id })).map(
        (c) => c.id
      )
    ).toContain(collection.id);

    await deleteSourceOp.run(withPorts, { id: source.id });
    await expect(
      getSourceOp.run(ctx(), { id: source.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("persists FAQs (single + bulk with indexed paths and CSV provenance)", async () => {
    const assistant = await newAssistant("FAQ fixture");
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "faq",
    });
    const persisted: Array<{ path?: string; question: string; sources?: unknown }> = [];
    const withPort = ctx({
      ports: {
        persistFaq: async (args) => {
          persisted.push({
            path: args.pathSuffix,
            question: args.question,
            sources: args.provenance.sources,
          });
          return { id: `c-${persisted.length}` } as unknown as Concept;
        },
      },
    });

    await createFaqOp.run(withPort, {
      collectionId: collection.id,
      question: "When is tuition due?",
      answer: "October.",
    });
    const { imported } = await importFaqsOp.run(withPort, {
      collectionId: collection.id,
      fileName: "faqs.csv",
      rows: [
        { question: "Q1", answer: "A1" },
        { question: "Q1", answer: "A1 again" },
      ],
    });
    expect(imported).toBe(2);
    // Bulk rows carry indexed suffixes (no overwrite) and the CSV derivation.
    expect(persisted[1].path).toBe("-0");
    expect(persisted[2].path).toBe("-1");
    expect(persisted[2].sources).toBeTruthy();
    expect(persisted[0].sources).toBeUndefined();
  });

  it("re-crawl refuses non-website Sources", async () => {
    const assistant = await newAssistant("Crawl fixture");
    const collection = await getMockDb().createCollection(assistant.id, {
      name: "web",
    });
    const { source } = await addSourceOp.run(
      ctx({ ports: { enqueueIngest: async () => {} } }),
      {
        collectionId: collection.id,
        name: "note",
        kind: "text",
        rawText: "x",
      }
    );
    await expect(
      recrawlSourceOp.run(ctx({ ports: { restartCrawl: async () => {} } }), {
        id: source.id,
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("publish operations (#623)", () => {
  it("publish → status → unpublish with cache invalidation via port", async () => {
    const assistant = await newAssistant("Publish fixture");
    const invalidated: string[] = [];
    const withPort = ctx({
      role: "admin",
      ports: { invalidatePublication: (id) => void invalidated.push(id) },
    });

    const before = await publicationStatusOp.run(ctx(), {
      assistantId: assistant.id,
    });
    expect(before.published).toBe(false);

    const { version } = await publishAssistantOp.run(withPort, {
      assistantId: assistant.id,
    });
    expect(version).toBeGreaterThan(0);
    const after = await publicationStatusOp.run(ctx(), {
      assistantId: assistant.id,
    });
    expect(after.published).toBe(true);

    await unpublishAssistantOp.run(withPort, { assistantId: assistant.id });
    const gone = await publicationStatusOp.run(ctx(), {
      assistantId: assistant.id,
    });
    expect(gone.published).toBe(false);
    expect(invalidated).toEqual([assistant.id, assistant.id]);
  });
});

describe("inbox operations (#624)", () => {
  it("lists org conversations and reads a guarded transcript", async () => {
    const conversations = await listInboxConversationsOp.run(ctx(), {});
    expect(conversations.length).toBeGreaterThan(0);
    const first = conversations[0];

    const detail = await getConversationOp.run(ctx(), { id: first.id });
    expect(detail.conversation.id).toBe(first.id);
    expect(Array.isArray(detail.messages)).toBe(true);

    await expect(
      getConversationOp.run(foreignCtx(), { id: first.id })
    ).rejects.toMatchObject({ code: "not_found" });

    const exportReads = await readConversationsForExportOp.run(ctx(), {
      conversationIds: [first.id, "not-a-real-id"],
    });
    // Forged ids silently drop; real ones come back with their messages.
    expect(exportReads).toHaveLength(1);
    expect(exportReads[0].conversation.id).toBe(first.id);
  });
});

describe("improvements operations (#625)", () => {
  it("lists, reads detail, updates with notification port", async () => {
    const items = await listImprovementsOp.run(ctx(), {});
    expect(items.length).toBeGreaterThan(0);
    const target = items[0];

    const detail = await getImprovementOp.run(ctx(), { id: target.id });
    expect(detail.improvement.id).toBe(target.id);

    const notified: string[] = [];
    const updated = await updateImprovementOp.run(
      ctx({
        ports: {
          notifyImprovementUpdate: async ({ updated: u }) =>
            void notified.push(u.id),
        },
      }),
      { id: target.id, patch: { priority: "high" } }
    );
    expect(updated.priority).toBe("high");
    expect(notified).toEqual([target.id]);

    await expect(
      updateImprovementOp.run(foreignCtx(), {
        id: target.id,
        patch: { priority: "low" },
      })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
