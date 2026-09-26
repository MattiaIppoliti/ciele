import { describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";
import { enqueueVerbatimReingests, runDueIngestJobs } from "./jobs";

/**
 * The one-off verbatim re-ingest (ADR-0025): a Source ingested under the old
 * rewrite carries enriched Concepts plus "Source Text" companions. Re-ingesting
 * it from the companions leaves one verbatim Document per part and nothing a
 * model wrote. Asserted end to end on the mock Db: list → enqueue → the
 * ordinary ingest job → the generation swap.
 */

const at = "2026-09-01T00:00:00.000Z";

async function enrichedSource(db: Db, name: string, parts: string[]) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
  const collection = await db.createCollection(assistant.id, { name });
  const source = await db.createSource({ collectionId: collection.id, name, kind: "file" });
  await db.setSourceAssistantLinks(source.id, [assistant.id]);
  await db.updateSource(source.id, { status: "ready" });
  await db.createConcept({
    collectionId: collection.id,
    sourceId: source.id,
    path: "summary.md",
    frontmatter: {
      type: "Policy",
      title: "Summary",
      generated: { by: "okf-enricher/claude-sonnet-5", at },
    },
    body: "A lossy summary.",
  });
  // Written in reverse so the test proves the rebuild orders by part number.
  for (const [index, body] of [...parts.entries()].reverse()) {
    const suffix = parts.length === 1 ? "" : `-part-${index + 1}`;
    await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: `originals/${name}${suffix}.md`,
      frontmatter: {
        type: "Source Text",
        title: `${name}, full text`,
        generated: { by: "process:okf-verbatim-index", at },
      },
      body,
    });
  }
  return { assistant, collection, source };
}

describe("enqueueVerbatimReingests", () => {
  it("rebuilds a rewritten Source from its own text, in part order", async () => {
    const db = getMockDb();
    const parts = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}.`);
    const { collection, source } = await enrichedSource(db, "handbook-verbatim", parts);

    const report = await enqueueVerbatimReingests({ db }, { limit: 1_000 });
    expect(report.enqueued).toContain(source.id);
    await runDueIngestJobs({ db }, { workerId: "verbatim-test" });

    const concepts = (await db.listConcepts(collection.id)).filter(
      (c) => c.sourceId === source.id
    );
    expect(concepts).toHaveLength(1);
    expect(concepts[0].frontmatter.type).toBe("Document");
    expect(concepts[0].frontmatter.generated?.by).toBe("process:okf-ingest-passthrough");
    expect(concepts[0].body).toBe(parts.join("\n\n"));
    expect((await db.getSource(source.id))?.status).toBe("ready");

    // Idempotent: the Source no longer lists, so a second pass leaves it alone.
    const again = await enqueueVerbatimReingests({ db }, { limit: 1_000 });
    expect(again.enqueued).not.toContain(source.id);
  });

  it("reports a rewritten Source with no companion instead of guessing its text", async () => {
    const db = getMockDb();
    const { source } = await enrichedSource(db, "handbook-no-companion", []);

    const report = await enqueueVerbatimReingests({ db }, { limit: 1_000 });

    expect(report.enqueued).not.toContain(source.id);
    expect(report.skipped).toContainEqual({ sourceId: source.id, reason: "no_source_text" });
    expect((await db.getSource(source.id))?.status).toBe("ready");
  });

  it("leaves a Source that is already being processed alone", async () => {
    const db = getMockDb();
    const { source } = await enrichedSource(db, "handbook-busy", ["Body."]);
    await db.updateSource(source.id, { status: "processing" });

    const report = await enqueueVerbatimReingests({ db }, { limit: 1_000 });

    expect(report.skipped).toContainEqual({ sourceId: source.id, reason: "processing" });
  });
});
