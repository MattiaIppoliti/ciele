# Audit: Deep Search & OKF-graph retrieval primitives

Scope: verify, with file:line references, what part of the documented "Deep Search" /
OKF-graph navigation design (`agents.md` §5, `CONTEXT.md` "Deep Search") is actually
implemented in the runtime today, vs. documented-but-unbuilt. This is a facts-only audit
(issue #54, under the design map #52) — no design decisions or recommendations.

## 1. Deep Search / OKF-graph navigation: not implemented

`agents.md` §5 (lines 163–180) describes the Search-knowledge loop as:
1. Retrieve candidate Concepts (vector + lexical fallback), optionally anchored to a
   Course/Collection via a Context Hint.
2. **Optionally navigate the OKF graph (`index.md` → linked Concepts → Sources) — Deep
   Search gives the loop more iterations/multi-hop** (knowledge-only, never the open web).
3. Generate with native tool-use, cite Concept → Source.
4. Emit Thinking Steps.

`CONTEXT.md` (lines 55–56) defines **Deep Search** as "a composer mode that gives the
agent loop more iterations and multi-hop navigation of the OKF graph (index → linked
Concepts → Sources)."

None of step 2 exists in code:

- The only tool the agent loop can call for retrieval is `searchKnowledge`
  (`apps/web/src/lib/runtime/tools.ts:162-193`). Its `execute` (lines 174–192) does exactly
  one thing: `ctx.searchKnowledge(query)` → push results into `usedSources` → return them.
  There is no second retrieval mode, no graph-walk, no "expand from this Concept" tool.
- The closure passed in as `searchKnowledge` (`apps/web/src/lib/runtime/turn.ts:173-180`,
  mirrored for the standing-goal evaluator in `apps/web/src/lib/runtime/goal-runner.ts:71-78`)
  is a flat function: embed the query once, call `db.searchChunks(assistantId, collectionId,
  { embedding, text: query, limit: 6 })`. No concept id, no adjacency, no `index.md` is ever
  read or passed.
- `db.searchChunks` (Supabase impl: `packages/db/src/supabase.ts:1555-1631`) runs the
  `match_chunks` RPC (lines 1584–1589) and, **only if that returns zero rows**, falls back to
  an `ilike` lexical search over `concept_chunks` (lines 1562–1581, invoked at line 1592).
  Both paths are single-shot, single-collection, top-`k` queries — no traversal, no
  second-degree lookups.
- `match_chunks` itself (`supabase/migrations/0005_knowledge.sql:97-119`) is a plain SQL
  function: `order by cc.embedding <=> p_query_embedding limit p_match_count` — one cosine
  ANN query, nothing graph-shaped. (Re-declared with a hardened `search_path` in
  `supabase/migrations/0024_backfill_fix_function_search_paths.sql`, same query body.)
- The mock/offline engine's `searchChunks` (`packages/db/src/mock.ts:1778-1811`) is the
  demo-path equivalent: token-overlap scoring over in-memory chunks, sorted, sliced to
  `limit` — also single-shot, no graph.
- **No `index.md` handling exists anywhere.** `grep -rn "index.md"` across
  `apps/web/src` and `packages/db/src` returns zero matches. Concepts are never given an
  index/table-of-contents document, and nothing reads one.
- **No concept-adjacency/link model exists.** `grep -rn "graph|adjacen|linkedConcept|conceptLink"`
  across the same trees returns zero matches (aside from an unrelated calendar-grid comment
  and a support-channel description string). `ConceptFrontmatter`
  (`packages/db/src/types.ts:623-630`) has exactly five optional/required fields — `type`,
  `title`, `description`, `resource`, `tags`, `timestamp` — no `links`/`related`/`seeAlso`
  field, and `Concept` (lines 633-648) carries only `path`, `frontmatter`, `body`; markdown
  links inside a Concept's `body` are literal text, never parsed or followed.
- **No "Deep Search" toggle exists at all** — not a composer-mode flag, not an assistant
  setting, not a flow-action setting. `grep -rin "deep.search|deepSearch|composer.mode"`
  across `apps/web/src` returns zero matches. The term appears only in `agents.md` and
  `CONTEXT.md`; there is no code path, database column, or UI control it maps to.

**Conclusion for Q1**: `searchKnowledge` is exactly the flat `match_chunks` cosine search +
lexical fallback the issue hypothesized — nothing more. The OKF-graph navigation described
in `agents.md` §5 point 2 is 100% aspirational/documentation-only.

## 2. Iteration mechanics

- The generative loop lives in `searchKnowledgeHandler`
  (`apps/web/src/lib/runtime/actions.ts:215-438`). The no-model branch (lines 230–281) does a
  single non-agentic `searchKnowledge(message)` call and returns text — no loop at all.
- The model-driven branch calls `streamText` (lines 294–314) with:
  ```ts
  tools: buildToolset({ assistant, session, searchKnowledge, usedSources, emit, signal }),
  stopWhen: stepCountIs(5),
  ```
  `stepCountIs(5)` (AI SDK `stopWhen`) is a **total-step cap for the whole turn**, not a
  search-specific counter. A "step" is one model generation; the loop advances a step every
  time the model emits a tool call and continues, and terminates either when the model
  returns a response with no tool call, or once 5 steps have elapsed, whichever comes first.
- The cap is **shared across every tool in the turn's toolset**
  (`apps/web/src/lib/runtime/tools.ts:412-428`, `buildToolset`): `searchKnowledge` (always
  on), `calculator` and `remember` (default on), `fetchUrl` (default off), plus any
  admin-defined custom HTTP tools. A turn that also calls `remember` or `calculator` spends
  steps from the same 5-step budget as retrieval.
- Realistic search count under the cap: at most **4 sequential `searchKnowledge` calls**
  followed by a final text-only step (5 steps total: search, search, search, search,
  answer) — and only if the model makes no other tool calls that turn. In practice, fewer:
  any `remember`/`calculator`/`fetchUrl` call, or a step where the model calls two tools
  that must run sequentially, eats into the same budget. Reasoning text emitted *before* a
  tool call in the same step does not cost an extra step (it is reclassified into a
  `thought` event, `actions.ts:328-333`), but a distinct model turn to decide "I need to
  search again" always does.
- Reasoning/text produced after the step cap is hit but before any final answer text is
  handled defensively, not structurally: `actions.ts:400-409` — "The step cap (stopWhen) can
  cut the loop after a tool call, before any final text streamed — never leave the user with
  an empty bubble" — falls back to a fixed "I couldn't find a reliable answer…" string. This
  confirms the cap can truncate mid-loop with no guaranteed final synthesis step.
- **Does the model reformulate on its own today?** Nothing prevents it — `searchKnowledge`
  is an ordinary tool the model can call more than once with a different `query` string
  inside the 5-step budget, and the system prompt (`buildSystemPrompt`, `actions.ts:41-82`,
  specifically line 76) only instructs: "call the searchKnowledge tool before answering
  questions that depend on organization-specific facts." There is no instruction to
  decompose the query, evaluate what's already known, or search more than once — any
  multi-call behavior is emergent from the base model's own tool-use judgment, not an
  engineered reformulation strategy. This matches the parent map's (#52) own verification
  baseline: "#1 iterative reasoning 🟡 emergent (no evaluate-what-I-know gate)" and "#5
  multi-pass 🟡 5-step cap, no reformulation strategy."

**Conclusion for Q2**: the cap is a flat, shared, whole-turn step budget (not a
search-specific iteration counter), realistically allowing up to ~4 searches, with no
built-in query decomposition, coverage tracking, or forced reformulation — whatever
multi-search behavior appears is incidental to general tool-calling, not a designed loop.

## 3. What a reformulation strategy would have to work with today

Everything a "6-iteration reformulating search" design would need to hook into, as it
exists right now:

- **Concept links / adjacency**: none. `ConceptFrontmatter` (`packages/db/src/types.ts:623-630`)
  has no relation field. Nothing in the ingestion pipeline
  (`apps/web/src/lib/runtime/ingest.ts`) writes cross-concept links; the LLM-drafted concept
  schema (`CONCEPT_SCHEMA`, `ingest.ts:27-45`) asks only for `path`, `type`, `title`,
  `description`, `tags`, `body` — no `links`/`seeAlso` field is requested or stored.
- **Collection structure**: shallow. A Concept has a `collectionId` and a `path`
  (`types.ts:633-648`), and `path` is a flat, disambiguated filename
  (`ingest.ts:399-401`: `web/${slugify(page.title)}.md`, de-duped with a numeric suffix on
  collision) — not a directory hierarchy with semantic meaning. `listConcepts(collectionId)`
  and `getConcept(id)` (`packages/db/src/types.ts:1265-1267`) exist as generic CRUD, but a
  `grep` for their call sites shows they're used only by admin knowledge-editor pages/actions
  (`apps/web/src/app/actions.ts`, `apps/web/src/app/(admin)/assistants/[id]/page.tsx`) and a
  verifier/tests — never by the retrieval loop.
- **Adjacency / graph traversal primitives**: none exist at the `Db` interface level. There
  is no `getRelatedConcepts`, `getConceptsByPath`, or `listChunksNear` method — retrieval has
  exactly one entry point, `searchChunks(assistantId, collectionId, {embedding, text, limit})`
  (`packages/db/src/types.ts:1295` for the interface; Supabase impl at
  `packages/db/src/supabase.ts:1555`; mock at `packages/db/src/mock.ts:1778`).
- **`index.md` / progressive disclosure**: not modeled. No Concept is ever created with path
  `index.md`, no frontmatter field marks a Concept as an index/summary node, and nothing
  reads a document expecting that convention. This is purely a documentation phrase in
  `agents.md` §5 and ADR-0002 (`docs/adr/0002-knowledge-as-okf-bundles.md:5`, "its `index.md`
  progressive-disclosure convention matches how the agent loop navigates knowledge" — an
  aspirational rationale, not a built behavior).
- **What a reformulation strategy *could* reuse as-is**: the `searchKnowledge` tool already
  accepts an arbitrary free-text `query` per call (`tools.ts:166`), so a model- or
  code-driven reformulation could already issue different query strings against the same flat
  index without any new retrieval primitive — it would just be repeated flat search, not
  graph-aware multi-hop. `usedSources` collection + `dedupSources()`
  (`actions.ts:84-98`) already dedups and caps citations across multiple calls within a turn,
  so citation plumbing for a multi-search loop is in place even though the search itself
  isn't graph-aware.

**Conclusion for Q3**: a reformulating, graph-aware search would need to be built from
scratch on: (a) a concept-link/adjacency model (none exists in frontmatter, storage, or the
`Db` interface), (b) an `index.md`-equivalent entry-point convention (none exists), and (c) a
retrieval primitive beyond "top-k over one flat embedding index" (none exists — one RPC,
one fallback). The only reusable pieces are the tool-calling seam itself (a tool can be
called repeatedly with different query text) and the source-collection/dedup plumbing
downstream of retrieval.

## Summary table

| Primitive | Status | Evidence |
|---|---|---|
| Flat vector search (`match_chunks` cosine top-k) | **Real** | `supabase/migrations/0005_knowledge.sql:97-119`; `packages/db/src/supabase.ts:1584-1589` |
| Lexical fallback (`ilike`, only when vector search returns 0 rows) | **Real** | `packages/db/src/supabase.ts:1562-1581, 1592` |
| Collection anchoring (Context Hint → `collectionId` filter) | **Real** | `apps/web/src/lib/runtime/turn.ts:172-180` |
| Agent loop with tool-calling, ≤5 total steps (shared across all tools) | **Real** | `apps/web/src/lib/runtime/actions.ts:293-314` |
| Model-driven repeat search with different query text | **Real but emergent** (not engineered) | `apps/web/src/lib/runtime/tools.ts:162-193`; system prompt `actions.ts:76` gives no reformulation instruction |
| Query decomposition / "evaluate what I know" gate | **Not implemented** | no code found |
| OKF graph navigation (`index.md` → linked Concepts → Sources) | **Not implemented — documentation only** | zero matches for `index.md`/graph/adjacency in `apps/web/src`, `packages/db/src`; `agents.md:174-176`, `CONTEXT.md:55-56` |
| Concept-to-concept links in frontmatter/storage | **Not implemented** | `packages/db/src/types.ts:623-630, 633-648` |
| "Deep Search" composer-mode toggle | **Not implemented** | zero matches for `deep.search`/`composer.mode` in `apps/web/src` |
| Forced/bounded reformulation strategy (e.g. a distinct "6-iteration" loop) | **Not implemented** | the only cap is the shared 5-step `stopWhen`, not a search-specific iteration count |
