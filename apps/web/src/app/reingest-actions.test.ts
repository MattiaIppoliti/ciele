import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Keep the enqueued Ingestion Job queued instead of running it inline, so the
// test can observe the world between the action and the job.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
  requireSession: vi.fn(),
}));

import { requireMember } from "@/lib/authz";
import { runDueIngestJobs } from "@agent-hub/agent";
import { retrySourceIngestAction } from "./actions";

/**
 * Regression for spec #189 / ticket #190: the retry action must no longer
 * destroy a Source's Concepts up front, last-good knowledge stays live while
 * the re-ingest job is pending and survives a failing job. Asserted as
 * observable Db state, never as internal call ordering.
 */
describe("retrySourceIngestAction, no destructive pre-delete", () => {
  const requireMemberMock = vi.mocked(requireMember);
  let db: Db;

  beforeEach(() => {
    db = getMockDb();
    requireMemberMock.mockReset();
    requireMemberMock.mockResolvedValue({
      db,
      session: { organization: DEMO_ORG },
    } as never);
  });

  async function seed(name: string) {
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
    const collection = await db.createCollection(assistant.id, { name });
    const source = await db.createSource({
      collectionId: collection.id,
      name,
      kind: "text",
      config: {},
    });
    const prior = await db.createConcept({
      collectionId: collection.id,
      sourceId: source.id,
      path: "docs/previous.md",
      frontmatter: { type: "Document", title: "docs/previous.md" },
      body: "Previously ingested knowledge.",
    });
    // The original ingest's job row, which the retry action reads its payload from.
    await db.createBackgroundJob({
      kind: "ingest_source",
      sourceId: source.id,
      payload: {
        kind: "ingest_source",
        assistantId: assistant.id,
        collectionId: collection.id,
        sourceId: source.id,
        rawText: "Fresh content for the replacement set.",
      },
    });
    return { assistantId: assistant.id, collectionId: collection.id, source, prior };
  }

  it("keeps prior Concepts live while the retried job is pending", async () => {
    const { assistantId, collectionId, source, prior } = await seed("retry-pending");

    await retrySourceIngestAction(assistantId, collectionId, source.id);

    expect((await db.getSource(source.id))?.status).toBe("processing");
    const concepts = await db.listConcepts(collectionId);
    expect(concepts.some((c) => c.id === prior.id)).toBe(true);
  });

  it("keeps prior Concepts when the retried job then fails", async () => {
    const { assistantId, collectionId, source, prior } = await seed("retry-failing");

    await retrySourceIngestAction(assistantId, collectionId, source.id);

    vi.spyOn(db, "saveChunks").mockRejectedValue(new Error("embeddings provider timeout"));
    await runDueIngestJobs({ db }, { workerId: "retry-failing-worker" });
    vi.restoreAllMocks();

    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.id).toBe(prior.id);
  });
});
