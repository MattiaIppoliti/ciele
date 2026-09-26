# Retrieval bench (ADR-0025)

The bench that chose verbatim chunks and the rerank stage. Run it by hand, never in CI:

```bash
AI_GATEWAY_API_KEY=... pnpm --filter @agent-hub/agent bench:rag [--json results.json]
```

`../rag-eval.mts` is the runner. It builds the index with the production chunker, compares dense
top-6 against dense top-20 reranked to 6 by `createReranker`, and has a model judge every retrieved
passage. Embeddings and verdicts are cached in `.cache/` (gitignored). The run exits 1 when the
reranked variant misses easy recall@1 95% or hard complete@6 90%, or when any search fell back to
the dense order.

## Contents

- `corpus/`: ten economics readings of about 20,000 characters each, cut at a paragraph boundary.
  The text comes from the English Wikipedia articles of the same names, under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It is unchanged apart from the
  cut and the removal of the reference sections.
- `questions-easy.json`: 50 questions (35 English, 15 Italian), each answered by one paragraph,
  with the verbatim evidence.
- `questions-hard.json`: 50 questions (20 indirect, 20 multi-hop, 10 cross-document, 25 in
  Italian), each with the list of facts a complete answer needs.

A model wrote both question sets from the corpus, which favours verbatim retrieval somewhat. Treat
the numbers as a regression check on this corpus, not as a measure on real course PDFs.

## Results when the stage was chosen (25 September 2026)

| Variant | Easy recall@1 | Easy MRR | Hard complete@6 | Hard complete@3 | Hard MRR |
|---|---|---|---|---|---|
| Rewrite + verbatim, dense top-6 (before) | 70% | 0.79 | 82% | 60% | 0.49 |
| Verbatim, dense top-6 | 70% | 0.80 | 82% | 60% | 0.47 |
| Verbatim, top-20 → voyage/rerank-2.5 → 6 | 100% | 1.00 | 94% | 88% | 0.67 |
