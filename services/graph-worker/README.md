# Ciele Graph Knowledge worker

A private, token-gated container that builds and queries a **derived knowledge
graph** over an Organization's OKF Concepts, using the [cognee](https://docs.cognee.ai/)
library. It is the sidecar behind Ciele's Graph Knowledge Engine (ADR-0017): the
graph is a *retrieval + learning index*, never the system of record, OKF stays
authoritative and every result maps back to a **Concept → Source** citation.

The Ciele-side adapter that speaks this worker's contract is
[`packages/agent/src/graph-worker.ts`](../../packages/agent/src/graph-worker.ts).
Runtime docs live in [`docs/research/cognee-fit.md`](../../docs/research/cognee-fit.md)
(capabilities/cost/tenancy) and [`docs/research/cognee-spike.md`](../../docs/research/cognee-spike.md)
(the validating spike). Operations, sizing, and deploy: [`RUNBOOK.md`](./RUNBOOK.md).

## API contract

One static operator token, sent as `Authorization: Bearer <token>`. Every route
except `/health` requires it and the server refuses to boot without it (fail
closed). Each collection maps to one cognee dataset; the adapter derives the
dataset name, the worker never guesses it.

| Method & path | Body | Returns |
|---|---|---|
| `GET /health` |, (no token) | `{ status: "ok" }` |
| `POST /ingest` | `{ dataset, collection_id, documents: [{ conceptId, sourceId, text }] }` | `{ ingested, usage }`: `add` + `cognify`; re-ingesting a `conceptId` replaces its document |
| `POST /remove` | `{ dataset, concept_id }` | `{ removed }`: drops that Concept's document(s) |
| `POST /purge` | `{ dataset }` | `{ purged }`, drops the **whole** dataset (Collection/Assistant delete); missing dataset ⇒ `{ purged: false }` |
| `POST /search` | `{ dataset, query, mode, session_id, top_k }` | `{ answer, provenance: [{ concept_id, source_id, excerpt }], qa_id, usage }` |
| `POST /feedback` | `{ dataset, session_id, qa_id, score, text }` | `{ recorded }`: score 1–5 on a graph answer |
| `POST /improve` | `{ dataset, session_ids, distill }` | `{ weighted_elements, boosted, demoted, usage }`: feedback-weight pass (+ optional LLM distillation); `boosted`/`demoted` split the non-neutral edges by direction and sum to `weighted_elements` |

`mode` is `graph_completion` (composed answer + evidence) or `chunks` (matched
material, no LLM). Documents are tagged `concept::<id>` / `source::<id>` at
ingest so search provenance resolves to OKF, never an opaque chunk.

`usage` is `{ input_tokens, output_tokens, llm_calls, model, provider }`, the
aggregate token usage of the LLM calls cognee made internally to serve the
request (cognify extraction, graph-completion answers, session guidance,
distillation), captured via a litellm success callback per request. The Ciele
runtime meters it into the `ai_usage` ledger (`graph_search` / `graph_cognify`
stages). Best-effort accounting: a call path that bypasses litellm, or a
logging callback racing the response, under-counts; it never fails a request.
`llm_calls: 0` means nothing to meter (e.g. a pure `chunks` retrieval or a
weight-only improve pass).

## Run it locally

```bash
cp .env.example .env          # set GRAPH_WORKER_API_TOKEN + LLM_API_KEY
docker compose up -d --build
./scripts/smoke-test.sh       # ingest -> search round-trip (needs the LLM key)
```

Then point the Ciele app at it:

```bash
GRAPH_WORKER_BASE_URL=http://localhost:8000
GRAPH_WORKER_API_TOKEN=<same token as .env>
```

## Design notes

- **Embeddings are local** (fastembed / ONNX MiniLM): zero embedding-token cost
  (spike-verified). Only cognify entity extraction and graph-completion answers
  call the configured LLM provider (`LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY`).
- **Telemetry is disabled** (`TELEMETRY_DISABLED=1`), baked into the image.
- **Stateful, single instance.** The graph/vector/relational stores are embedded
  and process-local, so the service is pinned to one instance and a persistent
  volume. Scaling out requires external Postgres-backed stores, see the runbook.
- **The graph is disposable.** Losing the volume loses no source of truth; the
  index rebuilds by re-ingesting from OKF.
