import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundJob, Concept } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  GRAPH_SYNC_KIND,
  graphSyncJobFromRecord,
  performGraphSyncConcept,
} from "./graph-sync";
import {
  backfillCollectionToGraph,
  enqueueGraphSyncJob,
  runDueGraphSyncJobs,
} from "./jobs";
import * as graphWorker from "./graph-worker";

// Off-network: the graph-worker client is faked and the job ledger's other
// import (./ingest) is stubbed so nothing real runs. The after-response
// accelerator needs no stub — with no host registered it is a no-op by
// default, which is exactly the contract `host.ts` guarantees.
vi.mock("./ingest", () => ({ ingestSource: vi.fn() }));
vi.mock("./graph-worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./graph-worker")>();
  return {
    ...actual,
    isGraphWorkerConfigured: vi.fn(() => true),
    ingestConcepts: vi.fn().mockResolvedValue({ dataset: "ds", ingested: 1, usage: null }),
    removeConcept: vi.fn().mockResolvedValue(undefined),
    purgeCollection: vi.fn().mockResolvedValue(undefined),
  };
});

const configured = vi.mocked(graphWorker.isGraphWorkerConfigured);
const ingestConcepts = vi.mocked(graphWorker.ingestConcepts);
const removeConcept = vi.mocked(graphWorker.removeConcept);
const purgeCollection = vi.mocked(graphWorker.purgeCollection);

function concept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: "c1",
    collectionId: "col1",
    sourceId: "s1",
    path: "faq/reset.md",
    frontmatter: { type: "FAQ", title: "How do I reset?" },
    body: "Open the portal.",
    excluded: false,
    ...overrides,
  } as Concept;
}

function fakeDb(overrides: Partial<Db> = {}): Db {
  return {
    getConcept: vi.fn().mockResolvedValue(concept()),
    listConcepts: vi.fn().mockResolvedValue([concept(), concept({ id: "c2" })]),
    getCollection: vi.fn().mockResolvedValue({ id: "col1", assistantId: "a1", name: "Handbook" }),
    getAssistant: vi.fn().mockResolvedValue({ id: "a1", organizationId: "org1" }),
    recordAiUsage: vi.fn().mockResolvedValue(undefined),
    createBackgroundJob: vi.fn().mockResolvedValue({ id: "job1" }),
    claimBackgroundJobs: vi.fn().mockResolvedValue([]),
    updateBackgroundJob: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Db;
}

beforeEach(() => {
  vi.clearAllMocks();
  configured.mockReturnValue(true);
});

describe("graphSyncJobFromRecord", () => {
  it("narrows a valid payload", () => {
    expect(
      graphSyncJobFromRecord({
        payload: { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      })
    ).toEqual({ kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" });
  });

  it("narrows a purge payload (no conceptId)", () => {
    expect(
      graphSyncJobFromRecord({
        payload: { kind: GRAPH_SYNC_KIND, op: "purge", collectionId: "col1" },
      })
    ).toEqual({ kind: GRAPH_SYNC_KIND, op: "purge", collectionId: "col1" });
  });

  it("rejects a malformed payload", () => {
    expect(() => graphSyncJobFromRecord({ payload: { kind: "ingest_source" } })).toThrow(
      /Invalid graph-sync job payload/
    );
  });

  it("rejects an ingest/remove payload missing conceptId", () => {
    expect(() =>
      graphSyncJobFromRecord({
        payload: { kind: GRAPH_SYNC_KIND, op: "remove", collectionId: "col1" },
      })
    ).toThrow(/Invalid graph-sync job payload/);
  });

  it("rejects a purge payload missing collectionId", () => {
    expect(() =>
      graphSyncJobFromRecord({ payload: { kind: GRAPH_SYNC_KIND, op: "purge" } })
    ).toThrow(/Invalid graph-sync job payload/);
  });
});

describe("performGraphSyncConcept", () => {
  it("ingests a Concept as title-prefixed text tagged with its Source", async () => {
    const db = fakeDb();
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      { db }
    );
    expect(ingestConcepts).toHaveBeenCalledWith("col1", [
      { conceptId: "c1", sourceId: "s1", text: "How do I reset?\n\nOpen the portal." },
    ]);
    expect(removeConcept).not.toHaveBeenCalled();
    // No usage reported → nothing metered.
    expect(db.recordAiUsage).not.toHaveBeenCalled();
  });

  it("meters reported cognify LLM usage, attributed via Collection → Assistant → org", async () => {
    ingestConcepts.mockResolvedValueOnce({
      dataset: "ds",
      ingested: 1,
      usage: { inputTokens: 3500, outputTokens: 1200, llmCalls: 2, modelId: "gemini/gemini-2.0-flash", provider: "gemini" },
    });
    const db = fakeDb();
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      { db }
    );
    expect(db.recordAiUsage).toHaveBeenCalledWith([
      {
        organizationId: "org1",
        assistantId: "a1",
        stage: "graph_cognify",
        provider: "google",
        modelId: "gemini/gemini-2.0-flash",
        credentialKind: "platform",
        inputTokens: 3500,
        outputTokens: 1200,
      },
    ]);
  });

  it("skips metering (but not the sync) when the Collection is gone mid-flight", async () => {
    ingestConcepts.mockResolvedValueOnce({
      dataset: "ds",
      ingested: 1,
      usage: { inputTokens: 10, outputTokens: 5, llmCalls: 1, modelId: "m", provider: "openai" },
    });
    const db = fakeDb({ getCollection: vi.fn().mockResolvedValue(null) });
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      { db }
    );
    expect(ingestConcepts).toHaveBeenCalledOnce();
    expect(db.recordAiUsage).not.toHaveBeenCalled();
  });

  it("removes on an explicit remove op", async () => {
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "remove", collectionId: "col1", conceptId: "c1" },
      { db: fakeDb() }
    );
    expect(removeConcept).toHaveBeenCalledWith("col1", "c1");
    expect(ingestConcepts).not.toHaveBeenCalled();
  });

  it("removes instead of ingesting when the Concept is gone or excluded", async () => {
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      { db: fakeDb({ getConcept: vi.fn().mockResolvedValue(null) }) }
    );
    expect(removeConcept).toHaveBeenCalledWith("col1", "c1");

    removeConcept.mockClear();
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      { db: fakeDb({ getConcept: vi.fn().mockResolvedValue(concept({ excluded: true })) }) }
    );
    expect(removeConcept).toHaveBeenCalledWith("col1", "c1");
    expect(ingestConcepts).not.toHaveBeenCalled();
  });

  it("purges the whole dataset on a purge op (no Concept lookup, no per-Concept remove)", async () => {
    const db = fakeDb();
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "purge", collectionId: "col1" },
      { db }
    );
    expect(purgeCollection).toHaveBeenCalledWith("col1");
    expect(removeConcept).not.toHaveBeenCalled();
    expect(ingestConcepts).not.toHaveBeenCalled();
    expect(db.getConcept).not.toHaveBeenCalled();
  });

  it("is a no-op when the graph worker is unconfigured", async () => {
    configured.mockReturnValue(false);
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      { db: fakeDb() }
    );
    expect(ingestConcepts).not.toHaveBeenCalled();
    expect(removeConcept).not.toHaveBeenCalled();
  });

  it("does not purge when the graph worker is unconfigured", async () => {
    configured.mockReturnValue(false);
    await performGraphSyncConcept(
      { kind: GRAPH_SYNC_KIND, op: "purge", collectionId: "col1" },
      { db: fakeDb() }
    );
    expect(purgeCollection).not.toHaveBeenCalled();
  });
});

describe("enqueueGraphSyncJob", () => {
  it("creates a ledger row when configured", async () => {
    const db = fakeDb();
    await enqueueGraphSyncJob({ op: "ingest", collectionId: "col1", conceptId: "c1" }, { db });
    expect(db.createBackgroundJob).toHaveBeenCalledWith({
      kind: GRAPH_SYNC_KIND,
      sourceId: null,
      payload: { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
    });
  });

  it("creates a purge ledger row (no conceptId) when configured", async () => {
    const db = fakeDb();
    await enqueueGraphSyncJob({ op: "purge", collectionId: "col1" }, { db });
    expect(db.createBackgroundJob).toHaveBeenCalledWith({
      kind: GRAPH_SYNC_KIND,
      sourceId: null,
      payload: { kind: GRAPH_SYNC_KIND, op: "purge", collectionId: "col1" },
    });
  });

  it("is inert (no row) when the graph worker is unconfigured", async () => {
    configured.mockReturnValue(false);
    const db = fakeDb();
    await enqueueGraphSyncJob({ op: "ingest", collectionId: "col1", conceptId: "c1" }, { db });
    expect(db.createBackgroundJob).not.toHaveBeenCalled();
  });
});

describe("backfillCollectionToGraph", () => {
  it("enqueues an ingest per Concept when configured", async () => {
    const db = fakeDb();
    const result = await backfillCollectionToGraph("col1", { db });
    expect(result).toEqual({ enqueued: 2 });
    expect(db.createBackgroundJob).toHaveBeenCalledTimes(2);
  });

  it("is inert when unconfigured", async () => {
    configured.mockReturnValue(false);
    const db = fakeDb();
    const result = await backfillCollectionToGraph("col1", { db });
    expect(result).toEqual({ enqueued: 0 });
    expect(db.createBackgroundJob).not.toHaveBeenCalled();
  });
});

describe("runDueGraphSyncJobs", () => {
  it("runs a claimed graph-sync job through the handler and marks it succeeded", async () => {
    const record: BackgroundJob = {
      id: "job1",
      kind: GRAPH_SYNC_KIND,
      sourceId: null,
      status: "running",
      payload: { kind: GRAPH_SYNC_KIND, op: "ingest", collectionId: "col1", conceptId: "c1" },
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: "2026-07-19T10:00:00.000Z",
      lockedAt: "2026-07-19T10:00:00.000Z",
      lockedBy: "w1",
      error: "",
      createdAt: "2026-07-19T10:00:00.000Z",
      updatedAt: "2026-07-19T10:00:00.000Z",
    };
    const db = fakeDb({
      claimBackgroundJobs: vi.fn().mockResolvedValueOnce([record]).mockResolvedValue([]),
    });
    const result = await runDueGraphSyncJobs({ db });
    expect(result.succeeded).toBe(1);
    expect(ingestConcepts).toHaveBeenCalledOnce();
    expect(db.updateBackgroundJob).toHaveBeenCalledWith(
      "job1",
      expect.objectContaining({ status: "succeeded" })
    );
  });
});
