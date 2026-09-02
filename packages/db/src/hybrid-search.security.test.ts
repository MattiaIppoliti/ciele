import { describe, expect, it } from "vitest";
import {
  MAX_HITS_PER_DOCUMENT,
  MIN_VECTOR_SIMILARITY,
  capPerSource,
  hybridRetrieve,
  shapeRetrievalHits,
} from "./hybrid-search";

/**
 * #801, CYB-14. Top-k returns k rows however unrelated the tail is, and a long
 * document whose every paragraph half-matches takes the whole window from the
 * document that actually answers. Both are retrieval-quality problems that
 * become security ones once the window is the model's whole view of the truth.
 */

interface Hit {
  id: string;
  document: string;
  similarity: number;
}

const hit = (id: string, document: string, similarity: number): Hit => ({
  id,
  document,
  similarity,
});

const shape = (rows: Hit[], limit = 6) =>
  shapeRetrievalHits(rows, {
    limit,
    groupOf: (row) => row.document,
    similarityOf: (row) => row.similarity,
  });

describe("shapeRetrievalHits", () => {
  it("drops hits under the noise floor", () => {
    const rows = [
      hit("a", "doc-1", 0.82),
      hit("b", "doc-2", MIN_VECTOR_SIMILARITY),
      hit("c", "doc-3", MIN_VECTOR_SIMILARITY - 0.01),
      hit("d", "doc-4", 0.02),
    ];
    expect(shape(rows).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("caps how much one document may contribute", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => hit(`long-${i}`, "doc-1", 0.9 - i * 0.01)),
      hit("other", "doc-2", 0.4),
    ];
    const kept = shape(rows);
    expect(kept.filter((row) => row.document === "doc-1")).toHaveLength(
      MAX_HITS_PER_DOCUMENT,
    );
    // The point of the cap: the second document survives.
    expect(kept.map((row) => row.id)).toContain("other");
  });

  it("keeps the index's own ranking, it only ever removes", () => {
    const rows = [hit("a", "doc-1", 0.9), hit("b", "doc-2", 0.8), hit("c", "doc-3", 0.7)];
    expect(shape(rows).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("applies no floor when no similarity is offered", () => {
    // A lexical score is a placeholder constant, not a cosine, so judging it
    // against a cosine floor would be a category error.
    const rows = [hit("a", "doc-1", 0.01)];
    expect(
      shapeRetrievalHits(rows, { limit: 6, groupOf: (row) => row.document }),
    ).toHaveLength(1);
  });

  it("applies no cap when rows have no document to group by", () => {
    const rows = Array.from({ length: 5 }, (_, i) => hit(`m-${i}`, "n/a", 0.9));
    expect(shapeRetrievalHits(rows, { limit: 6 })).toHaveLength(5);
  });
});

describe("hybridRetrieve", () => {
  const keyOf = (row: Hit) => row.id;
  const groupOf = (row: Hit) => row.document;
  const similarityOf = (row: Hit) => row.similarity;

  it("holds the cap across the vector hits and the lexical top-up together", async () => {
    // The bug this rules out: three from one document via the vector index,
    // then three more from the same document to fill the window.
    const rows = await hybridRetrieve<Hit>({
      embedding: [0.1, 0.2],
      limit: 6,
      vector: async () =>
        Array.from({ length: 3 }, (_, i) => hit(`v-${i}`, "doc-1", 0.9)),
      lexical: async () => [
        hit("l-0", "doc-1", 0.5),
        hit("l-1", "doc-2", 0.5),
        hit("l-2", "doc-3", 0.5),
      ],
      keyOf,
      groupOf,
      similarityOf,
    });

    expect(rows.filter((row) => row.document === "doc-1")).toHaveLength(
      MAX_HITS_PER_DOCUMENT,
    );
    expect(rows.map((row) => row.id)).toEqual(["v-0", "v-1", "v-2", "l-1", "l-2"]);
  });

  it("still tops up from lexical when the vector index is thin", async () => {
    const rows = await hybridRetrieve<Hit>({
      embedding: [0.1],
      limit: 4,
      vector: async () => [hit("v-0", "doc-1", 0.9)],
      lexical: async () => [hit("v-0", "doc-1", 0.5), hit("l-1", "doc-2", 0.5)],
      keyOf,
      groupOf,
      similarityOf,
    });
    // Deduped against what the vector already returned.
    expect(rows.map((row) => row.id)).toEqual(["v-0", "l-1"]);
  });

  it("shapes the lexical-only path too, an unembedded org is not exempt", async () => {
    const rows = await hybridRetrieve<Hit>({
      embedding: null,
      limit: 6,
      vector: async () => {
        throw new Error("must not run without an embedding");
      },
      lexical: async () =>
        Array.from({ length: 5 }, (_, i) => hit(`l-${i}`, "doc-1", 0.5)),
      keyOf,
      groupOf,
    });
    expect(rows).toHaveLength(MAX_HITS_PER_DOCUMENT);
  });
});

describe("capPerSource", () => {
  const hit = (conceptId: string, sourceId: string | null) =>
    ({ conceptId, sourceId }) as { conceptId: string; sourceId: string | null };

  it("caps on the Source, not the Concept", () => {
    // The defect this exists to rule out: one Source produces many Concepts
    // (ingest splits a document into them), so capping per Concept let a long
    // Source keep the whole window while looking like it had been capped.
    const hits = [
      ...Array.from({ length: 6 }, (_, i) => hit(`c-${i}`, "source-long")),
      hit("c-other", "source-short"),
    ];
    const kept = capPerSource(hits, 6);
    expect(kept.filter((h) => h.sourceId === "source-long")).toHaveLength(
      MAX_HITS_PER_DOCUMENT,
    );
    expect(kept.map((h) => h.conceptId)).toContain("c-other");
  });

  it("groups a Source-less hit on its own Concept", () => {
    // A queried API endpoint contributes a synthetic hit with no Source. It
    // must not collapse with every other Source-less hit into one bucket.
    const hits = Array.from({ length: 5 }, (_, i) => hit(`api-${i}`, null));
    expect(capPerSource(hits, 6)).toHaveLength(5);
  });
});
