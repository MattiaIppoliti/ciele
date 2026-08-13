/**
 * The hybrid-retrieve skeleton shared by every pgvector-backed search in this
 * package (`searchChunks`, `searchMemories`) and the lexical scoring the mock
 * implementations mirror. One algorithm, written once: before this existed the
 * same body — identical tokenizer, identical 0.5 placeholder similarity,
 * identical "vector RPC then top up from lexical via a seen set" — was pasted
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
 * Vector-first retrieval with a lexical top-up. With an embedding: run the
 * vector RPC, and when it returns fewer than `limit` rows, fill the remainder
 * from the lexical searcher (rows ingested while no embedding key was
 * configured have NULL embeddings and are invisible to the vector index),
 * deduped by `keyOf`. Without an embedding: lexical only.
 */
export async function hybridRetrieve<Row>(opts: {
  embedding: number[] | null | undefined;
  limit: number;
  vector: () => Promise<Row[]>;
  lexical: () => Promise<Row[]>;
  keyOf: (row: Row) => string;
}): Promise<Row[]> {
  if (!opts.embedding) return opts.lexical();
  const rows = await opts.vector();
  if (rows.length >= opts.limit) return rows;
  const seen = new Set(rows.map(opts.keyOf));
  for (const row of await opts.lexical()) {
    if (rows.length >= opts.limit) break;
    const key = opts.keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}
