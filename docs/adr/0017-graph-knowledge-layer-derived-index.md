# Graph Knowledge Layer as a derived retrieval index (OKF stays the record)

## Status

Accepted — **being implemented** (wayfinder map #379 → spec #385). This ADR is
the decision record; the build lands across tickets #386–#390.

- #386 (this ticket): the graph worker sidecar + the runtime client adapter +
  this ADR + the domain terms.
- #387 ingestion fan-out, #388 the Knowledge Engine + graph searcher, #389 the
  feedback learning loop, #390 Suggested Fix — the rest of the layer.

## Context

Ciele's knowledge is stored as **OKF bundles**: discrete Concepts with Source
provenance, embedded into Supabase pgvector, retrieved by the runtime's
`search_knowledge` action, and cited as **Concept → Source** (ADR-0002's
invariant — citations never resolve to opaque chunks).

Two product gaps motivated a change (map #379): the knowledge base is static
(bad answers never demote their material; feedback and Improvement descriptions
go nowhere) and cross-document questions are answered from isolated chunks. A
research pass ([`docs/research/cognee-fit.md`](../research/cognee-fit.md)) and a
live spike ([`docs/research/cognee-spike.md`](../research/cognee-spike.md))
established that the open-source **cognee** library (Apache-2.0, self-hostable,
no paid SaaS) can build a per-collection knowledge graph whose feedback loop
re-weights exactly the elements used to answer, and whose graph exports with an
intact Entity → Chunk → Document provenance chain.

The user chose (2026-07-19) to make the graph Ciele's retrieval layer, built on
cognee — not merely a background enricher. That raises the stakes: the graph now
sits on the answer path, so the citation invariant must be re-proven on it.

## Decision

Add a **Graph Knowledge Layer** as a **derived index**, not a new system of
record.

1. **OKF remains authoritative.** Concepts and Sources, their admin editing, and
   the citation contract are unchanged. The graph is rebuilt from OKF and is
   disposable — losing it loses no source of truth.
2. **Per-Assistant Knowledge Engine.** `Graph` is the **primary/default** engine
   — cognee is the retrieval brain every assistant uses (amended 2026-07-19, see
   below). `Vector` (the pgvector RAG) remains the **fallback**: when the graph
   worker is unreachable, retrieval falls back to Vector in the same turn so the
   widget never stops answering. The pgvector *index* is a candidate for later
   retirement once Graph is proven — but OKF, the record it is built from, is
   not (see the amendment).
3. **Citations survive on the graph.** Every ingested document is tagged with
   its `conceptId` / `sourceId`; a graph result's provenance resolves back to
   Concept → Source through those tags. ADR-0002's invariant holds — this ADR
   supersedes ADR-0002's *retrieval mechanism*, not its citation guarantee.
4. **Self-hosted sidecar.** cognee runs as one private, token-gated, stateful
   container (`services/graph-worker/`), mirroring the crawler worker's shape:
   base-URL + Bearer-token env, fail-closed auth, capability-gated client module
   inside the runtime, deployed as a documented action (not from app code).
   Embeddings are local (fastembed) — zero embedding-token cost; only cognify
   and graph-completion call the configured LLM. Telemetry is disabled.
5. **Tenancy in our layer.** One cognee dataset per Knowledge Collection;
   org→collection authorization is enforced by the RLS-scoped Db facade *before*
   any worker call. cognee's own app-level ACL and its per-dataset
   `CREATE DATABASE` isolation are not used (research: incompatible with managed
   Supabase, weaker than our RLS). The worker trusts only the service token.
6. **Human-approved learning only.** Feedback re-weights retrieval automatically
   (safe, invisible tuning), but any change to knowledge *content* is a
   Suggested Fix a Member must accept. The loop never silently edits a tenant's
   knowledge base.

## Consequences

- **Positive:** conversations and feedback finally improve retrieval; multi-hop
  answers become possible; no second source of truth to reconcile; the answer
  engine degrades gracefully to the proven Vector path; no new recurring SaaS
  cost.
- **Costs / obligations:** a stateful Python sidecar to operate (persistent
  volume, version-sensitive cognee upgrades — see the worker runbook); ~3 LLM
  calls per graph answer vs ~1 for Vector (mitigated by cheap per-stage models +
  a per-org daily learning-token budget, #389); the feedback loop only exists
  when retrieval flows through the graph, which the Graph engine makes true by
  construction; the Concept→Source mapper over graph provenance is ours to build
  and keep correct as cognee's payloads drift.
- **Revisit if:** graph answer quality/cost does not beat Vector in production,
  or the sidecar's operational burden outweighs the learning gains — in which
  case Vector remains fully functional and Graph can be retired per-assistant
  with no data migration.

## Amendment — 2026-07-19: Graph is primary, not opt-in

Original decision #2 made `Vector` the default and `Graph` opt-in. The product
owner chose instead to **lean fully into cognee**: `Graph` is the default engine
for every assistant, and `Vector` steps back to fallback-only (candidate for
later retirement *as a retrieval index*).

The question that prompted this — "why keep both OKF and cognee if they overlap?"
— was resolved by distinguishing the roles, not by dropping a layer:

- **OKF stays the system of record**, unconditionally. It is the *authored*
  content (FAQs, uploaded files, crawled pages), the *editing* surface, the
  RLS-scoped per-tenant store, and the **citation anchor** (Concept → Source).
  cognee has none of these — no authoring UI, app-level tenancy only, a
  disposable store — and its provenance resolves *back to the OKF document it
  ingested*. cognee therefore **depends on** OKF as its input and its citation
  target; it cannot replace it.
- The only genuine redundancy is the **retrieval index** (pgvector vs graph),
  not the record. So the thing that may eventually be retired is the pgvector
  index, never OKF.

Consequence for the build: this flips the default in #388 (Graph selected unless
an assistant opts out / the worker is down). The ingestion fan-out (#387) is
**unchanged** — content still originates in OKF and flows into the graph either
way.
