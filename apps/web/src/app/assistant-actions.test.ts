import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() is the enqueue accelerator; a no-op keeps graph-sync jobs on the
// ledger for assertion instead of running them against a live worker.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
  requireSession: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/authz";
import {
  acceptImprovementProposalAction,
  createFlowAction,
  deleteAssistantAction,
  deleteCollectionAction,
  deleteSourceAction,
  dismissImprovementProposalAction,
  updateAssistantAction,
} from "./actions";

/**
 * Revalidation parity for the first orgMutation tranche: the migrated
 * wrappers must purge exactly the paths the hand-written versions did.
 */
describe("assistant & flow actions (orgMutation tranche)", () => {
  const requireMemberMock = vi.mocked(requireMember);
  const revalidatePathMock = vi.mocked(revalidatePath);
  let db: Db;

  beforeEach(() => {
    db = getMockDb();
    requireMemberMock.mockReset();
    revalidatePathMock.mockReset();
    requireMemberMock.mockResolvedValue({
      db,
      organizationId: DEMO_ORG.id,
      session: { organization: DEMO_ORG },
    } as never);
  });

  it("updateAssistantAction patches and revalidates list + editor layout", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    revalidatePathMock.mockClear();

    await updateAssistantAction(assistant.id, { nickname: "Patched" });

    expect(requireMemberMock).toHaveBeenCalledWith("edit");
    expect((await db.getAssistant(assistant.id))?.nickname).toBe("Patched");
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/", undefined],
      [`/assistants/${assistant.id}`, "layout"],
    ]);
  });

  it("createFlowAction creates and revalidates the assistant editor page", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    const before = (await db.listFlows(assistant.id)).length;
    revalidatePathMock.mockClear();

    await createFlowAction(assistant.id, {
      name: "Contract flow",
      description: "matches questions about contracts",
      actions: ["custom_message"],
    });

    expect(await db.listFlows(assistant.id)).toHaveLength(before + 1);
    expect(revalidatePathMock.mock.calls).toEqual([
      [`/assistants/${assistant.id}`, undefined],
    ]);
  });

  it("deleteSourceAction retires the source's Concepts from the graph when configured", async () => {
    process.env.GRAPH_WORKER_BASE_URL = "https://graph.internal";
    process.env.GRAPH_WORKER_API_TOKEN = "tok";
    try {
      const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
      const collection = await db.createCollection(assistant.id, { name: "C" });
      const source = await db.createSource({
        collectionId: collection.id,
        name: "Doc",
        kind: "text",
      });
      const concept = await db.createConcept({
        collectionId: collection.id,
        sourceId: source.id,
        path: "doc.md",
        frontmatter: { type: "Document", title: "Doc" },
        body: "body",
      });

      await deleteSourceAction(assistant.id, source.id);

      // The Concept is cascade-gone, and a graph-remove was enqueued for it.
      expect(await db.getConcept(concept.id)).toBeNull();
      const queued = await db.claimBackgroundJobs({
        kind: "graph_sync_concept",
        // Far-future "now" so the freshly-queued job is unambiguously due.
        workerId: "test",
        now: new Date("2100-01-01T00:00:00Z").toISOString(),
        staleBefore: new Date("2000-01-01T00:00:00Z").toISOString(),
        limit: 10,
      });
      expect(queued.map((j) => j.payload)).toContainEqual({
        kind: "graph_sync_concept",
        op: "remove",
        collectionId: collection.id,
        conceptId: concept.id,
      });
    } finally {
      delete process.env.GRAPH_WORKER_BASE_URL;
      delete process.env.GRAPH_WORKER_API_TOKEN;
    }
  });

  it("acceptImprovementProposalAction creates a FAQ Concept and advances the improvement", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    const collection = await db.createCollection(assistant.id, { name: "KB" });
    const improvement = await db.createImprovement(DEMO_ORG.id, { title: "Bad reset answer" });
    await db.createImprovementProposal({
      improvementId: improvement.id,
      organizationId: DEMO_ORG.id,
      payload: {
        draftQuestion: "How do I reset my password?",
        draftAnswer: "Open the Identity Portal and choose Forgot password.",
        rationale: "The answer omitted the portal.",
        sources: [],
        model: "test-model",
        targetAssistantId: assistant.id,
        targetCollectionId: collection.id,
      },
    });

    await acceptImprovementProposalAction(improvement.id);

    const concepts = await db.listConcepts(collection.id);
    expect(
      concepts.some(
        (c) =>
          c.frontmatter.type === "FAQ" &&
          c.frontmatter.title === "How do I reset my password?"
      )
    ).toBe(true);
    const proposal = await db.getImprovementProposal(improvement.id);
    expect(proposal?.status).toBe("accepted");
    expect(proposal?.acceptedConceptId).toBeTruthy();
    expect((await db.getImprovement(improvement.id))?.status).toBe("in_review");
  });

  it("dismissImprovementProposalAction records the reason and touches no knowledge", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    const collection = await db.createCollection(assistant.id, { name: "KB" });
    const improvement = await db.createImprovement(DEMO_ORG.id, { title: "x" });
    await db.createImprovementProposal({
      improvementId: improvement.id,
      organizationId: DEMO_ORG.id,
      payload: {
        draftQuestion: "q",
        draftAnswer: "a",
        rationale: "r",
        sources: [],
        model: "m",
        targetAssistantId: assistant.id,
        targetCollectionId: collection.id,
      },
    });

    await dismissImprovementProposalAction(improvement.id, "Not a real gap");

    const proposal = await db.getImprovementProposal(improvement.id);
    expect(proposal?.status).toBe("dismissed");
    expect(proposal?.dismissReason).toBe("Not a real gap");
    expect(await db.listConcepts(collection.id)).toHaveLength(0);
  });

  it("deleteAssistantAction is publish-gated and revalidates the dashboard", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    revalidatePathMock.mockClear();

    await deleteAssistantAction(assistant.id);

    expect(requireMemberMock).toHaveBeenCalledWith("publish");
    expect(await db.getAssistant(assistant.id)).toBeNull();
    expect(revalidatePathMock.mock.calls).toEqual([["/", undefined]]);
  });

  /** Far-future "now" so freshly-queued graph-sync jobs are unambiguously due. */
  async function claimGraphSyncJobs() {
    return db.claimBackgroundJobs({
      kind: "graph_sync_concept",
      workerId: "test",
      now: new Date("2100-01-01T00:00:00Z").toISOString(),
      staleBefore: new Date("2000-01-01T00:00:00Z").toISOString(),
      limit: 10,
    });
  }

  it("deleteAssistantAction purges each Collection's graph dataset when configured", async () => {
    process.env.GRAPH_WORKER_BASE_URL = "https://graph.internal";
    process.env.GRAPH_WORKER_API_TOKEN = "tok";
    try {
      const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
      const c1 = await db.createCollection(assistant.id, { name: "C1" });
      const c2 = await db.createCollection(assistant.id, { name: "C2" });

      await deleteAssistantAction(assistant.id);

      expect(await db.getAssistant(assistant.id)).toBeNull();
      // One whole-dataset purge per Collection — no per-Concept fan-out.
      const payloads = (await claimGraphSyncJobs()).map((j) => j.payload);
      expect(payloads).toContainEqual({
        kind: "graph_sync_concept",
        op: "purge",
        collectionId: c1.id,
      });
      expect(payloads).toContainEqual({
        kind: "graph_sync_concept",
        op: "purge",
        collectionId: c2.id,
      });
      expect(payloads).toHaveLength(2);
    } finally {
      delete process.env.GRAPH_WORKER_BASE_URL;
      delete process.env.GRAPH_WORKER_API_TOKEN;
    }
  });

  it("deleteAssistantAction enqueues no graph jobs when the worker is unconfigured", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
    await db.createCollection(assistant.id, { name: "C1" });

    await deleteAssistantAction(assistant.id);

    expect(await db.getAssistant(assistant.id)).toBeNull();
    expect(await claimGraphSyncJobs()).toHaveLength(0);
  });

  it("deleteCollectionAction deletes the Collection and purges its graph dataset when configured", async () => {
    process.env.GRAPH_WORKER_BASE_URL = "https://graph.internal";
    process.env.GRAPH_WORKER_API_TOKEN = "tok";
    try {
      const assistant = await db.createAssistant(DEMO_ORG.id, { title: "A" });
      const collection = await db.createCollection(assistant.id, { name: "C" });

      await deleteCollectionAction(assistant.id, collection.id);

      expect(requireMemberMock).toHaveBeenCalledWith("edit");
      expect(await db.getCollection(collection.id)).toBeNull();
      const payloads = (await claimGraphSyncJobs()).map((j) => j.payload);
      expect(payloads).toEqual([
        { kind: "graph_sync_concept", op: "purge", collectionId: collection.id },
      ]);
    } finally {
      delete process.env.GRAPH_WORKER_BASE_URL;
      delete process.env.GRAPH_WORKER_API_TOKEN;
    }
  });
});
