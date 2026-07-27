import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trustTier } from "@agent-hub/core";
import { getMockDb, DEMO_ORG, type Db } from "@agent-hub/db";

/**
 * OKF v0.2 conformance of what ingestion *writes* (ADR-0002 / SPEC §5).
 *
 * Every producer must stamp `generated` (who wrote this) and, where a real
 * material exists, `sources` (what it derives from) — otherwise a reader
 * cannot tell machine-drafted knowledge from hand-authored knowledge, which
 * is the whole point of the v0.2 trust families. Asserted at the public
 * ingestion seams (`ingestSource`, `finalizeWebsiteCrawl`) against the mock
 * Db, so the real enrich → persist → embed path runs; only the two calls that
 * would leave the machine are faked.
 */

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  getClassifierModel: vi.fn(),
}));
// Both factories spread the original: a partial mock silently breaks other
// importers of these modules (embeddings.ts pulls credential resolution out of
// "./models"), and ingestSource swallows the resulting error into Source.error
// — which reads as a passing test over a path that never ran.
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
  ENRICH_MAX_OUTPUT_TOKENS,
  ENRICH_MAX_WINDOWS,
  ENRICH_SOURCE_MAX_CHARS,
  ENRICH_WINDOW_CHARS,
  SOURCE_TEXT_CONCEPT_TYPE,
  enrichmentWindows,
  finalizeWebsiteCrawl,
  ingestSource,
} from "./ingest";

async function seed(db: Db, name: string) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: name });
  const collection = await db.createCollection(assistant.id, { name });
  return { assistantId: assistant.id, collectionId: collection.id };
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

describe("ingestSource — enriched Concepts (§5.1, §5.2)", () => {
  it("attributes the drafting model and the Source it derives from", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-enriched");
    const source = await db.createSource({
      collectionId,
      name: "Fees 2026",
      kind: "url",
      config: { url: "https://x.edu/fees" },
    });
    mocks.getClassifierModel.mockReturnValue({
      model: {},
      provider: "anthropic",
      modelId: "claude-opus-5",
      credentialKind: "platform",
    });
    mocks.generateObject.mockResolvedValue({
      object: {
        concepts: [
          {
            path: "fees.md",
            type: "Policy",
            title: "Tuition fees",
            description: "Fee schedule for 2026.",
            tags: ["fees"],
            body: "Tuition is due in two instalments.",
          },
        ],
      },
      usage: {},
    });

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Tuition is due in two instalments.",
      connections: [],
    });

    // The Source also gets a verbatim companion; this assertion is about the
    // enriched Concept, so pick it by type rather than by list position.
    const concepts = await db.listConcepts(collectionId);
    const concept = concepts.find((c) => c.frontmatter.type === "Policy")!;
    // `<producer>/<version>` (§7) — the actor form, not a bare model id.
    expect(concept.frontmatter.generated?.by).toBe("okf-enricher/claude-opus-5");
    expect(concept.frontmatter.generated?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The URL Source keeps a followable artifact, not just its page title.
    expect(concept.frontmatter.sources).toEqual([
      { id: "fees-2026", resource: "https://x.edu/fees", title: "Fees 2026" },
    ]);
    // Machine-drafted and unconfirmed — the tier must say so.
    expect(trustTier(concept.frontmatter)).toBe("unverified");
    // v0.1's `timestamp` is superseded by `generated.at` (§13.1).
    expect(concept.frontmatter.timestamp).toBeUndefined();
  });

  it("falls back to a scope descriptor when the Source has no followable artifact", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-descriptor");
    const source = await db.createSource({
      collectionId,
      name: "Pasted notes",
      kind: "text",
    });
    mocks.getClassifierModel.mockReturnValue(null);

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
});

describe("enrichmentWindows", () => {
  it("keeps a short source as a single window", () => {
    expect(enrichmentWindows("One paragraph.")).toEqual(["One paragraph."]);
  });

  it("splits on paragraph boundaries without exceeding the window budget", () => {
    const paragraph = `${"x".repeat(10_000)}`;
    const windows = enrichmentWindows(Array(5).fill(paragraph).join("\n\n"));
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) expect(window.length).toBeLessThanOrEqual(ENRICH_WINDOW_CHARS);
  });

  it("hard-splits a single oversized paragraph", () => {
    // Extracted PDFs routinely have no blank lines at all; keeping such a
    // "paragraph" whole would blow the very budget windowing exists to respect.
    const windows = enrichmentWindows("y".repeat(ENRICH_WINDOW_CHARS * 2 + 500));
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) expect(window.length).toBeLessThanOrEqual(ENRICH_WINDOW_CHARS);
  });

  it("caps the number of windows", () => {
    const windows = enrichmentWindows("z".repeat(ENRICH_WINDOW_CHARS * (ENRICH_MAX_WINDOWS + 6)));
    expect(windows).toHaveLength(ENRICH_MAX_WINDOWS);
  });

  it("drops nothing for a source that fits the curated span", () => {
    const source = Array(4).fill("p".repeat(20_000)).join("\n\n");
    expect(source.length).toBeLessThanOrEqual(ENRICH_SOURCE_MAX_CHARS);
    const rejoined = enrichmentWindows(source).join("");
    expect(rejoined.replace(/\s/g, "")).toHaveLength(source.replace(/\s/g, "").length);
  });
});

describe("ingestSource — windowed enrichment", () => {
  /** A classifier whose every call returns one concept named after its window. */
  function windowedEnrichment() {
    mocks.getClassifierModel.mockReturnValue({
      model: {},
      provider: "anthropic",
      modelId: "claude-opus-5",
      credentialKind: "platform",
    });
    let call = 0;
    mocks.generateObject.mockImplementation(async () => {
      call += 1;
      return {
        object: {
          concepts: [
            {
              path: "part.md",
              type: "Policy",
              title: `Part ${call}`,
              description: `Concepts drafted from window ${call}.`,
              tags: [],
              body: `Body of window ${call}.`,
            },
          ],
        },
        usage: {},
      };
    });
  }

  it("spends one call per window instead of truncating to a single call", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-windows");
    const source = await db.createSource({ collectionId, name: "Big", kind: "file" });
    windowedEnrichment();

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      // Three windows' worth, on clean paragraph boundaries.
      rawText: Array(3).fill("q".repeat(ENRICH_WINDOW_CHARS - 10)).join("\n\n"),
      connections: [],
    });

    expect(mocks.generateObject).toHaveBeenCalledTimes(3);
    const concepts = await db.listConcepts(collectionId);
    expect(concepts.filter((c) => c.frontmatter.type === "Policy")).toHaveLength(3);
  });

  it("sets an explicit output budget on every call", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-output-budget");
    const source = await db.createSource({ collectionId, name: "Doc", kind: "file" });
    windowedEnrichment();

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Short body.",
      connections: [],
    });

    // Left to a provider default, the compression ratio would be invisible and
    // vary by provider — the whole point of pinning it.
    expect(mocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS })
    );
  });

  it("suffixes colliding paths so independent windows never write twin Concepts", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-window-paths");
    const source = await db.createSource({ collectionId, name: "Big", kind: "file" });
    // Every window returns the same `part.md`.
    windowedEnrichment();

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: Array(3).fill("q".repeat(ENRICH_WINDOW_CHARS - 10)).join("\n\n"),
      connections: [],
    });

    const paths = (await db.listConcepts(collectionId))
      .filter((c) => c.frontmatter.type === "Policy")
      .map((c) => c.path)
      .sort();
    expect(paths).toEqual(["part-2.md", "part-3.md", "part.md"]);
  });

  it("keeps the windows that succeeded when one fails", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-window-partial");
    const source = await db.createSource({ collectionId, name: "Big", kind: "file" });
    mocks.getClassifierModel.mockReturnValue({
      model: {},
      provider: "anthropic",
      modelId: "claude-opus-5",
      credentialKind: "platform",
    });
    let call = 0;
    mocks.generateObject.mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error("provider blip");
      return {
        object: {
          concepts: [
            {
              path: `part-${call}.md`,
              type: "Policy",
              title: `Part ${call}`,
              description: "d",
              tags: [],
              body: `Body ${call}.`,
            },
          ],
        },
        usage: {},
      };
    });

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: Array(3).fill("q".repeat(ENRICH_WINDOW_CHARS - 10)).join("\n\n"),
      connections: [],
    });

    // Two of three windows survived — a blip must not discard their work.
    const concepts = await db.listConcepts(collectionId);
    expect(concepts.filter((c) => c.frontmatter.type === "Policy")).toHaveLength(2);
    expect((await db.getSource(source.id))?.status).toBe("ready");
  });

  it("falls back to the full-text pass-through when every window fails", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-window-total-failure");
    const source = await db.createSource({ collectionId, name: "Big", kind: "file" });
    mocks.getClassifierModel.mockReturnValue({
      model: {},
      provider: "anthropic",
      modelId: "claude-opus-5",
      credentialKind: "platform",
    });
    mocks.generateObject.mockRejectedValue(new Error("provider down"));

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Body that must survive a total enrichment failure.",
      connections: [],
    });

    // The pass-through IS the verbatim text, so there is no companion beside it.
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0].frontmatter.generated?.by).toBe("process:okf-ingest-passthrough");
    expect(concepts[0].body).toBe("Body that must survive a total enrichment failure.");
  });
});

describe("ingestSource — the verbatim companion Concept", () => {
  /** Enrichment that keeps only a fraction of the source — the lossy case. */
  function summarizingEnrichment() {
    mocks.getClassifierModel.mockReturnValue({
      model: {},
      provider: "anthropic",
      modelId: "claude-opus-5",
      credentialKind: "platform",
    });
    mocks.generateObject.mockResolvedValue({
      object: {
        concepts: [
          {
            path: "handbook.md",
            type: "Policy",
            title: "Handbook",
            description: "Summary of the handbook.",
            tags: [],
            body: "The handbook covers leave, expenses and travel.",
          },
        ],
      },
      usage: {},
    });
  }

  it("makes detail the enrichment dropped retrievable again", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-recovers");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    summarizingEnrichment();
    // A specific clause the one-line summary above does not carry.
    const clause = "Bereavement leave is five consecutive working days.";

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: `Leave policy.\n\n${clause}\n\nExpenses policy.`,
      connections: [],
    });

    // Before the verbatim companion existed, the summary was the only thing
    // chunked, so this query could not match anything however good ranking was.
    const hits = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: "bereavement leave days",
    });
    expect(hits.some((hit) => hit.content.includes(clause))).toBe(true);
  });

  it("indexes the whole source, including past the enrichment prompt cap", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-length");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    summarizingEnrichment();
    // The model only ever sees the first ENRICH_SOURCE_MAX_CHARS. What matters
    // is that the *index* is not bounded by that same cap.
    const tail = "TAIL-MARKER";
    const rawText = `${"a".repeat(ENRICH_SOURCE_MAX_CHARS)}\n\n${tail}`;

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText,
      connections: [],
    });

    const verbatim = (await db.listConcepts(collectionId)).find(
      (c) => c.frontmatter.type === SOURCE_TEXT_CONCEPT_TYPE
    )!;
    expect(verbatim.body).toHaveLength(rawText.length);
    const hits = await db.searchChunks(assistantId, collectionId, {
      embedding: null,
      text: tail,
    });
    expect(hits.some((hit) => hit.content.includes(tail))).toBe(true);
  });

  it("carries its own provenance and derives from the same Source", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-provenance");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    summarizingEnrichment();

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Handbook body.",
      connections: [],
    });

    const verbatim = (await db.listConcepts(collectionId)).find(
      (c) => c.frontmatter.type === SOURCE_TEXT_CONCEPT_TYPE
    )!;
    expect(verbatim.path).toBe("originals/handbook.md");
    expect(verbatim.sourceId).toBe(source.id);
    // Copied by the extractor, not written by a model — the actor must say so.
    expect(verbatim.frontmatter.generated?.by).toBe("process:okf-verbatim-index");
    expect(verbatim.frontmatter.sources?.[0]?.title).toBe("Handbook");
  });

  it("is replaced, not duplicated, when the Source is re-ingested", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-reingest");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    summarizingEnrichment();
    const ingest = (rawText: string) =>
      ingestSource({ db, assistantId, collectionId, source, rawText, connections: [] });

    await ingest("First revision.");
    await ingest("Second revision.");

    const verbatim = (await db.listConcepts(collectionId)).filter(
      (c) => c.frontmatter.type === SOURCE_TEXT_CONCEPT_TYPE
    );
    expect(verbatim).toHaveLength(1);
    expect(verbatim[0].body).toBe("Second revision.");
  });

  it("is not written when no model ran — the pass-through IS the verbatim text", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-verbatim-no-dupe");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    mocks.getClassifierModel.mockReturnValue(null);

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Handbook body.",
      connections: [],
    });

    // One concept, not the pass-through plus an identical copy of itself.
    const concepts = await db.listConcepts(collectionId);
    expect(concepts).toHaveLength(1);
    expect(concepts[0].frontmatter.type).toBe("Document");
  });

  it("leaves crawled pages alone — they are already verbatim", async () => {
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

describe("ingestSource — the no-model pass-through Concept", () => {
  it("is attributed to the process, not to a nonexistent agent", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-passthrough-actor");
    const source = await db.createSource({
      collectionId,
      name: "Handbook",
      kind: "file",
    });
    mocks.getClassifierModel.mockReturnValue(null);

    await ingestSource({
      db,
      assistantId,
      collectionId,
      source,
      rawText: "Handbook body.",
      connections: [],
    });

    const [concept] = await db.listConcepts(collectionId);
    expect(concept.frontmatter.generated?.by).toBe("process:okf-ingest-passthrough");
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("keeps the whole document past the enrichment prompt cap", async () => {
    const db = getMockDb();
    const { assistantId, collectionId } = await seed(db, "okf-passthrough-length");
    const source = await db.createSource({
      collectionId,
      name: "Long handbook",
      kind: "file",
    });
    mocks.getClassifierModel.mockReturnValue(null);
    // ENRICH_SOURCE_MAX_CHARS bounds the enrichment *prompt*. No model runs on
    // this path, so reusing that slice for the body silently dropped the tail
    // of every long upload — the pass-through concept IS the source text.
    const tail = "TAIL-MARKER";
    const rawText = `${"a".repeat(ENRICH_SOURCE_MAX_CHARS)}\n\n${tail}`;

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
});

describe("finalizeWebsiteCrawl — crawled Concepts", () => {
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
    // No model sees a crawled page — the body is verbatim, so the actor is a
    // process, never an agent (which would overstate what happened to it).
    expect(concept.frontmatter.generated?.by).toBe("process:website-crawl");
    expect(concept.frontmatter.sources).toEqual([
      { id: "about-us", resource: "https://x.edu/about", title: "About us" },
    ]);
    expect(concept.frontmatter.timestamp).toBeUndefined();
  });
});
