import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, resetMockDb, type Db } from "@agent-hub/db";
import type { ApplicationConnector } from "./application-connectors";
import { syncApplicationImport } from "./application-sync";
import {
  enqueueApplicationSyncJob,
  runDueApplicationSyncJobs,
} from "./jobs";

let db: Db;

beforeEach(() => {
  resetMockDb();
  db = getMockDb();
});

async function configuredImport(options: {
  connectionMetadata?: Record<string, unknown>;
} = {}) {
  const [assistant] = await db.listAssistants(DEMO_ORG.id);
  const collection = await db.getOrCreateOrgLibraryCollection(DEMO_ORG.id);
  const connection = await db.createApplicationConnection({
    organizationId: DEMO_ORG.id,
    provider: "salesforce",
    name: "Salesforce Service Cloud",
    sealedCredentials: "sealed-for-test",
    scopes: ["api", "refresh_token"],
    providerAccountId: "acme.my.salesforce.com",
    metadata: options.connectionMetadata ?? {},
  });
  const applicationImport = await db.createApplicationImport({
    organizationId: DEMO_ORG.id,
    connectionId: connection.id,
    collectionId: collection.id,
    name: "Published knowledge",
    config: { language: "en_US" },
    cadence: "daily",
    assistantIds: [assistant.id],
  });
  return { assistant, applicationImport };
}

describe("Application Import synchronization", () => {
  it("raises an operational alert on failure and resolves it after recovery", async () => {
    const { applicationImport } = await configuredImport();
    let fail = true;
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        if (fail) throw new Error("Salesforce is unavailable");
        return { artifacts: [], checkpoint: {} };
      },
    };
    const input = {
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    } as const;

    await expect(syncApplicationImport(input)).rejects.toThrow(
      "Salesforce is unavailable"
    );
    expect(
      (await db.listAlerts(DEMO_ORG.id)).filter(
        (alert) => alert.sourceKey === `application-import:${applicationImport.id}`
      )
    ).toEqual([
      expect.objectContaining({ title: "Application knowledge sync failed" }),
    ]);

    fail = false;
    await syncApplicationImport(input);
    expect(
      (await db.listAlerts(DEMO_ORG.id)).filter(
        (alert) =>
          alert.sourceKey === `application-import:${applicationImport.id}` &&
          alert.status === "active"
      )
    ).toEqual([]);
  });

  it("runs through the durable job registry", async () => {
    const { applicationImport } = await configuredImport();
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [
            {
              remoteId: "ka-job",
              title: "Job article",
              text: "Durable content",
              canonicalUrl: null,
              revision: "1",
              updatedAt: null,
              metadata: {},
            },
          ],
          checkpoint: {},
        };
      },
    };
    await enqueueApplicationSyncJob(
      { importId: applicationImport.id, organizationId: DEMO_ORG.id },
      { db, applicationConnectors: { salesforce: connector } }
    );
    await enqueueApplicationSyncJob(
      { importId: applicationImport.id, organizationId: DEMO_ORG.id },
      { db, applicationConnectors: { salesforce: connector } }
    );

    const result = await runDueApplicationSyncJobs(
      { db, applicationConnectors: { salesforce: connector } },
      { workerId: "application-sync-test" }
    );

    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await db.listApplicationSources(applicationImport.id)).toHaveLength(1);
  });

  it("keeps a manual request due when the Organization queue is full", async () => {
    const first = await configuredImport();
    const second = await configuredImport();
    const previous = process.env.APPLICATION_IMPORT_MAX_CONCURRENT;
    process.env.APPLICATION_IMPORT_MAX_CONCURRENT = "1";
    try {
      await expect(
        enqueueApplicationSyncJob(
          { importId: first.applicationImport.id, organizationId: DEMO_ORG.id },
          { db }
        )
      ).resolves.toBe(true);
      await expect(
        enqueueApplicationSyncJob(
          { importId: second.applicationImport.id, organizationId: DEMO_ORG.id },
          { db }
        )
      ).resolves.toBe(false);
      expect(await db.getApplicationImport(second.applicationImport.id)).toMatchObject({
        status: "syncing",
        nextSyncAt: expect.any(String),
      });
      expect(
        (await db.listDueApplicationImports(new Date().toISOString(), 10)).map(
          (item) => item.id
        )
      ).toContain(second.applicationImport.id);
    } finally {
      if (previous === undefined) delete process.env.APPLICATION_IMPORT_MAX_CONCURRENT;
      else process.env.APPLICATION_IMPORT_MAX_CONCURRENT = previous;
    }
  });

  it("continues a bounded provider scan in a fresh durable claim", async () => {
    const { applicationImport } = await configuredImport();
    let claims = 0;
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        claims += 1;
        return {
          artifacts: [],
          checkpoint: claims === 1 ? { cursor: "page-2" } : { done: true },
          continuationRequired: claims === 1,
        };
      },
    };
    const deps = { db, applicationConnectors: { salesforce: connector } };
    await enqueueApplicationSyncJob(
      { importId: applicationImport.id, organizationId: DEMO_ORG.id },
      deps
    );
    await expect(
      runDueApplicationSyncJobs(deps, { workerId: "bounded-page-1" })
    ).resolves.toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      status: "syncing",
      checkpoint: { cursor: "page-2" },
    });
    await expect(
      runDueApplicationSyncJobs(deps, { workerId: "bounded-page-2" })
    ).resolves.toMatchObject({ claimed: 1, succeeded: 1 });
    expect(claims).toBe(2);
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      status: "ready",
      checkpoint: { done: true },
    });
  });

  it("fails terminally before materialization when the remote-item allowance is exceeded", async () => {
    const { applicationImport } = await configuredImport({
      connectionMetadata: { applicationImportItemLimit: 1 },
    });
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: ["one", "two"].map((remoteId) => ({
            remoteId,
            title: `Article ${remoteId}`,
            text: `Content ${remoteId}`,
            canonicalUrl: null,
            revision: "1",
            updatedAt: null,
            metadata: {},
          })),
          checkpoint: {},
        };
      },
    };

    await expect(
      syncApplicationImport({
        db,
        organizationId: DEMO_ORG.id,
        importId: applicationImport.id,
        connectors: { salesforce: connector },
      })
    ).rejects.toMatchObject({
      message: "Application Import exceeds its 1 remote-item allowance",
      retryable: false,
    });
    expect(await db.listSources(applicationImport.collectionId)).toEqual([]);
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      status: "error",
    });
  });

  it("enforces the cumulative Organization byte allowance before materialization", async () => {
    const { applicationImport } = await configuredImport({
      connectionMetadata: { applicationOrganizationByteLimit: 5 },
    });
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [{
            remoteId: "large",
            title: "Large article",
            text: "more than five bytes",
            canonicalUrl: null,
            revision: "1",
            updatedAt: null,
            metadata: {},
          }],
          checkpoint: {},
        };
      },
    };
    await expect(
      syncApplicationImport({
        db,
        organizationId: DEMO_ORG.id,
        importId: applicationImport.id,
        connectors: { salesforce: connector },
      })
    ).rejects.toMatchObject({ retryable: false });
    expect(await db.listSources(applicationImport.collectionId)).toEqual([]);
  });

  it("preserves items from earlier claims when a complete snapshot finishes", async () => {
    const { applicationImport } = await configuredImport();
    let claim = 0;
    const snapshotStartedAt = "2026-08-27T10:00:00.000Z";
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        claim += 1;
        return {
          artifacts: [{
            remoteId: `page-${claim}`,
            title: `Page ${claim}`,
            text: `Content ${claim}`,
            canonicalUrl: null,
            revision: "1",
            updatedAt: null,
            metadata: {},
          }],
          checkpoint: claim === 1 ? { scanStartedAt: snapshotStartedAt } : {},
          continuationRequired: claim === 1,
          completeSnapshotStartedAt:
            claim === 1 ? undefined : snapshotStartedAt,
        };
      },
    };
    const input = {
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    } as const;
    await syncApplicationImport({
      ...input,
      now: new Date(snapshotStartedAt),
    });
    await syncApplicationImport({
      ...input,
      now: new Date("2026-08-27T10:05:00.000Z"),
    });
    expect(
      (await db.listApplicationSources(applicationImport.id)).filter(
        (mapping) => mapping.sourceId
      )
    ).toHaveLength(2);
  });

  it("does not call a provider for a paused Import", async () => {
    const { applicationImport } = await configuredImport();
    await db.updateApplicationImport(applicationImport.id, { enabled: false });
    const synchronize = vi.fn();
    await expect(
      syncApplicationImport({
        db,
        organizationId: DEMO_ORG.id,
        importId: applicationImport.id,
        connectors: {
          salesforce: {
            provider: "salesforce",
            async discoverScopes() { return { scopes: [] }; },
            synchronize,
          },
        },
      })
    ).rejects.toMatchObject({ retryable: false });
    expect(synchronize).not.toHaveBeenCalled();
  });

  it("materializes remote artifacts as linked Sources and enqueues ingestion", async () => {
    const { assistant, applicationImport } = await configuredImport();
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [
            {
              remoteId: "ka01",
              title: "Reset your password",
              text: "Open Settings, then choose Reset password.",
              canonicalUrl: "https://acme.my.salesforce.com/knowledge/ka01",
              revision: "7",
              updatedAt: "2026-08-27T10:00:00.000Z",
              metadata: { language: "en_US" },
            },
          ],
          checkpoint: { cursor: "next-page" },
        };
      },
    };

    const run = await syncApplicationImport({
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
      now: new Date("2026-08-27T12:00:00.000Z"),
    });

    expect(run).toMatchObject({
      status: "succeeded",
      discovered: 1,
      upserted: 1,
      unchanged: 0,
      enqueued: 1,
    });
    const [mapping] = await db.listApplicationSources(applicationImport.id);
    expect(mapping).toMatchObject({ remoteId: "ka01", revision: "7" });
    expect(mapping.sourceId).not.toBeNull();
    const source = await db.getSource(mapping.sourceId!);
    expect(source).toMatchObject({
      name: "Reset your password",
      kind: "application",
      status: "processing",
      config: {
        applicationProvider: "salesforce",
        applicationImportId: applicationImport.id,
        remoteId: "ka01",
      },
    });
    expect(await db.listAssistantSourceIds(assistant.id)).toContain(source?.id);
    const jobs = await db.listBackgroundJobsForSource(source!.id, "ingest_source");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({
      assistantId: assistant.id,
      payloadVersion: expect.any(Number),
    });
    expect(jobs[0].payload).not.toHaveProperty("rawText");
    await expect(
      db.getSourceIngestPayload(
        source!.id,
        Number(jobs[0].payload.payloadVersion)
      )
    ).resolves.toMatchObject({
      rawText: "Open Settings, then choose Reset password.",
    });
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      status: "ready",
      checkpoint: { cursor: "next-page" },
      error: "",
      lastSyncedAt: "2026-08-27T12:00:00.000Z",
    });
  });

  it("reuses the deterministic Source after a crash before mapping persistence", async () => {
    const { applicationImport } = await configuredImport();
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [{
            remoteId: "crash-boundary",
            title: "Durable article",
            text: "Content survives a retry.",
            canonicalUrl: null,
            revision: "1",
            updatedAt: null,
            metadata: {},
          }],
          checkpoint: {},
        };
      },
    };
    const originalUpsert = db.upsertApplicationSource.bind(db);
    let failOnce = true;
    const crashingDb = {
      ...db,
      upsertApplicationSource: async (...args: Parameters<Db["upsertApplicationSource"]>) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("simulated mapping crash");
        }
        return originalUpsert(...args);
      },
    } as Db;
    const input = {
      db: crashingDb,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    } as const;
    await expect(syncApplicationImport(input)).rejects.toThrow("simulated mapping crash");
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      reservedBytes: 0,
    });
    const sourcesAfterCrash = await db.listSources(applicationImport.collectionId);
    expect(sourcesAfterCrash).toHaveLength(1);
    await syncApplicationImport(input);
    const [mapping] = await db.listApplicationSources(applicationImport.id);
    expect(mapping.sourceId).toBe(sourcesAfterCrash[0].id);
    expect(await db.listSources(applicationImport.collectionId)).toHaveLength(1);
  });

  it("does not lower its byte reservation until a smaller revision is materialized", async () => {
    const { applicationImport } = await configuredImport();
    let text = "1234567890";
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [{
            remoteId: "shrinking-article",
            title: "Shrinking article",
            text,
            canonicalUrl: null,
            revision: text,
            updatedAt: null,
            metadata: {},
          }],
          completeRemoteIds: ["shrinking-article"],
          checkpoint: {},
        };
      },
    };
    const baseInput = {
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    } as const;
    await syncApplicationImport(baseInput);
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      reservedBytes: 10,
    });

    text = "x";
    const originalUpsert = db.upsertApplicationSource.bind(db);
    const failingDb = {
      ...db,
      upsertApplicationSource: vi
        .fn<Db["upsertApplicationSource"]>()
        .mockRejectedValueOnce(new Error("mapping write failed"))
        .mockImplementation(originalUpsert),
    } as Db;
    await expect(
      syncApplicationImport({ ...baseInput, db: failingDb })
    ).rejects.toThrow("mapping write failed");
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      reservedBytes: 10,
    });
  });

  it("reserves the intermediate peak of a multi-item revision swap", async () => {
    const { applicationImport } = await configuredImport();
    let swapped = false;
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [
            {
              remoteId: "first",
              title: "First",
              text: swapped ? "a".repeat(100) : "a",
              canonicalUrl: null,
              revision: swapped ? "2" : "1",
              updatedAt: null,
              metadata: {},
            },
            {
              remoteId: "second",
              title: "Second",
              text: swapped ? "b" : "b".repeat(100),
              canonicalUrl: null,
              revision: swapped ? "2" : "1",
              updatedAt: null,
              metadata: {},
            },
          ],
          completeRemoteIds: ["first", "second"],
          checkpoint: {},
        };
      },
    };
    const baseInput = {
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    } as const;
    await syncApplicationImport(baseInput);
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      reservedBytes: 101,
    });

    swapped = true;
    const originalUpsert = db.upsertApplicationSource.bind(db);
    let writes = 0;
    const failingDb = {
      ...db,
      upsertApplicationSource: async (
        ...args: Parameters<Db["upsertApplicationSource"]>
      ) => {
        writes += 1;
        if (writes === 2) throw new Error("second mapping write failed");
        return originalUpsert(...args);
      },
    } as Db;
    await expect(
      syncApplicationImport({ ...baseInput, db: failingDb })
    ).rejects.toThrow("second mapping write failed");
    expect(
      (await db.listApplicationSources(applicationImport.id))
        .filter((mapping) => mapping.sourceId)
        .reduce((sum, mapping) => sum + mapping.contentBytes, 0)
    ).toBe(200);
    expect(await db.getApplicationImport(applicationImport.id)).toMatchObject({
      reservedBytes: 200,
    });
  });

  it("updates the same Source when a remote revision changes", async () => {
    const { applicationImport } = await configuredImport();
    let revision = 1;
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [
            {
              remoteId: "ka01",
              title: `Password guide v${revision}`,
              text: `Revision ${revision}`,
              canonicalUrl: null,
              revision: String(revision),
              updatedAt: null,
              metadata: {},
            },
          ],
          checkpoint: { revision },
        };
      },
    };
    const input = {
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    } as const;

    await syncApplicationImport(input);
    const [first] = await db.listApplicationSources(applicationImport.id);
    revision = 2;
    await syncApplicationImport(input);
    const mappings = await db.listApplicationSources(applicationImport.id);

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ sourceId: first.sourceId, revision: "2" });
    expect(first.sourceId).not.toBeNull();
    expect(await db.getSource(first.sourceId!)).toMatchObject({
      name: "Password guide v2",
    });
    const jobs = await db.listBackgroundJobsForSource(first.sourceId!, "ingest_source");
    expect(jobs).toHaveLength(2);
    expect(jobs.filter((job) => job.status === "failed")).toHaveLength(1);
    expect(jobs.filter((job) => job.status === "queued")).toHaveLength(1);
    expect(
      jobs.find((job) => job.status === "failed")?.error
    ).toMatch(/superseded/i);
  });

  it("counts a skipped item once when it is also in a complete snapshot", async () => {
    const { applicationImport } = await configuredImport();
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return {
          artifacts: [],
          completeRemoteIds: ["empty-article"],
          skipped: [
            { remoteId: "empty-article", reason: "empty_article_content" },
          ],
          checkpoint: {},
        };
      },
    };

    const run = await syncApplicationImport({
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    });

    expect(run).toMatchObject({ discovered: 1, skipped: 1 });
  });

  it("removes stale content when a changed artifact becomes deterministically unsupported", async () => {
    const { applicationImport } = await configuredImport();
    let unsupported = false;
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return unsupported
          ? {
              artifacts: [],
              completeRemoteIds: ["article-1"],
              skipped: [{ remoteId: "article-1", reason: "empty_article_content" }],
              checkpoint: { revision: 2 },
            }
          : {
              artifacts: [{
                remoteId: "article-1",
                title: "Policy",
                text: "Old retrievable policy",
                canonicalUrl: null,
                revision: "1",
                updatedAt: null,
                metadata: {},
              }],
              completeRemoteIds: ["article-1"],
              checkpoint: { revision: 1 },
            };
      },
    };
    const input = {
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
    } as const;
    await syncApplicationImport(input);
    const [before] = await db.listApplicationSources(applicationImport.id);
    unsupported = true;
    await syncApplicationImport(input);
    const [after] = await db.listApplicationSources(applicationImport.id);
    expect(after.sourceId).toBeNull();
    expect(after.removedAt).not.toBeNull();
    expect(await db.getSource(before.sourceId!)).toBeNull();
  });

  it("removes a remote item from retrieval while retaining its tombstone", async () => {
    const { assistant, applicationImport } = await configuredImport();
    let removed = false;
    const connector: ApplicationConnector = {
      provider: "salesforce",
      async discoverScopes() {
        return { scopes: [] };
      },
      async synchronize() {
        return removed
          ? {
              artifacts: [],
              completeRemoteIds: [],
              checkpoint: { done: true },
            }
          : {
              artifacts: [
                {
                  remoteId: "ka-removed",
                  title: "Old policy",
                  text: "This policy is no longer valid.",
                  canonicalUrl: null,
                  revision: "1",
                  updatedAt: null,
                  metadata: {},
                },
              ],
              completeRemoteIds: ["ka-removed"],
              checkpoint: {},
            };
      },
    };
    const input = {
      db,
      organizationId: DEMO_ORG.id,
      importId: applicationImport.id,
      connectors: { salesforce: connector },
      now: new Date("2026-08-27T12:00:00.000Z"),
    } as const;
    await syncApplicationImport(input);
    const [before] = await db.listApplicationSources(applicationImport.id);
    expect(before.sourceId).not.toBeNull();

    removed = true;
    await syncApplicationImport({
      ...input,
      now: new Date("2026-08-27T13:00:00.000Z"),
    });
    const [after] = await db.listApplicationSources(applicationImport.id);
    expect(after).toMatchObject({
      id: before.id,
      sourceId: null,
      removedAt: "2026-08-27T13:00:00.000Z",
    });
    expect(await db.getSource(before.sourceId!)).toBeNull();
    expect(await db.listAssistantSourceIds(assistant.id)).not.toContain(
      before.sourceId
    );
  });
});
