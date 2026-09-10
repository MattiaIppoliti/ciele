import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { BackgroundJob } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { enqueueIngestJob, runDueIngestJobs, runIngestJob } from "./jobs";
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
    claimTerminalBackgroundJobs: vi.fn().mockResolvedValue([]),
    claimBackgroundJobs: vi.fn().mockResolvedValue([]),
    settleBackgroundJob: vi.fn().mockResolvedValue(true),
    getSourceIngestPayload: vi.fn().mockResolvedValue({
      version: 1,
      rawText: "hello",
    }),
    ...overrides,
  } as unknown as Db;
}

function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: "job1",
    organizationId: "org1",
    kind: "ingest_source",
    sourceId: "s1",
    status: "running",
    payload: {
      kind: "ingest_source",
      assistantId: "a1",
      collectionId: "c1",
      sourceId: "s1",
      payloadVersion: 1,
    },
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: "2026-07-09T10:00:00.000Z",
    lockedAt: "2026-07-09T10:00:00.000Z",
    lockedBy: "worker1",
    leaseToken: "00000000-0000-4000-8000-000000000001",
    error: "",
    createdAt: "2026-07-09T10:00:00.000Z",
    updatedAt: "2026-07-09T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ingestSource).mockResolvedValue(true);
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
    ).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      retried: 0,
      superseded: 0,
    });
    await expect(
      runDueIngestJobs(
        { db },
        {
          now: new Date("2026-07-09T10:02:00.000Z"),
          workerId: "worker1",
        }
      )
    ).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      superseded: 0,
    });

    expect(ingestSource).toHaveBeenCalledTimes(1);
    expect(db.settleBackgroundJob).toHaveBeenCalledWith({
      id: "job1",
      leaseToken: "00000000-0000-4000-8000-000000000001",
      now: "2026-07-09T10:01:00.000Z",
      outcome: { status: "succeeded" },
    });
  });

  it("converts a legacy application ingest in place and resumes that version", async () => {
    const legacyPayload = {
      kind: "ingest_source" as const,
      assistantId: "a1",
      collectionId: "c1",
      sourceId: "s1",
      rawText: "Large application artifact",
    };
    const firstClaim = job({ payload: legacyPayload });
    const secondClaim = job({
      payload: {
        kind: "ingest_source",
        assistantId: "a1",
        collectionId: "c1",
        sourceId: "s1",
        payloadVersion: 1,
      },
      attempts: 2,
      leaseToken: "00000000-0000-4000-8000-000000000002",
    });
    const upgrade = vi.fn().mockResolvedValue(1);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([firstClaim])
        .mockResolvedValueOnce([secondClaim]) as Db["claimBackgroundJobs"],
      upgradeLegacySourceIngestJob: upgrade as Db["upgradeLegacySourceIngestJob"],
      settleBackgroundJob: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true) as Db["settleBackgroundJob"],
    });

    await expect(
      runDueIngestJobs({ db }, { now: new Date("2026-07-09T10:01:00Z") })
    ).resolves.toMatchObject({ superseded: 1 });
    await expect(
      runDueIngestJobs({ db }, { now: new Date("2026-07-09T10:20:00Z") })
    ).resolves.toMatchObject({ succeeded: 1 });

    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(upgrade).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job1",
      assistantId: "a1",
      collectionId: "c1",
      sourceId: "s1",
      rawText: "Large application artifact",
    }));
    expect(ingestSource).toHaveBeenCalledTimes(2);
  });

  it("executes a schema-lag fallback instead of restaging it forever", async () => {
    const fallback = job({
      payload: {
        kind: "ingest_source",
        assistantId: "a1",
        collectionId: "c1",
        sourceId: "s1",
        rawText: "Fallback payload",
        schemaLagFallback: true,
      },
    });
    const stage = vi.fn();
    const db = fakeDb({
      claimBackgroundJobs: vi.fn().mockResolvedValue([fallback]) as Db["claimBackgroundJobs"],
      stageSourceIngestJob: stage as Db["stageSourceIngestJob"],
    });

    await expect(
      runDueIngestJobs({ db }, { now: new Date("2026-07-09T10:01:00Z") })
    ).resolves.toMatchObject({ succeeded: 1 });
    expect(stage).not.toHaveBeenCalled();
    expect(ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: "Fallback payload" })
    );
  });

  it("executes an existing legacy job when the payload migration is not installed", async () => {
    const legacy = job({
      payload: {
        kind: "ingest_source",
        assistantId: "a1",
        collectionId: "c1",
        sourceId: "s1",
        rawText: "Pre-migration payload",
      },
    });
    const upgrade = vi.fn().mockResolvedValue("schema_lag");
    const db = fakeDb({
      claimBackgroundJobs: vi.fn().mockResolvedValue([legacy]) as Db["claimBackgroundJobs"],
      upgradeLegacySourceIngestJob: upgrade as Db["upgradeLegacySourceIngestJob"],
    });

    await expect(
      runDueIngestJobs({ db }, { now: new Date("2026-07-09T10:01:00Z") })
    ).resolves.toMatchObject({ succeeded: 1 });
    expect(upgrade).toHaveBeenCalledOnce();
    expect(ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: "Pre-migration payload" })
    );
  });

  it("drops an obsolete legacy application revision and upgrades the current one", async () => {
    const rawJob = (rawText: string, leaseToken: string) =>
      job({
        payload: {
          kind: "ingest_source",
          assistantId: "a1",
          collectionId: "c1",
          sourceId: "s1",
          rawText,
        },
        leaseToken,
      });
    const oldRevision = rawJob(
      "Revision one",
      "00000000-0000-4000-8000-000000000001"
    );
    const currentRevision = rawJob(
      "Revision two",
      "00000000-0000-4000-8000-000000000002"
    );
    const currentHash = createHash("sha256")
      .update("Password guide")
      .update("\0")
      .update("Revision two")
      .digest("hex");
    const upgrade = vi.fn().mockResolvedValue(1);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([oldRevision])
        .mockResolvedValueOnce([currentRevision]) as Db["claimBackgroundJobs"],
      getSource: vi.fn().mockResolvedValue({
        id: "s1",
        name: "Password guide",
        kind: "application",
        config: { applicationImportId: "import1" },
      }) as Db["getSource"],
      listApplicationSources: vi.fn().mockResolvedValue([
        { sourceId: "s1", contentHash: currentHash },
      ]) as Db["listApplicationSources"],
      upgradeLegacySourceIngestJob: upgrade as Db["upgradeLegacySourceIngestJob"],
    });

    await runDueIngestJobs({ db }, { now: new Date("2026-07-09T10:01:00Z") });
    await runDueIngestJobs({ db }, { now: new Date("2026-07-09T10:02:00Z") });

    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(upgrade).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: "Revision two" })
    );
    expect(ingestSource).toHaveBeenCalledTimes(1);
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
    ).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 0,
      retried: 1,
      superseded: 0,
    });
    expect(db.settleBackgroundJob).toHaveBeenCalledWith({
      id: "job1",
      leaseToken: "00000000-0000-4000-8000-000000000001",
      now: "2026-07-09T10:01:00.000Z",
      outcome: {
        status: "queued",
        error: "Not found",
        nextRunAt: "2026-07-09T10:02:00.000Z",
      },
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
    ).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      retried: 0,
      superseded: 0,
    });
    expect(db.settleBackgroundJob).toHaveBeenCalledWith({
      id: "job1",
      leaseToken: "00000000-0000-4000-8000-000000000001",
      now: "2026-07-09T10:01:00.000Z",
      outcome: { status: "failed", error: "Not found" },
    });
    expect(db.updateSource).toHaveBeenCalledWith("s1", {
      status: "error",
      error: "Not found",
    });
  });

  it("runs terminal cleanup for a lease that crashed on its last attempt", async () => {
    const terminal = job({
      attempts: 3,
      maxAttempts: 3,
      error: "Worker lease expired after final attempt",
    });
    const db = fakeDb({
      claimTerminalBackgroundJobs: vi
        .fn()
        .mockResolvedValue([terminal]) as Db["claimTerminalBackgroundJobs"],
    });

    await expect(
      runDueIngestJobs({ db }, { now: new Date("2026-07-09T11:00:00.000Z") })
    ).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 1,
      retried: 0,
      superseded: 0,
    });
    expect(ingestSource).not.toHaveBeenCalled();
    expect(db.updateSource).toHaveBeenCalledWith("s1", {
      status: "error",
      error: "Worker lease expired after final attempt",
    });
    expect(db.settleBackgroundJob).toHaveBeenCalledWith({
      id: "job1",
      leaseToken: terminal.leaseToken,
      now: "2026-07-09T11:00:00.000Z",
      outcome: {
        status: "failed",
        error: "Worker lease expired after final attempt",
      },
    });
  });

  it("retries terminal cleanup when its side effect fails transiently", async () => {
    const terminal = job({ attempts: 3, maxAttempts: 3 });
    const db = fakeDb({
      claimTerminalBackgroundJobs: vi
        .fn()
        .mockResolvedValue([terminal]) as Db["claimTerminalBackgroundJobs"],
      updateSource: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });

    await expect(
      runDueIngestJobs({ db }, { now: new Date("2026-07-09T11:00:00.000Z") })
    ).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      retried: 1,
      superseded: 0,
    });
    expect(db.settleBackgroundJob).not.toHaveBeenCalled();
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

describe("enqueueIngestJob", () => {
  it("stages large text separately and queues only its version reference", async () => {
    const stageSourceIngestJob = vi.fn().mockResolvedValue(7);
    const db = fakeDb({
      stageSourceIngestJob: stageSourceIngestJob as Db["stageSourceIngestJob"],
    });
    const rawText = "x".repeat(2 * 1024 * 1024);

    await enqueueIngestJob(
      {
        kind: "ingest_source",
        assistantId: "a1",
        collectionId: "c1",
        sourceId: "s1",
        rawText,
      },
      { db }
    );

    expect(stageSourceIngestJob).toHaveBeenCalledOnce();
    expect(stageSourceIngestJob).toHaveBeenCalledWith({
      kind: "ingest_source",
      assistantId: "a1",
      collectionId: "c1",
      sourceId: "s1",
      rawText,
    });
    expect(db.createBackgroundJob).toBeUndefined();
  });
});

describe("runDueJobs (generic ledger)", () => {
  it("reports a superseded result when the claim fence rejects settlement", async () => {
    const settle = vi.fn().mockResolvedValue(false);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([job()])
        .mockResolvedValue([]) as Db["claimBackgroundJobs"],
      settleBackgroundJob: settle as Db["settleBackgroundJob"],
    });
    const { runDueJobs } = await import("./jobs");

    await expect(
      runDueJobs(
        { db },
        { now: new Date("2026-07-09T10:01:00Z"), kinds: ["ingest_source"] }
      )
    ).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 0,
      retried: 0,
      superseded: 1,
    });
    expect(settle).toHaveBeenCalledOnce();
  });

  it("drains every registered kind when no kinds are given", async () => {
    const claim = vi.fn().mockResolvedValue([]);
    const db = fakeDb({ claimBackgroundJobs: claim as Db["claimBackgroundJobs"] });
    const { runDueJobs } = await import("./jobs");
    const result = await runDueJobs({ db }, { now: new Date("2026-07-09T10:00:00Z") });
    // Every registered kind is claimed once.
    const kinds = claim.mock.calls.map((call) => call[0].kind).sort();
    expect(kinds).toEqual([
      "deliver_review_request",
      "distill_agent_memory",
      "draft_improvement_proposal",
      "graph_sync_concept",
      "ingest_source",
      "promote_memories",
      "resume_reviewed_conversation",
      "resume_webhook_conversation",
      "sync_application_import",
      "sync_entity_records",
    ]);
    expect(result).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      superseded: 0,
    });
  });

  it("applies linear backoff on retry: attempt N reruns N minutes later", async () => {
    vi.mocked(ingestSource).mockRejectedValue(new Error("boom"));
    const settle = vi.fn().mockResolvedValue(true);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([job({ attempts: 2, maxAttempts: 3 })])
        .mockResolvedValue([]) as Db["claimBackgroundJobs"],
      settleBackgroundJob: settle as Db["settleBackgroundJob"],
      getSource: vi
        .fn()
        .mockResolvedValue({ id: "s1", name: "Doc", kind: "text", status: "error", error: "boom" }) as Db["getSource"],
    });
    const { runDueJobs } = await import("./jobs");
    const now = new Date("2026-07-09T10:00:00Z");
    await runDueJobs({ db }, { now });
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job1",
        outcome: expect.objectContaining({
          status: "queued",
          nextRunAt: new Date(now.getTime() + 2 * 60_000).toISOString(),
        }),
      })
    );
  });

  it("honors a provider Retry-After when it is longer than generic backoff", async () => {
    vi.mocked(ingestSource).mockRejectedValue(
      Object.assign(new Error("rate limited"), { retryAfterMs: 10 * 60_000 })
    );
    const settle = vi.fn().mockResolvedValue(true);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([job({ attempts: 1, maxAttempts: 3 })])
        .mockResolvedValue([]) as Db["claimBackgroundJobs"],
      settleBackgroundJob: settle as Db["settleBackgroundJob"],
      getSource: vi
        .fn()
        .mockResolvedValue({ id: "s1", name: "Doc", kind: "text" }) as Db["getSource"],
    });
    const { runDueJobs } = await import("./jobs");
    const now = new Date("2026-07-09T10:00:00Z");
    await runDueJobs({ db }, { now });
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job1",
        outcome: expect.objectContaining({
          status: "queued",
          nextRunAt: "2026-07-09T10:10:00.000Z",
        }),
      })
    );
  });

  it("fails a non-retryable provider error immediately", async () => {
    vi.mocked(ingestSource).mockRejectedValue(
      Object.assign(new Error("authorization expired"), { retryable: false })
    );
    const settle = vi.fn().mockResolvedValue(true);
    const db = fakeDb({
      claimBackgroundJobs: vi
        .fn()
        .mockResolvedValueOnce([job({ attempts: 1, maxAttempts: 3 })])
        .mockResolvedValue([]) as Db["claimBackgroundJobs"],
      settleBackgroundJob: settle as Db["settleBackgroundJob"],
    });
    const { runDueJobs } = await import("./jobs");

    await expect(runDueJobs({ db }, { now: new Date("2026-07-09T10:00:00Z") }))
      .resolves.toEqual({
        claimed: 1,
        succeeded: 0,
        failed: 1,
        retried: 0,
        superseded: 0,
      });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      id: "job1",
      outcome: expect.objectContaining({
        status: "failed",
        error: "authorization expired",
      }),
    }));
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
