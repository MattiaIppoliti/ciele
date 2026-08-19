import { describe, expect, it, vi } from "vitest";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";
import { ingestSource } from "./ingest";

/**
 * The ingestion-failure Alert producer, parity with the website-crawl
 * producer in `finalizeWebsiteCrawl`. Runs offline (mock DB, no Provider
 * Connections): `enrich` falls back to a single naive concept and embeddings
 * fall back to lexical, so the only failure is the one we inject.
 */
describe("ingestSource operational alerts", () => {
  async function seed(db: Db) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Ingest" });
    const collection = await db.createCollection(assistant.id, { name: "Ingest" });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Handbook.pdf",
      kind: "file",
      config: {},
    });
    return { assistant, collection, source };
  }

  const activeIngestAlerts = async (db: Db, orgId: string, sourceId: string) =>
    (await db.listAlerts(orgId)).filter(
      (a) => a.sourceKey === `ingest-source:${sourceId}` && a.status === "active"
    );

  it("raises one Alert on failure, dedups repeats, and auto-resolves on retry", async () => {
    const db = getMockDb();
    const { assistant, collection, source } = await seed(db);
    const orgId = assistant.organizationId;
    const baselineActive = await db.countActiveAlerts(orgId);

    // Force the persist step to fail so ingestion lands in `error`.
    const createConcept = vi
      .spyOn(db, "createConcept")
      .mockRejectedValue(new Error("embedding provider unreachable"));

    const run = () =>
      ingestSource({
        db,
        assistantId: assistant.id,
        collectionId: collection.id,
        source,
        rawText: "Some handbook content.",
        connections: [],
      });

    await run();
    expect((await db.getSource(source.id))?.status).toBe("error");
    let alerts = await activeIngestAlerts(db, orgId, source.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("ingestion");
    expect(alerts[0].detail).toMatch(/unreachable/);
    // Sidebar badge count reflects the new producer.
    expect(await db.countActiveAlerts(orgId)).toBe(baselineActive + 1);

    // Repeated failure of the same Source refreshes, never duplicates.
    await run();
    await run();
    alerts = await activeIngestAlerts(db, orgId, source.id);
    expect(alerts).toHaveLength(1);
    expect(await db.countActiveAlerts(orgId)).toBe(baselineActive + 1);

    // Successful retry ingests and auto-resolves the Alert.
    createConcept.mockRestore();
    await run();
    expect((await db.getSource(source.id))?.status).toBe("ready");
    expect(await activeIngestAlerts(db, orgId, source.id)).toHaveLength(0);
    expect(await db.countActiveAlerts(orgId)).toBe(baselineActive);
  });
});
