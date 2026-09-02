/**
 * The hybrid-retrieve skeleton shared by every pgvector-backed search in this
 * package (`searchChunks`, `searchMemories`) and the lexical scoring the mock
 * implementations mirror. One algorithm, written once: before this existed the
 * same body, identical tokenizer, identical 0.5 placeholder similarity,
 * identical "vector RPC then top up from lexical via a seen set", was pasted
 * twice in `supabase.ts` and twice more in `mock.ts`.
 *
 * Internal to the package: the `Db` interface exposes the search methods, not
 * their retrieval mechanics.
 */

/**
 * Tokenizes a query for the lexical safety net: lowercase, split on anything
 * that isn't a letter or digit (unicode-aware), drop tokens of ≤2 chars.
 * `max` caps the tokens sent to a SQL `or(ilike)` filter; the in-memory mock
 * scores against all of them.
 */
export function lexicalTokens(text: string, max?: number): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
  return max === undefined ? tokens : tokens.slice(0, max);
}

/**
 * The placeholder similarity for a lexical hit. It is a constant, not a score:
 * consumers that branch on similarity (the coverage gate) know 0.5 means
 * "matched lexically", never a cosine.
 */
export const LEXICAL_SIMILARITY = 0.5;

/** Token-overlap score for the in-memory mock: hits / tokens, in [0, 1]. */
export function lexicalScore(text: string, tokens: string[]): number {
  const haystack = text.toLowerCase();
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  return hits / Math.max(tokens.length, 1);
}

/**
 * A cosine similarity below which a vector hit is noise rather than a weak
 * answer (#801, CYB-14). Top-k always returns k rows however unrelated they
 * are, and the tail of that k is what the model then has to explain away.
 *
 * A floor, deliberately not a relevance threshold. 0.15 excludes only
 * near-orthogonal matches, which needs no calibration to call wrong; moving it
 * towards a real relevance cut needs a labelled corpus, and doing that by feel
 * would silently start dropping answers the knowledge base has.
 */
export const MIN_VECTOR_SIMILARITY = 0.15;

/**
 * How many chunks one document may contribute to one result set. Without it a
 * long Source whose every paragraph is a near-match takes the whole window,
 * and the second document, the one that answers the question, never reaches
 * the model. Three leaves room for a genuinely multi-part answer from one
 * document while still forcing breadth.
 */
export const MAX_HITS_PER_DOCUMENT = 3;

/**
 * How many rows to ask the index for, relative to what the caller wants. The
 * per-document cap can only remove, so without an over-fetch a query whose top
 * hits all come from one Source would come back short instead of diverse.
 * Three is enough to fill a window from four documents when the first one
 * dominates the ranking.
 */
export const RETRIEVAL_OVERFETCH = 3;

/**
 * The shape of a result set: at most `limit` rows, at most
 * {@link MAX_HITS_PER_DOCUMENT} from any one document, and nothing under the
 * similarity floor. Order in is order out, so the index's own ranking is
 * preserved and this only ever removes.
 *
 * `counts` lets a caller carry the per-document tally across two calls, which
 * is how the lexical top-up stays inside the same cap as the vector hits it is
 * topping up.
 */
export function shapeRetrievalHits<Row>(
  rows: Row[],
  opts: {
    limit: number;
    groupOf?: (row: Row) => string;
    /** Present only for scores that are real cosines; a lexical placeholder is not one. */
    similarityOf?: (row: Row) => number;
    counts?: Map<string, number>;
  }
): Row[] {
  const perGroup = opts.counts ?? new Map<string, number>();
  const kept: Row[] = [];
  for (const row of rows) {
    if (kept.length >= opts.limit) break;
    if (opts.similarityOf && opts.similarityOf(row) < MIN_VECTOR_SIMILARITY) continue;
    if (opts.groupOf) {
      const group = opts.groupOf(row);
      const used = perGroup.get(group) ?? 0;
      if (used >= MAX_HITS_PER_DOCUMENT) continue;
      perGroup.set(group, used + 1);
    }
    kept.push(row);
  }
  return kept;
}

/**
 * Vector-first retrieval with a lexical top-up. With an embedding: run the
 * vector RPC, and when it returns fewer than `limit` rows, fill the remainder
 * from the lexical searcher (rows ingested while no embedding key was
 * configured have NULL embeddings and are invisible to the vector index),
 * deduped by `keyOf`. Without an embedding: lexical only.
 *
 * Both halves go through {@link shapeRetrievalHits}, sharing one per-document
 * tally, so the diversity cap holds over the union rather than over each half
 * (#801, CYB-14). The similarity floor applies to vector hits only: a lexical
 * hit's score is a placeholder constant, not a cosine.
 */
export async function hybridRetrieve<Row>(opts: {
  embedding: number[] | null | undefined;
  limit: number;
  vector: () => Promise<Row[]>;
  lexical: () => Promise<Row[]>;
  keyOf: (row: Row) => string;
  /**
   * The document a row belongs to, for the diversity cap. Omitted, no cap is
   * applied, which is what a search over rows with no grouping (memories)
   * wants.
   */
  groupOf?: (row: Row) => string;
  /** Cosine similarity of a vector row, for the noise floor. */
  similarityOf?: (row: Row) => number;
}): Promise<Row[]> {
  const counts = new Map<string, number>();
  if (!opts.embedding) {
    return shapeRetrievalHits(await opts.lexical(), {
      limit: opts.limit,
      groupOf: opts.groupOf,
      counts,
    });
  }

  const rows = shapeRetrievalHits(await opts.vector(), {
    limit: opts.limit,
    groupOf: opts.groupOf,
    similarityOf: opts.similarityOf,
    counts,
  });
  if (rows.length >= opts.limit) return rows;

  const seen = new Set(rows.map(opts.keyOf));
  const topUp = (await opts.lexical()).filter((row) => !seen.has(opts.keyOf(row)));
  rows.push(
    ...shapeRetrievalHits(topUp, {
      limit: opts.limit - rows.length,
      groupOf: opts.groupOf,
      counts,
    })
  );
  return rows;
}

/**
 * The per-document cap, applied to hydrated results where the Source is known
 * (#801, CYB-14). A Concept is not a document: one Source produces many, so
 * capping on the Concept would let a long Source keep the whole window.
 * Results with no Source (a queried API endpoint's synthetic hit) group on
 * their Concept instead, which is the closest thing they have to a document.
 */
export function capPerSource<Row extends { sourceId?: string | null; conceptId: string }>(
  hits: Row[],
  limit: number
): Row[] {
  return shapeRetrievalHits(hits, {
    limit,
    groupOf: (hit) => hit.sourceId ?? `concept:${hit.conceptId}`,
  });
}
