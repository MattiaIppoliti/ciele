import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";

/**
 * OKF v0.2 conformance of what ingestion *writes* (ADR-0002 / SPEC §5), and
 * the rule ADR-0025 added: a file or text Source is stored as its own words.
 *
 * Every producer must stamp `generated` (who wrote this) and, where a real
 * material exists, `sources` (what it derives from), otherwise a reader
 * cannot tell machine-drafted knowledge from hand-authored knowledge, which
 * is the whole point of the v0.2 trust families. Asserted at the public
 * ingestion seams (`ingestSource`, `finalizeWebsiteCrawl`) against the mock
 * Db, so the real draft → persist → embed path runs; only the calls that
 * would leave the machine are faked.
 */

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  getClassifierModel: vi.fn(),
}));
// Both factories spread the original: a partial mock silently breaks other
// importers of these modules (embeddings.ts pulls credential resolution out of
// "./models"), and ingestSource swallows the resulting error into Source.error,
// which reads as a passing test over a path that never ran.
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: mocks.generateObject,
}));
vi.mock("./models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models")>()),
  getClassifierModel: mocks.getClassifierModel,
}));
vi.mock("./apify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apify")>()),
  getRunState: vi.fn(),
  fetchCrawledPages: vi.fn(),
}));

import { fetchCrawledPages, getRunState } from "./apify";
import {
  MAX_CONCEPT_BODY_CHARS,
  finalizeWebsiteCrawl,
  ingestSource,
} from "./ingest";

/** Longer than the old enrichment prompt window, which used to truncate bodies. */
const LONG_SOURCE_CHARS = 100_000;

async function seed(db: Db, name: string) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
  const collection = await db.createCollection(assistant.id, { name });
  return { assistantId: assistant.id, collectionId: collection.id };
}

/** A classifier that ingestion must no longer call (ADR-0025). */
function classifierAvailable() {
  mocks.getClassifierModel.mockReturnValue({
    model: {},
    provider: "anthropic",
    modelId: "claude-opus-5",
    credentialKind: "platform",
  });
  mocks.generateObject.mockRejectedValue(new Error("ingestion must not call a model"));
}

beforeEach(() => {
  mocks.generateObject.mockReset();
  mocks.getClassifierModel.mockReset();
  vi.mocked(getRunState).mockReset();
  vi.mocked(fetchCrawledPages).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ingestSource, verbatim Concepts (§5.1, ADR-0025)", () => {
  it("attributes the ingest process and the Source it derives from", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim");
    const source = await db.createSource({
      collectionId,
      name: "Fees 2026",
      kind: "url",
      config: { url: "https://x.edu/fees" },
    });
    classifierAvailable();

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Tuition is due in two instalments.",
      connections: [],
    });

    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    const [concept] = concepts;
    expect(concept.frontmatter.type).toBe("Document");
    expect(concept.body).toBe("Tuition is due in two instalments.");
    expect(concept.frontmatter.generated?.by).toBe("process:okf-ingest-passthrough");
    expect(concept.frontmatter.generated?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The URL Source keeps a followable artifact, not just its page title.
    expect(concept.frontmatter.sources).toEqual([
      { id: "fees-2026", resource: "https://x.edu/fees", title: "Fees 2026" },
    ]);
    // v0.1's `timestamp` is superseded by `generated.at` (§13.1).
    expect(concept.frontmatter.timestamp).toBeUndefined();
  });

  it("stores a file Source as its own words even when a model is configured", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-file");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    await db.setSourceAssistantLinks(source.id, [assistantId]);
    classifierAvailable();
    const clause = "Bereavement leave is five consecutive working days.";
    const rawText = `Leave policy.\n\n${clause}\n\nExpenses policy.`;

    await ingestSource({ db, assistantId, collectionId, source, rawText, connections: [] });

    expect(mocks.generateObject).not.toHaveBeenCalled();
    const concepts = await db.listConcepts(collectionId);
    // One Concept, the text itself: no curated rewrite, no "Source Text" twin.
    expect(concepts.map((c) => [c.path, c.frontmatter.type])).toEqual([
      ["handbook.md", "Document"],
    ]);
    expect(concepts[0].body).toBe(rawText);
    expect((await db.getSource(source.id))?.status).toBe("ready");
    const hits = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: "bereavement leave days",
    });
    expect(hits.some((hit) => hit.content.includes(clause))).toBe(true);
  });

  it("falls back to a scope descriptor when the Source has no followable artifact", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-descriptor");
    const source = await db.createSource({
      collectionId,
      name: "Pasted notes",
      kind: "text",
    });

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Office hours are 9-5.",
      connections: [],
    });

    const [concept] = await db.listConcepts(collectionId);
    // §5.1 allows a descriptor for material a consumer cannot follow.
    expect(concept.frontmatter.sources?.[0]?.resource).toBe('text source "Pasted notes"');
  });

  it("is replaced, not duplicated, when the Source is re-ingested", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-reingest");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    const ingest = (rawText: string) =>
      ingestSource({ db, assistantId, collectionId, source, rawText, connections: [] });

    await ingest("First revision.");
    await ingest("Second revision.");

    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0].body).toBe("Second revision.");
  });

  it("leaves crawled pages alone; they are already verbatim", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-crawl");
    const source = await db.createSource({
      collectionId,
      name: "Site",
      kind: "website",
      config: { url: "https://x.edu", crawlRunId: "run_1", crawlDatasetId: "ds_1" },
    });
    vi.mocked(getRunState).mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    vi.mocked(fetchCrawledPages).mockResolvedValue([
      { url: "https://x.edu/a", title: "A", text: "Page A." },
      { url: "https://x.edu/b", title: "B", text: "Page B." },
    ]);

    await finalizeWebsiteCrawl({ db, assistantId, collectionId, sourceId: source.id });

    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(2);
    expect(concepts.every((c) => c.frontmatter.type === "Web Page")).toBe(true);
  });
});

describe("ingestSource, long documents", () => {
  it("keeps the whole document, tail included", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-passthrough-length");
    const source = await db.createSource({
      collectionId,
      name: "Long handbook",
      kind: "file",
    });
    await db.setSourceAssistantLinks(source.id, [assistantId]);
    // The old enrichment prompt window once truncated bodies to its own
    // size, silently dropping the tail of every long upload.
    const tail = "TAIL-MARKER";
    const rawText = `${"a".repeat(LONG_SOURCE_CHARS)}\n\n${tail}`;

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText,
      connections: [],
    });

    const [concept] = await db.listConcepts(collectionId);
    expect(concept.body).toHaveLength(rawText.length);
    expect(concept.body).toContain(tail);
    // And the tail is retrievable, not merely stored.
    const hits = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: tail,
    });
    expect(hits.some((hit) => hit.content.includes(tail))).toBe(true);
  });

  it("shards documents beyond the per-Concept ceiling without dropping the tail", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-passthrough-huge");
    const source = await db.createSource({
      collectionId,
      name: "Corporate handbook",
      kind: "file",
    });
    await db.setSourceAssistantLinks(source.id, [assistantId]);
    const tail = "CORPORATE-TAIL-MARKER";
    const rawText = `${"a".repeat(MAX_CONCEPT_BODY_CHARS)}\n\n${tail}`;

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText,
      connections: [],
    });

    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(2);
    expect(concepts.every((concept) => concept.body.length <= MAX_CONCEPT_BODY_CHARS)).toBe(true);
    expect(concepts.map((concept) => concept.body).join("\n")).toContain(tail);
    const hits = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: tail,
    });
    expect(hits.some((hit) => hit.content.includes(tail))).toBe(true);
  });
});

describe("finalizeWebsiteCrawl, crawled Concepts", () => {
  it("attributes the crawl process and records the page as its source", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-crawl");
    const source = await db.createSource({
      collectionId,
      name: "Site",
      kind: "website",
      config: { url: "https://x.edu", crawlRunId: "run_1", crawlDatasetId: "ds_1" },
    });
    vi.mocked(getRunState).mockResolvedValue({ status: "SUCCEEDED", datasetId: "ds_1" });
    vi.mocked(fetchCrawledPages).mockResolvedValue([
      { url: "https://x.edu/about", title: "About us", text: "We are here." },
    ]);

    const status = await finalizeWebsiteCrawl({
      db,
      assistantId,
      collectionId,
      sourceId: source.id,
    });

    expect(status).toBe("ready");
    const [concept] = await db.listConcepts(collectionId);
    // No model sees a crawled page: the body is verbatim, so the actor is a
    // process, never an agent (which would overstate what happened to it).
    expect(concept.frontmatter.generated?.by).toBe("process:website-crawl");
    expect(concept.frontmatter.sources).toEqual([
      { id: "about-us", resource: "https://x.edu/about", title: "About us" },
    ]);
    expect(concept.frontmatter.timestamp).toBeUndefined();
  });
});
