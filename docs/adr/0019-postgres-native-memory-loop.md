# ADR-0019: Postgres-native long-term memory (promote → recall)

Status: accepted · Spec: ciele-org#660 · Ticket: ciele-org#664

## Context

Session memory (ADR-0006) is per-conversation: the `remember` tool writes facts into
`conversations.session_state`, and every new conversation starts from zero. The spec's
memory capability needs the other half, durable, per-end-user facts that survive across
conversations, with hard constraints locked upstream:

- **SaaS + self-host parity**: the capability must ship identically in the `deploy/`
  compose stack. Anything that isn't Postgres-plus-what-we-run breaks this.
- **SSO subjects only** (ADR-0018): memories attach to a verified OIDC subject, keyed
  with the Organization, never to client-generated visitor ids (GDPR posture).
- **Zero chat latency**: extraction must never run on the request path.
- **Bounded spend**: a busy day must not run up an unbounded extraction bill.

The research survey (`docs/research/long-term-memory-building-blocks.md`) evaluated
off-the-shelf layers, the Redis Agent Memory Server (the behavioural reference), mem0,
cognee, framework memory modules, and rejected them all: each adds a stateful service or
a foreign framework where every required building block already exists in the stack.

## Decision

**Build the promote/recall loop on Postgres, reusing the existing seams.**

1. **Store**: a `memories` table (org, SSO subject, text, 1536-dim padded embedding,
   provenance to the source Conversation) with an HNSW index and a `match_memories` SQL
   function, the exact `match_chunks` pattern from the RAG pipeline. Writes deduplicate
   on exact text per subject and enforce a per-subject cap (drop-oldest,
   `MEMORIES_PER_SUBJECT_CAP`). All access goes through the `Db` seam
   (`upsertMemories` / `listMemories` / `searchMemories` / delete + subject wipe),
   contract-tested against both implementations.
2. **Promote**: a `promote_memories` kind in the durable job ledger (ADR-0008). Every
   SSO turn enqueues a job due after a quiet window; a job that finds messages newer than
   itself defers (a fresher job exists), so only the conversation's last turn extracts.
   The handler gates on subject type, the org toggle, and the org's daily token budget,
   then asks the small classifier-tier model (org Provider Connections, ADR-0001) for
   durable facts, embeds them via the org's embedding connection, and upserts. Spend is
   metered under the new `memory_extract` stage, so it counts against the daily budget.
   The existing cron surface drains the jobs (`finalize-crawls` tick + the self-host
   `cron` compose profile), no new cron route, no compose change.
3. **Recall**: on the first turn of a conversation with a known subject, the top-k
   memories matching the opening message are injected as the "Long-term memory" system
   prompt layer (right below session memory). A `searchMemories` built-in tool covers
   mid-conversation recall; it registers by capability, the tool exists only when the
   org toggle is on AND the turn has a verified SSO subject, not by admin toggle.
4. **Enablement**: one org-level boolean (`organizations.memory_enabled`), off by
   default, surfaced in Settings → AI. While off, nothing extracts and nothing recalls.

## Consequences

- Full self-host parity for free: pgvector, the job ledger, provider connections and the
  cron profile are already in the compose stack; no new service to operate.
- Extraction quality is a prompt concern (conservative: explicit preferences, standing
  instructions, stable facts), iterate on the prompt, not the architecture.
- Erasure is a `Db` call (`deleteMemory` / `deleteSubjectMemories`); admin and widget
  management surfaces build on it without touching the loop.
- The Redis Agent Memory Server remains a behavioural reference only; adopting it (or
  mem0/cognee for this purpose) stays rejected under the parity constraint.
