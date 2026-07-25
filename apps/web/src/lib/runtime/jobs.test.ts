import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundJob, Db } from "@agent-hub/db";
import { runDueIngestJobs, runIngestJob } from "./jobs";
import { ingestSource } from "./ingest";

vi.mock("./ingest", () => ({
  ingestSource: vi.fn(),
}));

function fakeDb(overrides: Partial<Db> = {}): Db {
  return {
    getAssistant: vi.fn().mockResolvedValue({ id: "a1", organizationId: "org1" }),
    getSource: vi.fn().mockResolvedValue({ id: "s1", name: "Doc", kind: "text" }),
    listProviderConnections: vi.fn().mockResolvedValue([]),
    updateSource: vi.fn().mockResolvedValue(undefined),
    claimBackgroundJobs: vi.fn().mockResolvedValue([]),
    updateBackgroundJob: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Db;
}

function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: "job1",
    kind: "ingest_source",
    sourceId: "s1",
    status: "running",
    payload: {
      kind: "ingest_source",
      assistantId: "a1",
      collectionId: "c1",
      sourceId: "s1",
      rawText: "hello",
    },
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: "2026-07-09T10:00:00.000Z",
    lockedAt: "2026-07-09T10:00:00.000Z",
    lockedBy: "worker1",
    error: "",
    createdAt: "2026-07-09T10:00:00.000Z",
    updatedAt: "2026-07-09T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runDueIngestJobs", () => {
  it("marks a claimed job succeeded and a second run does not ingest it again", async () => {
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([job()])
        .mockResolvedValueOnce([]) as Db["claimBackgroundJobs"],
    });

    await expect(
      runDueIngestJobs(
        { db },
        {
          now: new Date("2026-07-09T10:01:00.000Z"),
          workerId: "worker1",
        }
      )
    ).resolves.toEqual({ claimed: 1, succeeded: 1, failed: 0, retried: 0 });
    await expect(
      runDueIngestJobs(
        { db },
        {
          now: new Date("2026-07-09T10:02:00.000Z"),
          workerId: "worker1",
        }
      )
    ).resolves.toEqual({ claimed: 0, succeeded: 0, failed: 0, retried: 0 });

    expect(ingestSource).toHaveBeenCalledTimes(1);
    expect(db.updateBackgroundJob).toHaveBeenCalledWith("job1", {
      status: "succeeded",
      error: "",
      lockedAt: null,
      lockedBy: null,
    });
  });

  it("requeues failed jobs until their final attempt", async () => {
    const db = fakeDb({
      getSource: vi.fn().mockResolvedValue(null) as Db["getSource"],
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValue([job({ attempts: 1, maxAttempts: 3 })]) as Db["claimBackgroundJobs"],
    });

    await expect(
      runDueIngestJobs(
        { db },
        {
          now: new Date("2026-07-09T10:01:00.000Z"),
          workerId: "worker1",
        }
      )
    ).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 0, retried: 1 });
    expect(db.updateBackgroundJob).toHaveBeenCalledWith("job1", {
      status: "queued",
      error: "Not found",
      nextRunAt: "2026-07-09T10:02:00.000Z",
      lockedAt: null,
      lockedBy: null,
    });
  });

  it("marks the Source error when the last attempt fails", async () => {
    const db = fakeDb({
      getSource: vi.fn().mockResolvedValue(null) as Db["getSource"],
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValue([job({ attempts: 3, maxAttempts: 3 })]) as Db["claimBackgroundJobs"],
    });

    await expect(
      runDueIngestJobs(
        { db },
        {
          now: new Date("2026-07-09T10:01:00.000Z"),
          workerId: "worker1",
        }
      )
    ).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1, retried: 0 });
    expect(db.updateBackgroundJob).toHaveBeenCalledWith("job1", {
      status: "failed",
      error: "Not found",
      lockedAt: null,
      lockedBy: null,
    });
    expect(db.updateSource).toHaveBeenCalledWith("s1", {
      status: "error",
      error: "Not found",
    });
  });
});

describe("runIngestJob", () => {
  it("rehydrates assistant, source and connections for ingest_source", async () => {
    const db = fakeDb();
    await runIngestJob(
      {
        kind: "ingest_source",
        assistantId: "a1",
        collectionId: "c1",
        sourceId: "s1",
        rawText: "hello",
      },
      { db }
    );
    expect(db.listProviderConnections).toHaveBeenCalledWith("org1");
    expect(ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        assistantId: "a1",
        collectionId: "c1",
        rawText: "hello",
        source: expect.objectContaining({ id: "s1" }),
      })
    );
  });

  it("lands rehydration failures in the Source error status", async () => {
    const db = fakeDb({ getSource: vi.fn().mockResolvedValue(null) as Db["getSource"] });
    await runIngestJob(
      {
        kind: "ingest_source",
        assistantId: "a1",
        collectionId: "c1",
        sourceId: "s1",
        rawText: "hello",
      },
      { db }
    );
    expect(ingestSource).not.toHaveBeenCalled();
    expect(db.updateSource).toHaveBeenCalledWith("s1", {
      status: "error",
      error: "Not found",
    });
  });
});

describe("runDueJobs (generic ledger)", () => {
  it("drains every registered kind when no kinds are given", async () => {
    const claim = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ claimBackgroundJobs: claim as Db["claimBackgroundJobs"] });
    const { runDueJobs } = await import("./jobs");
    const result = await runDueJobs({ db }, { now: new Date("2026-07-09T10:00:00Z") });
    // Every registered kind is claimed once.
    const kinds = claim.mock.calls.map((call) => call[0].kind).sort();
    expect(kinds).toEqual([
      "draft_improvement_proposal",
      "graph_sync_concept",
      "ingest_source",
    ]);
    expect(result).toEqual({ claimed: 0, succeeded: 0, failed: 0, retried: 0 });
  });

  it("applies linear backoff on retry: attempt N reruns N minutes later", async () => {
    vi.mocked(ingestSource).mockRejectedValue(new Error("boom"));
    const update = vi.fn().mockResolvedValue(undefined);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([job({ attempts: 2, maxAttempts: 3 })])
        .mockResolvedValue([]) as Db["claimBackgroundJobs"],
      updateBackgroundJob: update as Db["updateBackgroundJob"],
      getSource: vi
        .fn()
        .mockResolvedValue({ id: "s1", name: "Doc", kind: "text", status: "error", error: "boom" }) as Db["getSource"],
    });
    const { runDueJobs } = await import("./jobs");
    const now = new Date("2026-07-09T10:00:00Z");
    await runDueJobs({ db }, { now });
    expect(update).toHaveBeenCalledWith(
      "job1",
      expect.objectContaining({
        status: "queued",
        nextRunAt: new Date(now.getTime() + 2 * 60_000).toISOString(),
      })
    );
  });

  it("runs the terminal-failure hook exactly once when attempts are exhausted", async () => {
    vi.mocked(ingestSource).mockRejectedValue(new Error("boom"));
    const updateSource = vi.fn().mockResolvedValue(undefined);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([job({ attempts: 3, maxAttempts: 3 })])
        .mockResolvedValue([]) as Db["claimBackgroundJobs"],
      updateSource: updateSource as Db["updateSource"],
      getSource: vi
        .fn()
        .mockResolvedValue({ id: "s1", name: "Doc", kind: "text", status: "error", error: "boom" }) as Db["getSource"],
    });
    const { runDueJobs } = await import("./jobs");
    const result = await runDueJobs({ db }, { now: new Date("2026-07-09T10:00:00Z") });
    expect(result.failed).toBe(1);
    expect(updateSource).toHaveBeenCalledTimes(1);
    expect(updateSource).toHaveBeenCalledWith("s1", {
      status: "error",
      error: expect.stringContaining("boom"),
    });
  });
});
