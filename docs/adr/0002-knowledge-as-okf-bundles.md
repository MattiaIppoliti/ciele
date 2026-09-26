# Knowledge Collections are stored as OKF bundles

Each Knowledge Collection inside an Assistant is represented as an Open Knowledge Format (OKF v0.2) bundle: a directory of markdown Concept documents with YAML frontmatter (`type` required; `title`, `description`, `resource`, `tags`), cross-linked with normal markdown links, with `index.md` for progressive disclosure. Uploaded Sources (PDFs, URLs) are ingested by an enrichment step that drafts one Concept per meaningful unit; embeddings for RAG (pgvector) index Concept content and always point back to their Concept, so chat citations resolve to a Concept and its original Source.

Why: OKF makes the knowledge portable (export/import a collection as a tarball, versionable in git, readable by humans and by any agent) instead of locking it into an opaque blob+embeddings pipeline, and its `index.md` progressive-disclosure convention matches how the agent loop navigates knowledge. Google published OKF as an open, vendor-neutral spec in June 2026.

**Rejected:** storing only raw files + embedding chunks (simplest, but knowledge is not portable, not human-curatable, and citations can only point at page offsets instead of curated Concepts).

## Update: OKF v0.2 (2026-07-26)

The format moved to **v0.2**, which makes provenance, trust and lifecycle first-class for a corpus that is mostly agent-written. We adopt it in full on the *producer* and *consumer* side; the format module is [`packages/db/src/okf.ts`](../../packages/db/src/okf.ts) (`OKF_VERSION`, the frontmatter types, and the pure derivations), re-exported through `@agent-hub/db`.

What every Concept we write now carries:

| Family | Field | Who stamps it |
|---|---|---|
| Trust (§5.2) | `generated: { by, at }` | LLM enrichment → `okf-enricher/<modelId>`; verbatim companion → `process:okf-verbatim-index`; crawl → `process:website-crawl`; no-model ingest → `process:okf-ingest-passthrough`; FAQ authoring/import → `human:<userId>`; accepted Suggested Fix → `suggested-fix-drafter/<model>` |
| Trust (§5.2) | `verified: [{ by, at }]` | Only a real confirmation event. Today that is exactly one: accepting a Suggested Fix stamps `human:<reviewer>`, the sole path that yields the `human-reviewed` tier |
| Provenance (§5.1) | `sources: [{ id, resource, title }]` | The Source the Concept derives from: the page URL, the retained original's storage key, or a scope descriptor when there is no followable artifact |

Deliberate non-decisions, so they are not mistaken for oversights:

- **No backfill of `generated` onto pre-upgrade rows.** `generated.by` is required within `generated` and we do not know who authored v0.1 rows; inventing an actor would be a provenance lie. §13.1 blesses the read-time fallback instead, so `conceptGeneratedAt()` reads `generated.at` and falls back to the legacy `timestamp`. Old rows stay readable and honestly unattributed. No migration ships with this change, `frontmatter` is `jsonb`, so the new families need no schema change.
- **We do not stamp `status` or `stale_after`.** Absent `status` means `stable` (§5.4), which is true of everything we write, and we have no signal that would justify a freshness date. Both are modeled and read; nothing fabricates them.
- **Attested Computations (§10) are modeled, not executed.** `runtime` / `parameters` / `computation` / `executor` / `attester` are typed so a bundle authored elsewhere survives a round-trip through the platform. Shipping an executor/attester runner is out of scope, OKF fixes the interface, and the spec itself defers the runtime protocol (§12).
- **Credibility signals (`author`, `usage_count`, `last_modified`, `usage_window`) are modeled but unpopulated.** We have no usage telemetry per source to report, and a fabricated count is worse than none.

Consumers read these only through the derivations (`trustTier`, `verificationEvents`, `conceptStatus`, `isStale`, `conceptGeneratedAt`), the `verified`-is-a-mapping-or-a-list rule (§5.2, a §11 MUST) and the legacy-`timestamp` fallback each live in exactly one place. The Knowledge browser surfaces trust tier, non-default status, staleness and `sources` on each concept card.

## Update: the verbatim companion Concept (2026-07-26)

Enrichment rewrites, and `embedConcept` chunks the Concept *body*, so for a file / URL / pasted-text
Source the vector index only ever saw the model's rewrite: detail the rewrite dropped was
unreachable however good retrieval was, and the index was additionally capped at the enrichment
prompt's 60k characters. Website crawls were unaffected (their bodies are verbatim page text).

`enrich` therefore emits one **verbatim companion** per Source alongside the enriched Concepts:
`originals/<slug>.md`, `type: Source Text`, `generated: process:okf-verbatim-index`, body = the
extracted text unedited and uncapped. It is an ordinary Concept on the ordinary `persistConcept`
seam, so it chunks, embeds and atomically replaces like any other, and citations still
resolve Concept → Source. Written **only when enrichment ran**, the no-model pass-through Concept
already is the verbatim text, and crawled pages already are too, so a companion there would be a
duplicate competing for the same top-*k* slots.

The enriched Concepts stay the curated, citable layer; the companion only guarantees nothing in the
source is absent from the index, with cosine arbitrating between the two.

**Rejected:** chunk-level provenance (verbatim chunks attached to whichever Concept covers them). It
keeps one Concept per unit and avoids near-duplicate hits, but requires the enricher to emit
trustworthy text spans back into the original plus a `concept_chunks` schema change, LLM-reported
offsets are exactly the kind of thing that is silently wrong.

**Cost accepted:** embedding roughly doubles per enriched Source (negligible), and `graph_cognify`
rises by more than 2× on those Sources because the worker runs an LLM over the longer verbatim body.
Syncing it to the graph anyway was deliberate: `withGraphEngine` falls back to vector only when the
graph returns nothing, so a companion missing from the graph would be dead weight for assistants on
the default engine. The per-Concept lever if that spend bites is the existing `excluded` flag, which
drops a Concept from both indexes. Full reasoning:
[`docs/audits/okf-enrichment-information-loss.md`](../audits/okf-enrichment-information-loss.md).

Sources ingested before this change have no companion until re-ingested; file Sources with a
retained original can be re-processed from the Knowledge UI, pasted text and URLs cannot.

## Amendment: OKF is the envelope, not a rewrite (2026-09-25, ADR-0025)

The enrichment step above is gone. A file or pasted-text Source is stored as its own words: the
pass-through `Document` Concept(s), `generated: process:okf-ingest-passthrough`, with `sources`
naming the Source. No model drafts Concepts at ingestion, and the verbatim companion has nothing to
accompany, so new Sources carry neither `okf-enricher/...` Concepts nor `Source Text` ones.

What survives is everything this ADR was for: the OKF frontmatter on every Concept, the bundle's
portability, and the citation invariant (a citation resolves to a Concept and then its Source,
never to an opaque chunk). pgvector is the index; OKF is the record.

The reason is measured, not taste: on the ADR-0025 bench the rewrite kept 16% of the source
characters and never found an answer the verbatim text missed, while it took one of the six result
slots in six. The rejected alternative at the top of this ADR ("raw files + embedding chunks")
stays rejected in the sense it meant: chunks still belong to a Concept with provenance, and a
curated FAQ is still a hand-written Concept.

Existing enriched Concepts are rebuilt from their own `Source Text` companions by
`enqueueVerbatimReingests` (ADR-0025, Consequences).

## Amendment: Document is the domain noun, Concept stays the format's (2026-09-20)

The stored unit is called a **Document** everywhere a person reads it: `7 Documents` in the
Library's Content column, `{n} Documents` in the Assistant editor, the "View knowledge source"
dialog and its empty state, the `ciele knowledge sources` table, `CONTEXT.md`, and any new code.
The word it replaces is "Page", which was never accurate for a Source that is a PDF, a pasted note
or an imported Salesforce article.

**Concept is not retired.** It is what OKF v0.2 calls the same row, so the format keeps the word
wherever the format is the one speaking: `ConceptFrontmatter` and every derivation over it
(`trustTier`, `conceptStatus`, `conceptGeneratedAt`, …), the `concepts` and `concept_chunks`
tables, their SQL functions (`match_chunks_*`), and the `Db` methods named after them
(`listConceptsBySource`, `persistConcept`, `embedConcept`). One operation moved, the
`knowledge.sources.concepts.list` the "View knowledge source" dialog calls, which is
`knowledge.sources.documents.list` now; nothing on `/api/v1`, in the `ciele` CLI or in the MCP
server referenced it, which is why it could move at all. The wire contracts do not move with it.

The cost, stated rather than left for a reviewer to find: for a while `listSourceDocumentsOp` calls
`ctx.db.listConceptsBySource` and a function named after Concepts returns Documents. The
alternative is a rename migration on a live database so a variable agrees with a label, which buys
nothing a reader can see.

**The citation invariant is unchanged, word for word:** a citation resolves to a Document and then
to its Source, never to an opaque chunk.

**Pages are still pages.** The crawl activity card counts the pages a crawler fetches (`162/291`)
and keeps saying so, because that is the number the provider reports while it stages. One fetched
page becomes one stored Document, so the card and the Library land on the same count and describe
different moments; neither copy claims the other is wrong.
