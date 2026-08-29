import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { feedbackScore, forwardGraphFeedback, runGraphLearning } from "./graph-feedback";
import * as graphWorker from "./graph-worker";

// Off-network: the graph-worker client is faked; the Db is a fake exposing only
// the methods these functions touch. Alerts go through signalHealth →
// raiseAlert/resolveAlertsByKey on the fake Db.
vi.mock("./graph-worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph-worker")>();
  return {
    ...actual,
    isGraphWorkerConfigured: vi.fn(() => true),
    sendFeedback: vi.fn().mockResolvedValue(undefined),
    purgeCollection: vi.fn().mockResolvedValue(undefined),
    ingestConcepts: vi.fn().mockResolvedValue({
      dataset: "col1",
      ingested: 1,
      usage: null,
    }),
    resumeConceptReconciliation: vi
      .fn()
      .mockResolvedValue({ phase: "index", cursor: null, done: false }),
    indexConceptInventory: vi
      .fn()
      .mockResolvedValue({ phase: "mark", cursor: null, done: false }),
    reconcileConceptInventory: vi.fn().mockResolvedValue({
      phase: "deliver",
      cursor: null,
      done: false,
      missingConceptIds: ["c1"],
    }),
    acknowledgeConceptInventory: vi
      .fn()
      .mockResolvedValue({ phase: "sweep", cursor: null, done: false }),
    reconcileLegacyConceptInventory: vi
      .fn()
      .mockResolvedValue({ removed: 0, missingConceptIds: [] }),
    sweepConceptInventory: vi
      .fn()
      .mockResolvedValue({ phase: "done", cursor: null, removed: 1, done: true }),
    improveDataset: vi
      .fn()
      .mockResolvedValue({ weightedElements: 4, boosted: 3, demoted: 1, usage: null }),
  };
});

const configured = vi.mocked(graphWorker.isGraphWorkerConfigured);
const sendFeedback = vi.mocked(graphWorker.sendFeedback);
const improveDataset = vi.mocked(graphWorker.improveDataset);
const purgeCollection = vi.mocked(graphWorker.purgeCollection);
const ingestConcepts = vi.mocked(graphWorker.ingestConcepts);
const reconcileConceptInventory = vi.mocked(
  graphWorker.reconcileConceptInventory,
);

function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv1",
    assistantId: "a1",
    teammateId: null,
    subjectType: "visitor",
    subjectId: "v1",
    collectionId: "col1",
    title: "t",
    metadata: {},
    sessionState: { graphQa: { m1: "qa-1" } },
    sessionVersion: 0,
    pinned: false,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    ...over,
  };
}

function fakeDb(over: Partial<Db> = {}): Db {
  return {
    getConversationForMessage: vi.fn().mockResolvedValue(conversation()),
    listActiveGraphDatasets: vi
      .fn()
      .mockResolvedValue([{ organizationId: "org1", collectionId: "col1" }]),
    listConceptPage: vi.fn().mockResolvedValue([
      {
        id: "c1",
        collectionId: "col1",
        sourceId: "s1",
        path: "one.md",
        frontmatter: { title: "One" },
        body: "First",
        excluded: false,
      },
      {
        id: "c2",
        collectionId: "col1",
        sourceId: "s2",
        path: "two.md",
        frontmatter: { title: "Two" },
        body: "Second",
        excluded: true,
      },
    ]),
    createBackgroundJob: vi.fn().mockResolvedValue({ id: "job1" }),
    getOrgBudget: vi.fn().mockResolvedValue(null),
    getOrgTokensUsedToday: vi.fn().mockResolvedValue(0),
    getCollection: vi
      .fn()
      .mockResolvedValue({ id: "col1", organizationId: "org1" }),
    getAssistant: vi.fn().mockResolvedValue({ id: "a1", organizationId: "org1" }),
    recordAiUsage: vi.fn().mockResolvedValue(undefined),
    raiseAlert: vi.fn().mockResolvedValue(undefined),
    resolveAlertsByKey: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as Db;
}

beforeEach(() => {
  vi.clearAllMocks();
  configured.mockReturnValue(true);
  sendFeedback.mockResolvedValue(undefined);
  purgeCollection.mockResolvedValue(undefined);
  ingestConcepts.mockResolvedValue({
    dataset: "col1",
    ingested: 1,
    usage: null,
  });
  vi.mocked(graphWorker.resumeConceptReconciliation).mockResolvedValue({
    phase: "index",
    cursor: null,
    done: false,
  });
  vi.mocked(graphWorker.indexConceptInventory).mockResolvedValue({
    phase: "mark",
    cursor: null,
    done: false,
  });
  reconcileConceptInventory.mockResolvedValue({
    phase: "deliver",
    cursor: null,
    done: false,
    missingConceptIds: ["c1"],
  });
  vi.mocked(graphWorker.acknowledgeConceptInventory).mockResolvedValue({
    phase: "sweep",
    cursor: null,
    done: false,
  });
  vi.mocked(graphWorker.sweepConceptInventory).mockResolvedValue({
    phase: "done",
    cursor: null,
    removed: 1,
    done: true,
  });
  improveDataset.mockResolvedValue({ weightedElements: 4, boosted: 3, demoted: 1, usage: null });
});

describe("feedbackScore", () => {
  it("maps 👍→5 and 👎→1", () => {
    expect(feedbackScore(1)).toBe(5);
    expect(feedbackScore(-1)).toBe(1);
  });
});

describe("forwardGraphFeedback", () => {
  it("forwards the score for a graph-served answer and clears the alert", async () => {
    const db = fakeDb();
    await forwardGraphFeedback({ db, organizationId: "org1", messageId: "m1", score: 1, text: "bad" });
    expect(sendFeedback).toHaveBeenCalledWith("col1", {
      sessionId: "conv1",
      qaId: "qa-1",
      score: 1,
      text: "bad",
    });
    expect(db.resolveAlertsByKey).toHaveBeenCalledWith("org1", "graph-worker:org1");
  });

  it("is a no-op for a vector-served answer (no trace recorded)", async () => {
    const db = fakeDb({
      getConversationForMessage: vi
        .fn()
        .mockResolvedValue(conversation({ sessionState: {} })),
    });
    await forwardGraphFeedback({ db, organizationId: "org1", messageId: "m1", score: 5 });
    expect(sendFeedback).not.toHaveBeenCalled();
  });

  it("is inert when the worker is unconfigured", async () => {
    configured.mockReturnValue(false);
    const db = fakeDb();
    await forwardGraphFeedback({ db, organizationId: "org1", messageId: "m1", score: 5 });
    expect(db.getConversationForMessage).not.toHaveBeenCalled();
    expect(sendFeedback).not.toHaveBeenCalled();
  });

  it("raises an auto-resolving alert and never throws when the worker errors", async () => {
    sendFeedback.mockRejectedValue(new Error("worker down"));
    const db = fakeDb();
    await expect(
      forwardGraphFeedback({ db, organizationId: "org1", messageId: "m1", score: 1 })
    ).resolves.toBeUndefined();
    expect(db.raiseAlert).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ type: "integration", sourceKey: "graph-worker:org1" })
    );
  });
});

describe("runGraphLearning", () => {
  it("is inert when the worker is unconfigured", async () => {
    configured.mockReturnValue(false);
    const db = fakeDb();
    const result = await runGraphLearning({ db });
    expect(result).toEqual({
      datasets: 0,
      weightedElements: 0,
      boosted: 0,
      demoted: 0,
      distilled: 0,
      failed: 0,
    });
    expect(improveDataset).not.toHaveBeenCalled();
  });

  it("applies weights per dataset and distills when under budget", async () => {
    const db = fakeDb({
      listActiveGraphDatasets: vi.fn().mockResolvedValue([
        { organizationId: "org1", collectionId: "col1" },
        { organizationId: "org1", collectionId: "col2" },
      ]),
    });
    const result = await runGraphLearning({ db });
    expect(improveDataset).toHaveBeenCalledWith("col1", { distill: true });
    expect(improveDataset).toHaveBeenCalledWith("col2", { distill: true });
    expect(result).toEqual({
      datasets: 2,
      weightedElements: 8,
      boosted: 6,
      demoted: 2,
      distilled: 2,
      failed: 0,
    });
    // Each dataset reserves its own bounded distillation capacity.
    expect(db.getOrgBudget).toHaveBeenCalledTimes(2);
  });

  it("repairs worker inventory and queues only missing or changed Concepts", async () => {
    const db = fakeDb();
    await runGraphLearning({ db });
    expect(reconcileConceptInventory).toHaveBeenCalledWith(
      "col1",
      null,
      [expect.objectContaining({ conceptId: "c1" })],
      null,
      true,
    );
    expect(purgeCollection).not.toHaveBeenCalled();
    expect(ingestConcepts).not.toHaveBeenCalled();
    expect(db.createBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org1",
        kind: "graph_sync_concept",
        payload: expect.objectContaining({ conceptId: "c1", op: "ingest" }),
      }),
    );
  });

  it("defers improvement while bounded reconciliation still has pages", async () => {
    vi.mocked(graphWorker.indexConceptInventory).mockResolvedValue({
      phase: "index",
      cursor: "worker-page",
      done: false,
    });

    const result = await runGraphLearning({ db: fakeDb() });

    expect(improveDataset).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(graphWorker.indexConceptInventory).toHaveBeenCalledTimes(6);
  });

  it("meters distillation LLM usage reported by the worker (graph_cognify)", async () => {
    improveDataset.mockResolvedValue({
      weightedElements: 4,
      boosted: 3,
      demoted: 1,
      usage: { inputTokens: 900, outputTokens: 400, llmCalls: 2, modelId: "gemini/gemini-2.0-flash", provider: "gemini" },
    });
    const db = fakeDb();
    await runGraphLearning({ db });
    expect(db.recordAiUsage).toHaveBeenCalledWith([
      {
        organizationId: "org1",
        assistantId: null,
        stage: "graph_cognify",
        provider: "google",
        modelId: "gemini/gemini-2.0-flash",
        credentialKind: "platform",
        inputTokens: 900,
        outputTokens: 400,
      },
    ]);
  });

  it("skips distillation for an org over its daily token budget (weights still applied)", async () => {
    const db = fakeDb({
      getOrgBudget: vi.fn().mockResolvedValue({
        dailyTokenLimit: 1000,
        dailyEuroLimit: null,
        enforcement: "block",
      }),
      getOrgTokensUsedToday: vi.fn().mockResolvedValue(1000),
    });
    const result = await runGraphLearning({ db });
    expect(improveDataset).toHaveBeenCalledWith("col1", { distill: false });
    expect(result.distilled).toBe(0);
    expect(result.weightedElements).toBe(4);
    expect(result.boosted).toBe(3);
    expect(result.demoted).toBe(1);
  });

  it("counts a failed dataset, raises an alert, and continues", async () => {
    improveDataset
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ weightedElements: 4, boosted: 3, demoted: 1, usage: null });
    const db = fakeDb({
      listActiveGraphDatasets: vi.fn().mockResolvedValue([
        { organizationId: "org1", collectionId: "col1" },
        { organizationId: "org2", collectionId: "col2" },
      ]),
    });
    const result = await runGraphLearning({ db });
    expect(result.failed).toBe(1);
    expect(result.weightedElements).toBe(4);
    // Only the surviving dataset's counts accrue; the failed one contributes 0.
    expect(result.boosted).toBe(3);
    expect(result.demoted).toBe(1);
    expect(db.raiseAlert).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ sourceKey: "graph-worker:org1" })
    );
  });
});
