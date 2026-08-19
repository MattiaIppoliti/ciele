# Does OKF enrichment lose what RAG could have retrieved?

**Question.** The agentic flow answers out of OKF Concepts. If the OKF layer *summarizes* a source
rather than carrying it, the summary is the only thing that ever reaches the vector index, and the
detail the visitor actually asked about is unreachable no matter how good retrieval is. So: does
enrichment summarize, what is lost, and does the answer path still return the request-relevant
chunks ranked by embedding similarity?

**Scope.** Code as of this audit; `apps/web/src/lib/runtime/`. Everything below is read off the
ingestion and retrieval paths, with the two claims that could be mistaken for opinion
(`similarity: 1`, the pass-through truncation) backed by executable tests.

---

## 1. Short answer

| | |
|---|---|
| Does the retrieval layer return embedding-ranked chunks? | **Yes.** Cosine top-*k* over `concept_chunks`, in similarity order, up to 6 passes per turn. Nothing about OKF replaced ranked chunk retrieval with a summary lookup. |
| Were those chunks the source text? | **Originally, only on the website-crawl path.** On the file / URL / pasted-text path they were chunks *of the LLM's rewrite*; the original was never chunked, never embedded, therefore never retrievable. |
| Could detail be lost? | **Yes, structurally, on that one path.** Three independent mechanisms, §3. |
| Status | **Fixed.** The verbatim companion Concept (§3.1) means the rewrite is no longer the only thing indexed; windowed enrichment with a pinned output budget (§3.2) makes the rewrite itself less lossy; and the graph coverage gate (§4.1) no longer reads a rank placeholder as a relevance score. |

The failure mode this closes: an admin uploads a 40-page regulation PDF, a visitor asks about a
clause the enricher folded into a summary sentence, and the assistant answers "I couldn't find
anything about that", correctly, because the clause was not in the index. Re-embedding could not
fix it; only re-ingesting could, and only if enrichment behaved differently that time.

---

## 2. Where a chunk comes from

One write seam, `persistConcept` → `embedConcept` ([ingest.ts](../../apps/web/src/lib/runtime/ingest.ts)):
it chunks **`options.body`**, the Concept body, and embeds that. There is no second index. So
"what can retrieval ever see" is exactly "what ends up in a Concept body", and the question becomes
what fills that body.

Two producers did, and they are not equivalent:

**Website crawl, verbatim.** `finalizeWebsiteCrawl` stores `page.text` up to
`MAX_CONCEPT_BODY_CHARS` (1,000,000). No model touches it. Full fidelity, chunked and embedded.

**File / URL / pasted text, LLM rewrite.** `ingestSource` → `enrich` sends the source to a
`generateObject` call and stores **the model's output** as the body. Uploaded *files* keep their
binary in the `knowledge-originals` bucket, but that bucket exists to support re-processing; it is
not indexed and not searchable, and pasted text and fetched URLs keep nothing at all. So until
§3.1, once enrichment had run the model's rewrite was the only *searchable* copy of the source, and
for two of the three kinds the only copy at all.

The prompt does say *"Preserve every fact; do not invent content."* That is an instruction, not a
mechanism: nothing measures whether the output preserved the input, and three ceilings make full
preservation impossible for a large document regardless of how well the model complies.

---

## 3. The three loss mechanisms

**(a) Prompt truncation at 60k characters.** `ENRICH_SOURCE_MAX_CHARS` was `60_000` and `enrich`
sliced `rawText` to it in one call. Past that point the source was not summarized; it was *never
seen*. A long PDF contributed its first 60,000 characters and the rest was silently discarded: no
Alert, no Source `error`, nothing in the UI. **Addressed twice over**, §3.1 indexes the whole
document regardless, §3.2 windows the enrichment instead of truncating it.

**(b) An output-token ceiling, not a fidelity budget.** The `generateObject` call set no
`maxOutputTokens`, so the provider default applied. Reproducing 60k characters of input across the
concept bodies needs roughly 15k output tokens *before* any restructuring. A model asked to turn a
long document into ≤12 self-contained concepts under an unknown output cap compresses, arithmetic,
not a prompt-quality problem. **Addressed** by §3.2: the budget is pinned and the window is sized
to it.

**(c) A hard cap of 12 concepts.** `CONCEPT_SCHEMA` is `.max(12)`. A document with 40 distinct
policies had to be squeezed into at most 12 bodies, forcing merging and therefore compression.
**Softened** by §3.2, the cap now applies per window, so the ceiling scales with document length
(up to 4 × 12) rather than being fixed per document.

**Also fixed (was a fourth):** the *no-model* fallback, the path taken when no classifier
connection is configured, built its concept body from the already-truncated `text` rather than
`rawText`. It performs no enrichment at all, so it should have been the lossless path, yet it
silently dropped everything past 60k of every upload. It now keeps the full document (regression
test: `ingest.okf.test.ts` → "keeps the whole document past the enrichment prompt cap").

### 3.1 The fix: a verbatim companion Concept

`enrich` now emits, alongside the enriched Concepts, one **verbatim companion** per Source:
`originals/<slug>.md`, `type: Source Text`, `generated: process:okf-verbatim-index`, body = the
extracted text unedited. It goes through the same `persistConcept` seam, so it is chunked, embedded
and graph-synced exactly like any other Concept, and `replaceSourceKnowledge` replaces it atomically
on re-ingest rather than accumulating copies.

The enriched Concepts remain the curated, citable layer; the companion guarantees nothing in the
source is *absent* from the index. Four properties worth stating, because they are the reason this
shape was chosen over the alternatives:

- **It carries the full text, not the 60k slice.** Mechanism (a) still bounds what the *model* sees,
  but no longer what is *retrievable*. That is the half that decides whether a question can be
  answered at all, so windowed enrichment (§5.2) drops from "necessary" to "improves the curated
  layer".
- **It is written only when enrichment actually ran.** With no classifier the pass-through Concept
  already is the verbatim text; a companion would be a byte-identical duplicate competing with it
  for the same top-*k* slots. Crawled pages are likewise untouched, already verbatim.
- **Citations still resolve Concept → Source** (ADR-0002). The companion is a real Concept with a
  real Source, titled `"<name>, full text"` so a citation chip reads sensibly.
- **Ranking arbitrates between the two.** A summary chunk and a verbatim chunk from the same Source
  can both surface; cosine decides. This is the accepted trade-off: a near-duplicate occasionally
  spends one of the six slots, in exchange for the detail never being unreachable.

**Costs, stated plainly.** Embedding roughly doubles per enriched Source (negligible,
`text-embedding-3-small` is ~$0.02/1M tokens). **Cognify is the one to watch**: the graph worker
runs an LLM over every synced Concept, and the verbatim body is several times longer than the
summary it accompanies, so `graph_cognify` spend on enriched Sources rises by more than 2×, visible
per-org in the `ai_usage` ledger. Syncing it was still the right default: in graph mode
`withGraphEngine` falls back to vector only when the graph returns *nothing*, so a verbatim Concept
missing from the graph would be dead weight, embedded but never queried, for exactly the
assistants on the default engine. The per-concept lever if the spend does bite is the existing
`excluded` flag, which drops a Concept from both indexes.

**Pre-existing Sources are not backfilled.** A Source ingested before this change has no companion
until it is re-ingested. File Sources with a retained original can be re-processed from the
Knowledge UI; pasted text and fetched URLs cannot, because nothing kept their input (§2).

### 3.2 Windowed enrichment and a pinned output budget

The companion fixes *retrievability*. Mechanisms (b) and (c) still degraded the *curated* layer, so
enrichment now runs over windows with an explicit budget:

| Constant | Value | What it bounds |
|---|---|---|
| `ENRICH_MAX_OUTPUT_TOKENS` | 8,000 | Output per call: the compression ratio, now a deliberate number instead of a provider default |
| `ENRICH_WINDOW_CHARS` | 24,000 | Source text per call (~6k input tokens), sized so a window *fits* the output budget rather than being compressed into it |
| `ENRICH_MAX_WINDOWS` | 4 | Calls per Source |
| `ENRICH_SOURCE_MAX_CHARS` | 96,000 | Derived: total span curated |

The real win is fidelity, not span: the same 60k-character document previously had to fit one
unbounded-but-unknown output budget, and now gets three windows each with 8k tokens of its own.
Span rises too (60k → 96k), but only modestly, and deliberately.

Why 8,000 and not more: `getClassifierModel` can resolve to any provider, including a
user-configured `openai_compatible` model with a modest cap, and exceeding a model's own limit is a
hard error that would cost the entire enrichment. The window is sized to the budget, not the reverse.

Why only 4 windows: this is bounded by **wall clock, not cost**. Enrichment runs in a job whose
route caps at `maxDuration = 300`, and a job killed mid-flight is retried by cron, burning tokens
on every attempt without ever finishing. Four sequential calls stay well inside that. Sequential
rather than parallel because bursting four structured-output calls is the shape that trips provider
rate limits, and the job has the time.

Three behaviours worth knowing:

- **Windows split on paragraph boundaries, with a hard size cap.** Unlike `chunkMarkdown`, an
  oversized paragraph is split mid-text: PDF extraction routinely returns pages with no blank lines,
  and one 100k-character "paragraph" would blow the very budget windowing exists to respect.
- **Partial failure is tolerated.** A window that fails (provider blip, schema violation) is skipped
  and the rest are kept. Only if *every* window fails does it fall back to the full-text
  pass-through Concept.
- **Colliding paths are suffixed.** Windows are drafted independently and can each land on
  `fees.md`; the second becomes `fees-2.md` rather than a twin Concept.

Past 96,000 characters the curated layer stops. This is logged, not alerted: the verbatim companion
still carries the whole document, so it degrades curation, not answerability, and an Alert that
cannot cleanly auto-resolve (the condition persists until someone splits the file) is worse than
none. See §5 for the judgement call.

---

## 4. The retrieval side

Ranking works as intended on the vector engine:

- `vectorSearch` ([turn.ts:345](../../apps/web/src/lib/runtime/turn.ts)) embeds the query and calls
  `searchChunks(..., limit: 6)`; `match_chunks` orders by `embedding <=> query` (cosine) and returns
  chunk `content` with its similarity. Partial vector results are topped up with lexical matches so
  NULL-embedding chunks are not masked.
- `runSearchPass` records each pass and scores coverage against real similarities
  (`strongSimilarity: 0.7`, `relevanceFloor: 0.4`); a thin pass triggers a rephrase + scope widen,
  up to `MAX_SEARCH_PASSES = 6`.
- The model receives `{ concept, collection, source, content }` per hit, in rank order.

So the requirement "the chunks relevant to the request must come back, correctly ranked by
embeddings" was always met by the retrieval *layer*. The gap was upstream, on the enriched path
those chunks were chunks of a rewrite, and §3.1 closes it: the same ranked retrieval now runs over
the source's own words as well as the curated summary.

### 4.1 The graph engine's synthetic similarity, fixed

`knowledge_engine` defaults to `graph` (migration `20260719010000`). When the worker is configured
and the search is collection-scoped, `withGraphEngine` bypasses pgvector entirely and
`hydrateGraphProvenance` assigns `similarity: 1 - results.length / (provenance.length + 1)`, a
rank-descending placeholder, not a relevance score. Its first result is therefore always exactly
`1`, above `strongSimilarity: 0.7`, so `scoreCoverage` returned `sufficient` for **any** non-empty
graph result and the reformulation/widen policy could never fire. `graph-search.test.ts` already
pinned `similarity: 1`, so this was settled behaviour, not a hypothesis. In graph mode the coverage
gate was effectively "did anything come back", and a weak-but-nonempty graph hit ended the search
where vector would have widened and tried again.

The worker reports no score to plumb through, `GraphProvenance` is
`{ conceptId, sourceId, excerpt }` and nothing more, so a real relevance number was not obtainable
without changing a separate service. The gate is engine-aware instead:

- `KnowledgeSearchResult` gains an optional `engine` field, reusing the existing `KnowledgeEngine`
  union. `hydrateGraphProvenance` stamps `"graph"`; the vector path leaves it absent, which is read
  as vector. Carrying it on the *result* rather than threading it through call sites is what
  guarantees `similarity` is never interpreted without the context that makes it meaningful.
- `scoreCoverage` branches. Vector results are judged on cosine exactly as before; graph results are
  judged on **count** (`graphMinResults: 3`), separating sparse from plentiful. That is strictly
  weaker than separating weak from strong, and honestly so, count is the only signal the graph
  gives. A mixed list is judged by the graph rule, since placeholder scores would dominate a
  `Math.max` over similarity.

The payoff: a thin graph pass is now `insufficient`, so `nextReformulation` widens to the assistant
tier, and an assistant-wide widen is served by **vector** (`withGraphEngine` has no per-collection
dataset to target). A turn the graph answered thinly now gets a real ranked second opinion instead
of stopping on an unscored result.

---

## 5. Recommendations: all four closed

1. ~~**Index the original alongside the Concept.**~~ **Done**, §3.1. Shipped as the companion
   verbatim Concept rather than chunk-level provenance: the latter needs the enricher to emit text
   spans mapping each concept back to the original, which LLM output cannot be trusted to produce
   accurately, and it would have required a schema change to `concept_chunks`. The companion needs
   neither and reuses the existing write and replacement seams.
2. ~~**Window the enrichment instead of truncating**~~ (#398 / #404). **Done**, §3.2. Four windows
   of 24k characters, split on paragraph boundaries with a hard cap, partial failure tolerated,
   colliding paths suffixed. Windows do **not** overlap: overlap buys cross-boundary context at the
   cost of duplicate concepts, and with the verbatim companion already guaranteeing retrievability,
   fragmentation of the curated layer is the cheaper failure.
3. ~~**Give the graph engine a real score, or a graph-specific coverage gate.**~~ **Done**, §4.1.
   The gate, not the score: the worker returns no distance, and inventing one would have repeated
   the original mistake in a new place.
4. ~~**Set an explicit `maxOutputTokens`.**~~ **Done**, §3.2, pinned at 8,000 with the window sized
   to it.

### Left deliberately undone

- **No UI surface for "curated only in part".** Past 96k characters the curated layer stops and this
  is logged, not alerted. The verbatim companion still carries the whole document, so the condition
  degrades curation rather than answerability, and the existing `signalHealth` mechanism is a
  healthy/unhealthy binary that auto-resolves on the next successful ingest, it cannot express a
  persistent "partially curated" state without either a new alert key that never resolves or a
  schema change. Worth revisiting if large uploads turn out to be common.
- **No overlap between windows**: see 2 above.
- **`graphMinResults: 3` is a coarse number**, like the cosine thresholds it sits beside. It is the
  point at which a graph pass stops widening; tune it if graph-mode turns are observed widening too
  eagerly.
- **`sources.show_in_citations` remains dead schema.** The column exists (migration
  `20260710102020`) and nothing reads it. It is the natural lever if the verbatim companion's
  citation chip ever proves too noisy next to its enriched sibling, but wiring it up is a separate
  product decision about whether an answer may be grounded in an uncited source.
