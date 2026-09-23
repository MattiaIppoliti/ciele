import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import {
  enqueueDocumentMemoryExtractions,
  enqueueStaleDocumentMemoryExtractions,
  extractMemoriesJobId,
} from "./jobs";
import { hashDocumentBody } from "./extract-document-memories";
import { ingestSource } from "./ingest";
import type { KnowledgeMemoryExtraction } from "@agent-hub/core";

/**
 * What a committed generation leaves behind for memories (#930).
 *
 * The enqueue, not the extractor: the point of this concern file is that the
 * generation commit hands off one durable job per Document and gets out of the
 * way, so no model call is ever on the cutover's path or inside its claim.
 * Every ingestion route converges on that commit, so the file also drives one
 * non-crawl route end to end rather than trusting the crawl finaliser alone.
 */

async function seedSource(db: Db, paths: string[]) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Crawled" });
  const collection = await db.createCollection(assistant.id, { name: "Site" });
  const source = await db.createSource({
    collectionId: collection.id,
    name: "acme.example",
    kind: "website",
  });
  for (const path of paths) {
    await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path,
      frontmatter: { type: "Web Page", title: path },
      body: `body of ${path}`,
    });
  }
  return { collection, source };
}

const extractionJobs = (db: Db, sourceId: string) =>
  db.listBackgroundJobsForSource(sourceId, "extract_document_memories");

beforeEach(() => resetMockDb());

describe("memory extraction enqueue", () => {
  it("queues one job per Document the generation stores", async () => {
    const db = getMockDb();
    const { collection, source } = await seedSource(db, [
      "web/a.md",
      "web/b.md",
      "web/c.md",
    ]);

    await enqueueDocumentMemoryExtractions(
      { db },
      {
        organizationId: DEMO_ORG.id,
        collectionId: collection.id,
        sourceId: source.id,
        generationId: source.activeGenerationId,
      }
    );

    const jobs = await extractionJobs(db, source.id);
    expect(jobs).toHaveLength(3);
    expect(
      jobs
        .map((job) => (job.payload as { documentPath: string }).documentPath)
        .sort()
    ).toEqual(["web/a.md", "web/b.md", "web/c.md"]);
    // Every job carries what the handler needs without another lookup, and
    // its Source, so the ledger can be read per Source.
    expect(jobs[0]!.sourceId).toBe(source.id);
    expect(jobs[0]!.payload).toMatchObject({
      kind: "extract_document_memories",
      organizationId: DEMO_ORG.id,
      collectionId: collection.id,
      sourceId: source.id,
    });
  });

  it("queues nothing for a Source that stored no Documents", async () => {
    const db = getMockDb();
    const { collection, source } = await seedSource(db, []);
    await enqueueDocumentMemoryExtractions(
      { db },
      {
        organizationId: DEMO_ORG.id,
        collectionId: collection.id,
        sourceId: source.id,
        generationId: source.activeGenerationId,
      }
    );
    expect(await extractionJobs(db, source.id)).toEqual([]);
  });

  it("enqueues once per commit: a resumed finaliser adds no second job", async () => {
    // A crawl finaliser that resumes after its cutover was committed runs the
    // enqueue again. The job id is (Source, generation, page), so the ledger
    // answers with the row it already has; the next generation enqueues anew.
    const db = getMockDb();
    const { collection, source } = await seedSource(db, ["web/a.md", "web/b.md"]);
    const input = {
      organizationId: DEMO_ORG.id,
      collectionId: collection.id,
      sourceId: source.id,
      generationId: source.activeGenerationId,
    };
    await enqueueDocumentMemoryExtractions({ db }, input);
    await enqueueDocumentMemoryExtractions({ db }, input);
    expect(await extractionJobs(db, source.id)).toHaveLength(2);
    expect(
      extractMemoriesJobId({
        sourceId: source.id,
        generationId: source.activeGenerationId,
        documentPath: "web/a.md",
      })
    ).not.toBe(
      extractMemoriesJobId({
        sourceId: source.id,
        generationId: "00000000-0000-4000-8000-000000000931",
        documentPath: "web/a.md",
      })
    );
  });

  it("pages through the whole Source rather than the first page of it", async () => {
    const db = getMockDb();
    const paths = Array.from({ length: 503 }, (_, i) => `web/p${i}.md`);
    const { collection, source } = await seedSource(db, paths);
    await enqueueDocumentMemoryExtractions(
      { db },
      {
        organizationId: DEMO_ORG.id,
        collectionId: collection.id,
        sourceId: source.id,
        generationId: source.activeGenerationId,
      }
    );
    expect(await extractionJobs(db, source.id)).toHaveLength(503);
  });

  it("follows a file's ingest as it follows a crawl", async () => {
    // Pasted text, files and FAQs commit through `replaceSourceKnowledge`,
    // not the crawl finaliser. The memories must not depend on which door the
    // knowledge came in by.
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Uploads" });
    const collection = await db.createCollection(assistant.id, { name: "Files" });
    const source = await db.createSource({
      collectionId: collection.id,
      name: "Handbook.pdf",
      kind: "file",
    });
    const completed = await ingestSource({
      db,
      assistantId: assistant.id,
      collectionId: collection.id,
      source,
      rawText: "Employees accrue 25 days of paid leave a year.",
      connections: [],
    });
    expect(completed).toBe(true);
    const stored = await db.listSourceDocuments(source.id, { pageSize: 50 });
    expect(stored.total).toBeGreaterThan(0);
    const jobs = await extractionJobs(db, source.id);
    expect(jobs.map((job) => (job.payload as { documentPath: string }).documentPath).sort())
      .toEqual(stored.items.map((row) => row.path).sort());
    // The Organization on the job is the Collection's, not the caller's.
    expect(jobs[0]!.payload).toMatchObject({ organizationId: DEMO_ORG.id });
  });

  it("never fails the crawl that just succeeded", async () => {
    // Memories are derived. A queue write that fails must not turn a committed
    // generation into a reported failure; cron and the next crawl re-enqueue.
    const db = getMockDb();
    const { collection, source } = await seedSource(db, ["web/a.md"]);
    const broken: Db = {
      ...db,
      createBackgroundJob: async () => {
        throw new Error("ledger is down");
      },
    };
    await expect(
      enqueueDocumentMemoryExtractions(
        { db: broken },
        {
          organizationId: DEMO_ORG.id,
          collectionId: collection.id,
          sourceId: source.id,
          generationId: source.activeGenerationId,
        }
      )
    ).resolves.toBeUndefined();
  });
});

describe("the by-hand backfill (#933)", () => {
  const backfill = (db: Db, collectionId: string, sourceId: string) =>
    enqueueStaleDocumentMemoryExtractions(
      { db },
      { organizationId: DEMO_ORG.id, collectionId, sourceId }
    );

  const record = async (
    db: Db,
    input: {
      collectionId: string;
      sourceId: string;
      documentPath: string;
      bodyHash: string | null;
      status: KnowledgeMemoryExtraction["status"];
    }
  ) =>
    db.recordMemoryExtraction({
      organizationId: DEMO_ORG.id,
      memoryCount: 0,
      capped: false,
      attempts: 1,
      lastError: null,
      extractedAt: null,
      ...input,
    });

  it("queues every Document of a Source nothing has extracted", async () => {
    const db = getMockDb();
    const { collection, source } = await seedSource(db, ["web/a.md", "web/b.md"]);
    expect(await backfill(db, collection.id, source.id)).toBe(2);
    expect(await extractionJobs(db, source.id)).toHaveLength(2);
  });

  it("pages through the whole Source, so a large one is backfilled whole", async () => {
    const db = getMockDb();
    const paths = Array.from({ length: 503 }, (_, i) => `web/p${i}.md`);
    const { collection, source } = await seedSource(db, paths);
    expect(await backfill(db, collection.id, source.id)).toBe(503);
  });

  it("skips a Document whose recorded hash still matches its body", async () => {
    const db = getMockDb();
    const { collection, source } = await seedSource(db, ["web/a.md", "web/b.md"]);
    const documents = await db.listSourceDocuments(source.id);
    const fresh = documents.items.find((row) => row.path === "web/a.md")!;
    const body = (await db.getConcept(fresh.id))!.body;
    await record(db, {
      collectionId: collection.id,
      sourceId: source.id,
      documentPath: "web/a.md",
      bodyHash: hashDocumentBody(body),
      status: "done",
    });

    // Only the page nobody has read pays for a call.
    expect(await backfill(db, collection.id, source.id)).toBe(1);
    const jobs = await extractionJobs(db, source.id);
    expect(
      jobs.map((job) => (job.payload as { documentPath: string }).documentPath)
    ).toEqual(["web/b.md"]);
  });

  it("queues a Document whose body changed since the last extraction", async () => {
    const db = getMockDb();
    const { collection, source } = await seedSource(db, ["web/a.md"]);
    await record(db, {
      collectionId: collection.id,
      sourceId: source.id,
      documentPath: "web/a.md",
      bodyHash: hashDocumentBody("something the page used to say"),
      status: "done",
    });
    expect(await backfill(db, collection.id, source.id)).toBe(1);
  });

  it("retries a page that failed or found no provider", async () => {
    const db = getMockDb();
    const { collection, source } = await seedSource(db, ["web/a.md", "web/b.md"]);
    await record(db, {
      collectionId: collection.id,
      sourceId: source.id,
      documentPath: "web/a.md",
      bodyHash: null,
      status: "failed",
    });
    await record(db, {
      collectionId: collection.id,
      sourceId: source.id,
      documentPath: "web/b.md",
      bodyHash: null,
      status: "skipped_no_provider",
    });
    // Neither is `done`, so both are work the button should still offer.
    expect(await backfill(db, collection.id, source.id)).toBe(2);
  });

  it("queues nothing on a second press while the first batch is pending", async () => {
    const db = getMockDb();
    const { collection, source } = await seedSource(db, ["web/a.md", "web/b.md"]);
    expect(await backfill(db, collection.id, source.id)).toBe(2);
    // The whole point of the idempotence: an impatient second click must not
    // double the Organization's bill.
    expect(await backfill(db, collection.id, source.id)).toBe(0);
    expect(await extractionJobs(db, source.id)).toHaveLength(2);
  });
});
