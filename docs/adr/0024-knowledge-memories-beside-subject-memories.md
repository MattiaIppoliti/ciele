# Knowledge memories live beside subject memories, not inside them

A **knowledge memory** is one standalone sentence a Document said, kept beside the Document. It gets
its own table, `public.knowledge_memories`, rather than a `kind` column on `public.memories`
(ADR-0019's subject memory, #664) or a row type on the temporal graph (ADR-0023, #882).

The two share one English word and almost nothing else:

| | Subject memory (`memories`) | Knowledge memory (`knowledge_memories`) |
|---|---|---|
| A fact about | a person | a page |
| Keyed to | the verified SSO subject within the Organization | `(source_id, document_path)` |
| Comes from | a Conversation, by the promotion job | a Document, by the extraction job (#930) |
| Read by | the runtime, semantically, at the start of a chat | a Member, in the Memories tab (#932) |
| Embedded | yes, `match_memories` recalls top-*k* | no |
| Versioned | yes: `is_latest`, supersession, history retention | no |
| Removed by | **Erase**, destructive, an admin act (#925) | **Forget**, a reversible state a Member undoes |
| Gated by | an org-level toggle, off by default | nothing: knowledge is the product |
| Tenancy | organization + subject | organization + Collection, RLS at Editor rank to write |

A shared table would have meant a discriminator column plus a nullable half of the schema on every
row, two retention policies under one sweep, and an embedding column that is the whole point on one
side and dead weight on the other. The one thing genuinely shared is the liveness rule, and that is
shared as code rather than as a table: `isMemoryLive` in `@agent-hub/core`, with
`isKnowledgeMemoryLive` naming the two constants a page-scoped memory implies (always the latest,
never on a clock) so no caller re-checks `forgottenAt` by hand.

## What the row is, and what it deliberately is not

The durable identity is the **page**, not the page's row. A re-crawl is a generation swap
(`20260828070100`): every page is staged with a fresh random id and the retired generation is
deleted outright by the retention sweep. So `(source_id, document_path)` is the key, the same pair
`concepts_active_source_path_idx` indexes and the same pair `20260920100000` carries admin state
across, and `concept_id` is a nullable convenience with `on delete set null`: the memory outlives
the row it was read from.

Evidence is a pair: `quote`, the verbatim span, and a nullable `chunk_id`. The quote is the durable
half, because a Member checking whether a memory is still true reads the sentence, not a chunk id.
Provenance is OKF `generated` as `{by, at}` in the actor convention (ADR-0002), and it is required
on insert rather than defaulted: a row whose provenance the database invented is a provenance lie.

Four things are absent on purpose, each with its reason in the migration header: no `embedding`
(retrieval over memories is a later effort, and a column nothing reads is a promise the schema
cannot keep), no version chain (v1 keeps no per-memory history; the day a human can edit one,
supermemory's names are the ones to take), no `forget_after` (the page is the authority on whether
its memory still holds, and a page is not a clock), and no static/dynamic split (that is a property
of a person, not of a page).

**Rejected:** a `kind` column on `public.memories`. It reads as thrift and costs a nullable half of
the schema on every row, a sweep that has to branch, and a recall function that has to exclude a
kind it was never meant to see. The `memories` table also carries an org-level toggle that is off by
default; knowledge memories are not opt-in, so the toggle would have needed a branch too.

**Rejected:** keeping the memory on the Document row (a `memories jsonb` column on `concepts`). It
loses the whole point: the row dies with its generation at the next re-crawl, so every forget a
Member made would be reverted by a crawl they did not run.

## Two words, two owners

**Erase** is destructive and belongs to subject memory: rows go away and do not come back (#925,
and its SQL has always called it `erase_subject_memories`). **Forget** is a reversible state and
belongs to knowledge: `forgotten_at`, `forget_reason`, `forgotten_by`, cleared by a restore. One
product never has two meanings under one verb.

## Summaries are made on open, which is a different cost shape

A Document's Summary (#931) is generated the first time a Member opens that Document and cached on
its row until a re-crawl replaces the text. The consequence is worth stating plainly: **most
Documents have no summary**, because most Documents are never opened. That is the right trade for a
reading aid in the Details column, where the alternative is paying for a model call over every page
of every crawl so that a handful of them get read.

It is the wrong trade for anything that reads summaries in bulk. If a summary ever becomes a
retrieval bucket, or feeds a digest, a report or the Playground this map ruled out, it needs an
ingest-time job over every Document first, and that is a different cost shape from this one: one
call per crawled page rather than one per opened page, paid by the Organization that crawls rather
than by the Member who reads. Nothing here scales into that by accident, because nothing reads
`concepts.summary` except the card that made it.

## Status

Accepted, 2026-09-20 (ciele-org#911, #926). Nothing extracts these yet (#930) and nothing renders
them yet (#932); this decision is the record they will both write and read.
