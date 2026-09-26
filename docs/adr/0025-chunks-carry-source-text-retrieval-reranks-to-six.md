# Chunks carry source text; retrieval reranks to six

## Status

Accepted, 2026-09-25. Supersedes ADR-0017's retrieval decisions (#1 to #5: the Graph Knowledge
Engine, its worker, the ingestion fan-out and the feedback loop). ADR-0017's decision #6, the
Suggested Fix and its human-accept rule with the #770 amendment, stays in force. Amends ADR-0002:
OKF is the envelope, not a rewrite.

## Context

An offline bench measured retrieval over 10 course-style readings (187k characters) with the
production chunker, the production enrichment prompt and a model judge: 50 single-answer questions
and 50 hard ones (indirect, multi-hop, cross-document, half in Italian). It is in the repo now,
`pnpm --filter @agent-hub/agent bench:rag`, with its corpus and both sets under
`packages/agent/scripts/rag-eval/`.

Two findings decided this.

**The ingestion rewrite adds nothing and costs result slots.** `enrich()` kept 16% of the
characters it was given (8% to 21% per document) despite "Preserve every fact". Rewrite-only
retrieval found 42% of the answers, rewrite plus the verbatim companion 94%, verbatim alone 98%.
The rewrite chunks took 1 slot in 6 and never found an answer the verbatim chunks missed. Twice
they pushed the right chunk out of the top 6.

**A reranker is the one retrieval change that matters.** Dense top-20 reranked to 6 by
`voyage/rerank-2.5`:

| | Easy recall@1 | Easy MRR | Hard: all facts in top 6 | Hard: in top 3 | Hard MRR |
|---|---|---|---|---|---|
| Before (rewrite + verbatim, top-6) | 70% | 0.79 | 82% | 60% | 0.49 |
| Verbatim only, top-6 | 70% | 0.80 | 82% | 60% | 0.47 |
| **Verbatim, top-20 → rerank → 6** | **100%** | **1.00** | **94%** | **88%** | **0.67** |

Median added latency 0.51 s (p90 0.55 s) through the AI Gateway. Rejected on the same bench:
textbook BM25 + dense fusion (it hurt Italian questions over English text), HyDE (+1.3 s, no gain
once reranked), per-chunk contextual headers (no gain, about 230 extra model calls per 10
documents). Small-to-big retrieval was the best option without a reranker and is kept for later.

The TypeScript port reproduces the baseline exactly (easy recall@1 70%, MRR 0.80; hard 82%) and
measured the shipped stage at 100% / 1.00 and 92% / 88% / 0.67. The hard set's 92% against the
original 94% is one question.

The Graph engine (ADR-0017) had been the default retrieval path, and it cost a stateful Python
sidecar with a persistent volume, about three extra model calls per answer, a Concept → Source
mapper over the library's drifting payloads, a nightly learning cron and a job kind. Every graph
answer fell back to exactly this pgvector index whenever the worker was unreachable, and the bench
shows the index plus a reranker answers better than the index alone ever did. The complication
bought no measured gain.

## Decision

1. **A file or pasted-text Source is stored as its own words.** Ingestion writes the pass-through
   `Document` Concept(s) (`sourceConceptDrafts`), the extracted text split only at the per-Concept
   safety ceiling. No model call runs. Web pages and FAQs were already verbatim or human-authored
   and are unchanged. OKF stays the record: `type`, `title`, `generated`
   (`process:okf-ingest-passthrough`) and `sources` on every Concept, and citations still resolve
   Concept → Source (ADR-0002's invariant).
2. **Knowledge search reranks.** `buildKnowledgeSearcher` and the Teammate's
   `buildCollectionSearcher` ask the index for `RERANK_CANDIDATES` (20) and return the reranker's
   `KNOWLEDGE_SEARCH_LIMIT` (6), `voyage/rerank-2.5` through the Gateway (`packages/agent/src/rerank.ts`).
   The results are the index's own objects, reordered and truncated, so everything downstream sees
   today's shape. `voyage/rerank-2.5-lite` is the fallback option (98% / 88% on the same sets).
3. **Fail open.** No `AI_GATEWAY_API_KEY`, a provider error or a 1.5 s timeout returns the first 6
   candidates in the index's order. Five consecutive failures for one Organization raise a
   `system` Alert, and the next reranked search clears it.
4. **Platform key only.** The reranker never reads a Provider Connection, so a Member's personal
   subscription cannot fund it (ADR-0001, ADR-0007). Widget traffic runs on the platform key.
5. **Metered.** One `rerank` usage row per search, on the query embedding's spenders and surface,
   priced at the Gateway's list rate. `RerankResult` carries no usage: the row takes a token count
   from the provider metadata when the Gateway reports one and otherwise estimates it from the
   characters sent.
6. **The Graph engine is removed.** Gone: `services/graph-worker`, the `graph-*` runtime modules,
   the `knowledgeEngine` Assistant setting and column, the `graph_sync_concept` job handler, the
   learn-graph cron and its rotation function, and the worker from the self-host overlay. A
   migration deletes queued graph jobs and resolves open graph-worker Alerts, because their
   producer can no longer clear them.

## Consequences

- One more sub-processor sits in the query path: the reranker receives the Visitor's question and
  20 passages of the Organization's knowledge. The Gateway's retention terms for Voyage models, and
  whether a customer's data-processing agreement needs a new sub-processor entry, are open
  questions for the data-protection owner, not decided here.
- About 0.5 s more per search pass, and the agent loop can run several passes per turn.
- A self-host without a Gateway key keeps today's retrieval exactly. The key is now in the compose
  file's app environment and in `.env.example`.
- The candidates are not the bench's. `db.searchChunks` is vector-first with a lexical top-up, a
  0.15 cosine floor and at most 3 passages per Source, so the 20 span at least 7 Sources where the
  bench's dense top-20 had no cap. A hard question whose facts sit in 4 or more passages of one
  Source can lose one before the reranker sees it. Changing the hybrid scoring was out of scope.
  It is the first thing to revisit if production recall disagrees with the bench.
- Ingestion is cheaper (no rewrite call, about 20× less spend per document on the bench) and the
  `enrich` usage stage now meters only document summaries.
- Existing enriched Concepts stay live until re-ingested. `enqueueVerbatimReingests` rebuilds each
  such Source from its own "Source Text" companions through the ordinary ingest job and generation
  swap, so no model runs and no original file is needed. It is a manual step, the unscheduled
  `/api/cron/reingest-verbatim` route, run until it enqueues nothing. A Source with no companion
  (ingested before 2026-07-26) is reported for its owner to re-process or re-upload.
- Removing the graph also removes the feedback loop that re-weighted retrieval from 👍/👎. Reactions
  are still stored and still feed Insights and Improvements. They no longer change ranking.

## Follow-ups

- Small-to-big (400-character children, 1,200-character parents) as the no-reranker fallback. It
  needs child embeddings, so it needs a migration.
- Re-run the bench on real course PDFs, where a clean-text corpus says least.
