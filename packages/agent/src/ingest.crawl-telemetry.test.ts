import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RuntimeEventInput } from "@agent-hub/core";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";

// Keep the pure Crawl4AI helpers (status classification, page mapping,
// redaction) real; stub only the network status call so the finalizer can be
// driven through the Crawl4AI adapter offline.
vi.mock("./crawl4ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./crawl4ai")>()),
  getCrawl4aiTask: vi.fn(),
}));

import { getCrawl4aiTask } from "./crawl4ai";
import { finalizeWebsiteCrawl } from "./ingest";

/**
 * Operational visibility for Crawl4AI runs (#108): the finalizer must map a
 * terminal Crawl4AI outcome onto the existing Source-scoped crawl Alert
 * (raise / dedup / auto-resolve), meter one sanitized `crawl` telemetry event,
 * and never let a crawler credential reach a Source, an Alert, or the sink.
 *
 * Runs offline: mock DB + no Provider Connections (lexical embeddings), and the
 * one Crawl4AI status call is stubbed.
 */
describe("finalizeWebsiteCrawl — Crawl4AI visibility", () => {
  const taskMock = vi.mocked(getCrawl4aiTask);

  async function seed(db: Db, name: string) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "website",
      config: {
        url: "https://x.edu",
        crawlerProvider: "crawl4ai",
        resolvedCrawlerProvider: "crawl4ai",
        crawlRunId: "task-1",
        crawlDatasetId: "task-1",
        crawlStartedAt: new Date(Date.now() - 5_000).toISOString(),
      },
    });
    return { assistant, collection, source };
  }

  const activeCrawlAlerts = (db: Db, orgId: string, sourceId: string) =>
    db
      .listAlerts(orgId)
      .then((alerts) =>
        alerts.filter(
          (a) => a.sourceKey === `website-source:${sourceId}` && a.status === "active"
        )
      );

  /** Captures every telemetry event written during a finalize. */
  function captureTelemetry(db: Db): RuntimeEventInput[] {
    const events: RuntimeEventInput[] = [];
    vi.spyOn(db, "recordRuntimeEvent").mockImplementation(async (event) => {
      events.push(event);
    });
    return events;
  }

  beforeEach(() => {
    taskMock.mockReset();
    process.env.CRAWL4AI_BASE_URL = "https://crawler.internal";
    process.env.CRAWL4AI_API_TOKEN = "super-secret-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CRAWL4AI_BASE_URL;
    delete process.env.CRAWL4AI_API_TOKEN;
  });

  it("raises a crawl Alert on a remote failure, dedups repeats, and records telemetry", async () => {
    const db = getMockDb();
    const { assistant, collection, source } = await seed(db, "c4-failed");
    const orgId = assistant.organizationId;
    const baseline = await db.countActiveAlerts(orgId);
    const events = captureTelemetry(db);
    taskMock.mockResolvedValue({ status: "failed", results: [], error: "worker crashed" });

    const run = () =>
      finalizeWebsiteCrawl({
        db,
        assistantId: assistant.id,
        collectionId: collection.id,
        sourceId: source.id,
      });

    expect(await run()).toBe("error");
    let alerts = await activeCrawlAlerts(db, orgId, source.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("crawl");
    expect(await db.countActiveAlerts(orgId)).toBe(baseline + 1);

    // Repeated finalizes of the same failed run refresh, never duplicate. A
    // terminal Source is a no-op, so re-arm it to `processing` between polls.
    await db.updateSource(source.id, { status: "processing" });
    await run();
    await db.updateSource(source.id, { status: "processing" });
    await run();
    alerts = await activeCrawlAlerts(db, orgId, source.id);
    expect(alerts).toHaveLength(1);
    expect(await db.countActiveAlerts(orgId)).toBe(baseline + 1);

    // Telemetry: a failed crawl event attributed to the resolved provider and
    // the worker task id, with the sanitized error class.
    const failed = events.filter((e) => e.kind === "crawl" && e.status === "failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0].crawlerProvider).toBe("crawl4ai");
    expect(failed[0].traceId).toBe("task-1");
    expect(failed[0].errorClass).toBe("RemoteCrawlFailure");
    expect(failed[0].pageCount).toBeNull();
    expect(failed[0].durationMs).toBeGreaterThan(0);
  });

  it("treats a completed-but-empty crawl as a distinct error outcome", async () => {
    const db = getMockDb();
    const { assistant, collection, source } = await seed(db, "c4-empty");
    const events = captureTelemetry(db);
    taskMock.mockResolvedValue({ status: "completed", results: [] });

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });

    expect(status).toBe("error");
    expect((await db.getSource(source.id))?.error).toMatch(/no usable pages/i);
    const failed = events.find((e) => e.kind === "crawl" && e.status === "failed");
    expect(failed?.errorClass).toBe("EmptyCrawl");
  });

  it("ingests pages, resolves the Alert, and records a succeeded crawl event on recovery", async () => {
    const db = getMockDb();
    const { assistant, collection, source } = await seed(db, "c4-recovers");
    const orgId = assistant.organizationId;
    const events = captureTelemetry(db);

    // First a failure raises the Alert…
    taskMock.mockResolvedValue({ status: "failed", results: [], error: "worker crashed" });
    await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });
    expect(await activeCrawlAlerts(db, orgId, source.id)).toHaveLength(1);

    // …then a successful retry ingests pages and auto-resolves it.
    await db.updateSource(source.id, { status: "processing" });
    taskMock.mockResolvedValue({
      status: "completed",
      results: [
        { url: "https://x.edu/a", markdown: "Alpha", metadata: { title: "Page A" } },
        { url: "https://x.edu/b", markdown: "Beta", metadata: { title: "Page B" } },
      ],
    });
    const status = await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    expect(await activeCrawlAlerts(db, orgId, source.id)).toHaveLength(0);
    expect(await db.listConcepts(collection.id)).toHaveLength(2);

    const succeeded = events.find((e) => e.kind === "crawl" && e.status === "succeeded");
    expect(succeeded?.crawlerProvider).toBe("crawl4ai");
    expect(succeeded?.pageCount).toBe(2);
    expect(succeeded?.traceId).toBe("task-1");
    expect(succeeded?.errorClass).toBeNull();
  });

  it("never lets a crawler credential reach the Source, Alert, or telemetry", async () => {
    const db = getMockDb();
    const { assistant, collection, source } = await seed(db, "c4-redaction");
    const orgId = assistant.organizationId;
    const events = captureTelemetry(db);
    // A worker that echoes the bearer token into its error body.
    taskMock.mockResolvedValue({
      status: "failed",
      results: [],
      error: "auth rejected: Authorization: Bearer super-secret-token",
    });

    await finalizeWebsiteCrawl({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      sourceId: source.id,
    });

    const persisted = await db.getSource(source.id);
    expect(persisted?.error).not.toContain("super-secret-token");

    const alert = (await activeCrawlAlerts(db, orgId, source.id))[0];
    expect(alert.detail).not.toContain("super-secret-token");

    const failed = events.find((e) => e.kind === "crawl" && e.status === "failed");
    expect(JSON.stringify(failed)).not.toContain("super-secret-token");
  });
});
